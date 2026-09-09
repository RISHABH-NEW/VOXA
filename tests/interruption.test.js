/**
 * VOXA — Interruption Acceptance Test
 * 
 * This test documents the exact acceptance criteria for the
 * interrupt-and-recover flow. It can be run manually through the UI
 * or used as a reference for automated testing.
 * 
 * Test: Interrupt and Recover
 * 
 * Prerequisites:
 *   - Server running on localhost:3000
 *   - Valid RIME_API_KEY in .env
 *   - Valid LLM_API_KEY in .env (or LLM_MODE=mock)
 *   - Chrome or Edge browser
 *   - Microphone connected and permitted
 */

const TEST_STEPS = [
  {
    step: 1,
    action: 'Start Voxa',
    expected: 'Voice session begins, STT starts listening',
    verify: 'Status shows LISTENING, orb shows listening animation',
  },
  {
    step: 2,
    action: 'Ask a question requiring a long response',
    input: 'Plan my study schedule for tomorrow with detailed time blocks for each subject',
    expected: 'STT captures speech, state transitions to THINKING',
    verify: 'Transcript shows user message, status shows THINKING',
  },
  {
    step: 3,
    action: 'Allow Rime to begin speaking',
    expected: 'LLM generates response, Rime TTS converts to audio, playback starts',
    verify: 'Audio plays through speakers, status shows SPEAKING, orb shows waveform',
  },
  {
    step: 4,
    action: 'Interrupt before completion',
    input: 'Wait, I have an exam at 2 PM',
    expected: 'Interruption detected while audio is playing',
    verify: 'Status briefly shows INTERRUPTED',
  },
  {
    step: 5,
    action: 'Verify Rime audio stops',
    expected: 'Audio playback stops within 300ms',
    verify: 'No more sound from speakers, metric shows latency',
  },
  {
    step: 6,
    action: 'Verify queued audio is cleared',
    expected: 'No audio remains in the queue',
    verify: 'Audio player queue is empty',
  },
  {
    step: 7,
    action: 'Verify old response is invalidated',
    expected: 'Old requestId is no longer the currentRequestId',
    verify: 'Any arriving response with old requestId is discarded',
  },
  {
    step: 8,
    action: 'Verify old response cannot resume',
    expected: 'Even if old TTS response arrives late, it is not played',
    verify: 'Console shows "Discarding stale" message',
  },
  {
    step: 9,
    action: 'Capture new instruction',
    expected: 'STT captures "Wait, I have an exam at 2 PM"',
    verify: 'Transcript shows new user message',
  },
  {
    step: 10,
    action: 'Update conversation state',
    expected: 'Conversation history includes interrupted response + new message',
    verify: 'Context sent to LLM includes interruption annotation',
  },
  {
    step: 11,
    action: 'Generate new response',
    expected: 'LLM generates response that incorporates the 2 PM exam',
    verify: 'Response mentions keeping 2 PM free or adjusting schedule',
  },
  {
    step: 12,
    action: 'Send new response to Rime',
    expected: 'New response text is sent to Rime TTS',
    verify: 'Rime returns audio for the new response',
  },
  {
    step: 13,
    action: 'Play new Rime response',
    expected: 'New audio plays through speakers',
    verify: 'Status shows SPEAKING, audio is the new (adapted) response',
  },
  {
    step: 14,
    action: 'Record interruption-to-audio-stop latency',
    expected: 'Metrics panel shows real measured value',
    verify: 'Current latency is a positive number in milliseconds',
  },
];

/**
 * Print the acceptance test procedure to console.
 */
function printAcceptanceTest() {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  VOXA ACCEPTANCE TEST: Interrupt and Recover');
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  TEST_STEPS.forEach(step => {
    console.log(`  Step ${step.step}: ${step.action}`);
    if (step.input) console.log(`    Input: "${step.input}"`);
    console.log(`    Expected: ${step.expected}`);
    console.log(`    Verify: ${step.verify}`);
    console.log('');
  });

  console.log('═══════════════════════════════════════════════════');
  console.log('  Run this test by using the "RUN INTERRUPTION TEST"');
  console.log('  button in the Demo panel of the Voxa UI.');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
}

// If run directly in Node.js
if (typeof window === 'undefined') {
  printAcceptanceTest();

  // Basic server connectivity test
  async function testServerHealth() {
    const port = process.env.PORT || 3000;
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      const data = await res.json();
      console.log('Server Health:', JSON.stringify(data, null, 2));
      
      if (data.status === 'healthy') {
        console.log('✅ Server is healthy');
      } else {
        console.log('⚠️  Server is degraded:', data.services);
      }
    } catch (err) {
      console.log('❌ Server not reachable at localhost:' + port);
      console.log('   Start with: npm start');
    }
  }

  testServerHealth();
}

module.exports = { TEST_STEPS, printAcceptanceTest };
