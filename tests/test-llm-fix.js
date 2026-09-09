require('dotenv').config();
const llm = require('../server/llm');

async function testAll() {
  console.log('--- 1. Simple sentence test ---');
  const r1 = await llm.generateResponse([{ role: 'user', content: 'Say hello in one sentence.' }]);
  console.log('Result 1:', r1);

  console.log('\n--- 2. Calendar tool result test ---');
  const r2 = await llm.generateResponse(
    [{ role: 'user', content: 'What do I have today?' }],
    { toolResult: { success: true, service: 'calendar', action: 'getTodayEvents', data: [] } }
  );
  console.log('Result 2:', r2);

  console.log('\n--- 3. Gmail service unenabled test ---');
  const r3 = await llm.generateResponse(
    [{ role: 'user', content: 'Do I have any important emails?' }],
    { toolResult: { success: false, service: 'gmail', error: 'API_ERROR', message: "I couldn't access Gmail right now." } }
  );
  console.log('Result 3:', r3);
}

testAll().catch(console.error);
