/**
 * weekend-wheel-processor.js  —  MEGASPIN HIGH THROUGHPUT EDITION
 *
 * MegaSpin has noWeekendSpin = true, so this processor always runs
 * in single-spin mode (same as regular-wheel-processor) but supports
 * multi-cycle repetition for repeated daily runs.
 *
 * Same throughput architecture as regular-wheel-processor:
 *  - 50 concurrent workers
 *  - 50ms stagger
 *  - 20s hard timeout
 *  - No inter-account delays
 */

const WebSocket    = require('ws');
const EventEmitter = require('events');
const { makeProxyAgent, ProxyRotator } = require('./proxyUtils');

class WeekendWheelProcessor extends EventEmitter {
  constructor(db) {
    super();
    this.db              = db;
    this.isProcessing    = false;
    this.currentAccounts = [];
    this.proxyRotator    = new ProxyRotator([]);
    this.instanceId      = 'default';
    this.noWeekendSpin   = true;   // MegaSpin default
    this.totalCycles     = 1;
    this.currentCycle    = 0;

    this.stats = {
      successCount:      0,
      failCount:         0,
      regularWheelSpins: 0,
      weekendWheelSpins: 0,
      totalScoreWon:     0,
      activeWorkers:     0,
      cyclesCompleted:   0,
      processed:         0,
      startTime:         null,
    };

    this.config = {
      LOGIN_WS_URL:  'ws://47.251.75.73:8600/',
      GAME_VERSION:  '2.0.1',
      ORIGIN:        'http://47.251.75.73',

      WORKERS:        50,
      STAGGER_MS:     50,
      RETRY_ATTEMPTS: 1,

      TIMEOUTS: {
        TOTAL: 20000,
        WS:    8000,
      },

      CLOSE_DELAY_MS: 100,

      // Between cycles — short pause so server doesn't see instant re-runs
      CYCLE_DELAY: { MIN: 1000, MAX: 3000 },
    };

    this.mobileUserAgents = [
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
    ];
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async startProcessing(accountIds, repetitions = 1, useProxy = false, proxyList = []) {
    if (this.isProcessing) throw new Error('Already processing');

    this.isProcessing  = true;
    this.totalCycles   = Math.max(1, Math.min(100, parseInt(repetitions) || 1));
    this.currentCycle  = 0;

    this.stats = {
      successCount: 0, failCount: 0,
      regularWheelSpins: 0, weekendWheelSpins: 0,
      totalScoreWon: 0, activeWorkers: 0, cyclesCompleted: 0,
      processed: 0, startTime: Date.now(),
    };

    this.proxyRotator = new ProxyRotator(proxyList);

    const workerCount = (useProxy && proxyList.length > 0)
      ? Math.min(this.config.WORKERS, proxyList.length)
      : this.config.WORKERS;

    const all = await this.db.getAllAccounts();
    this.currentAccounts = all.filter(a => accountIds.includes(a.id));

    const total          = this.currentAccounts.length;
    const estimatedHourly = Math.round(workerCount * (3600 / 2.5));
    const spinMode = this.noWeekendSpin ? 'Single Spin only' : 'Regular + Weekend';

    this._emit('terminal', { type: 'info', message: `🚀 MEGASPIN WHEEL BOT STARTED` });
    this._emit('terminal', { type: 'info', message: `📋 Accounts: ${total} | Cycles: ${this.totalCycles}` });
    this._emit('terminal', { type: 'info', message: `⚡ Workers: ${workerCount} concurrent` });
    this._emit('terminal', { type: 'info', message: `📈 Est. throughput: ~${estimatedHourly.toLocaleString()}/hr` });
    this._emit('terminal', { type: 'info', message: `🎯 Strategy: ${spinMode}` });
    this._emit('terminal', { type: 'info', message: `🌐 Login: ${this.config.LOGIN_WS_URL}` });
    this._emit('terminal', { type: 'info', message: `🛡️ Proxy: ${this.proxyRotator.enabled ? this.proxyRotator.summary() : 'disabled (direct)'}` });
    this._emit('status', {
      running: true, total, current: 0, activeWorkers: 0,
      currentCycle: 0, totalCycles: this.totalCycles,
    });

    this._runCycles(workerCount);
    return { started: true, totalAccounts: total, totalCycles: this.totalCycles };
  }

  async stopProcessing() {
    this.isProcessing = false;
    this._emit('terminal', { type: 'warning', message: '🛑 Processing stopped by user' });
    this._emit('status', { running: false, activeWorkers: 0 });
    return { success: true };
  }

  // ── Cycle loop ──────────────────────────────────────────────────────────────

  async _runCycles(workerCount) {
    while (this.isProcessing && this.currentCycle < this.totalCycles) {
      this.currentCycle++;
      this.stats.processed = 0;

      const sep = '─'.repeat(55);
      this._emit('terminal', { type: 'info', message: `\n${sep}\n🔄 CYCLE ${this.currentCycle}/${this.totalCycles}\n${sep}` });
      this._emit('cycleStart', {
        cycle: this.currentCycle, totalCycles: this.totalCycles,
        accountCount: this.currentAccounts.length,
      });

      await this._runWorkerPool(workerCount);

      this.stats.cyclesCompleted = this.currentCycle;
      this._emit('cycleUpdate', { ...this.stats, cyclesCompleted: this.currentCycle, totalCycles: this.totalCycles });

      const elapsed = ((Date.now() - this.stats.startTime) / 1000).toFixed(1);
      const rate    = elapsed > 0 ? Math.round((this.stats.processed / elapsed) * 3600) : 0;
      this._emit('terminal', { type: 'success',
        message: `✅ Cycle ${this.currentCycle} done | Spins: ${this.stats.regularWheelSpins} | Score: ${this.stats.totalScoreWon} | Rate: ${rate.toLocaleString()}/hr` });

      if (this.isProcessing && this.currentCycle < this.totalCycles) {
        const delay = this._rand(this.config.CYCLE_DELAY.MIN, this.config.CYCLE_DELAY.MAX);
        this._emit('terminal', { type: 'info', message: `⏳ Next cycle in ${delay}ms...` });
        await this._sleep(delay);
      }
    }
    this._complete();
  }

  // ── Continuous worker pool ──────────────────────────────────────────────────

  async _runWorkerPool(workerCount) {
    const queue   = [...this.currentAccounts];
    let   queueIdx = 0;
    const total   = queue.length;

    const getNext = () => {
      if (queueIdx >= total) return null;
      return { account: queue[queueIdx], index: queueIdx++ };
    };

    const worker = async () => {
      while (this.isProcessing) {
        const next = getNext();
        if (!next) break;

        const { account, index } = next;
        this.stats.activeWorkers++;
        this._emit('status', {
          running: true, total, current: index + 1,
          activeWorkers: this.stats.activeWorkers,
          currentAccount: account.username,
          currentCycle: this.currentCycle, totalCycles: this.totalCycles,
        });

        try {
          await this._processWithRetry(account, index);
        } catch (_) {}

        this.stats.activeWorkers--;
        this.stats.processed++;

        if (this.stats.processed % 50 === 0) {
          const elapsed = (Date.now() - this.stats.startTime) / 1000;
          const rate    = elapsed > 0 ? Math.round((this.stats.processed / elapsed) * 3600) : 0;
          this._emit('terminal', {
            type: 'info',
            message: `📊 [C${this.currentCycle}] ${this.stats.processed}/${total} | ✅ ${this.stats.successCount} | ❌ ${this.stats.failCount} | ⚡ ${rate.toLocaleString()}/hr`,
          });
        }
      }
    };

    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      await this._sleep(this.config.STAGGER_MS);
      if (!this.isProcessing) break;
      workers.push(worker());
    }

    await Promise.allSettled(workers);
  }

