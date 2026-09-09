/**
 * VOXA — Rime TTS Module
 * Handles all communication with the Rime Text-to-Speech API.
 * 
 * Rime API Reference (confirmed from docs.rime.ai):
 *   POST https://users.rime.ai/v1/rime-tts
 *   Authorization: Bearer $RIME_API_KEY
 *   Body: { speaker, text, modelId, lang }
 *   Accept: audio/mpeg → returns MP3 audio buffer
 */

class RimeError extends Error {
  constructor(message, code, statusCode = null) {
    super(message);
    this.name = 'RimeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Synthesize text to speech using Rime TTS.
 * @param {string} text - The text to convert to speech
 * @param {object} options - Optional overrides
 * @param {AbortSignal} [options.signal] - AbortController signal for cancellation
 * @returns {Promise<Buffer>} - MP3 audio buffer
 */
async function synthesize(text, options = {}) {
  const {
    signal,
    speaker = process.env.RIME_SPEAKER || 'astra',
    modelId = process.env.RIME_MODEL || 'coda',
    lang = process.env.RIME_LANGUAGE || 'en',
  } = options;

  const endpoint = process.env.RIME_ENDPOINT || 'https://users.rime.ai/v1/rime-tts';
  const apiKey = process.env.RIME_API_KEY;

  if (!apiKey || apiKey === 'your_rime_api_key_here') {
    throw new RimeError(
      'RIME_API_KEY is not configured. Get one at https://app.rime.ai/tokens',
      'NO_API_KEY'
    );
  }

  if (!text || text.trim().length === 0) {
    throw new RimeError('Text cannot be empty', 'EMPTY_TEXT');
  }

  const body = JSON.stringify({
    speaker,
    text: text.trim(),
    modelId,
    lang,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new RimeError('Rime request was cancelled', 'CANCELLED');
    }
    throw new RimeError(
      `Failed to reach Rime API: ${err.message}`,
      'NETWORK_ERROR'
    );
  }

  if (!response.ok) {
    const status = response.status;
    let detail = '';
    try {
      detail = await response.text();
    } catch (_) { /* ignore */ }

    if (status === 401 || status === 403) {
      throw new RimeError(
        `Rime authentication failed (${status}). Check your RIME_API_KEY.`,
        'AUTH_ERROR',
        status
      );
    }
    if (status === 429) {
      throw new RimeError(
        'Rime rate limit exceeded. Please wait before retrying.',
        'RATE_LIMIT',
        status
      );
    }
    throw new RimeError(
      `Rime API error ${status}: ${detail}`,
      'API_ERROR',
      status
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Validate Rime configuration at startup.
 * @returns {{ valid: boolean, issues: string[] }}
 */
function validateConfig() {
  const issues = [];

  const key = process.env.RIME_API_KEY;
  if (!key || key === 'your_rime_api_key_here') {
    issues.push('RIME_API_KEY is not set');
  }

  const model = process.env.RIME_MODEL || 'coda';
  if (!['coda', 'mist'].includes(model)) {
    issues.push(`RIME_MODEL "${model}" is not a known Rime model (expected: coda or mist)`);
  }

  return {
    valid: issues.length === 0,
    issues,
    config: {
      endpoint: process.env.RIME_ENDPOINT || 'https://users.rime.ai/v1/rime-tts',
      model: process.env.RIME_MODEL || 'coda',
      speaker: process.env.RIME_SPEAKER || 'astra',
      language: process.env.RIME_LANGUAGE || 'en',
      hasApiKey: !!process.env.RIME_API_KEY,
    },
  };
}

module.exports = { synthesize, validateConfig, RimeError };
