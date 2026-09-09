/**
 * VOXA — Express Server
 * Backend for the Adaptive Voice AI application.
 * 
 * Routes:
 *   GET  /api/health  — Health check with config validation
 *   POST /api/tts     — Proxy text to Rime TTS, returns audio/mpeg
 *   POST /api/chat    — Send messages to LLM, returns response text
 * 
 * All API keys are server-side only. Never exposed to frontend.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const rime = require('./rime');
const llm = require('./llm');

const authRoutes = require('./routes/auth');
const integrationsRoutes = require('./routes/integrations');
const chromeRoutes = require('./routes/chrome');
const { commandRouter } = require('./integrations/commandRouter');
const { integrationManager } = require('./integrations/integrationManager');
const { chromeExtensionManager } = require('./integrations/chrome');

const app = express();
const PORT = process.env.PORT || 10000;

// ── Middleware & CORS ─────────────────────────────────────────────────────────

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.BACKEND_URL,
  process.env.VOXA_BACKEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin, curl, server-to-server, or mobile requests without origin header
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin === o || origin.startsWith(o))) {
      return callback(null, true);
    }
    // Allow any Render deployment domain (*.onrender.com)
    if (origin.endsWith('.onrender.com')) {
      return callback(null, true);
    }
    // Allow localhost/127.0.0.1 in non-production
    if (process.env.NODE_ENV !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    return callback(new Error('CORS origin denied'), false);
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// ── Production Health Endpoint (Render requirement) ──────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VOXA',
  });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'client')));

// Mount modular sub-routers
app.use('/api/auth', authRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/extension', chromeRoutes);

// ── Request tracking for cancellation ────────────────────────────────────────

const activeRequests = new Map(); // requestId → AbortController

/**
 * Clean up an active request's abort controller.
 */
function cleanupRequest(requestId) {
  const controller = activeRequests.get(requestId);
  if (controller) {
    activeRequests.delete(requestId);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Health check with configuration validation and integration status.
 */
app.get('/api/health', (req, res) => {
  const rimeConfig = rime.validateConfig();
  const llmConfig = llm.validateConfig();
  const integrations = integrationManager.getStatus();

  const healthy = rimeConfig.valid && llmConfig.valid;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      rime: {
        status: rimeConfig.valid ? 'configured' : 'misconfigured',
        config: rimeConfig.config,
        issues: rimeConfig.issues,
      },
      llm: {
        status: llmConfig.valid ? 'configured' : 'misconfigured',
        config: llmConfig.config,
        issues: llmConfig.issues,
      },
      ...integrations.services,
    },
    integrations,
  });
});

/**
 * POST /api/chat
 * Generate a response from the LLM, executing any requested integration actions.
 * 
 * Body: {
 *   messages: [{role: "user"|"assistant", content: string}],
 *   requestId: string,
 *   context: object
 * }
 * 
 * Returns: {
 *   text: string,
 *   requestId: string,
 *   responseType: "llm"|"fallback",
 *   toolResult?: object,
 *   toolDurationMs?: number,
 *   service?: string,
 *   action?: string
 * }
 */
app.post('/api/chat', async (req, res) => {
  const { messages, requestId, context = {} } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Messages array is required',
      code: 'INVALID_INPUT',
    });
  }

  if (!requestId) {
    return res.status(400).json({
      error: 'requestId is required',
      code: 'MISSING_REQUEST_ID',
    });
  }

  // Create abort controller for this request
  const controller = new AbortController();
  activeRequests.set(requestId, controller);

  try {
    const lastUserMessage = messages[messages.length - 1];
    let toolResult = null;
    let toolDurationMs = null;
    let executedService = null;
    let executedAction = null;

    // ── Command Routing & Integration Execution ─────────────
    if (lastUserMessage && lastUserMessage.role === 'user') {
      const routing = commandRouter.route(lastUserMessage.content, context);

      if (routing.requiresIntegration) {
        executedService = routing.service;
        executedAction = routing.action;

        console.log(`[Integration Router] Executing ${routing.service}.${routing.action} for request ${requestId.slice(0, 8)}`);
        const toolStart = performance.now();

        toolResult = await integrationManager.execute({
          service: routing.service,
          action: routing.action,
          parameters: routing.parameters || {},
          signal: controller.signal,
          requestId,
        });

        toolDurationMs = Math.round(performance.now() - toolStart);

        if (controller.signal.aborted) {
          throw new llm.LLMError('Request was cancelled during tool execution', 'CANCELLED');
        }
      }
    }

    // ── LLM Response Generation ─────────────────────────────
    const text = await llm.generateResponse(messages, {
      signal: controller.signal,
      toolResult,
    });

    cleanupRequest(requestId);

    res.json({
      text,
      requestId,
      responseType: 'llm',
      isMock: (process.env.LLM_MODE || 'live') === 'mock',
      toolResult,
      toolDurationMs,
      service: executedService,
      action: executedAction,
    });
  } catch (err) {
    cleanupRequest(requestId);

    if (err.code === 'CANCELLED') {
      return res.status(499).json({
        error: 'Request was cancelled',
        code: 'CANCELLED',
        requestId,
      });
    }

    console.error(`[LLM Error] ${err.message}`);

    res.status(502).json({
      error: "Sorry, I couldn't process that request. Please try again.",
      code: err.code || 'LLM_ERROR',
      requestId,
      responseType: 'fallback',
    });
  }
});

