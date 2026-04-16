// /**
//  * regular-wheel-processor.js  —  MEGASPIN HIGH THROUGHPUT EDITION
//  *
//  * Target: 20,000+ accounts/hour on MegaSpin
//  *
//  * Architecture:
//  *  - Continuous worker pool (no batch gaps)
//  *  - 50 concurrent workers default (MegaSpin is permissive, plain ws://)
//  *  - Minimal delays: 50ms stagger, no inter-account sleep
//  *  - Smart retry: connection errors only, never server rejections
//  *  - Hard timeout: 20s per account (MegaSpin responds fast, no need for 35s)
//  *  - WS handshake: 8s (plain ws is faster than wss)
//  *  - Spin close delay: 100ms (was 300-500ms)
//  *
//  * Throughput math:
//  *   50 workers × 3 accounts/sec each = 150 accounts/sec = ~20,000/hr (realistic with proxy overhead)
//  *   Without proxy: 50 workers × ~1.5s per account = ~120,000/hr (direct, if server allows)
//  *
//  * MegaSpin specifics:
//  *   - Plain ws:// (not wss) — faster handshake
//  *   - noWeekendSpin = true — single spin only, no re-check needed
//  *   - No IP ban tracking needed (less aggressive than PandaMaster)
//  */

// const WebSocket    = require('ws');
// const EventEmitter = require('events');
// const { makeProxyAgent, ProxyRotator } = require('./proxyUtils');

// class RegularWheelProcessor extends EventEmitter {
//   constructor(db) {
//     super();
//     this.db              = db;
//     this.isProcessing    = false;
//     this.currentAccounts = [];
//     this.proxyRotator    = new ProxyRotator([]);
//     this.instanceId      = 'default';

//     this.stats = {
//       successCount:  0,
//       failCount:     0,
//       wheelSpins:    0,
//       totalScoreWon: 0,
//       activeWorkers: 0,
//       processed:     0,
//       startTime:     null,
//     };

//     this.config = {
//       // Runtime-overwritable by game selector / processing route
//       LOGIN_WS_URL:  'ws://47.251.75.73:8600/',
//       GAME_VERSION:  '2.0.1',
//       ORIGIN:        'http://47.251.75.73',

//       // ── Throughput settings ─────────────────────────────────────────────
//       // 50 workers × ~1.4s avg per account = ~128k/hr theoretical
//       // With proxy overhead (~2-3s avg): ~60-80k/hr per proxy pool
//       // Realistic with 20-50 proxies: 15k-25k/hr
//       WORKERS:        50,

//       // Stagger between worker starts — prevents TCP SYN flood on startup
//       // 50 workers × 50ms = 2.5s total ramp-up
//       STAGGER_MS:     50,

//       // Only retry on connection/timeout — not server rejections
//       RETRY_ATTEMPTS: 1,

//       TIMEOUTS: {
//         TOTAL: 20000,  // MegaSpin responds in <2s — 20s is very generous
//         WS:    8000,   // Plain ws:// handshake is faster than wss
//       },

//       // Post-spin close delay — just enough for the server to ack
//       CLOSE_DELAY_MS: 100,
//     };

//     this.mobileUserAgents = [
//       'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
//       'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
//       'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
//       'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
//       'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
//       'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
//     ];
//   }

//   // ── Public API ──────────────────────────────────────────────────────────────

//   async startProcessing(accountIds, repetitions = 1, useProxy = false, proxyList = []) {
//     if (this.isProcessing) throw new Error('Already processing');

//     this.isProcessing = true;
//     this.stats = {
//       successCount: 0, failCount: 0, wheelSpins: 0,
//       totalScoreWon: 0, activeWorkers: 0, processed: 0,
//       startTime: Date.now(),
//     };

//     this.proxyRotator = new ProxyRotator(proxyList);

//     // Cap workers to proxy count only when proxies are enabled
//     // Without proxy: use full WORKERS count — MegaSpin allows direct connections
//     const workerCount = (useProxy && proxyList.length > 0)
//       ? Math.min(this.config.WORKERS, proxyList.length)
//       : this.config.WORKERS;

