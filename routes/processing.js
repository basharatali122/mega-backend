const router = require('express').Router();

// GET /api/processing/all/status — MUST be before /:profile routes
router.get('/all/status', (req, res) => {
  try {
    const profiles = req.app.get('botManager').getActiveProcessors(req.userId);
    res.json({ success: true, profiles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/processing/:profile/status
router.get('/:profile/status', async (req, res) => {
  try {
    const botManager = req.app.get('botManager');
    const instance = await botManager.getInstance(req.userId, req.params.profile);
    if (!instance) return res.json({ running: false });

    const proc = instance.processor;
    res.json({
      running:       proc.isProcessing,
      wheelMode:     instance.wheelMode,
      currentCycle:  proc.currentCycle || 0,
      totalCycles:   proc.totalCycles  || 0,
      activeWorkers: proc.stats?.activeWorkers || 0,
      stats:         proc.stats || {},
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/processing/:profile/start
router.post('/:profile/start', async (req, res) => {
  try {
    const botManager = req.app.get('botManager');
    const {
      repetitions = 1,
      accountIds,
      wheelMode = 'single',
      gameConfig,
      workers,        // optional override from frontend
    } = req.body;

    const { processor, db } = await botManager.getOrCreateInstance(
      req.userId, req.params.profile, wheelMode
    );

    if (processor.isProcessing) {
      return res.status(400).json({ error: 'Already processing' });
    }

    // ── Apply game server config ─────────────────────────────────────────────
    const gc = (gameConfig && typeof gameConfig === 'object') ? gameConfig : {};

    const CONFIG_KEYS = ['LOGIN_WS_URL', 'GAME_VERSION', 'ORIGIN'];
    for (const k of CONFIG_KEYS) {
      if (gc[k] !== undefined && gc[k] !== null && gc[k] !== '') {
        processor.config[k] = gc[k];
      }
    }

    if (gc.noWeekendSpin !== undefined) {
      processor.noWeekendSpin = !!gc.noWeekendSpin;
    }

    // ── MegaSpin worker config ────────────────────────────────────────────────
    // MegaSpin uses plain ws://, no wss overhead, and doesn't ban IPs aggressively.
    // 50 workers is the sweet spot for 20k+/hr throughput.
    // Cap: 100 workers max to prevent memory exhaustion.
    // Floor: 1 worker minimum.
    const gameId = gc.id || 'megaspin';
    const defaultWorkers = 50; // MegaSpin optimal

    const workerCount = Math.min(100, Math.max(1, parseInt(workers) || gc.workers || defaultWorkers));
    processor.config.WORKERS = workerCount;

    console.log(`🎮 [${req.userId.substring(0, 8)}] Game=${gameId} URL=${processor.config.LOGIN_WS_URL} Origin=${processor.config.ORIGIN} Workers=${workerCount} NoWeekend=${processor.noWeekendSpin}`);

    // ── Proxy setup ──────────────────────────────────────────────────────────
    const proxyConfig = db.getProxyConfig();
    let useProxy = false, proxyList = [];
    if (proxyConfig?.enabled) {
      useProxy  = true;
      proxyList = Array.isArray(proxyConfig.proxyList)
        ? proxyConfig.proxyList
        : (proxyConfig.proxyList || '').split('\n').filter(Boolean);
    }

    // ── Account IDs ──────────────────────────────────────────────────────────
    let ids = accountIds;
    if (!ids || ids.length === 0) {
      ids = db.getAllAccounts().map(a => a.id);
    }
    if (ids.length === 0) {
      return res.status(400).json({ error: 'No accounts found. Please add accounts first.' });
    }

    let result;
    if (wheelMode === 'double') {
      result = await processor.startProcessing(ids, repetitions, useProxy, proxyList);
    } else {
      result = await processor.startProcessing(ids, 1, useProxy, proxyList);
    }

    res.json({ success: true, wheelMode, workers: workerCount, ...result });
  } catch (err) {
    console.error('Start processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/processing/:profile/stop
router.post('/:profile/stop', async (req, res) => {
  try {
    const instance = await req.app.get('botManager').getInstance(req.userId, req.params.profile);
    if (!instance) return res.json({ success: true, message: 'Not running' });
    const result = await instance.processor.stopProcessing();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
