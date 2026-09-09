const http = require('http');

function postChat(content) {
  return new Promise((resolve) => {
    const data = JSON.stringify({
      messages: [{ role: 'user', content }],
      requestId: 'test-chat-' + Date.now(),
    });

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });

    req.on('error', err => resolve({ error: err.message }));
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('=== TEST 1: Simple Hello ===');
  const t1 = await postChat('Say hello in one sentence.');
  console.log('Status:', t1.status);
  console.log('Text:', t1.data?.text);
  console.log('Type:', t1.data?.responseType);

  console.log('\n=== TEST 2: What do I have tomorrow? ===');
  const t2 = await postChat('What do I have tomorrow?');
  console.log('Status:', t2.status);
  console.log('Text:', t2.data?.text);
  console.log('Service:', t2.data?.service);
  console.log('Action:', t2.data?.action);

  console.log('\n=== TEST 3: Do I have any important emails? ===');
  const t3 = await postChat('Do I have any important emails?');
  console.log('Status:', t3.status);
  console.log('Text:', t3.data?.text);
  console.log('Service:', t3.data?.service);
  console.log('Action:', t3.data?.action);
}

run().catch(console.error);