//     const all = await this.db.getAllAccounts();
//     this.currentAccounts = all.filter(a => accountIds.includes(a.id));

//     const total = this.currentAccounts.length;
//     const estimatedHourly = Math.round(workerCount * (3600 / 2.5)); // ~2.5s avg per account

//     this._emit('terminal', { type: 'info',    message: `🚀 MEGASPIN WHEEL BOT STARTED` });
//     this._emit('terminal', { type: 'info',    message: `📋 Accounts: ${total}` });
//     this._emit('terminal', { type: 'info',    message: `⚡ Workers: ${workerCount} concurrent` });
//     this._emit('terminal', { type: 'info',    message: `📈 Est. throughput: ~${estimatedHourly.toLocaleString()}/hr` });
//     this._emit('terminal', { type: 'info',    message: `🌐 Login: ${this.config.LOGIN_WS_URL}` });
//     this._emit('terminal', { type: 'info',    message: `🛡️ Proxy: ${this.proxyRotator.enabled ? this.proxyRotator.summary() : 'disabled (direct)'}` });
//     this._emit('status',   { running: true, total, current: 0, activeWorkers: 0 });

//     this._runWorkerPool(workerCount);
//     return { started: true, totalAccounts: total };
//   }

//   async stopProcessing() {
//     this.isProcessing = false;
//     this._emit('terminal', { type: 'warning', message: '🛑 Processing stopped by user' });
//     this._emit('status',   { running: false, activeWorkers: 0 });
//     return { success: true };
//   }

//   // ── Continuous worker pool ──────────────────────────────────────────────────
//   // N workers all pulling from a shared queue simultaneously.
//   // As soon as one account finishes, the worker immediately grabs the next.
//   // No batch waiting, no sleep between accounts.

//   async _runWorkerPool(workerCount) {
//     const queue = [...this.currentAccounts];
//     let   queueIdx = 0;
//     const total    = queue.length;

//     const getNext = () => {
//       if (queueIdx >= total) return null;
//       return { account: queue[queueIdx], index: queueIdx++ };
//     };

//     const worker = async (workerId) => {
//       while (this.isProcessing) {
//         const next = getNext();
//         if (!next) break;

//         const { account, index } = next;
//         this.stats.activeWorkers++;
//         this._emit('status', {
//           running: true, total, current: index + 1,
//           activeWorkers: this.stats.activeWorkers,
//           currentAccount: account.username,
//         });

//         try {
//           await this._processWithRetry(account, index);
//         } catch (_) {}

//         this.stats.activeWorkers--;
//         this.stats.processed++;

//         // Progress report every 50 accounts (less spam than every 10)
//         if (this.stats.processed % 50 === 0) {
//           const elapsed = (Date.now() - this.stats.startTime) / 1000;
//           const rate    = elapsed > 0 ? Math.round((this.stats.processed / elapsed) * 3600) : 0;
//           this._emit('terminal', {
//             type: 'info',
//             message: `📊 ${this.stats.processed}/${total} | ✅ ${this.stats.successCount} | ❌ ${this.stats.failCount} | ⚡ ${rate.toLocaleString()}/hr | Workers: ${this.stats.activeWorkers}`,
//           });
//         }
//       }
//     };

//     // Start workers with small stagger to avoid burst on startup
//     const workers = [];
//     for (let i = 0; i < workerCount; i++) {
//       await this._sleep(this.config.STAGGER_MS);
//       if (!this.isProcessing) break;
//       workers.push(worker(i));
//     }

//     await Promise.allSettled(workers);
//     if (this.isProcessing) this._complete();
//   }

//   // ── Retry wrapper ───────────────────────────────────────────────────────────

//   async _processWithRetry(account, globalIndex, attempt = 0) {
//     const result = await this._accountFlow(account, globalIndex, attempt);

//     // Persist score update
//     if (result.newScore !== undefined) {
//       await this.db.updateAccount({ ...account, score: result.newScore });
//     }
//     await this.db.addProcessingLog(
//       account.id,
//       result.success ? 'success' : (result.serverRejected ? 'rejected' : 'error'),
//       result.success ? `Spin: +${result.lotteryscore || 0}` : result.error,
//       result
//     );