/**
 * POST /api/tts
 * Convert text to speech using Rime TTS.
 * 
 * Body: { text: string, requestId: string }
 * Returns: audio/mpeg binary
 */
app.post('/api/tts', async (req, res) => {
  const { text, requestId } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({
      error: 'Text is required',
      code: 'INVALID_INPUT',
    });
  }

  if (!requestId) {
    return res.status(400).json({
      error: 'requestId is required',
      code: 'MISSING_REQUEST_ID',
    });
  }

  // Create abort controller for this request
  const controller = new AbortController();
  activeRequests.set(`tts-${requestId}`, controller);

  try {
    const audioBuffer = await rime.synthesize(text, {
      signal: controller.signal,
    });

    cleanupRequest(`tts-${requestId}`);

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'X-Request-Id': requestId,
    });

    res.send(audioBuffer);
  } catch (err) {
    cleanupRequest(`tts-${requestId}`);

    if (err.code === 'CANCELLED') {
      return res.status(499).json({
        error: 'TTS request was cancelled',
        code: 'CANCELLED',
        requestId,
      });
    }

    console.error(`[Rime Error] ${err.message}`);

    const status = err.statusCode || 502;
    res.status(status).json({
      error: 'Voice delivery failed. Try again.',
      code: err.code || 'RIME_ERROR',
      requestId,
      detail: err.message,
    });
  }
});

/**
 * POST /api/cancel
 * Cancel an active request (LLM or TTS).
 * Used when the frontend detects an interruption.
 * 
 * Body: { requestId: string }
 */
app.post('/api/cancel', (req, res) => {
  const { requestId } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId is required' });
  }

  let cancelled = 0;

  // Cancel LLM request
  const llmController = activeRequests.get(requestId);
  if (llmController) {
    llmController.abort();
    activeRequests.delete(requestId);
    cancelled++;
  }

  // Cancel TTS request
  const ttsController = activeRequests.get(`tts-${requestId}`);
  if (ttsController) {
    ttsController.abort();
    activeRequests.delete(`tts-${requestId}`);
    cancelled++;
  }

  // Cancel Chrome extension pending actions
  chromeExtensionManager.cancelRequest(requestId);

  res.json({
    cancelled: cancelled > 0,
    requestId,
    operationsCancelled: cancelled,
  });
});

// ── Public Legal & Compliance Routes (Google OAuth verification) ───────────

app.get(['/privacy-policy', '/privacy'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'privacy-policy.html'));
});

app.get(['/terms', '/terms-of-service'], (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'terms.html'));
});

// ── Google OAuth Callback Route Alias (supports both /api/auth and /auth paths) ─
app.get('/auth/google/callback', (req, res) => {
  const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  res.redirect(307, `/api/auth/google/callback${query}`);
});

// ── Fallback: serve index.html for client-side routing ───────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// ── Startup ──────────────────────────────────────────────────────────────────

const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  const hostUrl = process.env.RENDER_EXTERNAL_URL || process.env.VOXA_BACKEND_URL || (process.env.NODE_ENV === 'production' ? 'https://voxa-cvsr.onrender.com' : `http://localhost:${PORT}`);
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         VOXA — Adaptive Voice AI     ║');
  console.log('  ║       Speak. Interrupt. Adapt.        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  🌐  ${hostUrl}`);
  console.log(`  🚀  Bound to 0.0.0.0:${PORT}`);
  console.log('');

  // Validate configuration
  const rimeConfig = rime.validateConfig();
  const llmConfig = llm.validateConfig();

  if (rimeConfig.valid) {
    console.log(`  ✅  Rime TTS: ${rimeConfig.config.model} / ${rimeConfig.config.speaker}`);
  } else {
    console.log(`  ⚠️   Rime TTS: ${rimeConfig.issues.join(', ')}`);
  }

  if (llmConfig.valid) {
    console.log(`  ✅  LLM: ${llmConfig.config.provider} / ${llmConfig.config.model} (${llmConfig.config.mode})`);
  } else {
    if (llmConfig.config.mode === 'mock') {
      console.log('  ✅  LLM: mock mode (development)');
    } else {
      console.log(`  ⚠️   LLM: ${llmConfig.issues.join(', ')}`);
    }
  }

  console.log('');
});

module.exports = app;
