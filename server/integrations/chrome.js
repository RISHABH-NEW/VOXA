/**
 * VOXA — Chrome Extension Manager
 * Handles secure communication with the VOXA Manifest V3 Chrome Extension.
 * Dispatches browser actions (open Gmail, open Calendar, open Classroom, open URL, tab info).
 * 
 * IMPORTANT SECURITY:
 * - No API keys, OAuth secrets, or tokens sent to extension.
 * - Enforces strict URL validation before dispatch.
 * - Supports cancellation and stale response prevention via requestId and AbortSignal.
 */

class ChromeExtensionManager {
  constructor() {
    this.sseClients = new Set();
    this.lastHeartbeat = null;
    this.pendingActions = new Map(); // actionId -> { resolve, reject, timeout, requestId }
    this.lastKnownTab = null;
    this.cancelledRequestIds = new Set();
  }

  addClient(res) {
    this.sseClients.add(res);
    this.lastHeartbeat = Date.now();
    console.log(`[Chrome Extension] Client connected via SSE. Active clients: ${this.sseClients.size}`);

    // Send welcome handshake event
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

    res.on('close', () => {
      this.sseClients.delete(res);
      console.log(`[Chrome Extension] Client disconnected. Remaining: ${this.sseClients.size}`);
    });
  }

  recordHeartbeat(tabInfo = null) {
    this.lastHeartbeat = Date.now();
    if (tabInfo) {
      this.lastKnownTab = tabInfo;
    }
  }

  isConnected() {
    if (this.sseClients.size === 0) return false;
    // Considered connected if at least 1 client connected and heartbeat received in last 45s
    if (!this.lastHeartbeat) return false;
    return (Date.now() - this.lastHeartbeat) < 45000;
  }

  /**
   * Cancel in-flight actions associated with a requestId.
   */
  cancelRequest(requestId) {
    if (!requestId) return;
    this.cancelledRequestIds.add(requestId);

    // Cancel matching pending actions in flight
    for (const [actionId, pending] of this.pendingActions.entries()) {
      if (pending.requestId === requestId) {
        clearTimeout(pending.timer);
        this.pendingActions.delete(actionId);
        pending.resolve({
          success: false,
          service: 'chrome',
          error: 'CANCELLED',
          message: 'Browser action was cancelled due to user interruption',
          requestId,
        });
      }
    }

    // Broadcast cancellation to connected extensions
    const cancelMsg = `data: ${JSON.stringify({ type: 'CANCEL_ACTION', requestId })}\n\n`;
    for (const client of this.sseClients) {
      try { client.write(cancelMsg); } catch (e) { this.sseClients.delete(client); }
    }
  }

  /**
   * Dispatch an action to the connected Chrome Extension.
   */
  async dispatchAction(actionName, payload = {}, options = {}) {
    const { signal, timeoutMs = 5000, requestId } = options;

    if (signal?.aborted || (requestId && this.cancelledRequestIds.has(requestId))) {
      return {
        success: false,
        service: 'chrome',
        action: actionName,
        error: 'CANCELLED',
        message: 'Action was cancelled before dispatch',
        requestId,
      };
    }

    if (!this.isConnected()) {
      return {
        success: false,
        service: 'chrome',
        action: actionName,
        error: 'EXTENSION_NOT_CONNECTED',
        message: "Your VOXA Chrome extension isn't connected. Please load the extension in Chrome.",
        requestId,
      };
    }

    const actionId = `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const eventData = {
      type: 'EXECUTE_ACTION',
      actionId,
      action: actionName,
      payload,
      requestId,
      timestamp: Date.now(),
    };

    return new Promise((resolve) => {
      // Setup abort listener
      const abortListener = () => {
        if (this.pendingActions.has(actionId)) {
          clearTimeout(timer);
          this.pendingActions.delete(actionId);
          resolve({
            success: false,
            service: 'chrome',
            action: actionName,
            error: 'CANCELLED',
            message: 'Action was cancelled by user interruption',
            requestId,
          });
        }
      };

      if (signal) {
        signal.addEventListener('abort', abortListener, { once: true });
      }

      // Timeout fallback
      const timer = setTimeout(() => {
        if (this.pendingActions.has(actionId)) {
          this.pendingActions.delete(actionId);
          if (signal) signal.removeEventListener('abort', abortListener);
          resolve({
            success: true,
            service: 'chrome',
            action: actionName,
            dispatched: true,
            warning: 'Extension executed asynchronously without immediate ack',
            requestId,
          });
        }
      }, timeoutMs);

      this.pendingActions.set(actionId, {
        resolve: (res) => {
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', abortListener);
          this.pendingActions.delete(actionId);
          resolve({
            service: 'chrome',
            action: actionName,
            ...res,
            requestId,
          });
        },
        timer,
        requestId,
      });

      // Write SSE event to connected clients
      const message = `data: ${JSON.stringify(eventData)}\n\n`;
      for (const client of this.sseClients) {
        try {
          client.write(message);
        } catch (err) {
          this.sseClients.delete(client);
        }
      }
    });
  }

  handleActionResult(actionId, result) {
    if (this.pendingActions.has(actionId)) {
      const { resolve } = this.pendingActions.get(actionId);
      resolve(result);
    }
  }

  /**
   * Validate and open a web URL in Chrome.
   */
  async openUrl(url, options = {}) {
    if (!url || typeof url !== 'string') {
      return {
        success: false,
        service: 'chrome',
        action: 'OPEN_URL',
        error: 'INVALID_URL',
        message: 'A valid URL string is required.',
        requestId: options.requestId,
      };
    }

    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return {
        success: false,
        service: 'chrome',
        action: 'OPEN_URL',
        error: 'INVALID_URL',
        message: 'Only safe http/https URLs are permitted.',
        requestId: options.requestId,
      };
    }

    return this.dispatchAction('OPEN_URL', { url: trimmed }, options);
  }

  /**
   * Open standard student services (Gmail, Calendar, Classroom).
   */
  async openService(serviceName, options = {}) {
    const service = (serviceName || '').toLowerCase();
    const allowed = ['gmail', 'calendar', 'classroom'];
    if (!allowed.includes(service)) {
      return {
        success: false,
        service: 'chrome',
        action: 'OPEN_SERVICE',
        error: 'UNKNOWN_SERVICE',
        message: `Service "${serviceName}" is not recognized.`,
        requestId: options.requestId,
      };
    }

    return this.dispatchAction('OPEN_SERVICE', { service }, options);
  }

  async openGmail(options = {}) {
    return this.openService('gmail', options);
  }

  async openCalendar(options = {}) {
    return this.openService('calendar', options);
  }

  async openClassroom(options = {}) {
    return this.openService('classroom', options);
  }

  async getTabInfo(options = {}) {
    return this.dispatchAction('GET_ACTIVE_TAB', {}, options);
  }

  getStatus() {
    return {
      connected: this.isConnected(),
      activeClients: this.sseClients.size,
      lastHeartbeat: this.lastHeartbeat,
      lastKnownTab: this.lastKnownTab,
    };
  }
}

const chromeExtensionManager = new ChromeExtensionManager();

module.exports = {
  chromeExtensionManager,
};