//     // Server rejection (wrong pass, account not found) — don't retry
//     if (result.serverRejected) {
//       this.stats.failCount++;
//       return result;
//     }

//     // Connection/timeout error — retry once with fresh proxy
//     if (!result.success && attempt < this.config.RETRY_ATTEMPTS) {
//       this._log(globalIndex, 'warning', `🔄 Retry ${attempt + 1}/${this.config.RETRY_ATTEMPTS}`);
//       // No sleep — grab fresh proxy and go immediately
//       return this._processWithRetry(account, globalIndex, attempt + 1);
//     }

//     if (result.success) {
//       this.stats.successCount++;
//       if (result.wheelSpun)    this.stats.wheelSpins++;
//       if (result.lotteryscore) this.stats.totalScoreWon += result.lotteryscore;
//     } else {
//       this.stats.failCount++;
//     }

//     this._emit('progress', {
//       index: globalIndex, total: this.currentAccounts.length,
//       account: account.username, success: result.success,
//       error: result.error, stats: { ...this.stats },
//     });

//     return result;
//   }

//   // ── Core account flow ───────────────────────────────────────────────────────
//   // State machine: login → check → spin → done
//   // MegaSpin flow is identical to PandaMaster protocol (same subIDs)

//   _accountFlow(account, index, attempt = 0) {
//     return new Promise(async (resolve) => {
//       let ws    = null;
//       let phase = 'login';

//       let loginDone    = false;
//       let wheelSpun    = false;
//       let lotteryscore = 0;
//       let lastScore    = account.score || 0;

//       // Hard timeout — MegaSpin responds fast, 20s is very generous
//       const hardTimeout = setTimeout(() => {
//         cleanup();
//         resolve({ success: wheelSpun, wheelSpun, lotteryscore, newScore: lastScore, error: 'Timeout' });
//       }, this.config.TIMEOUTS.TOTAL);

//       const cleanup = () => {
//         clearTimeout(hardTimeout);
//         try { if (ws && ws.readyState <= 1) ws.terminate(); } catch (_) {}
//       };

//       const done = (result) => {
//         if (phase === 'done') return;
//         phase = 'done';
//         cleanup();
//         resolve(result);
//       };

//       // ── Proxy selection ──────────────────────────────────────────────────
//       let agent = null;
//       if (this.proxyRotator.enabled) {
//         const proxyUrl = this.proxyRotator.next();
//         if (proxyUrl) {
//           try {
//             agent = await makeProxyAgent(proxyUrl);
//           } catch (_) {}
//         }
//       }

//       // ── WebSocket ────────────────────────────────────────────────────────
//       const wsOptions = {
//         handshakeTimeout: this.config.TIMEOUTS.WS,
//         headers: {
//           'User-Agent': this._userAgent(),
//           'Origin':     this.config.ORIGIN,
//         },
//       };
//       if (agent) wsOptions.agent = agent;

//       try {
//         ws = new WebSocket(this.config.LOGIN_WS_URL, ['wl'], wsOptions);
//       } catch (err) {
//         return resolve({ success: false, error: `WS create: ${err.message}` });
//       }

//       ws.on('open', () => {
//         // Step 1 — Login
//         ws.send(JSON.stringify({
//           account:  account.username,
//           password: account.password,
//           version:  this.config.GAME_VERSION,
//           mainID:   100,
//           subID:    6,
//         }));
//       });

//       ws.on('message', (raw) => {
//         if (phase === 'done') return;
//         let msg;
//         try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

//         // ── Login response (subID:116) ────────────────────────────────────
//         if (msg.subID === 116 && !loginDone) {
//           const d = msg.data || {};

//           if (!d.userid || !d.dynamicpass) {
//             // result=3 = wrong password, result=2 = account not found
//             const serverRejected = d.result === 3 || d.result === 2 || d.result === -1;
//             this._log(index, 'error', `❌ Login failed — result=${d.result} msg="${d.msg || ''}"`);
//             return done({ success: false, serverRejected, error: `Login rejected (result:${d.result})` });
//           }

