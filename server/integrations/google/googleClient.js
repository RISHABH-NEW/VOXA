/**
 * VOXA — Google OAuth2 Client & Token Manager
 * Manages Google OAuth 2.0 authentication, tokens, persistence, and service access.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const TOKENS_PATH = path.join(__dirname, '..', '..', '..', 'data', 'google_tokens.json');

// Scopes required for VOXA's read-only student workflow
const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

class GoogleClientManager {
  constructor() {
    this.oauth2Client = null;
    this.tokens = null;
    this.userEmail = null;
    this._initClient();
    this._loadTokensFromDisk();
  }

  _initClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const backendUrl = process.env.BACKEND_URL || process.env.VOXA_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || (process.env.NODE_ENV === 'production' ? 'https://voxa-cvsr.onrender.com' : 'http://localhost:3000');
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${backendUrl}/api/auth/google/callback`;

    if (clientId && clientSecret) {
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      // Listen for token refresh events to save updated access tokens
      this.oauth2Client.on('tokens', (tokens) => {
        console.log('[Google Auth] New tokens received (refresh or rotation)');
        this.saveTokens(tokens, true);
      });
    } else {
      this.oauth2Client = null;
    }
  }

  _loadTokensFromDisk() {
    try {
      if (fs.existsSync(TOKENS_PATH)) {
        const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (data.tokens && this.oauth2Client) {
          this.tokens = data.tokens;
          this.userEmail = data.email || null;
          this.oauth2Client.setCredentials(data.tokens);
          console.log(`[Google Auth] Loaded saved tokens for user: ${this.userEmail || 'unknown'}`);
        }
      }
    } catch (err) {
      console.warn('[Google Auth] Could not load saved tokens:', err.message);
    }
  }

  isConfigured() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    return !!(clientId && clientSecret && clientId !== 'your_google_client_id_here');
  }

  isAuthenticated() {
    return !!(this.oauth2Client && this.tokens && (this.tokens.access_token || this.tokens.refresh_token));
  }

  getOAuth2Client() {
    if (!this.oauth2Client) {
      this._initClient();
    }
    return this.oauth2Client;
  }

  generateAuthUrl(state = '') {
    const client = this.getOAuth2Client();
    if (!client) {
      throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.');
    }

    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: REQUIRED_SCOPES,
      state,
    });
  }

  async handleCallback(code) {
    const client = this.getOAuth2Client();
    if (!client) {
      throw new Error('Google OAuth client not configured.');
    }

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    this.tokens = tokens;

    // Fetch user email if possible
    let email = null;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const userinfo = await oauth2.userinfo.get();
      email = userinfo.data.email || null;
      this.userEmail = email;
    } catch (e) {
      console.warn('[Google Auth] Could not fetch user email:', e.message);
    }

    this.saveTokens(tokens, false, email);
    return { success: true, email };
  }

  saveTokens(tokens, isMerge = false, email = null) {
    try {
      const dir = path.dirname(TOKENS_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let mergedTokens = tokens;
      if (isMerge && this.tokens) {
        mergedTokens = { ...this.tokens, ...tokens };
      }
      this.tokens = mergedTokens;
      if (email) this.userEmail = email;

      const payload = {
        tokens: mergedTokens,
        email: this.userEmail,
        updatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(TOKENS_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
      if (this.oauth2Client) {
        this.oauth2Client.setCredentials(mergedTokens);
      }
    } catch (err) {
      console.error('[Google Auth] Failed to save tokens to disk:', err.message);
    }
  }

  async disconnect() {
    try {
      if (this.oauth2Client && this.tokens?.access_token) {
        try {
          await this.oauth2Client.revokeToken(this.tokens.access_token);
        } catch (e) {
          console.warn('[Google Auth] Remote token revocation warning:', e.message);
        }
      }
    } finally {
      this.tokens = null;
      this.userEmail = null;
      if (this.oauth2Client) {
        this.oauth2Client.setCredentials({});
      }
      if (fs.existsSync(TOKENS_PATH)) {
        try {
          fs.unlinkSync(TOKENS_PATH);
        } catch (e) {
          console.warn('[Google Auth] Could not delete token file:', e.message);
        }
      }
      console.log('[Google Auth] Disconnected Google account and cleared local tokens.');
    }
    return { success: true };
  }

  getStatus() {
    const configured = this.isConfigured();
    const authenticated = this.isAuthenticated();
    const grantedScopes = this.tokens?.scope ? this.tokens.scope.split(' ') : [];

    return {
      configured,
      connected: authenticated,
      userEmail: this.userEmail,
      scopes: grantedScopes,
      services: {
        calendar: {
          connected: authenticated,
          status: authenticated ? 'Connected ✓' : (configured ? 'Not Connected' : 'Unconfigured'),
          permission: authenticated ? 'granted' : 'none',
        },
        classroom: {
          connected: authenticated,
          status: authenticated ? 'Connected ✓' : (configured ? 'Not Connected' : 'Unconfigured'),
          permission: authenticated ? 'granted' : 'none',
        },
        gmail: {
          connected: authenticated,
          status: authenticated ? 'Connected ✓' : (configured ? 'Not Connected' : 'Unconfigured'),
          permission: authenticated ? 'granted' : 'none',
        },
      },
    };
  }
}

const googleClientManager = new GoogleClientManager();

module.exports = {
  googleClientManager,
  REQUIRED_SCOPES,
};