  // ── Retry wrapper ───────────────────────────────────────────────────────────

  async _processWithRetry(account, globalIndex, attempt = 0) {
    const result = await this._accountFlow(account, globalIndex, attempt);

    if (result.newScore !== undefined) {
      await this.db.updateAccount({ ...account, score: result.newScore });
    }
    await this.db.addProcessingLog(
      account.id,
      result.success ? 'success' : (result.serverRejected ? 'rejected' : 'error'),
      result.success
        ? `R:${result.regularSpun ? '✓' : '✗'} W:${result.weekendSpun ? '✓' : '✗'} +${result.totalScoreWon || 0}`
        : result.error,
      result
    );

    if (result.serverRejected) {
      this.stats.failCount++;
      return result;
    }

    if (!result.success && attempt < this.config.RETRY_ATTEMPTS) {
      this._log(globalIndex, 'warning', `🔄 Retry ${attempt + 1}/${this.config.RETRY_ATTEMPTS}`);
      return this._processWithRetry(account, globalIndex, attempt + 1);
    }

    if (result.success) {
      this.stats.successCount++;
      if (result.regularSpun)   this.stats.regularWheelSpins++;
      if (result.weekendSpun)   this.stats.weekendWheelSpins++;
      if (result.totalScoreWon) this.stats.totalScoreWon += result.totalScoreWon;
    } else {
      this.stats.failCount++;
    }

    this._emit('progress', {
      index: globalIndex, total: this.currentAccounts.length,
      account: account.username, success: result.success,
      stats: { ...this.stats },
    });
    this._emit('wheelStats', { ...this.stats });

    return result;
  }

