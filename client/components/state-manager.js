/**
 * VOXA — State Manager
 * Centralized state management with event-driven updates.
 * Tracks conversation history, request lifecycle, and system states.
 */

class VoxaStateManager {
  constructor() {
    // Voice state machine
    this.voiceState = 'READY'; // READY | LISTENING | THINKING | SPEAKING | INTERRUPTED | ERROR

    // Request tracking
    this.currentRequestId = null;
    this.currentResponseId = null;

    // Conversation
    this.conversationHistory = [];

    // Audio state
    this.currentAudio = null;
    this.queuedAudio = [];

    // Timing
    this.responseStartedAt = null;
    this.responseInterruptedAt = null;
    this.audioStoppedAt = null;
    this.lastSpeakingStartedAt = null;

    // Partial delivery tracking
    this.lastSpokenText = null;
    this.spokenDuration = 0; // seconds of audio played before interruption

    // Event listeners
    this._listeners = {};
  }

  // ── Event System ─────────────────────────────────────────────────────────

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[State] Event handler error:`, e); }
      });
    }
  }

  // ── State Transitions ────────────────────────────────────────────────────

  setState(newState, metadata = {}) {
    const oldState = this.voiceState;
    if (oldState === newState) return;

    this.voiceState = newState;
    this.emit('stateChange', { oldState, newState, metadata });
  }

  // ── Request Management ───────────────────────────────────────────────────

  createRequest() {
    const requestId = crypto.randomUUID();
    this.currentRequestId = requestId;
    this.responseStartedAt = performance.now();
    this.emit('requestCreated', { requestId });
    return requestId;
  }

  isRequestValid(requestId) {
    return requestId === this.currentRequestId;
  }

  invalidateRequest(requestId) {
    if (this.currentRequestId === requestId) {
      this.currentRequestId = null;
    }
    this.emit('requestInvalidated', { requestId });
  }

  // ── Conversation ─────────────────────────────────────────────────────────

  addMessage(role, content, metadata = {}) {
    const message = {
      id: crypto.randomUUID(),
      role, // 'user' | 'assistant'
      content,
      timestamp: Date.now(),
      requestId: metadata.requestId || null,
      interrupted: false,
      interruptedAt: null,
      spokenPortion: null,
      responseType: metadata.responseType || null,
      isMock: metadata.isMock || false,
    };

    this.conversationHistory.push(message);
    this.emit('messageAdded', message);
    return message;
  }

  markLastAssistantInterrupted(spokenDuration = null) {
    for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
      const msg = this.conversationHistory[i];
      if (msg.role === 'assistant' && !msg.interrupted) {
        msg.interrupted = true;
        msg.interruptedAt = Date.now();
        msg.spokenDuration = spokenDuration;
        this.emit('messageInterrupted', msg);
        return msg;
      }
    }
    return null;
  }

  /**
   * Get messages formatted for the LLM API.
   * Interrupted messages are annotated so the LLM knows what was partially heard.
   */
  getMessagesForLLM() {
    return this.conversationHistory.map(msg => {
      let content = msg.content;
      if (msg.interrupted) {
        content = `[Response was interrupted by user — they may not have heard all of this] ${content}`;
      }
      return { role: msg.role, content };
    });
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  reset() {
    this.voiceState = 'READY';
    this.currentRequestId = null;
    this.currentResponseId = null;
    this.conversationHistory = [];
    this.currentAudio = null;
    this.queuedAudio = [];
    this.responseStartedAt = null;
    this.responseInterruptedAt = null;
    this.audioStoppedAt = null;
    this.lastSpeakingStartedAt = null;
    this.lastSpokenText = null;
    this.spokenDuration = 0;
    this.emit('reset');
  }
}

// Export as singleton
window.VoxaState = new VoxaStateManager();