//           account.userid      = d.userid;
//           account.dynamicpass = d.dynamicpass;
//           lastScore           = d.score || lastScore;
//           loginDone           = true;

//           // Step 2 — Check wheel availability
//           phase = 'check';
//           ws.send(JSON.stringify({
//             userid:   account.userid,
//             password: account.password,
//             mainID:   100,
//             subID:    26,
//           }));
//           return;
//         }

//         // ── Availability check (subID:142) ────────────────────────────────
//         if (msg.subID === 142 && phase === 'check') {
//           const d = msg.data || {};
//           if (d.dynamicpass) account.dynamicpass = d.dynamicpass;
//           if (d.score !== undefined) lastScore = d.score;

//           const regularAvail = d.blottery === 1;

//           if (!regularAvail) {
//             // Already spun today — still a "success" (account is fine)
//             return done({ success: true, wheelSpun: false, lotteryscore: 0, newScore: lastScore, message: 'Already spun' });
//           }

//           // Step 3 — Spin
//           phase = 'spin';
//           ws.send(JSON.stringify({
//             userid:      account.userid,
//             dynamicpass: account.dynamicpass,
//             mainID:      100,
//             subID:       16,
//           }));
//           return;
//         }

//         // ── Spin result (subID:131) ───────────────────────────────────────
//         if (msg.subID === 131 && phase === 'spin') {
//           const d = msg.data || {};
//           wheelSpun    = true;
//           lotteryscore = d.lotteryscore || 0;
//           lastScore    = d.score !== undefined ? d.score : lastScore;

//           if (d.result === 0) {
//             this._log(index, 'success', `🎉 +${lotteryscore} | bal:${lastScore}`);
//           }

//           // Minimal close delay — just enough for server ack
//           setTimeout(() => done({
//             success: true, wheelSpun: true, lotteryscore, newScore: lastScore,
//           }), this.config.CLOSE_DELAY_MS);
//           return;
//         }
//       });

//       ws.on('error', (err) => {
//         done({ success: false, error: err.message, wheelSpun, lotteryscore, newScore: lastScore });
//       });

//       ws.on('close', (code) => {
//         if (phase !== 'done') {
//           done({ success: wheelSpun, wheelSpun, lotteryscore, newScore: lastScore });
//         }
//       });
//     });
//   }

//   // ── Completion ──────────────────────────────────────────────────────────────

//   _complete() {
//     this.isProcessing = false;
//     const elapsed = this.stats.startTime ? ((Date.now() - this.stats.startTime) / 1000).toFixed(1) : '?';
//     const rate    = this.stats.startTime && elapsed > 0
//       ? Math.round((this.stats.processed / elapsed) * 3600)
//       : 0;

//     this._emit('terminal', { type: 'success', message: `\n🎉 ALL PROCESSING COMPLETED!` });
//     this._emit('terminal', { type: 'info',    message: `📈 Success: ${this.stats.successCount} | Failed: ${this.stats.failCount}` });
//     this._emit('terminal', { type: 'info',    message: `🎡 Spins: ${this.stats.wheelSpins} | Score: ${this.stats.totalScoreWon}` });
//     this._emit('terminal', { type: 'info',    message: `⏱️  Time: ${elapsed}s | Rate: ${rate.toLocaleString()}/hr` });
//     this._emit('completed', { ...this.stats });
//     this._emit('status',   { running: false, activeWorkers: 0 });
//   }

//   // ── Helpers ─────────────────────────────────────────────────────────────────

//   _emit(event, data) { this.emit(event, data); }

//   _log(index, type, message) {
//     // Only emit errors/warnings to terminal — suppress debug/info per-account to reduce overhead
//     if (type === 'error' || type === 'warning') {
//       this.emit('terminal', { type, message: `[${index}] ${message}`, timestamp: new Date().toISOString() });
//     }
//   }

//   _userAgent() {
//     return this.mobileUserAgents[Math.floor(Math.random() * this.mobileUserAgents.length)];
//   }