  // ── Core account flow ───────────────────────────────────────────────────────
  // MegaSpin: noWeekendSpin=true so we skip weekend spin entirely

  _accountFlow(account, index, attempt = 0) {
    return new Promise(async (resolve) => {
      let ws    = null;
      let phase = 'login';

      let loginDone     = false;
      let regularSpun   = false;
      let weekendSpun   = false;
      let totalScoreWon = 0;
      let lastScore     = account.score || 0;

      const hardTimeout = setTimeout(() => {
        cleanup();
        resolve({ success: regularSpun || weekendSpun, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore, error: 'Timeout' });
      }, this.config.TIMEOUTS.TOTAL);

      const cleanup = () => {
        clearTimeout(hardTimeout);
        try { if (ws && ws.readyState <= 1) ws.terminate(); } catch (_) {}
      };

      const done = (result) => {
        if (phase === 'done') return;
        phase = 'done';
        cleanup();
        resolve(result);
      };

      // ── Proxy ──────────────────────────────────────────────────────────
      let agent = null;
      if (this.proxyRotator.enabled) {
        const proxyUrl = this.proxyRotator.next();
        if (proxyUrl) {
          try { agent = await makeProxyAgent(proxyUrl); } catch (_) {}
        }
      }

      const wsOptions = {
        handshakeTimeout: this.config.TIMEOUTS.WS,
        headers: {
          'User-Agent': this._userAgent(),
          'Origin':     this.config.ORIGIN,
        },
      };
      if (agent) wsOptions.agent = agent;

      try {
        ws = new WebSocket(this.config.LOGIN_WS_URL, ['wl'], wsOptions);
      } catch (err) {
        return resolve({ success: false, error: `WS create: ${err.message}`, regularSpun, weekendSpun, totalScoreWon });
      }

      ws.on('open', () => {
        ws.send(JSON.stringify({
          account: account.username, password: account.password,
          version: this.config.GAME_VERSION, mainID: 100, subID: 6,
        }));
      });

      ws.on('message', (raw) => {
        if (phase === 'done') return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        // ── Login (subID:116) ──────────────────────────────────────────
        if (msg.subID === 116 && !loginDone) {
          const d = msg.data || {};

          if (!d.userid || !d.dynamicpass) {
            const serverRejected = d.result === 3 || d.result === 2 || d.result === -1;
            this._log(index, 'error', `❌ Login failed result=${d.result}`);
            return done({ success: false, serverRejected, error: `Login rejected (result:${d.result})`, regularSpun, weekendSpun, totalScoreWon });
          }

          account.userid      = d.userid;
          account.dynamicpass = d.dynamicpass;
          lastScore           = d.score !== undefined ? d.score : lastScore;
          loginDone           = true;

          phase = 'check';
          ws.send(JSON.stringify({ userid: account.userid, password: account.password, mainID: 100, subID: 26 }));
          return;
        }

        // ── Availability (subID:142) ───────────────────────────────────
        if (msg.subID === 142) {
          const d = msg.data || {};
          if (d.dynamicpass) account.dynamicpass = d.dynamicpass;
          if (d.score !== undefined) lastScore = d.score;

          const regularAvail = d.blottery === 1;
          const weekendAvail = d.blotteryhappyweek === 1;

          if (phase === 'check') {
            if (regularAvail) {
              phase = 'spin_regular';
              ws.send(JSON.stringify({ userid: account.userid, dynamicpass: account.dynamicpass, mainID: 100, subID: 16 }));
            } else if (!this.noWeekendSpin && weekendAvail) {
              phase = 'spin_weekend';
              ws.send(JSON.stringify({ userid: account.userid, dynamicpass: account.dynamicpass, mainID: 100, subID: 27 }));
            } else {
              return done({ success: true, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore, message: 'No wheels available' });
            }
            return;
          }

          if (phase === 'check_weekend') {
            if (!this.noWeekendSpin && weekendAvail) {
              phase = 'spin_weekend';
              ws.send(JSON.stringify({ userid: account.userid, dynamicpass: account.dynamicpass, mainID: 100, subID: 27 }));
            } else {
              return done({ success: true, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore });
            }
            return;
          }
          return;
        }

        // ── Regular spin result (subID:131) ───────────────────────────
        if (msg.subID === 131 && phase === 'spin_regular') {
          const d = msg.data || {};
          regularSpun   = true;
          const won     = d.lotteryscore || 0;
          lastScore     = d.score !== undefined ? d.score : lastScore;
          totalScoreWon += won;

          if (d.result === 0) this._log(index, 'success', `🎉 Regular: +${won}`);

          // MegaSpin: no weekend wheel — done immediately
          if (this.noWeekendSpin) {
            return setTimeout(() => done({
              success: true, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore,
            }), this.config.CLOSE_DELAY_MS);
          }

          phase = 'check_weekend';
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN && phase !== 'done') {
              ws.send(JSON.stringify({ userid: account.userid, password: account.password, mainID: 100, subID: 26 }));
            }
          }, 300);
          return;
        }

        // ── Weekend spin result (subID:143) ───────────────────────────
        if (msg.subID === 143 && phase === 'spin_weekend') {
          const d = msg.data || {};
          weekendSpun   = true;
          const won     = d.lotteryscore || 0;
          lastScore     = d.score !== undefined ? d.score : lastScore;
          totalScoreWon += won;

          if (d.result === 0) this._log(index, 'success', `🎉 Weekend: +${won}`);

          setTimeout(() => done({
            success: true, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore,
          }), this.config.CLOSE_DELAY_MS);
          return;
        }
      });

