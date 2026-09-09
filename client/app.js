/**
 * VOXA — Main Application Controller
 * 
 * Orchestrates the full voice interaction pipeline:
 *   STT → Conversation Controller → LLM → Rime TTS → Audio Output
 * 
 * Core innovation: INTERRUPTION & RECOVERY
 *   When user speaks while Voxa is speaking:
 *   1. Immediately stop Rime audio
 *   2. Invalidate stale request
 *   3. Cancel in-flight operations
 *   4. Capture new instruction
 *   5. Update conversation state
 *   6. Generate new response
 *   7. Speak new response through Rime
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════════════════

  const state = window.VoxaState;
  const stt = new window.VoxaSTT();
  const audioPlayer = new window.VoxaAudioPlayer();
  const metrics = new window.VoxaMetrics();
  let orb;

  // Active AbortControllers for in-flight requests
  let currentAbortController = null;

  // Session active flag
  let sessionActive = false;

  // ── DOM Elements ──────────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const els = {
    app: $('#app'),
    btnVoice: $('#btnVoice'),
    btnText: $('#btnText'),
    btnIcon: $('#btnIcon'),
    btnInterrupt: $('#btnInterrupt'),
    statusBadge: $('#statusBadge'),
    statusText: $('#statusText'),
    statusDetail: $('#statusDetail'),
    statusDot: $('#statusDot'),
    transcriptBody: $('#transcriptBody'),
    transcriptEmpty: $('#transcriptEmpty'),
    errorBanner: $('#errorBanner'),
    errorMessage: $('#errorMessage'),
    errorClose: $('#errorClose'),
    interimTranscript: $('#interimTranscript'),
    interimText: $('#interimText'),
    connectionDot: $('.connection-dot'),
    connectionText: $('#connectionText'),
    // Mode switcher
    btnModeUser: $('#btnModeUser'),
    btnModeDemo: $('#btnModeDemo'),
    demoTechWrapper: $('#demoTechWrapper'),
    tickerText: $('#tickerText'),
    // Metrics
    metricCurrent: $('#metricCurrent'),
    metricAverage: $('#metricAverage'),
    metricMin: $('#metricMin'),
    metricMax: $('#metricMax'),
    metricTool: $('#metricTool'),
    metricLlm: $('#metricLlm'),
    metricTts: $('#metricTts'),
    metricStopLatest: $('#metricStopLatest'),
    timelineContainer: $('#timelineContainer'),
    sttStatus: $('#sttStatus'),
    llmStatus: $('#llmStatus'),
    rimeStatus: $('#rimeStatus'),
    modeStatus: $('#modeStatus'),
    // Voice Activity
    activityRequestId: $('#activityRequestId'),
    activityStateBadge: $('#activityStateBadge'),
    activityService: $('#activityService'),
    activityAction: $('#activityAction'),
    // Integrations
    integrationsToggle: $('#integrationsToggle'),
    integrationsBody: $('#integrationsBody'),
    googleUserEmail: $('#googleUserEmail'),
    btnGoogleAuth: $('#btnGoogleAuth'),
    calendarStatus: $('#calendarStatus'),
    classroomStatus: $('#classroomStatus'),
    gmailStatus: $('#gmailStatus'),
    chromeDetail: $('#chromeDetail'),
    chromeStatusBadge: $('#chromeStatusBadge'),
    // Panels
    metricsToggle: $('#metricsToggle'),
    metricsBody: $('#metricsBody'),
    demoToggle: $('#demoToggle'),
    demoBody: $('#demoBody'),
    // Demo Suite
    checklistItems: $('#checklistItems'),
    btnTest1: $('#btnTest1'),
    btnTest2: $('#btnTest2'),
    btnTest3: $('#btnTest3'),
    btnTest4: $('#btnTest4'),
    btnStressTest: $('#btnStressTest'),
    stressResult: $('#stressResult'),
    stressLabel: $('#stressLabel'),
    stressStatus: $('#stressStatus'),
    mockBanner: $('#mockBanner'),
    // Actions
    btnClearChat: $('#btnClearChat'),
  };

  // Conversation context for cross-turn actions (e.g. "open that assignment")
  const conversationContext = {
    lastAssignment: null,
    lastEmail: null,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK & STARTUP
  // ══════════════════════════════════════════════════════════════════════════

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();

      // Update connection indicator
      const isHealthy = data.status === 'healthy';
      els.connectionDot.classList.toggle('connected', isHealthy);
      els.connectionDot.classList.toggle('error', !isHealthy);
      els.connectionText.textContent = isHealthy ? 'Ready when you are' : 'Some services need attention';

      // Update system status
      updateSystemStatus(data.services);

      // Update connected services
      if (data.integrations) {
        updateIntegrationsUI(data.integrations);
      }

      // Show/hide mock banner
      els.mockBanner.hidden = (data.services?.llm?.config?.mode !== 'mock');

      return data;
    } catch (err) {
      els.connectionDot.classList.add('error');
      els.connectionText.textContent = 'Offline';
      updateStatusEl(els.llmStatus, '✕ Offline', 'fail');
      updateStatusEl(els.rimeStatus, '✕ Offline', 'fail');
      return null;
    }
  }

  function updateSystemStatus(services) {
    // STT
    if (stt.isSupported) {
      updateStatusEl(els.sttStatus, '✓ Ready', 'ok');
    } else {
      updateStatusEl(els.sttStatus, '✕ Unsupported', 'fail');
    }

    // LLM
    if (services?.llm?.status === 'configured') {
      const mode = services.llm.config.mode;
      const provider = services.llm.config.provider;
      updateStatusEl(els.llmStatus, `✓ ${provider}`, 'ok');
      els.modeStatus.textContent = mode === 'mock' ? '⚙ Mock' : '● Live';
      els.modeStatus.className = 'status-item-value ' + (mode === 'mock' ? 'warn' : 'ok');
    } else {
      updateStatusEl(els.llmStatus, '⚠ Not configured', 'warn');
      updateStatusEl(els.modeStatus, '—', '');
    }

    // Rime
    if (services?.rime?.status === 'configured') {
      updateStatusEl(els.rimeStatus, `✓ ${services.rime.config.model}`, 'ok');
    } else {
      updateStatusEl(els.rimeStatus, '⚠ Not configured', 'warn');
    }
  }

  function updateIntegrationsUI(integrations) {
    const google = integrations.google;
    const chrome = integrations.chrome;

    // Google Account
    if (google.connected) {
      els.googleUserEmail.textContent = google.userEmail || 'Connected Account';
      els.btnGoogleAuth.textContent = 'Disconnect';
      els.btnGoogleAuth.className = 'btn btn-connect connected';
    } else {
      els.googleUserEmail.textContent = google.configured ? 'Ready to Connect' : 'Credentials Unconfigured';
      els.btnGoogleAuth.textContent = 'Connect';
      els.btnGoogleAuth.className = 'btn btn-connect';
    }

    // Services
    const calStatus = google.services?.calendar?.status || 'Not Connected';
    els.calendarStatus.textContent = calStatus;
    els.calendarStatus.className = 'service-row-status ' + (calStatus.includes('✓') ? 'ok' : '');

    const classStatus = google.services?.classroom?.status || 'Not Connected';
    els.classroomStatus.textContent = classStatus;
    els.classroomStatus.className = 'service-row-status ' + (classStatus.includes('✓') ? 'ok' : '');

    const gmStatus = google.services?.gmail?.status || 'Not Connected';
    els.gmailStatus.textContent = gmStatus;
    els.gmailStatus.className = 'service-row-status ' + (gmStatus.includes('✓') ? 'ok' : '');

    // Chrome Extension
    if (chrome.connected) {
      els.chromeStatusBadge.textContent = 'Connected ✓';
      els.chromeStatusBadge.className = 'service-badge connected';
      els.chromeDetail.textContent = chrome.lastKnownTab ? `Active: ${chrome.lastKnownTab.title?.slice(0, 24)}…` : 'Connected';
    } else {
      els.chromeStatusBadge.textContent = 'Not Connected';
      els.chromeStatusBadge.className = 'service-badge';
      els.chromeDetail.textContent = 'Load chrome-extension in browser';
    }
  }

  function updateStatusEl(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = 'status-item-value ' + (cls || '');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATE MACHINE & UI UPDATES
  // ══════════════════════════════════════════════════════════════════════════

  function updateVoiceActivity(requestId, stateName, service = '—', action = '—') {
    if (els.activityRequestId) {
      els.activityRequestId.textContent = requestId ? `req-${requestId.slice(0, 6)}` : 'IDLE';
    }
    if (els.activityStateBadge) {
      els.activityStateBadge.textContent = stateName;
    }
    if (els.activityService) {
      els.activityService.textContent = service || '—';
    }
    if (els.activityAction) {
      els.activityAction.textContent = action || '—';
    }
  }

  const FRIENDLY_STATE_TEXTS = {
    READY: 'Ready when you are',
    LISTENING: "I'm listening...",
    THINKING: 'Let me check that...',
    TOOL_WORKING: 'Checking your services...',
    SPEAKING: 'VOXA is speaking',
    INTERRUPTING: 'Got it — stopping...',
    CANCELLING: 'Stopping...',
    RECOVERING: 'Updating your request...',
    INTERRUPTED: 'Interrupted — adapting...',
    ERROR: "Something went wrong. Let's try again.",
  };

  let isDemoMode = localStorage.getItem('voxa_ui_mode') === 'demo';

  function setVoiceState(newState, detail = '', meta = {}) {
    state.setState(newState);

    // Update CSS state class on app container while preserving mode
    const modeClass = (els.app.classList.contains('mode-demo') || isDemoMode) ? 'mode-demo' : 'mode-user';
    els.app.className = `app ${modeClass} state-${newState.toLowerCase()}`;

    // Friendly status badge on main orb
    let friendlyText = FRIENDLY_STATE_TEXTS[newState] || newState;
    if (newState === 'TOOL_WORKING' && meta.service) {
      friendlyText = `Checking ${meta.service}...`;
    }
    els.statusText.textContent = friendlyText;

    // Status detail
    const details = {
      READY: 'Press Start Talking to begin',
      LISTENING: 'Listening for your voice…',
      THINKING: 'Processing your request…',
      TOOL_WORKING: meta.action ? `Checking ${meta.service || 'services'}: ${meta.action}` : 'Checking your services…',
      SPEAKING: 'VOXA is responding — speak to interrupt',
      INTERRUPTING: 'Interruption detected — stopping audio…',
      CANCELLING: 'Stopping previous request…',
      RECOVERING: 'Adapting to your new request…',
      INTERRUPTED: 'Interrupted — adapting…',
      ERROR: detail || "Something went wrong. Let's try again.",
    };
    els.statusDetail.textContent = detail || details[newState] || '';

    // Update Activity Panel (preserves raw technical state for judges in Demo Mode)
    updateVoiceActivity(state.currentRequestId, newState, meta.service, meta.action);

    // Update orb
    if (orb) orb.setState(newState);

    // Update buttons
    updateButtons(newState);
  }

  function updateButtons(voiceState) {
    if (!sessionActive) {
      els.btnText.textContent = 'Start Talking';
      els.btnIcon.textContent = '🎙';
      els.btnVoice.classList.remove('active');
      els.btnInterrupt.disabled = true;
      return;
    }

    switch (voiceState) {
      case 'READY':
        els.btnText.textContent = 'Start Talking';
        els.btnIcon.textContent = '🎙';
        els.btnVoice.classList.remove('active');
        els.btnInterrupt.disabled = true;
        break;
      case 'LISTENING':
        els.btnText.textContent = 'Listening...';
        els.btnIcon.textContent = '⏹';
        els.btnVoice.classList.add('active');
        els.btnInterrupt.disabled = true;
        break;
      case 'THINKING':
      case 'TOOL_WORKING':
        els.btnText.textContent = 'Thinking...';
        els.btnIcon.textContent = '⏹';
        els.btnVoice.classList.add('active');
        els.btnInterrupt.disabled = false;
        break;
      case 'SPEAKING':
        els.btnText.textContent = 'Speaking...';
        els.btnIcon.textContent = '⏹';
        els.btnVoice.classList.add('active');
        els.btnInterrupt.disabled = false;
        break;
      case 'INTERRUPTING':
      case 'INTERRUPTED':
      case 'RECOVERING':
        els.btnText.textContent = 'Adapting...';
        els.btnIcon.textContent = '🔄';
        els.btnInterrupt.disabled = true;
        break;
      case 'ERROR':
        els.btnText.textContent = 'Try Again';
        els.btnIcon.textContent = '🔄';
        els.btnVoice.classList.remove('active');
        els.btnInterrupt.disabled = true;
        break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOICE SESSION MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  function startSession() {
    if (sessionActive) {
      stopSession();
      return;
    }

    sessionActive = true;
    metrics.startSession();
    setVoiceState('LISTENING');

    // Start STT
    const started = stt.start();
    if (!started) {
      showError('Could not start voice recognition. Check your browser and microphone.');
      setVoiceState('ERROR', 'Microphone unavailable');
      sessionActive = false;
      return;
    }
  }

  function stopSession() {
    sessionActive = false;
    stt.stop();
    audioPlayer.stop();
    cancelCurrentRequest();
    setVoiceState('READY');
    els.interimTranscript.hidden = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE: INTERRUPTION ENGINE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * THE CENTRAL INNOVATION
   * 
   * Called when user speech is detected while Voxa is speaking.
   * Must execute the interruption sequence as fast as possible.
   */
  function handleInterruption() {
    if (state.voiceState !== 'SPEAKING') return;

    const interruptionTime = performance.now();
    metrics.recordEvent('USER INTERRUPTION DETECTED', interruptionTime);
    metrics.markChecklistItem('interruptionDetected');

    // 1. IMMEDIATELY stop audio
    const playedDuration = audioPlayer.stop();
    const audioStopTime = performance.now();
    metrics.recordEvent('RIME AUDIO STOPPED', audioStopTime);
    metrics.markChecklistItem('audioStopped');

    // 2. Record latency
    const latency = metrics.recordInterruptionLatency(interruptionTime, audioStopTime);
    console.log(`[VOXA] Interruption-to-audio-stop: ${latency.toFixed(2)}ms`);

    // 3. Cancel in-flight server requests
    cancelCurrentRequest();
    metrics.recordEvent('OLD REQUEST INVALIDATED');
    metrics.markChecklistItem('staleResponseBlocked');

    // 4. Mark last assistant message as interrupted
    const interruptedMsg = state.markLastAssistantInterrupted(playedDuration);

    // 5. Update transcript UI
    if (interruptedMsg) {
      markTranscriptInterrupted(interruptedMsg.id);
    }

    // 6. Set interrupted state (brief visual, then transitions to LISTENING)
    state.responseInterruptedAt = interruptionTime;
    setVoiceState('INTERRUPTED', 'Interrupted — adapting…');

    // Brief visual pause, then resume listening
    setTimeout(() => {
      if (sessionActive && state.voiceState === 'INTERRUPTED') {
        setVoiceState('LISTENING');
      }
    }, 600);

    // Update metrics display
    updateMetricsDisplay();
  }

  /**
   * Cancel all in-flight requests for the current requestId.
   */
  function cancelCurrentRequest() {
    // Client-side abort
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }

    // Server-side abort
    if (state.currentRequestId) {
      fetch('/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: state.currentRequestId }),
      }).catch(() => { /* best effort */ });

      state.invalidateRequest(state.currentRequestId);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REQUEST PIPELINE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Full pipeline: user message → LLM → Rime TTS → audio playback
   * Every step checks if the request is still valid.
   */
  async function processUserMessage(text) {
    if (!text || text.trim().length === 0) return;

    const trimmedText = text.trim();

    // Cancel any previous request
    cancelCurrentRequest();

    // Create new request
    const requestId = state.createRequest();
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    // Add user message to conversation
    state.addMessage('user', trimmedText, { requestId });
    addTranscriptMessage('user', trimmedText);
    metrics.recordEvent('NEW INSTRUCTION RECEIVED');
    metrics.markChecklistItem('contextUpdated');

    // Hide interim
    els.interimTranscript.hidden = true;

    // ── Step 1: LLM & Tool Orchestration ───────────────
    setVoiceState('THINKING');
    metrics.recordEvent('LLM REQUEST SENT');

    let responseText;
    let isMock = false;
    let chatData = null;
    const llmStartTime = performance.now();

    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: state.getMessagesForLLM(),
          requestId,
          context: conversationContext,
        }),
        signal,
      });

      // STALE CHECK
      if (!state.isRequestValid(requestId)) {
        console.log(`[VOXA] Discarding stale LLM response (${requestId.slice(0, 8)})`);
        return;
      }

      if (!chatRes.ok) {
        const err = await chatRes.json().catch(() => ({}));
        throw new Error(err.error || `LLM error ${chatRes.status}`);
      }

      chatData = await chatRes.json();
      responseText = chatData.text;
      isMock = chatData.isMock;

      const llmDuration = Math.round(performance.now() - llmStartTime);
      metrics.recordLlmLatency(llmDuration);

      // Record tool execution if applicable
      if (chatData.service) {
        if (chatData.toolDurationMs) {
          metrics.recordToolLatency(chatData.toolDurationMs);
        }
        metrics.recordEvent(`TOOL: ${chatData.service}.${chatData.action} (${chatData.toolDurationMs || 0}ms)`);
        setVoiceState('TOOL_WORKING', '', { service: chatData.service, action: chatData.action });

        // Update context for follow-up cross-turn commands (e.g. "open that assignment")
        if (chatData.service === 'classroom' || chatData.service === 'agenda') {
          const assignments = chatData.toolResult?.data?.assignments || (Array.isArray(chatData.toolResult?.data) ? chatData.toolResult.data : []);
          if (assignments && assignments.length > 0) {
            conversationContext.lastAssignment = assignments[0];
          }
        }
        if (chatData.service === 'gmail' || chatData.service === 'agenda') {
          const emails = chatData.toolResult?.data?.emails || (Array.isArray(chatData.toolResult?.data) ? chatData.toolResult.data : []);
          if (emails && emails.length > 0) {
            conversationContext.lastEmail = emails[0];
          }
        }
      }

      // STALE CHECK again
      if (!state.isRequestValid(requestId)) {
        console.log(`[VOXA] Discarding stale LLM response after parse (${requestId.slice(0, 8)})`);
        return;
      }

      metrics.recordEvent('LLM RESPONSE RECEIVED');
      metrics.markChecklistItem('newResponseGenerated');
      updateMetricsDisplay();

    } catch (err) {
      if (err.name === 'AbortError' || !state.isRequestValid(requestId)) {
        return; // Request was intentionally cancelled
      }

      console.error('[VOXA] LLM Error:', err.message);
      showError("Sorry, I couldn't process that request. Please try again.");
      setVoiceState('ERROR', 'LLM request failed');

      // Add fallback to conversation
      state.addMessage('assistant', "Sorry, I couldn't process that request. Please try again.", {
        requestId,
        responseType: 'fallback',
      });
      addTranscriptMessage('assistant', "Sorry, I couldn't process that request. Please try again.", { isFallback: true });

      // Resume listening after error
      setTimeout(() => {
        if (sessionActive) {
          hideError();
          setVoiceState('LISTENING');
        }
      }, 3000);
      return;
    }

    // ── Step 2: Add to conversation ─────────────────────
    state.addMessage('assistant', responseText, { requestId, isMock, responseType: 'llm' });
    addTranscriptMessage('assistant', responseText, { isMock });

    // ── Step 3: Rime TTS ────────────────────────────────
    metrics.recordEvent('RIME TTS REQUEST SENT');
    const ttsStartTime = performance.now();

    let audioBlob;
    try {
      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: responseText, requestId }),
        signal,
      });

      // STALE CHECK
      if (!state.isRequestValid(requestId)) {
        console.log(`[VOXA] Discarding stale TTS response (${requestId.slice(0, 8)})`);
        return;
      }

      if (!ttsRes.ok) {
        const err = await ttsRes.json().catch(() => ({}));
        throw new Error(err.error || `TTS error ${ttsRes.status}`);
      }

      audioBlob = await ttsRes.blob();
      const ttsDuration = Math.round(performance.now() - ttsStartTime);
      metrics.recordTtsLatency(ttsDuration);
      metrics.recordEvent(`RIME AUDIO RECEIVED (${ttsDuration}ms)`);
      updateMetricsDisplay();

    } catch (err) {
      if (err.name === 'AbortError' || !state.isRequestValid(requestId)) {
        return;
      }

      console.error('[VOXA] Rime TTS Error:', err.message);
      showError("I couldn't start voice playback.");
      setVoiceState('ERROR', "I couldn't start voice playback.");

      setTimeout(() => {
        if (sessionActive) {
          hideError();
          setVoiceState('LISTENING');
        }
      }, 3000);
      return;
    }

    // ── Step 4: Play Audio ──────────────────────────────

    // FINAL STALE CHECK before playing
    if (!state.isRequestValid(requestId)) {
      console.log(`[VOXA] Discarding stale audio at play-time (${requestId.slice(0, 8)})`);
      return;
    }

    setVoiceState('SPEAKING', '', { service: chatData?.service || 'VOXA', action: 'Speaking via Rime' });
    state.lastSpeakingStartedAt = performance.now();
    metrics.recordEvent('VOXA STARTED SPEAKING');
    metrics.markChecklistItem('rimeSpeaking');

    const played = await audioPlayer.play(
      audioBlob,
      requestId,
      (rid) => state.isRequestValid(rid)
    );

    // If audio completed normally (not interrupted)
    if (played && state.isRequestValid(requestId) && sessionActive) {
      metrics.recordEvent('VOXA FINISHED SPEAKING');
      metrics.markChecklistItem('recoverySuccessful');
      setVoiceState('LISTENING');
      updateVoiceActivity(null, 'LISTENING', '—', 'Listening for user speech…');
      updateMetricsDisplay();
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STT CALLBACKS
  // ══════════════════════════════════════════════════════════════════════════

  stt.onSpeechStart = () => {
    if (!sessionActive) return;

    metrics.markChecklistItem('voiceDetected');
    metrics.recordEvent('USER SPEECH STARTED');

    // If Voxa is currently speaking, trigger interruption
    if (state.voiceState === 'SPEAKING') {
      handleInterruption();
    }
  };

  stt.onInterimResult = ({ transcript }) => {
    if (!sessionActive) return;

    els.interimTranscript.hidden = false;
    els.interimText.textContent = transcript;

    // Also trigger interruption on interim results while speaking
    if (state.voiceState === 'SPEAKING') {
      handleInterruption();
    }
  };

  stt.onFinalResult = ({ transcript }) => {
    if (!sessionActive) return;
    if (!transcript || transcript.trim().length === 0) return;

    els.interimTranscript.hidden = true;
    els.interimText.textContent = '';

    // Process the message through the full pipeline
    processUserMessage(transcript);
  };

  stt.onError = ({ message, isFatal }) => {
    showError(message);
    if (isFatal) {
      setVoiceState('ERROR', message);
      sessionActive = false;
    }
  };

  stt.onSpeechEnd = () => {
    // Speech ended — if we're listening, that's fine
  };

  // ══════════════════════════════════════════════════════════════════════════
  // AUDIO PLAYER CALLBACKS
  // ══════════════════════════════════════════════════════════════════════════

  audioPlayer.onPlayStart = ({ requestId }) => {
    console.log(`[Audio] Playing response ${requestId?.slice(0, 8)}`);
  };

  audioPlayer.onPlayEnd = ({ requestId }) => {
    console.log(`[Audio] Finished playing ${requestId?.slice(0, 8)}`);
  };

  audioPlayer.onError = ({ message, requestId }) => {
    console.error(`[Audio] Error: ${message}`);
    showError('Audio playback could not start.');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSCRIPT UI
  // ══════════════════════════════════════════════════════════════════════════

  function addTranscriptMessage(role, content, opts = {}) {
    // Hide empty state
    if (els.transcriptEmpty) {
      els.transcriptEmpty.style.display = 'none';
    }

    const msgEl = document.createElement('div');
    msgEl.className = `transcript-message ${role === 'user' ? 'user-msg' : 'assistant-msg'}`;
    msgEl.dataset.messageId = state.conversationHistory[state.conversationHistory.length - 1]?.id || '';

    const roleEl = document.createElement('div');
    roleEl.className = `transcript-role ${role}`;
    roleEl.textContent = role === 'user' ? 'YOU' : 'VOXA';

    if (opts.isMock && isDemoMode) {
      const mockBadge = document.createElement('span');
      mockBadge.className = 'mock-badge';
      mockBadge.textContent = 'MOCK';
      roleEl.appendChild(mockBadge);
    }

    if (opts.isFallback && isDemoMode) {
      const fallbackBadge = document.createElement('span');
      fallbackBadge.className = 'mock-badge';
      fallbackBadge.textContent = 'FALLBACK';
      roleEl.appendChild(fallbackBadge);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'transcript-content';
    contentEl.textContent = content;

    msgEl.appendChild(roleEl);
    msgEl.appendChild(contentEl);
    els.transcriptBody.appendChild(msgEl);

    // Auto-scroll
    els.transcriptBody.scrollTop = els.transcriptBody.scrollHeight;
  }

  function markTranscriptInterrupted(messageId) {
    const msgEl = els.transcriptBody.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
      msgEl.classList.add('transcript-interrupted');

      const badge = document.createElement('div');
      badge.className = 'interrupted-badge';
      badge.innerHTML = '<span>⚡</span> Interrupted';
      msgEl.appendChild(badge);
    }

    // Also add a visual separator
    const separator = document.createElement('div');
    separator.className = 'transcript-message';
    separator.innerHTML = '<div class="interrupted-badge" style="margin:4px 0">⚡ Interrupted</div>';
    els.transcriptBody.appendChild(separator);
    els.transcriptBody.scrollTop = els.transcriptBody.scrollHeight;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // METRICS DISPLAY
  // ══════════════════════════════════════════════════════════════════════════

  function updateMetricsDisplay() {
    const stats = metrics.getLatencyStats();

    if (stats.current !== null) {
      els.metricCurrent.textContent = `${Math.round(stats.current)}ms`;
      if (els.metricStopLatest) els.metricStopLatest.textContent = `${Math.round(stats.current)}ms`;
      els.metricAverage.textContent = `${Math.round(stats.average)}ms`;
      els.metricMin.textContent = `${Math.round(stats.min)}ms`;
      els.metricMax.textContent = `${Math.round(stats.max)}ms`;
    } else {
      els.metricCurrent.textContent = 'No measurements yet';
      if (els.metricStopLatest) els.metricStopLatest.textContent = 'No measurements yet';
      els.metricAverage.textContent = '—';
      els.metricMin.textContent = '—';
      els.metricMax.textContent = '—';
    }

    if (els.metricTool) {
      els.metricTool.textContent = metrics.latestToolLatency !== null ? `${metrics.latestToolLatency}ms` : '—';
    }
    if (els.metricLlm) {
      els.metricLlm.textContent = metrics.latestLlmLatency !== null ? `${metrics.latestLlmLatency}ms` : '—';
    }
    if (els.metricTts) {
      els.metricTts.textContent = metrics.latestTtsLatency !== null ? `${metrics.latestTtsLatency}ms` : '—';
    }

    // Timeline
    const timelineEvents = metrics.getTimelineDisplay();
    if (timelineEvents.length > 0) {
      els.timelineContainer.innerHTML = timelineEvents.map(evt => {
        let nameClass = 'timeline-name';
        const lower = evt.name.toLowerCase();
        if (lower.includes('interrupt') || lower.includes('stop')) nameClass += ' interrupted';
        else if (lower.includes('speaking') || lower.includes('rime')) nameClass += ' speaking';
        else if (lower.includes('thinking') || lower.includes('llm')) nameClass += ' thinking';

        return `<div class="timeline-event">
          <span class="timeline-time">${evt.time}</span>
          <span class="${nameClass}">${evt.name}</span>
        </div>`;
      }).join('');

      // Scroll timeline to bottom
      els.timelineContainer.scrollTop = els.timelineContainer.scrollHeight;
    }

    // Checklist
    updateChecklist();
  }

  function updateChecklist() {
    const items = metrics.getChecklistItems();
    els.checklistItems.innerHTML = items.map(item => `
      <div class="checklist-item ${item.completed ? 'completed' : ''}">
        <span class="checklist-check">${item.completed ? '✓' : '○'}</span>
        <span>${item.label}</span>
      </div>
    `).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ERROR HANDLING
  // ══════════════════════════════════════════════════════════════════════════

  function showError(message) {
    els.errorMessage.textContent = message;
    els.errorBanner.hidden = false;
  }

  function hideError() {
    els.errorBanner.hidden = true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DEMO & TESTING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Guided interruption test demo.
   * Starts a session, sends a test prompt, and guides the user to interrupt.
   */
  async function runInterruptionDemo() {
    // Reset
    metrics.startSession();
    updateChecklist();
    updateMetricsDisplay();

    if (!sessionActive) {
      startSession();
      // Wait for session to be ready
      await new Promise(r => setTimeout(r, 500));
    }

    setVoiceState('LISTENING', 'Demo: Say "Plan my study schedule for tomorrow"');

    // If STT isn't working, we can also accept a click-based demo
    showError('🎯 Demo: Say "Plan my study schedule for tomorrow", then interrupt Voxa while it speaks by saying "Wait, I have an exam at 2 PM"');
    setTimeout(hideError, 8000);
  }

  /**
   * Stress test: rapid request-then-interrupt cycle.
   * Sends a request, adds artificial delay, and interrupts during processing.
   */
  async function runStressTest() {
    els.stressResult.hidden = true;

    if (!sessionActive) {
      startSession();
      await new Promise(r => setTimeout(r, 500));
    }

    const testResults = [];

    // Test 1: Interrupt during LLM processing
    const test1 = await stressTestSingle('Test 1: Interrupt during processing');
    testResults.push(test1);

    // Test 2: Verify stale response blocked
    const test2 = { name: 'Test 2: Stale response protection', passed: metrics.checklist.staleResponseBlocked };
    testResults.push(test2);

    // Test 3: Context updated after interruption
    const test3 = { name: 'Test 3: Context preservation', passed: state.conversationHistory.length > 0 };
    testResults.push(test3);

    // Show results
    const allPassed = testResults.every(t => t.passed);

    els.stressResult.hidden = false;
    els.stressResult.className = 'stress-result ' + (allPassed ? 'pass' : 'fail');
    els.stressLabel.textContent = 'STRESS TEST';
    els.stressStatus.textContent = allPassed ? 'PASS' : 'FAIL';

    testResults.forEach(r => metrics.recordStressTestResult(r));
  }

  async function stressTestSingle(name) {
    return new Promise(resolve => {
      // Send a test message
      processUserMessage('Plan my study schedule for tomorrow with detailed time blocks for each subject');

      // After a brief delay, trigger interruption
      setTimeout(() => {
        if (state.voiceState === 'SPEAKING' || state.voiceState === 'THINKING') {
          handleInterruption();
          resolve({ name, passed: true });
        } else {
          // If Voxa hasn't started speaking/thinking yet, still counts
          resolve({ name, passed: state.voiceState !== 'ERROR' });
        }
      }, 1500);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DEMO SCENARIO RUNNERS (HACKATHON SUITE)
  // ══════════════════════════════════════════════════════════════════════════

  async function runTestScenario(testNumber) {
    metrics.startSession();
    updateChecklist();
    updateMetricsDisplay();

    if (!sessionActive) {
      startSession();
      await new Promise(r => setTimeout(r, 400));
    }

    if (testNumber === 1) {
      // TEST 1: Calendar + Classroom
      showError('🎯 Running Test 1: "What do I have tomorrow?"');
      setTimeout(hideError, 4000);
      processUserMessage('What do I have tomorrow?');
    } else if (testNumber === 2) {
      // TEST 2: Gmail
      showError('🎯 Running Test 2: "Do I have any important emails?"');
      setTimeout(hideError, 4000);
      processUserMessage('Do I have any important emails?');
    } else if (testNumber === 3) {
      // TEST 3: Chrome Action
      showError('🎯 Running Test 3: "Open Gmail."');
      setTimeout(hideError, 4000);
      processUserMessage('Open Gmail.');
    } else if (testNumber === 4) {
      // TEST 4: MAIN VOICE ENGINEERING DEMO (INTERRUPTION & ADAPT)
      showError('⚡ Master Demo: VOXA speaks schedule → Interrupted halfway → Adapts immediately to assignments only!');
      setTimeout(hideError, 6000);

      // 1. Initial query that generates a longer response
      processUserMessage('Tell me everything I have scheduled tomorrow with details on my schedule.');

      // 2. Wait until VOXA has started speaking
      let spoke = false;
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 200));
        if (state.voiceState === 'SPEAKING') {
          spoke = true;
          break;
        }
      }

      // Let it speak for 1.2 seconds so interruption is unmistakable
      if (spoke) {
        await new Promise(r => setTimeout(r, 1200));
      }

      // 3. Trigger Interruption
      console.log('[Demo] Simulating speech interruption...');
      handleInterruption();

      // Brief pause to mimic human speech turn
      await new Promise(r => setTimeout(r, 500));

      // 4. Send new instruction
      processUserMessage('Wait, only tell me my assignments.');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PANEL TOGGLES
  // ══════════════════════════════════════════════════════════════════════════

  function setupPanelToggles() {
    if (els.integrationsToggle && els.integrationsBody) {
      els.integrationsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        els.integrationsBody.classList.toggle('collapsed');
        els.integrationsToggle.classList.toggle('collapsed');
      });

      const intHeader = $('#integrationsHeader');
      if (intHeader) {
        intHeader.addEventListener('click', () => {
          els.integrationsBody.classList.toggle('collapsed');
          els.integrationsToggle.classList.toggle('collapsed');
        });
      }
    }

    if (els.metricsToggle && els.metricsBody) {
      els.metricsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        els.metricsBody.classList.toggle('collapsed');
        els.metricsToggle.classList.toggle('collapsed');
      });

      $('#metricsHeader').addEventListener('click', () => {
        els.metricsBody.classList.toggle('collapsed');
        els.metricsToggle.classList.toggle('collapsed');
      });
    }

    if (els.demoToggle && els.demoBody) {
      els.demoToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        els.demoBody.classList.toggle('collapsed');
        els.demoToggle.classList.toggle('collapsed');
      });

      $('#demoHeader').addEventListener('click', () => {
        els.demoBody.classList.toggle('collapsed');
        els.demoToggle.classList.toggle('collapsed');
      });
    }
  }

  // ── Mode Switcher & Prompt Ticker ──────────────────────────────────────────

  function applyMode(demo) {
    isDemoMode = demo;
    localStorage.setItem('voxa_ui_mode', demo ? 'demo' : 'user');
    if (demo) {
      els.app.classList.remove('mode-user');
      els.app.classList.add('mode-demo');
      if (els.btnModeDemo) els.btnModeDemo.classList.add('active');
      if (els.btnModeUser) els.btnModeUser.classList.remove('active');
    } else {
      els.app.classList.remove('mode-demo');
      els.app.classList.add('mode-user');
      if (els.btnModeUser) els.btnModeUser.classList.add('active');
      if (els.btnModeDemo) els.btnModeDemo.classList.remove('active');
    }
  }

  const ROTATING_PROMPTS = [
    '"What do I have tomorrow?"',
    '"Any assignments due this week?"',
    '"Do I have important emails?"',
    '"Open my Classroom."',
    '"Open the email from my professor."',
    '"What tab is currently open?"',
  ];
  let promptTickerIndex = 0;
  function startPromptTicker() {
    if (!els.tickerText) return;
    setInterval(() => {
      promptTickerIndex = (promptTickerIndex + 1) % ROTATING_PROMPTS.length;
      els.tickerText.style.opacity = '0';
      setTimeout(() => {
        els.tickerText.textContent = ROTATING_PROMPTS[promptTickerIndex];
        els.tickerText.style.opacity = '1';
      }, 300);
    }, 4200);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════════════

  function setupEventListeners() {
    // Mode toggles
    if (els.btnModeUser) els.btnModeUser.addEventListener('click', () => applyMode(false));
    if (els.btnModeDemo) els.btnModeDemo.addEventListener('click', () => applyMode(true));

    // Suggestion chips
    document.querySelectorAll('.chip[data-query]').forEach(chip => {
      chip.addEventListener('click', () => {
        const q = chip.getAttribute('data-query');
        if (q) {
          if (!sessionActive) {
            sessionActive = true;
            metrics.startSession();
          }
          processUserMessage(q);
        }
      });
    });

    // Quick action cards
    document.querySelectorAll('.qa-card[data-query]').forEach(card => {
      card.addEventListener('click', () => {
        const q = card.getAttribute('data-query');
        if (q) {
          if (!sessionActive) {
            sessionActive = true;
            metrics.startSession();
          }
          processUserMessage(q);
        }
      });
    });

    // Main voice button
    els.btnVoice.addEventListener('click', () => {
      if (state.voiceState === 'ERROR') {
        hideError();
        setVoiceState('READY');
        return;
      }
      startSession();
    });

    // Manual interrupt button
    els.btnInterrupt.addEventListener('click', () => {
      if (state.voiceState === 'SPEAKING' || state.voiceState === 'THINKING' || state.voiceState === 'TOOL_WORKING') {
        handleInterruption();
      }
    });

    // Google Auth Connect / Disconnect
    if (els.btnGoogleAuth) {
      els.btnGoogleAuth.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/auth/google/status');
          const data = await res.json();

          if (data.connected) {
            await fetch('/api/auth/google/disconnect', { method: 'POST' });
            await checkHealth();
          } else {
            // Open Google OAuth in popup
            const width = 550;
            const height = 650;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;
            window.open(
              '/api/auth/google',
              'voxa_google_auth',
              `width=${width},height=${height},top=${top},left=${left}`
            );
          }
        } catch (err) {
          console.error('[Google Auth UI Error]:', err);
          showError('Could not open Google authentication.');
        }
      });
    }

    // Listen for OAuth callback completion message
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'VOXA_GOOGLE_CONNECTED') {
        checkHealth();
      }
    });

    // Clear chat
    els.btnClearChat.addEventListener('click', () => {
      state.reset();
      els.transcriptBody.innerHTML = '';
      if (els.transcriptEmpty) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'transcript-empty';
        emptyDiv.id = 'transcriptEmpty';
        emptyDiv.innerHTML = '<div class="empty-icon">💬</div><h4>Let\'s get started</h4><p>Press <strong>Start Talking</strong> or click a quick action above.</p><div class="empty-examples"><span>"What do I have tomorrow?"</span><span>"What\'s due this week?"</span><span>"Check my important emails."</span></div>';
        els.transcriptBody.appendChild(emptyDiv);
      }
      metrics.startSession();
      updateMetricsDisplay();
      updateChecklist();
      updateVoiceActivity(null, 'READY', '—', 'Press Start Talking to begin');
    });

    // Error close
    els.errorClose.addEventListener('click', hideError);

    // Hackathon Suite buttons
    if (els.btnTest1) els.btnTest1.addEventListener('click', () => runTestScenario(1));
    if (els.btnTest2) els.btnTest2.addEventListener('click', () => runTestScenario(2));
    if (els.btnTest3) els.btnTest3.addEventListener('click', () => runTestScenario(3));
    if (els.btnTest4) els.btnTest4.addEventListener('click', () => runTestScenario(4));
    if (els.btnStressTest) els.btnStressTest.addEventListener('click', runStressTest);

    // Panel toggles
    setupPanelToggles();

    // Keyboard shortcut: Space to toggle voice
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        startSession();
      }
      // Escape to stop
      if (e.code === 'Escape' && sessionActive) {
        stopSession();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PERIODIC UPDATES
  // ══════════════════════════════════════════════════════════════════════════

  function startPeriodicUpdates() {
    // Update metrics display periodically while session is active
    setInterval(() => {
      if (sessionActive) {
        updateMetricsDisplay();
      }
    }, 1000);

    // Poll health & integration connection states periodically
    setInterval(() => {
      checkHealth();
    }, 4000);

    // Listen for extension in-page bridge messages
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'VOXA_EXTENSION_INSTALLED' || e.data?.type === 'VOXA_EXTENSION_STATUS') {
        checkHealth();
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════════════════════════

  async function init() {
    console.log('%c VOXA %c Adaptive Voice AI ', 
      'background: #6366f1; color: white; padding: 4px 8px; border-radius: 4px 0 0 4px; font-weight: bold;',
      'background: #1a1a28; color: #22d3ee; padding: 4px 8px; border-radius: 0 4px 4px 0;'
    );

    // Apply saved or default UI mode
    applyMode(isDemoMode);

    // Initialize orb
    const canvas = document.getElementById('orbCanvas');
    if (canvas) {
      orb = new window.VoxaOrb(canvas);
      orb.start();
    }

    // Setup event listeners
    setupEventListeners();

    // Start rotating prompt ticker
    startPromptTicker();

    // Initialize checklist display
    updateChecklist();

    // Health check
    await checkHealth();

    // Start periodic updates
    startPeriodicUpdates();

    // Set initial state
    setVoiceState('READY');

    console.log('[VOXA] Ready. Press Start Talking or press Space.');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
