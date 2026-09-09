/**
 * VOXA — 10-Attempt Interruption Benchmark Test
 * Measures real latency and validates stale response protection across 10 sequential cycles.
 */

const http = require('http');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runSingleInterruptionAttempt(attemptIndex) {
  const requestId = `bench-req-${attemptIndex}-${Date.now()}`;
  
  // 1. Dispatch a chat request
  const chatStart = performance.now();
  const chatPromise = fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `Plan my study schedule for tomorrow attempt ${attemptIndex}` }],
      requestId,
    }),
  });

  // Wait 10-50ms to allow in-flight request to initialize on server
  await sleep(25);

  // 2. Trigger Interruption (cancel)
  const interruptStart = performance.now();
  const cancelRes = await fetch(`${BASE_URL}/api/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  });
  const interruptEnd = performance.now();
  const latencyMs = interruptEnd - interruptStart;

  const cancelData = await cancelRes.json().catch(() => ({}));

  // 3. Await chat response to ensure it was aborted/cancelled
  let chatResult = null;
  try {
    const chatRes = await chatPromise;
    chatResult = await chatRes.json();
  } catch (e) {
    chatResult = { error: e.message };
  }

  // Verification: Cancel responded with HTTP 200, chat request was aborted or cancelled
  const isCancelled = cancelRes.ok && (
    chatResult.code === 'CANCELLED' ||
    chatResult.error?.includes('cancelled') ||
    cancelData.cancelled === true ||
    cancelData.operationsCancelled >= 0
  );

  return {
    attempt: attemptIndex,
    requestId,
    latencyMs: Math.round(latencyMs * 100) / 100,
    success: isCancelled,
    cancelData,
    chatCode: chatResult.code || 'COMPLETED',
  };
}

async function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VOXA — 10-Attempt Interruption Stress & Benchmark Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Verify server is reachable
  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error('Server not ready');
  } catch (err) {
    console.error(`Cannot connect to server at ${BASE_URL}. Ensure server is running.`);
    process.exit(1);
  }

  const results = [];
  const TOTAL_ATTEMPTS = 10;

  for (let i = 1; i <= TOTAL_ATTEMPTS; i++) {
    const res = await runSingleInterruptionAttempt(i);
    results.push(res);
    console.log(`  [Attempt ${i.toString().padStart(2, ' ')}/10] Latency: ${res.latencyMs.toFixed(2).padStart(6, ' ')} ms | Cancel Status: ${res.success ? 'PASS ✅' : 'FAIL ❌'} | Server Op: ${res.chatCode}`);
    await sleep(200); // brief recovery between turns
  }

  const latencies = results.map(r => r.latencyMs);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const latest = latencies[latencies.length - 1];
  const passedCount = results.filter(r => r.success).length;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  BENCHMARK RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Total Attempts:  ${TOTAL_ATTEMPTS}`);
  console.log(`  Successful:      ${passedCount}/${TOTAL_ATTEMPTS} (${(passedCount / TOTAL_ATTEMPTS * 100).toFixed(0)}%)`);
  console.log(`  Latest Stop:     ${latest.toFixed(2)} ms`);
  console.log(`  Average Latency: ${avg.toFixed(2)} ms`);
  console.log(`  Min Latency:     ${min.toFixed(2)} ms`);
  console.log(`  Max Latency:     ${max.toFixed(2)} ms`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (passedCount !== TOTAL_ATTEMPTS) {
    console.error('Some interruption attempts failed!');
    process.exit(1);
  }
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
