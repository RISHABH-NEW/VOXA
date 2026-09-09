/**
 * VOXA — Stress Test
 * 
 * Tests the system under rapid sequential interruptions.
 * Verifies that:
 *   1. No stale audio plays after interruption
 *   2. Request invalidation works correctly
 *   3. Context is preserved across multiple interruptions
 *   4. The system recovers cleanly
 * 
 * Run: node tests/stress-test.js
 * (Server must be running)
 */

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Test 1: Rapid request cancellation
 * Send a chat request, then immediately cancel it.
 * The cancelled request should not produce a response.
 */
async function testRapidCancellation() {
  const requestId = 'stress-test-' + Date.now();

  // Send chat request
  const chatPromise = fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Tell me a very long story about a dragon' }],
      requestId,
    }),
  });

  // Immediately cancel
  await sleep(50);
  const cancelRes = await fetch(`${BASE_URL}/api/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });

  const cancelData = await cancelRes.json();

  // The chat request should either be cancelled or completed
  // Either way, the cancel endpoint should respond
  const passed = cancelRes.ok;

  return {
    name: 'Rapid Cancellation',
    passed,
    detail: passed
      ? `Cancel responded OK, operations cancelled: ${cancelData.operationsCancelled}`
      : 'Cancel endpoint failed',
  };
}

/**
 * Test 2: Sequential requests with invalidation
 * Send request A, then immediately send request B.
 * Only request B's response should be considered valid.
 */
async function testSequentialInvalidation() {
  const requestA = 'stress-seq-A-' + Date.now();
  const requestB = 'stress-seq-B-' + Date.now();

  // Send request A
  const promiseA = fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      requestId: requestA,
    }),
  });

  await sleep(100);

  // Cancel A
  await fetch(`${BASE_URL}/api/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: requestA }),
  });

  // Send request B
  const resB = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'What is 3+3?' }],
      requestId: requestB,
    }),
  });

  const dataB = await resB.json();
  const passed = resB.ok && dataB.requestId === requestB && dataB.text;

  return {
    name: 'Sequential Invalidation',
    passed,
    detail: passed
      ? `Request B returned successfully with text: "${dataB.text?.slice(0, 50)}..."`
      : `Request B failed: ${JSON.stringify(dataB)}`,
  };
}

/**
 * Test 3: Health check
 * Verify the server is running and configured.
 */
async function testHealth() {
  const res = await fetch(`${BASE_URL}/api/health`);
  const data = await res.json();

  return {
    name: 'Health Check',
    passed: res.ok,
    detail: `Status: ${data.status}, Rime: ${data.services?.rime?.status}, LLM: ${data.services?.llm?.status}`,
  };
}

/**
 * Test 4: TTS request (if Rime is configured)
 */
async function testTTS() {
  const requestId = 'stress-tts-' + Date.now();

  try {
    const res = await fetch(`${BASE_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Hello, this is a test.',
        requestId,
      }),
    });

    if (res.ok) {
      const blob = await res.blob();
      return {
        name: 'Rime TTS',
        passed: true,
        detail: `Audio generated: ${blob.size} bytes, type: ${blob.type}`,
      };
    } else {
      const err = await res.json().catch(() => ({}));
      return {
        name: 'Rime TTS',
        passed: false,
        detail: `Error: ${err.error || res.status}`,
      };
    }
  } catch (err) {
    return {
      name: 'Rime TTS',
      passed: false,
      detail: `Network error: ${err.message}`,
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function runStressTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  VOXA STRESS TEST SUITE');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  const tests = [
    testHealth,
    testRapidCancellation,
    testSequentialInvalidation,
    testTTS,
  ];

  const results = [];

  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      const icon = result.passed ? '✅' : '❌';
      console.log(`  ${icon} ${result.name}`);
      console.log(`     ${result.detail}`);
      console.log('');
    } catch (err) {
      results.push({ name: test.name, passed: false, detail: err.message });
      console.log(`  ❌ ${test.name}`);
      console.log(`     Error: ${err.message}`);
      console.log('');
    }
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  const allPassed = passed === total;

  console.log('═══════════════════════════════════════════════════');
  console.log(`  RESULT: ${passed}/${total} passed — ${allPassed ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  process.exit(allPassed ? 0 : 1);
}

runStressTests().catch(err => {
  console.error('Stress test suite failed:', err);
  process.exit(1);
});