      ws.on('error', (err) => {
        done({ success: false, error: err.message, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore });
      });

      ws.on('close', () => {
        if (phase !== 'done') {
          done({ success: regularSpun || weekendSpun, regularSpun, weekendSpun, totalScoreWon, newScore: lastScore });
        }
      });
    });
  }

  // ── Completion ──────────────────────────────────────────────────────────────

  _complete() {
    this.isProcessing = false;
    const elapsed = this.stats.startTime ? ((Date.now() - this.stats.startTime) / 1000).toFixed(1) : '?';
    const rate    = this.stats.startTime && elapsed > 0
      ? Math.round((this.stats.processed / elapsed) * 3600)
      : 0;

    this._emit('terminal', { type: 'success', message: `\n🎉 ALL PROCESSING COMPLETED!` });
    this._emit('terminal', { type: 'info',    message: `📈 Success: ${this.stats.successCount} | Failed: ${this.stats.failCount}` });
    this._emit('terminal', { type: 'info',    message: `🎡 Spins: ${this.stats.regularWheelSpins} | Weekend: ${this.stats.weekendWheelSpins} | Score: ${this.stats.totalScoreWon}` });
    this._emit('terminal', { type: 'info',    message: `⏱️  Time: ${elapsed}s | Rate: ${rate.toLocaleString()}/hr` });
    this._emit('completed', { ...this.stats });
    this._emit('status',   { running: false, activeWorkers: 0 });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _emit(event, data) { this.emit(event, data); }

  _log(index, type, message) {
    if (type === 'error' || type === 'warning' || type === 'success') {
      this.emit('terminal', { type, message: `[${index}] ${message}`, timestamp: new Date().toISOString() });
    }
  }

  _userAgent() {
    return this.mobileUserAgents[Math.floor(Math.random() * this.mobileUserAgents.length)];
  }

  _rand(min, max) { return Math.floor(Math.random() * (max - min)) + min; }
  _sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = WeekendWheelProcessor;
