/**
 * VOXA Chrome Extension — Content Script
 * Injected on VOXA web app (http://localhost:3000/*) to establish a fast in-page bridge.
 */

// Signal to the VOXA web application that the extension is installed and active
function notifyVoxaDashboard() {
  window.postMessage({
    type: 'VOXA_EXTENSION_INSTALLED',
    version: '1.0.0',
    timestamp: Date.now(),
  }, '*');
}

// Notify on load
notifyVoxaDashboard();

// Listen for messages from VOXA web app (e.g. user clicks Reconnect in dashboard)
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data) return;

  if (event.data.type === 'VOXA_CHECK_EXTENSION') {
    chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
      window.postMessage({
        type: 'VOXA_EXTENSION_STATUS',
        status: res || { connected: false },
      }, '*');
    });
  }

  if (event.data.type === 'VOXA_PING_EXTENSION') {
    chrome.runtime.sendMessage({ type: 'TRIGGER_CONNECT' }, () => {
      notifyVoxaDashboard();
    });
  }
});

// Relay background status updates to page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'VOXA_STATUS_UPDATE') {
    window.postMessage({
      type: 'VOXA_EXTENSION_STATUS',
      status: msg.status,
    }, '*');
  }
});