//   _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
// }

// module.exports = RegularWheelProcessor;


/**
 * regular-wheel-processor.js  —  MEGASPIN HIGH THROUGHPUT EDITION
 *
 * Exact flow reverse-engineered from browser WebSocket capture:
 *
 *  CONNECTION 1 (login + check):
 *    → send subID:6  (login with account/password)
 *    ← recv subID:116 (get userid, dynamicpass, bossid)
 *    → send subID:11  (game list request — browser sends this, keeps server happy)
 *    → send subID:10  (bossid ping)
 *    → send subID:26  (check wheel availability, uses userid + password)
 *    ← recv subID:142 (blottery:1 = available, blottery:0 = already spun)
 *    → close connection 1
 *
 *  If blottery === 0: done (already spun today)
 *
 *  CONNECTION 2 (spin):
 *    → send subID:16  (spin wheel, uses userid + dynamicpass)
 *    ← recv subID:131 (lotteryscore, result)
 *    → close connection 2
 *
 * Target: 20,000+ accounts/hour
 * Architecture: continuous worker pool, no batch gaps
 */

const WebSocket    = require('ws');
const EventEmitter = require('events');
const { makeProxyAgent, ProxyRotator } = require('./proxyUtils');

class RegularWheelProcessor extends EventEmitter {
  constructor(db) {
    super();
    this.db              = db;
    this.isProcessing    = false;
    this.currentAccounts = [];
    this.proxyRotator    = new ProxyRotator([]);
    this.instanceId      = 'default';

    this.stats = {
      successCount:  0,
      failCount:     0,
      wheelSpins:    0,
      alreadySpun:   0,
      totalScoreWon: 0,
      activeWorkers: 0,
      processed:     0,
      startTime:     null,
    };

    this.config = {
      LOGIN_WS_URL:  'ws://47.251.75.73:8600/',
      GAME_VERSION:  '2.0.1',
      ORIGIN:        'http://okay.jkgame.vip',   // exact origin from browser capture

      WORKERS:        50,
      STAGGER_MS:     50,
      RETRY_ATTEMPTS: 1,

      TIMEOUTS: {
        CONN1: 15000,   // login + check connection
        CONN2: 10000,   // spin-only connection
        WS:    8000,    // handshake timeout
      },

      CLOSE_DELAY_MS: 80,
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

    this.isProcessing = true;
    this.stats = {
      successCount: 0, failCount: 0, wheelSpins: 0, alreadySpun: 0,
      totalScoreWon: 0, activeWorkers: 0, processed: 0,
      startTime: Date.now(),
    };

    this.proxyRotator = new ProxyRotator(useProxy ? proxyList : []);

    const workerCount = (useProxy && proxyList.length > 0)
      ? Math.min(this.config.WORKERS, proxyList.length)
      : this.config.WORKERS;

    const all = await this.db.getAllAccounts();
    this.currentAccounts = all.filter(a => accountIds.includes(a.id));
    const total = this.currentAccounts.length;

    // Throughput estimate: 2 connections per account, ~1.5s avg each = ~3s per account
    const estHourly = Math.round(workerCount * (3600 / 3));

    this._emit('terminal', { type: 'info', message: `🚀 MEGASPIN WHEEL BOT STARTED` });
    this._emit('terminal', { type: 'info', message: `📋 Accounts: ${total} | Workers: ${workerCount}` });
    this._emit('terminal', { type: 'info', message: `📈 Est. throughput: ~${estHourly.toLocaleString()}/hr` });
    this._emit('terminal', { type: 'info', message: `🌐 Server: ${this.config.LOGIN_WS_URL}` });
    this._emit('terminal', { type: 'info', message: `🛡️ Proxy: ${this.proxyRotator.enabled ? this.proxyRotator.summary() : 'disabled (direct)'}` });
    this._emit('status',   { running: true, total, current: 0, activeWorkers: 0 });

    this._runWorkerPool(workerCount);
    return { started: true, totalAccounts: total };
  }

  async stopProcessing() {
    this.isProcessing = false;
    this._emit('terminal', { type: 'warning', message: '🛑 Processing stopped' });
    this._emit('status',   { running: false, activeWorkers: 0 });
    return { success: true };
  }

  // ── Continuous worker pool ──────────────────────────────────────────────────

  async _runWorkerPool(workerCount) {
    const queue  = [...this.currentAccounts];
    let queueIdx = 0;
    const total  = queue.length;

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
        });

