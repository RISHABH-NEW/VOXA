/**
 * VOXA Chrome Extension — Popup Controller
 */

const statusIndicator = document.getElementById('statusIndicator');
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const currentStatusText = document.getElementById('currentStatusText');
const activeRequestRow = document.getElementById('activeRequestRow');
const activeRequestId = document.getElementById('activeRequestId');
const lastActionSection = document.getElementById('lastActionSection');
const lastActionType = document.getElementById('lastActionType');
const lastActionDetail = document.getElementById('lastActionDetail');
const inputBackendUrl = document.getElementById('inputBackendUrl');
const btnSaveUrl = document.getElementById('btnSaveUrl');
const btnReconnect = document.getElementById('btnReconnect');
const btnOpenGmail = document.getElementById('btnOpenGmail');
const btnOpenCalendar = document.getElementById('btnOpenCalendar');
const btnOpenClassroom = document.getElementById('btnOpenClassroom');

function renderUI(data) {
  const isConn = !!(data && data.connected);
  
  if (inputBackendUrl && data && data.voxaUrl && document.activeElement !== inputBackendUrl) {
    inputBackendUrl.value = data.voxaUrl;
  }
  
  if (isConn) {
    statusDot.textContent = '●';
    statusLabel.textContent = 'Connected';
    statusIndicator.className = 'status-indicator connected';
    currentStatusText.textContent = data.status || 'Idle';
    currentStatusText.className = 'status-val ' + (data.status === 'Executing action' ? 'active' : 'idle');
  } else {
    statusDot.textContent = '○';
    statusLabel.textContent = 'Not Connected';
    statusIndicator.className = 'status-indicator disconnected';
    currentStatusText.textContent = 'Disconnected';
    currentStatusText.className = 'status-val disconnected';
  }

  // Active Request
  if (data && data.currentRequestId && data.status === 'Executing action') {
    activeRequestRow.hidden = false;
    activeRequestId.textContent = data.currentRequestId;
  } else {
    activeRequestRow.hidden = true;
  }

  // Last Action
  if (data && data.lastAction) {
    lastActionSection.hidden = false;
    const act = data.lastAction;
    lastActionType.textContent = act.action || 'Action';
    lastActionDetail.textContent = act.payload?.url || (act.payload?.service ? `Service: ${act.payload.service}` : JSON.stringify(act.payload || {}));
  } else {
    lastActionSection.hidden = true;
  }
}

// Request initial status from background service worker
chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  renderUI(res);
});

// Real-time updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'VOXA_STATUS_UPDATE') {
    renderUI(msg.status);
  }
});

// Reconnect handler
btnReconnect.addEventListener('click', () => {
  statusDot.textContent = '○';
  statusLabel.textContent = 'Connecting...';
  currentStatusText.textContent = 'Handshaking...';
  
  chrome.runtime.sendMessage({ type: 'TRIGGER_CONNECT' }, () => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'GET_STATUS' }, renderUI);
    }, 1200);
  });
});

// Quick action buttons
btnOpenGmail.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'EXECUTE_LOCAL_SERVICE', service: 'gmail' });
});

btnOpenCalendar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'EXECUTE_LOCAL_SERVICE', service: 'calendar' });
});

btnOpenClassroom.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'EXECUTE_LOCAL_SERVICE', service: 'classroom' });
});

// Save Server URL handler
if (btnSaveUrl) {
  btnSaveUrl.addEventListener('click', () => {
    const url = inputBackendUrl.value.trim();
    if (url) {
      btnSaveUrl.textContent = '...';
      chrome.runtime.sendMessage({ type: 'SET_BACKEND_URL', url }, (res) => {
        btnSaveUrl.textContent = 'Saved';
        setTimeout(() => { btnSaveUrl.textContent = 'Save'; }, 1500);
        chrome.runtime.sendMessage({ type: 'GET_STATUS' }, renderUI);
      });
    }
  });
}

