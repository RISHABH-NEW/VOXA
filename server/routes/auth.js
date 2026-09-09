/**
 * VOXA — Google Auth Routes
 * Express router for Google OAuth 2.0 flow, status, and disconnect.
 */

const express = require('express');
const router = express.Router();
const authService = require('../integrations/google/auth');

/**
 * GET /api/auth/google
 * Initiates the Google OAuth consent flow.
 */
router.get('/google', (req, res) => {
  try {
    const authUrl = authService.getAuthUrl();
    res.redirect(authUrl);
  } catch (err) {
    console.error('[Auth Route Error]:', err.message);
    res.status(500).send(`<h3>Google OAuth Error</h3><p>${err.message}</p><a href="/">Return to VOXA</a>`);
  }
});

/**
 * GET /api/auth/google/callback
 * Handles OAuth 2.0 redirect from Google with authorization code.
 */
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('[Auth Callback Error]:', error);
    return res.send(`
      <html>
        <body style="background:#0a0a0f;color:#ef4444;font-family:sans-serif;padding:30px;text-align:center;">
          <h2>Google Authorization Failed</h2>
          <p>${error}</p>
          <p><a href="/" style="color:#6366f1;">Back to VOXA</a></p>
        </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send('Authorization code missing.');
  }

  try {
    await authService.handleCallback(code);
    // Send success page that auto-closes if in popup, or redirects back to app
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>VOXA — Google Connected</title>
          <style>
            body { background: #0a0a0f; color: #f0f0f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #12121a; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: center; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
            h2 { color: #34d399; margin-top: 0; }
            p { color: #a0a0b8; margin-bottom: 24px; }
            .btn { background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>✓ Connected to Google</h2>
            <p>Your Calendar, Classroom, and Gmail are now linked to VOXA.</p>
            <a href="/" class="btn" onclick="window.close();">Return to VOXA</a>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'VOXA_GOOGLE_CONNECTED' }, '*');
              setTimeout(() => window.close(), 1200);
            } else {
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('[Auth Callback Token Exchange Error]:', err.message);
    res.status(500).send(`
      <html>
        <body style="background:#0a0a0f;color:#ef4444;font-family:sans-serif;padding:30px;text-align:center;">
          <h2>Connection Failed</h2>
          <p>${err.message}</p>
          <p><a href="/" style="color:#6366f1;">Back to VOXA</a></p>
        </body>
      </html>
    `);
  }
});

/**
 * GET /api/auth/google/status
 * Returns connection state and service permissions.
 */
router.get('/google/status', (req, res) => {
  const status = authService.getAuthStatus();
  res.json(status);
});

/**
 * POST /api/auth/google/disconnect
 * Revokes Google tokens and resets integration state.
 */
router.post('/google/disconnect', async (req, res) => {
  try {
    await authService.disconnect();
    res.json({ success: true, message: 'Google account disconnected' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
