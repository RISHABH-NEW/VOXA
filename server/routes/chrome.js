/**
 * VOXA — Chrome Extension Router
 * Real-time SSE endpoint and action reporting for the VOXA Chrome Extension.
 */

const express = require('express');
const router = express.Router();
const { chromeExtensionManager } = require('../integrations/chrome');

/**
 * GET /api/extension/stream
 * Server-Sent Events stream kept open by the extension service worker.
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  chromeExtensionManager.addClient(res);
});

/**
 * POST /api/extension/heartbeat
 * Periodic ping from extension background worker.
 */
router.post('/heartbeat', (req, res) => {
  const { currentTab } = req.body || {};
  chromeExtensionManager.recordHeartbeat(currentTab);
  res.json({ success: true, timestamp: Date.now() });
});

/**
 * POST /api/extension/action-result
 * Extension reports the outcome of a dispatched browser action.
 */
router.post('/action-result', (req, res) => {
  const { actionId, result } = req.body || {};
  if (actionId) {
    chromeExtensionManager.handleActionResult(actionId, result || { success: true });
  }
  res.json({ success: true });
});

/**
 * GET /api/extension/status
 * Returns current extension connection status.
 */
router.get('/status', (req, res) => {
  res.json(chromeExtensionManager.getStatus());
});

module.exports = router;
