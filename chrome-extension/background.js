/**
 * VOXA Chrome Extension — Background Service Worker (Manifest V3)
 * Secure, authenticated browser action companion for VOXA Adaptive Voice AI.
 * 
 * IMPORTANT SECURITY:
 * - NO API keys, OAuth secrets, or user credentials in extension.
 * - Strict URL validation (safe http/https only; blocks javascript:, file:, data:).
 * - Only explicitly defined browser actions permitted (OPEN_URL, OPEN_SERVICE, GET_ACTIVE_TAB).
 * - Never executes arbitrary strings or code.
 */

let voxaUrl = 'http://localhost:3000';

// Initialize configurable backend URL from storage
chrome.storage.local.get(['voxaBackendUrl'], (data) => {
  if (data?.voxaBackendUrl) {
    voxaUrl = data.voxaBackendUrl.replace(/\/+$/, '');
    console.log('[VOXA Extension] Configured backend URL:', voxaUrl);
  }
});

const SERVICE_URLS = {
  gmail: 'https://mail.google.com/',
  calendar: 'https://calendar.google.com/',
  classroom: 'https://classroom.google.com/',
};

let eventSource = null;
let isConnected = false;
let currentStatus = 'Idle'; // 'Idle' | 'Executing action'
let lastAction = null;
let currentRequestId = null;
const cancelledRequestIds = new Set();

/**
 * Validate that a URL is safe to open.
 * Only http and https protocols are permitted.
 */
function isSafeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/**
 * Connect to VOXA SSE stream.
 */
function connectToVoxa() {
  if (eventSource) {
    try { eventSource.close(); } catch (e) {}
    eventSource = null;
  }

  console.log('[VOXA Extension] Connecting to VOXA stream on ' + voxaUrl);

  try {
    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource(`${voxaUrl}/api/extension/stream`);

      eventSource.onopen = () => {
        console.log('[VOXA Extension] Connected to VOXA SSE stream');
        isConnected = true;
        currentStatus = 'Idle';
        broadcastStatus();
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleStreamMessage(data);
        } catch (e) {
          console.warn('[VOXA Extension] Failed to parse stream event:', e);
        }
      };

      eventSource.onerror = () => {
        console.warn('[VOXA Extension] SSE Stream disconnected, will reconnect...');
        isConnected = false;
        currentStatus = 'Disconnected';
        broadcastStatus();
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        setTimeout(connectToVoxa, 4000);
      };
    } else {
      startFetchStream();
    }
  } catch (err) {
    console.warn('[VOXA Extension] SSE init error, falling back to fetch stream:', err);
    startFetchStream();
  }
}

/**
 * Streaming fetch fallback for environments without global EventSource.
 */
async function startFetchStream() {
  try {
    const res = await fetch(`${voxaUrl}/api/extension/stream`);
    if (!res.ok || !res.body) throw new Error(`Stream HTTP ${res.status}`);

    isConnected = true;
    currentStatus = 'Idle';
    broadcastStatus();
    console.log('[VOXA Extension] Connected via fetch stream');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop();

      for (const part of parts) {
        const line = part.trim();
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.substring(6));
            handleStreamMessage(data);
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    isConnected = false;
    currentStatus = 'Disconnected';
    broadcastStatus();
    setTimeout(connectToVoxa, 4000);
  }
}

/**
 * Handle incoming commands dispatched from VOXA.
 */