        try { await this._processWithRetry(account, index); } catch (_) {}

        this.stats.activeWorkers--;
        this.stats.processed++;

        if (this.stats.processed % 50 === 0) {
          const elapsed = (Date.now() - this.stats.startTime) / 1000;
          const rate    = elapsed > 0 ? Math.round((this.stats.processed / elapsed) * 3600) : 0;
          this._emit('terminal', {
            type: 'info',
            message: `📊 ${this.stats.processed}/${total} | ✅${this.stats.successCount} spun | ⏭️${this.stats.alreadySpun} done | ❌${this.stats.failCount} err | ⚡${rate.toLocaleString()}/hr`,
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
    if (this.isProcessing) this._complete();
  }

  // ── Retry wrapper ───────────────────────────────────────────────────────────

  async _processWithRetry(account, globalIndex, attempt = 0) {
    const result = await this._accountFlow(account, globalIndex);

    if (result.newScore !== undefined) {
      await this.db.updateAccount({ ...account, score: result.newScore }).catch(() => {});
    }
    await this.db.addProcessingLog(
      account.id,
      result.success ? (result.wheelSpun ? 'spun' : 'already_spun') : (result.serverRejected ? 'rejected' : 'error'),
      result.success
        ? (result.wheelSpun ? `Spin OK: +${result.lotteryscore || 0}` : 'Already spun today')
        : result.error,
      result
    ).catch(() => {});

    if (result.serverRejected) {
      this.stats.failCount++;
      return result;
    }

    if (!result.success && attempt < this.config.RETRY_ATTEMPTS) {
      this._log(globalIndex, 'warning', `🔄 Retry ${attempt + 1}`);
      return this._processWithRetry(account, globalIndex, attempt + 1);
    }

    if (result.success) {
      this.stats.successCount++;
      if (result.wheelSpun) {
        this.stats.wheelSpins++;
        if (result.lotteryscore) this.stats.totalScoreWon += result.lotteryscore;
      } else {
        this.stats.alreadySpun++;
      }
    } else {
      this.stats.failCount++;
    }

    this._emit('progress', {
      index: globalIndex, total: this.currentAccounts.length,
      account: account.username, success: result.success,
      wheelSpun: result.wheelSpun, lotteryscore: result.lotteryscore,
      error: result.error, stats: { ...this.stats },
    });

    return result;
  }

  // ── Core account flow ───────────────────────────────────────────────────────
  // Exact match of browser flow: 2 separate WebSocket connections

  async _accountFlow(account, index) {
    // Get a proxy for this account (shared across both connections for this account)
    let proxyUrl = null;
    if (this.proxyRotator.enabled) proxyUrl = this.proxyRotator.next();

    // ── Step 1: Login + Check (Connection 1) ────────────────────────────────
    let loginResult;
    try {
      loginResult = await this._loginAndCheck(account, index, proxyUrl);
    } catch (err) {
      return { success: false, error: `Conn1 error: ${err.message}` };
    }

    if (!loginResult.success) return loginResult;

    // Already spun today — valid success, skip spin connection
    if (!loginResult.available) {
      return {
        success: true, wheelSpun: false, lotteryscore: 0,
        newScore: loginResult.score, message: 'Already spun today',
      };
    }

    // ── Step 2: Spin (Connection 2) ─────────────────────────────────────────
    let spinResult;
    try {
      spinResult = await this._spinWheel(account, index, proxyUrl, loginResult);
    } catch (err) {
      return { success: false, error: `Conn2 error: ${err.message}` };
    }

    return spinResult;
  }

  // ── Connection 1: Login → subID:11 → subID:10 → subID:26 → check ────────

  _loginAndCheck(account, index, proxyUrl) {
    return new Promise(async (resolve) => {
      let ws     = null;
      let phase  = 'login';
      let closed = false;

      // Account data populated during login
      let userid      = null;
      let dynamicpass = null;
      let bossid      = null;
      let score       = account.score || 0;

      const timer = setTimeout(() => {
        close();
        resolve({ success: false, error: 'Conn1 timeout' });
      }, this.config.TIMEOUTS.CONN1);

      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try { if (ws && ws.readyState <= 1) ws.terminate(); } catch (_) {}
      };

      const done = (result) => {
        if (phase === 'done') return;
        phase = 'done';
        close();
        resolve(result);
      };

      const wsOptions = {
        handshakeTimeout: this.config.TIMEOUTS.WS,
        headers: {
          'User-Agent': this._userAgent(),
          'Origin':     this.config.ORIGIN,
        },
      };
      if (proxyUrl) {
        try { wsOptions.agent = await makeProxyAgent(proxyUrl); } catch (_) {}
      }

      try {
        ws = new WebSocket(this.config.LOGIN_WS_URL, ['wl'], wsOptions);
      } catch (err) {
        clearTimeout(timer);
        return resolve({ success: false, error: `WS create: ${err.message}` });
      }

      ws.on('open', () => {
        // Step 1 — Login
        ws.send(JSON.stringify({
          account:  account.username,
          password: account.password,
          version:  this.config.GAME_VERSION,
          mainID:   100,
          subID:    6,
        }));
      });

      ws.on('message', (raw) => {
        if (phase === 'done') return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        // ── Login response ──────────────────────────────────────────────
        if (msg.subID === 116 && phase === 'login') {
          const d = msg.data || {};

          if (!d.userid || !d.dynamicpass) {
            const serverRejected = [2, 3, -1].includes(d.result);
            this._log(index, 'error', `❌ Login fail result=${d.result}`);
            return done({ success: false, serverRejected, error: `Login rejected (${d.result})` });
          }

          userid      = d.userid;
          dynamicpass = d.dynamicpass;
          bossid      = d.bossid;
          score       = d.score !== undefined ? d.score : score;

          // Update account with session data for use in spin connection
          account.userid      = userid;
          account.dynamicpass = dynamicpass;
          account.bossid      = bossid;

          phase = 'lobby';

          // Send game list request (subID:11) — browser sends this, keeps server happy
          ws.send(JSON.stringify({ userid, mainID: 100, subID: 11 }));

          // Send bossid ping (subID:10) — observed in browser capture
          ws.send(JSON.stringify({ bossid, mainID: 100, subID: 10 }));

          // Send wheel check (subID:26) — uses userid + original password
          ws.send(JSON.stringify({
            userid,
            password: account.password,
            mainID:   100,
            subID:    26,
          }));

          phase = 'check';
          return;
        }

        // ── Wheel availability response ─────────────────────────────────
        if (msg.subID === 142 && phase === 'check') {
          const d = msg.data || {};

          if (d.dynamicpass) {
            dynamicpass = d.dynamicpass;
            account.dynamicpass = dynamicpass;
          }
          if (d.score !== undefined) score = d.score;

          const available = d.blottery === 1;
          this._log(index, 'info', available
            ? `🎡 Wheel available (score:${score})`
            : `⏭️ Already spun today`
          );

          return done({
            success:    true,
            available,
            userid,
            dynamicpass,
            score,
          });
        }

        // Ignore other messages (subID:122 game list, subID:120 jackpot, etc.)
      });

      ws.on('error', (err) => {
        done({ success: false, error: err.message });
      });

      ws.on('close', () => {
        if (phase !== 'done') {
          done({ success: false, error: 'Conn1 closed unexpectedly' });
        }
      });
    });
  }

  // ── Connection 2: Spin only ──────────────────────────────────────────────

  _spinWheel(account, index, proxyUrl, loginResult) {
    return new Promise(async (resolve) => {
      let ws     = null;
      let phase  = 'spin';
      let closed = false;

      const { userid, dynamicpass, score: scoreFromCheck } = loginResult;
      let score = scoreFromCheck || account.score || 0;

      const timer = setTimeout(() => {
        close();
        resolve({ success: false, error: 'Conn2 spin timeout' });
      }, this.config.TIMEOUTS.CONN2);

      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        try { if (ws && ws.readyState <= 1) ws.terminate(); } catch (_) {}
      };

      const done = (result) => {
        if (phase === 'done') return;
        phase = 'done';
        // Small delay before close — matches browser behaviour (server ack)
        setTimeout(() => { close(); resolve(result); }, this.config.CLOSE_DELAY_MS);
      };

      const wsOptions = {
        handshakeTimeout: this.config.TIMEOUTS.WS,
        headers: {
          'User-Agent': this._userAgent(),
          'Origin':     this.config.ORIGIN,
        },
      };
      if (proxyUrl) {
        try { wsOptions.agent = await makeProxyAgent(proxyUrl); } catch (_) {}
      }

      try {
        ws = new WebSocket(this.config.LOGIN_WS_URL, ['wl'], wsOptions);
      } catch (err) {
        clearTimeout(timer);
        return resolve({ success: false, error: `Conn2 WS create: ${err.message}` });
      }

      ws.on('open', () => {
        // Spin — uses userid + dynamicpass (NOT password)
        ws.send(JSON.stringify({
          userid,
          dynamicpass,
          mainID: 100,
          subID:  16,
        }));
      });

      ws.on('message', (raw) => {
        if (phase === 'done') return;
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

        if (msg.subID === 131 && phase === 'spin') {
          const d          = msg.data || {};
          const lotteryscore = d.lotteryscore || 0;
          const newScore     = d.score !== undefined ? d.score : score;

          if (d.result === 0) {
            this._log(index, 'success', `🎉 Spun! +${lotteryscore} | bal:${newScore}`);
            return done({ success: true, wheelSpun: true, lotteryscore, newScore });
          } else {
            this._log(index, 'error', `❌ Spin failed result=${d.result}`);
            return done({ success: false, error: `Spin rejected (${d.result})`, serverRejected: true });
          }
        }
      });

      ws.on('error', (err) => {
        if (phase !== 'done') {
          phase = 'done';
          close();
          resolve({ success: false, error: `Spin WS error: ${err.message}` });
        }
      });

      ws.on('close', () => {
        if (phase !== 'done') {
          phase = 'done';
          close();
          resolve({ success: false, error: 'Spin WS closed before response' });
        }
      });
    });
  }

