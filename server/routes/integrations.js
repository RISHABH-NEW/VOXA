/**
 * VOXA — Integrations Router
 * Direct query and status endpoint for connected services.
 */

const express = require('express');
const router = express.Router();
const { integrationManager } = require('../integrations/integrationManager');

/**
 * GET /api/integrations/status
 * Returns connection state of Google services and Chrome extension.
 */
router.get('/status', (req, res) => {
  const status = integrationManager.getStatus();
  res.json(status);
});

/**
 * POST /api/integrations/execute
 * Direct endpoint to test or trigger any integration action.
 * Body: { service, action, parameters }
 */
router.post('/execute', async (req, res) => {
  const { service, action, parameters, requestId } = req.body;

  if (!service || !action) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INPUT',
      message: 'service and action are required',
    });
  }

  try {
    const result = await integrationManager.execute({
      service,
      action,
      parameters: parameters || {},
      requestId: requestId || `direct-${Date.now()}`,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      success: false,
      service,
      action,
      error: 'EXECUTION_ERROR',
      message: err.message,
    });
  }
});

module.exports = router;
