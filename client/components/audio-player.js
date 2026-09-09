/**
 * VOXA — Audio Player
 * Manages Rime TTS audio playback with request-ID-aware interruption.
 */

class VoxaAudioPlayer {
  constructor() {
    this.currentAudio = null;
    this.currentRequestId = null;
    this.isPlaying = false;
    this.queue = [];

    // Callbacks
    this.onPlayStart = null;
    this.onPlayEnd = null;
    this.onError = null;
    this.onInterrupted = null;
  }

  /**
   * Play audio from a blob, associated with a request ID.
   * Before playing, validates the request is still current.
   * @param {Blob} audioBlob - The audio data
   * @param {string} requestId - The request this audio belongs to
   * @param {function} isValid - Callback that returns true if requestId is still valid
   */
  async play(audioBlob, requestId, isValid) {
    // Stale check before playing
    if (isValid && !isValid(requestId)) {
      console.log(`[Audio] Discarding stale audio for request ${requestId.slice(0, 8)}`);
      return false;
    }

    // Stop any current playback
    this._stopCurrent();

    return new Promise((resolve, reject) => {
      try {
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        this.currentAudio = audio;
        this.currentRequestId = requestId;

        audio.oncanplaythrough = () => {
          // Final stale check right before playing
          if (isValid && !isValid(requestId)) {
            console.log(`[Audio] Discarding stale audio at play-time for ${requestId.slice(0, 8)}`);
            URL.revokeObjectURL(url);
            this.currentAudio = null;
            resolve(false);
            return;
          }

          this.isPlaying = true;
          audio.play().then(() => {
            this._notify('onPlayStart', { requestId });
          }).catch(err => {
            this.isPlaying = false;
            this._notify('onError', {
              message: 'Audio playback could not start.',
              error: err,
              requestId,
            });
            resolve(false);
          });
        };

        audio.onended = () => {
          this.isPlaying = false;
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          this.currentRequestId = null;
          this._notify('onPlayEnd', { requestId });
          resolve(true);
        };

        audio.onerror = (err) => {
          this.isPlaying = false;
          URL.revokeObjectURL(url);
          this.currentAudio = null;
          this.currentRequestId = null;
          this._notify('onError', {
            message: 'Audio playback error.',
            error: err,
            requestId,
          });
          resolve(false);
        };

        audio.load();
      } catch (err) {
        this._notify('onError', {
          message: 'Failed to create audio element.',
          error: err,
          requestId,
        });
        resolve(false);
      }
    });
  }

  /**
   * Immediately stop all audio playback.
   * Returns the duration that was played (for tracking partial delivery).
   */
  stop() {
    const playedDuration = this.getPlayedDuration();
    this._stopCurrent();
    this._clearQueue();
    this._notify('onInterrupted', { playedDuration });
    return playedDuration;
  }

  /**
   * Get how many seconds of the current audio have been played.
   */
  getPlayedDuration() {
    if (this.currentAudio && this.isPlaying) {
      return this.currentAudio.currentTime || 0;
    }
    return 0;
  }

  /**
   * Get total duration of current audio.
   */
  getTotalDuration() {
    if (this.currentAudio) {
      return this.currentAudio.duration || 0;
    }
    return 0;
  }

  _stopCurrent() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        if (this.currentAudio.src && this.currentAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(this.currentAudio.src);
        }
      } catch (e) {
        // Ignore cleanup errors
      }
      this.currentAudio = null;
      this.currentRequestId = null;
      this.isPlaying = false;
    }
  }

  _clearQueue() {
    this.queue.forEach(item => {
      if (item.url) {
        try { URL.revokeObjectURL(item.url); } catch (e) { /* ignore */ }
      }
    });
    this.queue = [];
  }

  _notify(callbackName, data = {}) {
    if (typeof this[callbackName] === 'function') {
      try {
        this[callbackName](data);
      } catch (e) {
        console.error(`[Audio] Callback error in ${callbackName}:`, e);
      }
    }
  }
}

window.VoxaAudioPlayer = VoxaAudioPlayer;
