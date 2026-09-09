/**
 * VOXA — Speech-to-Text Module
 * Wraps the Web Speech API (SpeechRecognition) with event emitters,
 * continuous mode, interim results, and interruption detection.
 */

class VoxaSTT {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.isSupported = false;
    this.isSpeechActive = false; // true while user is actively speaking

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

  _init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.isSupported = false;
      console.warn('[STT] SpeechRecognition API not supported in this browser');
      return;
    }

    this.isSupported = true;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.isListening = true;
      this._notify('onStateChange', { listening: true });
    };

    this.recognition.onend = () => {
      this.isListening = false;
      this.isSpeechActive = false;
      this._notify('onStateChange', { listening: false });

      // Auto-restart if we should still be listening
      if (this._shouldRestart) {
        this._restartTimeout = setTimeout(() => {
          if (this._shouldRestart) {
            try {
              this.recognition.start();
            } catch (e) {
              // Already started or other error, ignore
            }
          }
        }, 100);
      }
    };

    this.recognition.onspeechstart = () => {
      this.isSpeechActive = true;
      this._notify('onSpeechStart');
    };

    this.recognition.onspeechend = () => {
      this.isSpeechActive = false;
      this._notify('onSpeechEnd');
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript) {
        this._notify('onInterimResult', { transcript: interimTranscript });
      }

      if (finalTranscript) {
        this._notify('onFinalResult', { transcript: finalTranscript.trim() });
      }
    };

    this.recognition.onerror = (event) => {
      const error = event.error;

      // Don't treat 'no-speech' or 'aborted' as fatal
      if (error === 'no-speech' || error === 'aborted') {
        return;
      }

      let userMessage = '';
      let isFatal = false;

      switch (error) {
        case 'not-allowed':
          userMessage = 'Microphone permission is required for Voxa.';
          isFatal = true;
          break;
        case 'audio-capture':
          userMessage = 'No microphone detected. Please connect one.';
          isFatal = true;
          break;
        case 'network':
          userMessage = 'Speech recognition network error. Check connection.';
          break;
        case 'service-not-allowed':
          userMessage = 'Voice recognition is unavailable in this browser.';
          isFatal = true;
          break;
        default:
          userMessage = `Speech recognition error: ${error}`;
      }

      this._notify('onError', { error, message: userMessage, isFatal });

      if (isFatal) {
        this._shouldRestart = false;
      }
    };
  }

  /**
   * Start listening for speech.
   */
  start() {
    if (!this.isSupported) {
      this._notify('onError', {
        error: 'not-supported',
        message: 'Voice recognition is unavailable in this browser.',
        isFatal: true,
      });
      return false;
    }

    this._shouldRestart = true;

    if (!this.isListening) {
      try {
        this.recognition.start();
        return true;
      } catch (e) {
        console.error('[STT] Failed to start:', e);
        return false;
      }
    }
    return true;
  }

  /**
   * Stop listening for speech.
   */
  stop() {
    this._shouldRestart = false;
    clearTimeout(this._restartTimeout);

    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignore
      }
    }
    this.isListening = false;
    this.isSpeechActive = false;
  }

  /**
   * Temporarily pause and restart recognition.
   * Useful after interruption to get a clean new transcript.
   */
  restart() {
    if (!this.isSupported) return;

    try {
      this.recognition.stop();
    } catch (e) { /* ignore */ }

    // Will auto-restart via onend handler since _shouldRestart is true
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
