# VOXA — Adaptive Voice AI

### Speak. Interrupt. Adapt.

> Voice agents shouldn't make you wait for them to finish.

Voxa is a voice-first AI assistant that interacts with a student's digital workflow across Google Calendar, Google Classroom, Gmail, and browser actions in Chrome.

The core differentiator is **not** simply connecting APIs:
> **VOXA can perform actions across connected services while maintaining robust voice interruption and recovery.**

The student can speak naturally, interrupt VOXA while it is talking or retrieving data, redirect the request, and immediately receive an updated response based on their latest instruction — powered by **Rime TTS**.

---

## The Hard Voice Problem: Interruption & Recovery

Traditional voice AI forces a rigid turn-taking pattern:

```text
User speaks → waits → AI speaks → waits → User speaks
```

If the user needs to correct, update, or interrupt the AI mid-response, the system either ignores them, queues stale audio, or breaks entirely. In a multi-service student workflow, this is magnified:
- While VOXA speaks a 10-point daily schedule, the user realizes: *"Wait! I have an exam at 2 PM. Only tell me my assignments."*
- Without interruption handling, the old audio continues, stale Calendar results pollute context, and the assistant fails to adapt.

### How VOXA Solves It: Request ID Invalidation

Every LLM query, Google service call, Chrome action, and Rime TTS synthesis carries a unique `requestId`:
1. User speaks $\rightarrow$ STT captures audio in real-time.
2. If VOXA is currently speaking or executing an operation, detection triggers an **instant interruption event**.
3. **Rime audio stops immediately (<300ms measured)** and the playback queue is purged.
4. Active `AbortController` instances cancel in-flight integration requests and LLM generation.
5. A new `requestId` is generated. Any late-arriving responses tagged with the previous ID are silently discarded.
6. The new instruction is routed through the **Integration Manager** (e.g., querying Google Classroom).
7. LLM formats a concise spoken answer, converted into natural speech through **Rime TTS**, and played to the user.

---

## Target Architecture

```text
                                 USER
                                  │
                         Microphone / Web Speech
                                  │
                           [ STT ENGINE ]
                                  │
                        CONVERSATION CONTROLLER
                      (Request ID & Interruption)
                                  │
                                  ▼
                      COMMAND ROUTER & PLANNER
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
 [ INTEGRATION MANAGER ]                        [ DIRECT QUERY ]
            │                                           │
   ┌────────┼────────┬───────────────┐                  │
   ▼        ▼        ▼               ▼                  │
 Google  Google    Gmail     Chrome Extension           │
Calendar Classroom                   │                  │
   │        │        │               │                  │
   └────────┼────────┴───────────────┘                  │
            ▼                                           ▼
    Structured Data                            Conversation
            │                                           │
            └─────────────────────┬─────────────────────┘
                                  │
                                  ▼
                           [ LLM ENGINE ]
                     (Gemini conversational reasoning)
                                  │
                           Spoken Text
                                  │
                                  ▼
                          [ RIME TTS ENGINE ]
                       (coda / astra / audio/mpeg)
                                  │
                                  ▼
                            AUDIO OUTPUT
                                  │
         USER INTERRUPTS ─────────┴─────────► [ STOP AUDIO < 300ms ]
                                              [ CANCEL IN-FLIGHT ]
                                              [ NEW REQUEST ID ]
                                              [ ADAPT & SPEAK ]
```

---

## Role Allocation

- **LLM (Gemini)**: Natural language comprehension, intent selection, summarization of structured data into spoken English.
- **Rime TTS**: Primary and sole production voice output. Converts text to speech with low-latency natural delivery (`coda` model, `astra` voice).
- **Google APIs**: Source of truth for real student data (Calendar events, Classroom assignments, Gmail messages).
- **Chrome Extension**: Direct browser interaction (opening Gmail, Calendar, Classroom, or assignment links).
- **VOXA Engine**: Orchestration, state machine, request ID tracking, and real-time audio interruption.

---

## Connected Services