async function handleStreamMessage(msg) {
  if (msg.type === 'CONNECTED') {
    isConnected = true;
    currentStatus = 'Idle';
    broadcastStatus();
    return;
  }

  // Handle cancellation signal from VOXA
  if (msg.type === 'CANCEL_ACTION' || msg.type === 'CANCEL_REQUEST') {
    if (msg.requestId) {
      console.log(`[VOXA Extension] Cancelled requestId: ${msg.requestId}`);
      cancelledRequestIds.add(msg.requestId);
    }
    return;
  }

  if (msg.type === 'EXECUTE_ACTION') {
    const { actionId, action, payload, requestId } = msg;
    console.log(`[VOXA Extension] Processing action "${action}" (req: ${requestId})`, payload);

    // Stale / cancelled request check
    if (requestId && cancelledRequestIds.has(requestId)) {
      console.log(`[VOXA Extension] Dropping cancelled requestId: ${requestId}`);
      reportActionResult(actionId, {
        success: false,
        error: 'CANCELLED',
        message: 'Action was cancelled before execution',
        requestId,
      });
      return;
    }

    currentRequestId = requestId;
    currentStatus = 'Executing action';
    lastAction = { action, payload, requestId, timestamp: Date.now() };
    broadcastStatus();

    let result = { success: false, requestId };

    try {
      if (action === 'OPEN_URL') {
        const targetUrl = payload?.url;
        if (isSafeUrl(targetUrl)) {
          const tab = await openOrFocusTab(targetUrl);
          result = {
            success: true,
            action: 'OPEN_URL',
            url: targetUrl,
            tabId: tab.id,
            requestId,
          };
        } else {
          result = {
            success: false,
            action: 'OPEN_URL',
            error: 'INVALID_URL',
            message: 'Only safe http/https URLs are permitted.',
            requestId,
          };
        }
      } else if (action === 'OPEN_SERVICE') {
        const serviceKey = (payload?.service || '').toLowerCase();
        const serviceUrl = SERVICE_URLS[serviceKey];
        if (serviceUrl) {
          const tab = await openOrFocusTab(serviceUrl);
          result = {
            success: true,
            action: 'OPEN_SERVICE',
            service: serviceKey,
            url: serviceUrl,
            tabId: tab.id,
            requestId,
          };
        } else {
          result = {
            success: false,
            action: 'OPEN_SERVICE',
            error: 'UNKNOWN_SERVICE',
            message: `Service "${serviceKey}" is not supported.`,
            requestId,
          };
        }
      } else if (action === 'GET_ACTIVE_TAB') {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        result = {
          success: true,
          action: 'GET_ACTIVE_TAB',
          tab: activeTab ? { id: activeTab.id, title: activeTab.title, url: activeTab.url } : null,
          requestId,
        };
      } else {
        result = {
          success: false,
          error: 'UNKNOWN_ACTION',
          message: `Action "${action}" is not supported.`,
          requestId,
        };
      }
    } catch (err) {
      result = {
        success: false,
        error: 'EXECUTION_FAILED',
        message: err.message,
        requestId,
      };
    } finally {
      currentStatus = 'Idle';
      broadcastStatus();
    }

    // Double check cancellation before acknowledging back
    if (requestId && cancelledRequestIds.has(requestId)) {
      result.cancelled = true;
    }

    reportActionResult(actionId, result);
  }
}

/**
 * Open a URL in Chrome or focus an existing tab with the same origin.
 */
async function openOrFocusTab(url) {
  try {
    const origin = new URL(url).origin;
    const existing = await chrome.tabs.query({ url: `${origin}/*` });
    if (existing.length > 0) {
      const tab = existing[0];
      await chrome.tabs.update(tab.id, { active: true, url });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      return tab;
    }
  } catch (e) {
    // If URL origin matching fails, create new tab directly
  }

  return await chrome.tabs.create({ url, active: true });
}

/**
 * Report structured action result back to VOXA backend.
 */
async function reportActionResult(actionId, result) {
  try {
    await fetch(`${voxaUrl}/api/extension/action-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, result }),
    });
  } catch (err) {
    console.warn('[VOXA Extension] Failed to report action result:', err.message);
  }
}

/**
 * Heartbeat mechanism: pings VOXA backend every 12 seconds with active tab info.
 */
async function sendHeartbeat() {
  try {
    let currentTab = null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && isSafeUrl(tab.url)) {
      currentTab = { id: tab.id, title: tab.title, url: tab.url };
    }

    const res = await fetch(`${voxaUrl}/api/extension/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentTab, timestamp: Date.now(), version: '1.0.0' }),
    });

    if (res.ok) {
      if (!isConnected) {
        isConnected = true;
        currentStatus = 'Idle';
        broadcastStatus();
      }
    } else {
      isConnected = false;
      broadcastStatus();
    }
  } catch (err) {
    isConnected = false;
    broadcastStatus();
  }
}

/**
 * Broadcast status update to any open popup views.
 */
function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'VOXA_STATUS_UPDATE',
    status: {
      connected: isConnected,
      status: currentStatus,
      lastAction,
      currentRequestId,
      timestamp: Date.now(),
    },
  }).catch(() => {});
}

// Listen for popup messages and content script messages
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === 'GET_STATUS') {
    sendResponse({
      connected: isConnected,
      status: currentStatus,
      lastAction,
      currentRequestId,
      voxaUrl,
    });
    return false;
  }

  if (req.type === 'SET_BACKEND_URL') {
    const newUrl = (req.url || '').trim().replace(/\/+$/, '');
    if (isSafeUrl(newUrl)) {
      voxaUrl = newUrl;
      chrome.storage.local.set({ voxaBackendUrl: newUrl });
      console.log('[VOXA Extension] Backend URL updated to:', voxaUrl);
      connectToVoxa();
      sendHeartbeat();
      sendResponse({ success: true, voxaUrl });
    } else {
      sendResponse({ success: false, error: 'INVALID_URL' });
    }
    return false;
  }

  if (req.type === 'TRIGGER_CONNECT') {
    connectToVoxa();
    sendHeartbeat();
    sendResponse({ connecting: true });
    return false;
  }

  if (req.type === 'EXECUTE_LOCAL_SERVICE') {
    const service = req.service;
    const url = SERVICE_URLS[service];
    if (url) {
      openOrFocusTab(url).then(tab => {
        sendResponse({ success: true, tabId: tab.id });
      });
      return true; // Keep channel open for async response
    }
  }
});

// Boot background processes
connectToVoxa();
sendHeartbeat();
setInterval(sendHeartbeat, 12000);
