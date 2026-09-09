/**
 * VOXA — Google Auth Service Layer
 * Coordinates authentication state, callbacks, and status checking.
 */

const { googleClientManager, REQUIRED_SCOPES } = require('./googleClient');

function getAuthUrl(state = '') {
  return googleClientManager.generateAuthUrl(state);
}

async function handleCallback(code) {
  return await googleClientManager.handleCallback(code);
}

function getAuthStatus() {
  return googleClientManager.getStatus();
}

async function disconnect() {
  return await googleClientManager.disconnect();
}

module.exports = {
  getAuthUrl,
  handleCallback,
  getAuthStatus,
  disconnect,
  REQUIRED_SCOPES,
};
