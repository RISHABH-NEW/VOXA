/**
 * VOXA — Speech-to-Text Module
 * Wraps the Web Speech API (SpeechRecognition) with event emitters,
 * continuous mode, interim results, interruption detection,
 * automatic recovery, and diagnostics.
 */

class VoxaSTT {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.isSupported = false;
    this.isSpeechActive = false; // true while user is actively speaking
    this.lastError = null;
    this.lastInterimTranscript = '';
    this.retryCount = 0;
    this.maxRetries = 2;
    this.intentionalStop = false;
    this.micPermission = 'prompt'; // 'granted' | 'denied' | 'prompt'
    this.browserInfo = this._getBrowserInfo();

    // Event callbacks
    this.onSpeechStart = null;    // User started speaking
    this.onSpeechEnd = null;      // User stopped speaking
    this.onInterimResult = null;  // Partial transcript
    this.onFinalResult = null;    // Final transcript
    this.onError = null;          // Error occurred
    this.onStateChange = null;    // Listening state changed

    this._shouldRestart = false;
    this._restartTimeout = null;

    this._init();
  }

  /**
   * Browser detection and environment metadata helper.
   */
  _getBrowserInfo() {
    const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
    let name = 'Unknown Browser';

    if (ua.includes('Edg/')) {
      name = 'Microsoft Edge';
    } else if (ua.includes('Chrome/') && !ua.includes('Edg/')) {
      name = 'Google Chrome';
    } else if (ua.includes('Firefox/')) {
      name = 'Mozilla Firefox';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome/')) {
      name = 'Apple Safari';
    }

    const protocol = typeof window !== 'undefined' && window.location ? window.location.protocol : 'unknown';
    const isSecureContext = typeof window !== 'undefined' ? !!window.isSecureContext : false;

    return {
      name,
      userAgent: ua,
      protocol,
      isSecureContext,
    };
  }

  /**
   * Initialize feature detection and log pipeline configuration.
   */
  _init() {
    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;

    if (!SpeechRecognition) {
      this.isSupported = false;
      console.warn('[STT Pipeline] Web Speech API is not supported in this browser:', {
        browser: this.browserInfo.name,
        protocol: this.browserInfo.protocol,
        SpeechRecognition: false,
        webkitSpeechRecognition: false,
      });
      return;
    }

    this.isSupported = true;

    // Log configuration safely without exposing secrets
    console.log('[STT Pipeline] Initialized successfully:', {
      browser: this.browserInfo.name,
      speechRecognitionAvailable: true,
      apiImplementation: window.SpeechRecognition ? 'standard' : 'webkitSpeechRecognition',
      lang: 'en-US',
      continuous: true,
      interimResults: true,
      maxAlternatives: 1,
      secureContext: this.browserInfo.isSecureContext,
      protocol: this.browserInfo.protocol,
    });
  }

  /**
   * Check microphone permission status via Permissions API.
   */
  async checkMicrophonePermission() {
    if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
      return this.micPermission;
    }

    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
      this.micPermission = permissionStatus.state; // 'granted' | 'denied' | 'prompt'
      permissionStatus.onchange = () => {
        this.micPermission = permissionStatus.state;
        console.log('[STT Pipeline] Microphone permission changed:', permissionStatus.state);
      };
      return permissionStatus.state;
    } catch (e) {
      return this.micPermission;
    }
  }

  /**
   * Warm up and verify microphone access via getUserMedia.
   */
  async requestMicrophoneAccess() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { granted: false, error: 'unsupported' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop all tracks to release hardware; permission is now established
      stream.getTracks().forEach(track => track.stop());
      this.micPermission = 'granted';
      return { granted: true };
    } catch (err) {
      console.warn('[STT Pipeline] getUserMedia failed:', err.name, err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.micPermission = 'denied';
        return { granted: false, error: 'not-allowed' };
      }
      if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        return { granted: false, error: 'audio-capture' };
      }
      return { granted: false, error: err.name };
    }
  }

  /**
   * Factory to create a clean, fresh SpeechRecognition instance.
   * Avoids reusing corrupted or invalidated recognition instances.
   */
  _createRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return null;

    if (this.recognition) {
      try {
        this.recognition.onstart = null;
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.onresult = null;
        this.recognition.onspeechstart = null;
        this.recognition.onspeechend = null;
        this.recognition.abort();
      } catch (e) {
        // Ignore abort cleanup errors
      }
      this.recognition = null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      console.log('[STT Event] onstart | Voice recognition active');
      this.isListening = true;
      this.retryCount = 0;
      this._notify('onStateChange', { listening: true });
    };

    recognition.onspeechstart = () => {
      console.log('[STT Event] onspeechstart | User speech detected');
      this.isSpeechActive = true;
      this._notify('onSpeechStart');
    };

    recognition.onspeechend = () => {
      console.log('[STT Event] onspeechend | User speech pause/end');
      this.isSpeechActive = false;
      this._notify('onSpeechEnd');
    };

    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      console.log('[STT Event] onresult:', {
        interim: interimTranscript,
        final: finalTranscript,
        resultIndex: event.resultIndex,
      });

      if (interimTranscript) {
        this.lastInterimTranscript = interimTranscript;
        this._notify('onInterimResult', { transcript: interimTranscript });
      }

      if (finalTranscript) {
        this.lastInterimTranscript = '';
        this._notify('onFinalResult', { transcript: finalTranscript.trim() });
      }
    };

    recognition.onerror = (event) => {
      const error = event.error || 'unknown';
      console.warn('[STT Event] onerror:', error, event.message || '');
      this.lastError = error;

      // Handle intentional abort without reporting error
      if (error === 'aborted' && this.intentionalStop) {
        return;
      }

      let userMessage = '';
      let isFatal = false;

      switch (error) {
        case 'not-allowed':
          userMessage = 'Microphone access is blocked. Allow microphone access and try again.';
          isFatal = true;
          this.micPermission = 'denied';
          break;

        case 'service-not-allowed':
          userMessage = 'Speech recognition service is unavailable. Please check your browser/network and try again.';
          isFatal = true;
          break;

        case 'network':
          // If interim speech was already recorded before network drop, salvage it
          if (this.lastInterimTranscript && this.lastInterimTranscript.trim().length > 0) {
            const recoveredText = this.lastInterimTranscript.trim();
            console.log('[STT Recovery] Salvaging interim transcript before network drop:', recoveredText);
            this.lastInterimTranscript = '';
            this._notify('onFinalResult', { transcript: recoveredText });
            return;
          }

          // If session is still supposed to run, attempt a resilient restart with backoff
          if (this._shouldRestart && this.retryCount < this.maxRetries) {
            this.retryCount++;
            console.log(`[STT Recovery] Transient network drop. Attempting clean restart ${this.retryCount}/${this.maxRetries}...`);
            return;
          }

          userMessage = 'Speech recognition service is unavailable. Please check your browser/network and try again.';
          isFatal = true;
          break;

        case 'no-speech':
          userMessage = "I didn't hear anything. Try again.";
          isFatal = false;
          break;

        case 'audio-capture':
          userMessage = 'No microphone detected. Please connect one.';
          isFatal = true;
          break;

        case 'aborted':
          // If aborted unexpectedly
          userMessage = 'Voice recognition was interrupted. Try again.';
          isFatal = false;
          break;

        case 'language-not-supported':
          userMessage = 'The selected language is not supported for voice recognition.';
          isFatal = true;
          break;

        default:
          userMessage = `Voice recognition error: ${error}. Please try again.`;
          isFatal = false;
      }

      this._notify('onError', { error, message: userMessage, isFatal });

      if (isFatal) {
        this._shouldRestart = false;
        this.isListening = false;
      }
    };

    recognition.onend = () => {
      console.log('[STT Event] onend | Listening stopped. shouldRestart =', this._shouldRestart);
      this.isListening = false;
      this.isSpeechActive = false;
      this._notify('onStateChange', { listening: false });

      // Auto-restart with safe backoff if still in active listening session
      if (this._shouldRestart && !this.intentionalStop) {
        clearTimeout(this._restartTimeout);
        const backoffMs = this.retryCount > 0
          ? Math.min(600 * this.retryCount, 2500)
          : 150;

        this._restartTimeout = setTimeout(() => {
          if (this._shouldRestart && !this.intentionalStop) {
            this._startRecognition();
          }
        }, backoffMs);
      }
    };

    return recognition;
  }

  /**
   * Internal recognition starter that creates a fresh instance.
   */
  _startRecognition() {
    if (this.isListening) return true;

    try {
      this.recognition = this._createRecognition();
      if (!this.recognition) return false;
      this.recognition.start();
      return true;
    } catch (e) {
      console.error('[STT] Recognition start failed:', e);
      if (e.name === 'InvalidStateError') {
        this.isListening = true;
        return true;
      }
      this._notify('onError', {
        error: 'start-failure',
        message: 'Could not start voice recognition. Please try again.',
        isFatal: false,
      });
      return false;
    }
  }

  /**
   * Start listening for speech with full permission & support checks.
   */
  async start() {
    this.intentionalStop = false;
    this.lastInterimTranscript = '';

    if (!this.isSupported) {
      this._notify('onError', {
        error: 'not-supported',
        message: "Voice recognition isn't supported in this browser. Please use Chrome or Edge.",
        isFatal: true,
      });
      return false;
    }

    this._shouldRestart = true;

    // Check and request microphone permissions
    if (this.micPermission !== 'granted') {
      const micResult = await this.requestMicrophoneAccess();
      if (!micResult.granted) {
        let msg = 'Microphone access is blocked. Allow microphone access and try again.';
        if (micResult.error === 'audio-capture') {
          msg = 'No microphone detected. Please connect one.';
        } else if (micResult.error === 'unsupported') {
          msg = "Voice recognition isn't supported in this browser. Please use Chrome or Edge.";
        }
        this._notify('onError', {
          error: micResult.error || 'not-allowed',
          message: msg,
          isFatal: true,
        });
        return false;
      }
    }

    return this._startRecognition();
  }

  /**
   * Stop listening for speech cleanly.
   */
  stop() {
    this.intentionalStop = true;
    this._shouldRestart = false;
    this.retryCount = 0;
    this.lastInterimTranscript = '';
    clearTimeout(this._restartTimeout);

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignore stop error
      }
    }
    this.isListening = false;
    this.isSpeechActive = false;
  }

  /**
   * Temporarily pause and restart recognition (e.g. after interruption).
   */
  restart() {
    if (!this.isSupported) return;

    this.intentionalStop = false;
    this._shouldRestart = true;
    this.retryCount = 0;
    this.lastInterimTranscript = '';

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {
        // Ignore abort error
      }
    }

    clearTimeout(this._restartTimeout);
    this._restartTimeout = setTimeout(() => {
      if (this._shouldRestart && !this.intentionalStop) {
        this._startRecognition();
      }
    }, 150);
  }

  /**
   * Internal diagnostic runner for Hackathon & Developer checks.
   */
  async runDiagnostics() {
    await this.checkMicrophonePermission();

    const diagnostics = {
      browser: this.browserInfo.name,
      userAgent: this.browserInfo.userAgent,
      protocol: this.browserInfo.protocol,
      isHttps: this.browserInfo.protocol === 'https:',
      sttSupported: this.isSupported ? 'YES' : 'NO',
      speechRecognitionAPI: typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      mediaDevicesSupported: typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      microphonePermission: (this.micPermission || 'unknown').toUpperCase(),
      recognitionStatus: this.isSupported ? (this.isListening ? 'LISTENING' : 'READY') : 'FAILED',
      lastSTTError: this.lastError || 'None',
      continuous: true,
      lang: 'en-US',
    };

    console.log('[STT Diagnostic Report]', diagnostics);
    return diagnostics;
  }

  _notify(callbackName, data = {}) {
    if (typeof this[callbackName] === 'function') {
      try {
        this[callbackName](data);
      } catch (e) {
        console.error(`[STT] Callback error in ${callbackName}:`, e);
      }
    }
  }
}

window.VoxaSTT = VoxaSTT;