  // ── Completion ──────────────────────────────────────────────────────────────

  _complete() {
    this.isProcessing = false;
    const elapsed = this.stats.startTime
      ? ((Date.now() - this.stats.startTime) / 1000).toFixed(1) : '?';
    const rate = (elapsed > 0 && this.stats.startTime)
      ? Math.round((this.stats.processed / elapsed) * 3600) : 0;

    this._emit('terminal', { type: 'success', message: `\n🎉 ALL DONE!` });
    this._emit('terminal', { type: 'info',    message: `✅ Spun: ${this.stats.wheelSpins} | ⏭️ Already done: ${this.stats.alreadySpun} | ❌ Failed: ${this.stats.failCount}` });
    this._emit('terminal', { type: 'info',    message: `🎡 Total score won: ${this.stats.totalScoreWon}` });
    this._emit('terminal', { type: 'info',    message: `⏱️ Time: ${elapsed}s | Rate: ${rate.toLocaleString()}/hr` });
    this._emit('completed', { ...this.stats });
    this._emit('status',    { running: false, activeWorkers: 0 });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _emit(event, data) { this.emit(event, data); }

  _log(index, type, message) {
    // Only forward errors, warnings, and successes to terminal — suppress info per-account
    if (type === 'error' || type === 'warning' || type === 'success') {
      this.emit('terminal', {
        type, message: `[${index}] ${message}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  _userAgent() {
    return this.mobileUserAgents[Math.floor(Math.random() * this.mobileUserAgents.length)];
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = RegularWheelProcessor;