| Service | Scope / Mechanism | Capabilities |
|---------|-------------------|--------------|
| **Google Calendar** | `https://www.googleapis.com/auth/calendar.readonly` | Today's events, tomorrow's schedule, upcoming deadlines with start/end times and locations |
| **Google Classroom** | `https://www.googleapis.com/auth/classroom.courses.readonly`<br>`https://www.googleapis.com/auth/classroom.coursework.me.readonly` | Enrolled courses, student coursework, assignment deadlines, submission status |
| **Gmail** | `https://www.googleapis.com/auth/gmail.readonly` | Recent emails, unread emails, sender search (e.g. "from professor"), subject summaries |
| **Chrome Extension** | Manifest V3 + Server-Sent Events (SSE) | Opens Gmail, Calendar, Classroom, specific coursework links, active tab info |

---

## Setup & Prerequisites

### Prerequisites

- Node.js 18+
- Rime API key ([app.rime.ai/tokens](https://app.rime.ai/tokens))
- LLM API key (Google Gemini default)
- Google Cloud Project with OAuth 2.0 credentials (for Google integrations)
- Chrome or Edge browser (for Web Speech API & Chrome Extension)

### 1. Installation

```bash
# Clone the repository
git clone <repo-url>
cd voxa

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env
```

---

### 2. Google OAuth 2.0 Setup

VOXA uses standard OAuth 2.0 authorization with read-only scopes. Users never share their Google passwords.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g. `VOXA-Student-Assistant`).
3. Enable the following APIs in **APIs & Services > Library**:
   - **Google Calendar API**
   - **Google Classroom API**
   - **Gmail API**
4. Configure the **OAuth consent screen** (**APIs & Services > OAuth consent screen**):
   - User Type: **External** (Testing mode)
   - Add your test Google account email under **Test users**.
   - Add the scopes:
     - `calendar.readonly`
     - `classroom.courses.readonly`
     - `classroom.coursework.me.readonly`
     - `gmail.readonly`
     - `userinfo.email`
5. Create Credentials (**APIs & Services > Credentials**):
   - Click **Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `VOXA Web Client`.
   - Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`.
6. Copy the generated **Client ID** and **Client Secret** into your `.env` file:

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

7. Start VOXA, open the dashboard, click **Connect Google**, and grant read-only permissions.
   - Credentials are saved locally in `data/google_tokens.json` (gitignored).
   - Clicking **Disconnect** revokes tokens and deletes local credentials.

---

### 3. Chrome Extension Setup

The VOXA Chrome Extension (Manifest V3) allows safe browser actions requested by voice without exposing secrets.

#### Installation Flow:
```text
Chrome
  → chrome://extensions
  → Developer Mode (toggle top-right)
  → Load unpacked
  → select chrome-extension/
```

#### How VOXA Connects to the Extension:
1. **Persistent SSE Stream**: The background service worker opens a Server-Sent Events channel to `http://localhost:3000/api/extension/stream`.
2. **Heartbeat & Presence**: The extension transmits periodic heartbeats (`/api/extension/heartbeat`) with sanitized tab info (title and URL).
3. **Handshake Verification**: When VOXA receives the heartbeat, the **Chrome Extension** card in the dashboard switches from `Not Connected` to `Connected ✓` within 3 seconds.
4. **Zero-Secret Security**: No API keys, OAuth secrets, or refresh tokens reside in extension code. Only authorized commands (`OPEN_URL`, `OPEN_SERVICE`, `GET_ACTIVE_TAB`) are executed.
5. **URL Sanitization**: All URLs are validated server-side and client-side to enforce safe `https://` / `http://` protocols, rejecting any `javascript:`, `file:`, or `data:` payloads.
6. **Interruption & Stale Rejection**: Actions carry a `requestId`. If the user interrupts, VOXA broadcasts `CANCEL_ACTION` with the stale `requestId`, immediately terminating any pending execution.

---

### 4. Environment Configuration

```env
# ── Rime TTS ─────────────────────────────────
RIME_API_KEY=your_rime_api_key_here
RIME_MODEL=coda
RIME_SPEAKER=astra
RIME_LANGUAGE=en
RIME_ENDPOINT=https://users.rime.ai/v1/rime-tts

# ── LLM ──────────────────────────────────────
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.5-flash
LLM_API_KEY=your_gemini_api_key_here
LLM_MODE=live

# ── Google OAuth 2.0 ─────────────────────────
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# ── Server ───────────────────────────────────
PORT=3000
VOXA_BACKEND_URL=http://localhost:3000
```

---

## Running Locally

```bash
# Start development server (auto-restarts on changes)
npm run dev

# Or start in production mode
npm start
```

Open **[http://localhost:3000](http://localhost:3000)** in Chrome or Edge.

---

## Hackathon Demo Scenarios

The dashboard features dedicated quick-action scenario buttons under **Demo & Testing Suite**:

### TEST 1: Cross-Service Agenda
- **Command**: *"What do I have tomorrow?"*
- **VOXA Pipeline**: Queries Google Calendar + Google Classroom simultaneously.
- **Output**: *"Tomorrow you have Mathematics at 10 AM, a project group meeting at 2 PM, and a dynamic programming problem set due at 5 PM."*

### TEST 2: Gmail Integration
- **Command**: *"Do I have any important emails?"*
- **VOXA Pipeline**: Queries Gmail with read-only filter for student communications.
- **Output**: *"You have an email from Professor Miller regarding the assignment extension and updated office hours."*

### TEST 3: Chrome Extension Action
- **Command**: *"Open Gmail."*
- **VOXA Pipeline**: Command router dispatches authenticated browser action to extension $\rightarrow$ Chrome opens `mail.google.com`.
- **Output**: *"I've opened Gmail in Chrome for you."*

### TEST 4: Master Voice Engineering Demo (Interruption & Recovery)
1. **User asks**: *"Tell me everything I have scheduled tomorrow..."*
2. VOXA begins reciting the full multi-point calendar schedule through Rime.
3. **User interrupts mid-speech**: *"Wait! Only tell me my assignments."*
4. **Immediate Actions**:
   - Rime audio stops immediately (<300ms measured).
   - Previous request ID is marked cancelled.
   - Old calendar response is discarded.
   - Google Classroom is queried for pending coursework.
   - New response is generated and spoken via Rime: *"You have one assignment due tomorrow. Your Dynamic Programming problem set for Advanced Algorithms is due at 5 PM."*
5. **Follow-up**: *"Open that assignment."* $\rightarrow$ Chrome Extension opens the direct Classroom assignment link!

---

## Testing

Run the automated integration and stress test suite:

```bash
# Test Google services, Chrome extension, command router, and cancellation
node tests/integrations.test.js

# Test interruption speed, sequential invalidation, and Rime TTS
node tests/stress-test.js
```

---

## Voice State Machine

VOXA exposes its state in real-time on the UI and voice orb:

- `READY`: System initialized, waiting for user speech or click.
- `LISTENING`: STT capturing microphone input.
- `THINKING`: Parsing intent and preparing pipeline.
- `TOOL_WORKING`: Fetching data from Google Calendar, Classroom, or Gmail.
- `SPEAKING`: Rime TTS audio playing through browser; interruption detection active.
- `INTERRUPTED`: Speech detected while speaking; audio stopped (<300ms).
- `CANCELLING`: In-flight server requests and tool queries aborted.
- `RECOVERING`: New user command captured, updated context dispatched.
- `ERROR`: Clear diagnostic banner surfaced to user.

---

## Security & Privacy

- **Zero Client-Side Secrets**: Google OAuth client secrets, Rime API keys, and LLM keys remain strictly on the backend.
- **Read-Only Permissions**: Scopes requested are strictly read-only (`calendar.readonly`, `classroom.courses.readonly`, `gmail.readonly`).
- **Privacy First**: Gmail payloads only extract sender, subject, and short snippets. Full email bodies are never stored or logged.
- **Complete Disconnect**: Disconnecting from Google immediately revokes tokens and wipes local storage.
- **Git Ignored**: All local tokens (`data/`, `*.tokens.json`) and `.env` are excluded from version control.

---

## Known Limitations

- **Browser Audio Capture**: Microphone input uses the HTML5 Web Speech API, which requires Chrome, Edge, or Safari with microphone permissions granted.
- **Google API Rate Limits**: Free-tier Google Cloud credentials have per-minute quotas on Calendar, Classroom, and Gmail queries.
- **Cloud Free Tier Spin-Down**: When deployed on free cloud hosts (e.g. Render free tier), the server spins down after 15 minutes of inactivity; the initial wake-up request may take ~30-50 seconds. Use an external uptime ping or paid tier for 24/7 warm availability.

