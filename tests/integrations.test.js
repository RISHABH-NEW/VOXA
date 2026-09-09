/**
 * VOXA — Multi-Service Integration & Interruption Test Suite
 * Validates Google service layer, Chrome extension manager,
 * central integration manager, command routing, and cancellation logic.
 */

const assert = require('assert');
const { googleClientManager, REQUIRED_SCOPES } = require('../server/integrations/google/googleClient');
const { commandRouter } = require('../server/integrations/commandRouter');
const { integrationManager } = require('../server/integrations/integrationManager');
const { chromeExtensionManager } = require('../server/integrations/chrome');

async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  VOXA — Integration & Interruption Test Suite');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌  FAIL: ${name}`);
      console.error(`      ${err.message}`);
      failed++;
    }
  }

  // ── 1. Google OAuth Client & Scopes ───────────────────────────────────────
  await test('Google OAuth Scopes are correctly configured', () => {
    assert(REQUIRED_SCOPES.includes('https://www.googleapis.com/auth/calendar.readonly'), 'Calendar scope missing');
    assert(REQUIRED_SCOPES.includes('https://www.googleapis.com/auth/classroom.courses.readonly'), 'Classroom courses scope missing');
    assert(REQUIRED_SCOPES.includes('https://www.googleapis.com/auth/classroom.coursework.me.readonly'), 'Classroom coursework scope missing');
    assert(REQUIRED_SCOPES.includes('https://www.googleapis.com/auth/gmail.readonly'), 'Gmail scope missing');
  });

  await test('Google Client Manager status reflects unauthenticated safely without crashing', () => {
    const status = googleClientManager.getStatus();
    assert.strictEqual(typeof status.connected, 'boolean');
    assert.strictEqual(typeof status.services.calendar.status, 'string');
    assert.strictEqual(typeof status.services.classroom.status, 'string');
    assert.strictEqual(typeof status.services.gmail.status, 'string');
  });

  // ── 2. Command Router Intent Classification ──────────────────────────────
  await test('CommandRouter routes "What do I have tomorrow?" to COMBINED_AGENDA', () => {
    const res = commandRouter.route('What do I have tomorrow?');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'agenda');
    assert.strictEqual(res.action, 'getCombinedAgenda');
  });

  await test('CommandRouter routes "What assignments do I have?" to CLASSROOM_ASSIGNMENTS', () => {
    const res = commandRouter.route('What assignments do I have?');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'classroom');
    assert.strictEqual(res.action, 'getUpcomingAssignments');
  });

  await test('CommandRouter routes "Do I have any unread emails?" to GMAIL_UNREAD', () => {
    const res = commandRouter.route('Do I have any unread emails?');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'gmail');
    assert.strictEqual(res.action, 'getUnreadEmails');
  });

  await test('CommandRouter routes "Open Gmail." to CHROME_ACTION', () => {
    const res = commandRouter.route('Open Gmail.');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'chrome');
    assert.strictEqual(res.action, 'openGmail');
  });

  await test('CommandRouter routes interruption redirection "Wait! Only tell me my assignments" directly to classroom', () => {
    const res = commandRouter.route('Wait! Only tell me my assignments');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'classroom');
    assert.strictEqual(res.action, 'getUpcomingAssignments');
  });

  await test('CommandRouter routes conversational greeting to CONVERSATIONAL (no tool)', () => {
    const res = commandRouter.route('Hello Voxa, how are you?');
    assert.strictEqual(res.requiresIntegration, false);
    assert.strictEqual(res.intent, 'CONVERSATIONAL');
  });

  // ── 3. Integration Manager Structured Results ─────────────────────────────
  await test('IntegrationManager returns structured result for unauthenticated Calendar call', async () => {
    const res = await integrationManager.execute({
      service: 'calendar',
      action: 'getTomorrowEvents',
      requestId: 'test-req-cal',
    });
    assert.strictEqual(res.service, 'calendar');
    // If live without Google credentials, it gracefully returns AUTH_REQUIRED
    assert(res.success === false && res.error === 'AUTH_REQUIRED' || res.success === true);
  });

  await test('IntegrationManager returns structured result for unauthenticated Classroom call', async () => {
    const res = await integrationManager.execute({
      service: 'classroom',
      action: 'getUpcomingAssignments',
      requestId: 'test-req-class',
    });
    assert.strictEqual(res.service, 'classroom');
    assert(res.success === false && res.error === 'AUTH_REQUIRED' || res.success === true);
  });

  await test('IntegrationManager returns structured result for unauthenticated Gmail call', async () => {
    const res = await integrationManager.execute({
      service: 'gmail',
      action: 'getRecentEmails',
      requestId: 'test-req-gmail',
    });
    assert.strictEqual(res.service, 'gmail');
    assert(res.success === false && res.error === 'AUTH_REQUIRED' || res.success === true);
  });

  // ── 4. Chrome Extension Manager ───────────────────────────────────────────
  await test('ChromeExtensionManager handles disconnected state gracefully', async () => {
    const res = await chromeExtensionManager.openGmail();
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'EXTENSION_NOT_CONNECTED');
  });

  await test('ChromeExtensionManager rejects unsafe URLs (javascript:, file:, data:)', async () => {
    const unsafeRes1 = await chromeExtensionManager.openUrl('javascript:alert(1)');
    assert.strictEqual(unsafeRes1.success, false);
    assert.strictEqual(unsafeRes1.error, 'INVALID_URL');

    const unsafeRes2 = await chromeExtensionManager.openUrl('file:///etc/passwd');
    assert.strictEqual(unsafeRes2.success, false);
    assert.strictEqual(unsafeRes2.error, 'INVALID_URL');
  });

  await test('CommandRouter routes "Open my physics assignment." to CHROME_ACTION openAssignment', () => {
    const res = commandRouter.route('Open my physics assignment.');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'chrome');
    assert.strictEqual(res.action, 'openAssignment');
    assert.strictEqual(res.parameters.query, 'physics');
  });

  await test('CommandRouter routes "Open the email from my professor." to CHROME_ACTION openEmail', () => {
    const res = commandRouter.route('Open the email from my professor.');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'chrome');
    assert.strictEqual(res.action, 'openEmail');
    assert.strictEqual(res.parameters.query, 'professor');
  });

  await test('CommandRouter routes "What tab is open?" to CHROME_ACTION getTabInfo', () => {
    const res = commandRouter.route('What tab is open?');
    assert.strictEqual(res.requiresIntegration, true);
    assert.strictEqual(res.service, 'chrome');
    assert.strictEqual(res.action, 'getTabInfo');
  });

  await test('ChromeExtensionManager cancels in-flight actions when cancelRequest() is called', async () => {
    chromeExtensionManager.cancelRequest('req-to-cancel-123');
    const res = await chromeExtensionManager.openGmail({ requestId: 'req-to-cancel-123' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'CANCELLED');
  });

  // ── 5. Interruption & Cancellation Protection ────────────────────────────
  await test('IntegrationManager aborts immediately when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    controller.abort(); // Pre-abort to simulate instant interruption

    const res = await integrationManager.execute({
      service: 'agenda',
      action: 'getCombinedAgenda',
      signal: controller.signal,
      requestId: 'test-cancelled-req',
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'CANCELLED');
    console.log('      Verified: Aborted request was cleanly stopped before execution');
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Tests Complete: ${passed} Passed, ${failed} Failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTests();
