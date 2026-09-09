const http = require('http');

const data = JSON.stringify({
  text: 'It looks like your calendar and inbox are completely clear for tomorrow.',
  requestId: 'test-tts-' + Date.now()
});

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/tts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
}, res => {
  let len = 0;
  res.on('data', chunk => len += chunk.length);
  res.on('end', () => console.log('Rime TTS HTTP Status:', res.statusCode, 'Audio Bytes:', len, 'Content-Type:', res.headers['content-type']));
});

req.write(data);
req.end();
