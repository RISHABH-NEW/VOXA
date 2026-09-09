# VOXA — Production Deployment Guide

This guide provides end-to-end instructions for deploying **VOXA (Adaptive Voice AI)** to **Render** as a unified full-stack web service with Google OAuth 2.0, Rime TTS, Gemini/OpenAI LLM, Interruption Engine, and Manifest V3 Chrome Extension support.

---

## 1. GitHub Setup

VOXA is organized so the entire full-stack application (frontend static assets, backend API, and Chrome extension) resides within a single clean repository.

### Step 1: Initialize Git and Commit
Ensure your `.gitignore` protects secrets, then commit the repository:

```bash
# Initialize repository (if not already done)
git init

# Stage all production assets (secrets are automatically ignored)
git add .

# Create initial production release commit
git commit -m "feat: prepare VOXA for production deployment on Render"
```

### Step 2: Push to GitHub
Create a new private or public repository on [GitHub](https://github.com/new), then link and push:

```bash
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO-NAME>.git
git push -u origin main
```

> [!IMPORTANT]
> Verify before pushing that `.env` and `data/` are not committed:
> ```bash
> git status
> ```
> `.env` and `data/google_tokens.json` must **NEVER** appear in `git status`.

---

## 2. Render Setup

VOXA runs as a standard **Node.js Web Service** on Render.

### Option A: Manual Setup (Render Dashboard)
1. Go to your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** > **Web Service**.
3. Connect your GitHub repository (`<YOUR-REPO-NAME>`).
4. Fill in the service configuration:
   - **Name**: `voxa` (or `voxa-voice-ai`)
   - **Region**: Choose the closest region to your users (e.g., *Oregon (US West)* or *Frankfurt (EU)*)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free` (or higher)
   - **Health Check Path**: `/health`

### Option B: Infrastructure-as-Code (Render Blueprint)
VOXA includes a pre-configured `render.yaml` Blueprint:
1. In Render Dashboard, click **New +** > **Blueprint**.
2. Select your repository.
3. Render will read `render.yaml`, configure the Web Service, and prompt you to input secret environment variables.

---

## 3. Build & Start Commands

- **Build Command**:
  ```bash
  npm install && npm run build
  ```
  *(Verifies dependencies and prepares static frontend assets)*

- **Start Command**:
  ```bash
  npm start
  ```
  *(Starts `node server/server.js`, binding to `0.0.0.0:${PORT}` where `PORT` is assigned dynamically by Render)*

---

## 4. Environment Variables

Configure the following environment variables in the Render Dashboard under **Environment** > **Environment Variables**:

| Variable | Recommended Production Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations & security rules |
| `PORT` | *(Provided by Render)* | Automatically assigned by Render (defaults to 10000) |
| `BACKEND_URL` | `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com` | Public base URL of your Render service |
| `FRONTEND_URL` | `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com` | Allowed CORS origin for web client |
| `VOXA_BACKEND_URL` | `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com` | Backend URL fallback reference |
| `RIME_API_KEY` | `<your-rime-api-key>` | Rime TTS API Key from [rime.ai](https://app.rime.ai/tokens) |
| `RIME_MODEL` | `coda` | Primary Rime model |
| `RIME_SPEAKER` | `astra` | Voice personality |
| `RIME_LANGUAGE` | `en` | Audio language |
| `RIME_ENDPOINT` | `https://users.rime.ai/v1/rime-tts` | Rime audio synthesis endpoint |
| `LLM_PROVIDER` | `gemini` | LLM provider (`gemini` or `openai`) |
| `LLM_MODEL` | `gemini-3.5-flash` | Gemini model (or `gpt-4o-mini`) |
| `LLM_API_KEY` | `<your-gemini-or-openai-api-key>` | Google AI Studio or OpenAI API key |
| `LLM_MODE` | `live` | Must be `live` in production |
| `GOOGLE_CLIENT_ID` | `<your-client-id>.apps.googleusercontent.com` | Google Cloud OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | `<your-google-client-secret>` | Google Cloud OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/api/auth/google/callback` | OAuth redirect callback URI |
| `SESSION_SECRET` | *(Random 32+ char string)* | Secret for server security & session signing |

---

## 5. Google OAuth 2.0 Production Configuration

Once your Render Web Service is deployed and you know its URL (e.g., `https://voxa-voice-ai.onrender.com`), update your credentials in Google Cloud Console:

1. Open [Google Cloud Console Credentials](https://console.cloud.google.com/apis/credentials).
2. Select your OAuth 2.0 Client ID (Web application).
3. **Authorized JavaScript origins**:
   Add:
   ```text
   https://<YOUR-RENDER-SUBDOMAIN>.onrender.com
   ```
4. **Authorized redirect URIs**:
   Add:
   ```text
   https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/api/auth/google/callback
   ```
5. Click **Save**.
6. In your VOXA dashboard, click the **Connect Google Account** button to perform the one-time OAuth consent grant.
7. The status badges will immediately display:
   - Google Calendar: `Connected ✓`
   - Google Classroom: `Connected ✓`
   - Gmail: `Connected ✓`

---

## 6. Rime TTS Configuration

VOXA uses **Rime TTS** as its primary audio synthesis engine.
- Production requests call `/api/tts` on the server, which streams binary audio (`audio/mpeg`) generated by Rime's low-latency neural TTS.
- The frontend plays Rime audio through an HTML5 `Audio` element with sub-second latency and interruption capability.
- Ensure `RIME_API_KEY` is added to Render environment variables. The API key is stored strictly on the server and is never sent to the browser.

---

## 7. LLM Configuration

VOXA supports **Google Gemini** (default: `gemini-3.5-flash` with failover to `gemini-3.8-flash`) and **OpenAI**.
- Commands such as *"What do I have tomorrow?"*, *"Do I have any important emails?"*, and *"Open my physics assignment"* are routed through the Integration Manager.
- The LLM receives the real tool outputs and synthesizes student-friendly conversational responses.
- Set `LLM_PROVIDER=gemini`, `LLM_MODEL=gemini-3.5-flash`, and `LLM_API_KEY=<your-key>` in Render.

---

## 8. Chrome Extension Configuration

The VOXA Chrome Extension (Manifest V3) allows safe browser actions (opening Gmail, Calendar, Classroom, assignment URLs, reading active tab).

### Loading the Extension in Google Chrome:
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** ON (top-right corner).
3. Click **Load unpacked** (top-left button).
4. Select the `chrome-extension/` directory from your cloned repository.
5. Click the VOXA puzzle icon in Chrome's toolbar to open the popup.

### Connecting to the Production Render URL:
1. Open the VOXA extension popup.
2. Under **Server Connection**, enter your production Render URL:
   ```text
   https://<YOUR-RENDER-SUBDOMAIN>.onrender.com
   ```
3. Click **Save**.
4. The extension will handshake with the production backend and show:
   ```text
   ● Connected
   Status: Idle
   ```
5. Any voice commands spoken on the VOXA web app will now instantly trigger browser navigation actions through the extension!

---

## 9. Production Testing & Verification

Before finalizing production, verify all critical systems:

### 1. Health Checks:
```bash
# Render Health Endpoint
curl -i https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/health
# Response: HTTP 200 {"status":"ok","service":"VOXA"}

# Deep System Health Endpoint
curl -i https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/api/health
# Response: HTTP 200 with rime, llm, and integrations status
```

### 2. Run Local Test Suite:
Run the comprehensive test suite before deploying new commits:
```bash
npm test
```
All 18 integration tests should report `PASSED`.

### 3. Voice Interruption Verification:
1. Start speaking a long prompt (e.g. *"What do I have scheduled for next week?"*).
2. While VOXA is speaking, click the **Interrupt** button or speak a new command (e.g. *"Stop, check my emails instead"*).
3. Verify that:
   - Rime audio immediately halts.
   - The active request is cancelled with code `CANCELLED`.
   - The new request executes with a fresh `requestId`.
   - Stale audio is discarded.

---

## 10. Troubleshooting

| Issue | Root Cause | Solution |
| :--- | :--- | :--- |
| **CORS error in browser console** | `FRONTEND_URL` mismatch | Set `FRONTEND_URL=https://<YOUR-RENDER-SUBDOMAIN>.onrender.com` in Render environment variables. Note that `.onrender.com` domains are automatically whitelisted. |
| **OAuth `redirect_uri_mismatch`** | Google Cloud URI does not match Render URL | Ensure Google Cloud Console Authorized Redirect URI exactly matches `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/api/auth/google/callback`. |
| **502 Bad Gateway on `/api/chat`** | Invalid or missing `LLM_API_KEY` | Verify `LLM_API_KEY` is set in Render environment variables and model is set to `gemini-3.5-flash`. |
| **Voice synthesis fails** | Missing or expired `RIME_API_KEY` | Check `RIME_API_KEY` at [app.rime.ai/tokens](https://app.rime.ai/tokens) and update Render environment. |
| **Extension shows Disconnected** | Extension pointing to `localhost` | Open extension popup, enter your Render URL (`https://...`), and click **Save**. |
| **Free tier spin-down delay** | Render free instances sleep after 15m inactivity | Use a free uptime monitor (e.g. UptimeRobot) targeting `https://<YOUR-RENDER-SUBDOMAIN>.onrender.com/health` to keep the container warm. |
