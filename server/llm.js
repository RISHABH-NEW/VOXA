/**
 * VOXA — LLM Module
 * Provider-agnostic language model interface.
 * 
 * Supported providers:
 *   - gemini  (Google Gemini, default — free tier available)
 *   - openai  (OpenAI-compatible APIs)
 *   - mock    (Deterministic responses for development/testing)
 */

const VOXA_SYSTEM_PROMPT = `You are Voxa, an adaptive voice AI assistant for students. You respond in natural, spoken-word style — concise, clear, and conversational. Your responses are designed to be spoken aloud through Rime text-to-speech.

Key behaviors:
- Keep responses reasonably concise (2-4 natural spoken sentences for most queries)
- Use natural spoken language: NO markdown formatting, NO bullet points, NO asterisks, and NO raw URLs
- When presenting Calendar schedules, state the times and event names naturally (e.g. "At ten AM you have Mathematics, followed by a project meeting at two PM")
- When presenting Classroom assignments, clearly state the course, assignment title, and when it is due
- When presenting Emails, mention who sent it and the main topic
- When confirming browser actions (opening Gmail, Calendar, Classroom, or an assignment link), confirm clearly and warmly (e.g. "I've opened Gmail in Chrome for you")
- If external service data is provided to you in the prompt context, summarize only that real data truthfully. Never fabricate events, deadlines, or emails
- When a user interrupts or updates a previous instruction (e.g. "Wait, focus only on assignments"), immediately acknowledge the redirection and provide only the requested information without resuming the interrupted topic.`;

/**
 * Generate a response from the configured LLM.
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @param {object} options
 * @param {AbortSignal} [options.signal] - For cancellation on interruption
 * @returns {Promise<string>} - Response text
 */
async function generateResponse(messages, options = {}) {
  const mode = process.env.LLM_MODE || 'live';
  const provider = process.env.LLM_PROVIDER || 'gemini';

  if (mode === 'mock') {
    return generateMockResponse(messages, options);
  }

  switch (provider) {
    case 'gemini':
      return generateGeminiResponse(messages, options);
    case 'openai':
      return generateOpenAIResponse(messages, options);
    default:
      throw new LLMError(`Unknown LLM provider: ${provider}`, 'UNKNOWN_PROVIDER');
  }
}

// ── Gemini Provider ──────────────────────────────────────────────────────────

async function generateGeminiResponse(messages, options = {}) {
  const { signal } = options;
  const apiKey = process.env.LLM_API_KEY;
  const configuredModel = process.env.LLM_MODEL || 'gemini-3.5-flash';

  if (!apiKey) {
    throw new LLMError('LLM_API_KEY is not set for Gemini provider', 'NO_API_KEY');
  }

  // Model fallback chain in case a model hits 429 quota, 503 high-demand, or 404
  const candidateModels = Array.from(new Set([
    configuredModel,
    'gemini-3.7-flash',
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ])).filter(Boolean);

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);

  // Convert messages to Gemini format
  const geminiHistory = [];
  const lastMessage = messages[messages.length - 1];

  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i];
    geminiHistory.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }

  let messageToSend = lastMessage.content;
  if (options.toolResult) {
    if (options.toolResult.success === false) {
      messageToSend = `User asked: "${lastMessage.content}"\n\nService Status: The ${options.toolResult.service || 'requested'} service reported: "${options.toolResult.message || options.toolResult.error}".\n\nInstructions: Politely and conversationally inform the user that their ${options.toolResult.service || 'service'} could not be reached right now, in 1-2 natural spoken sentences without markdown formatting.`;
    } else {
      messageToSend = `User asked: "${lastMessage.content}"\n\nReal Data from Connected Service (${options.toolResult.service}):\n${JSON.stringify(options.toolResult, null, 2)}\n\nInstructions: Speak a warm, concise conversational response summarizing this real data. Do not use markdown bullet points or asterisks.`;
    }
  }

  let lastError = null;

  for (const model of candidateModels) {
    if (signal?.aborted) {
      throw new LLMError('LLM request was cancelled', 'CANCELLED');
    }

    try {
      const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: {
          role: 'system',
          parts: [{ text: VOXA_SYSTEM_PROMPT }],
        },
      });

      const chat = genModel.startChat({
        history: geminiHistory,
      });

      const result = await chat.sendMessage(messageToSend, { signal });

      if (signal?.aborted) {
        throw new LLMError('LLM request was cancelled', 'CANCELLED');
      }

      const text = result.response.text();
      if (!text || text.trim().length === 0) {
        throw new LLMError('LLM returned empty response', 'EMPTY_RESPONSE');
      }

      return text.trim();
    } catch (err) {
      if (err instanceof LLMError && err.code === 'CANCELLED') throw err;
      if (err.name === 'AbortError' || signal?.aborted) {
        throw new LLMError('LLM request was cancelled', 'CANCELLED');
      }

      lastError = err;
      const isQuotaOrNotFound = err.status === 429 || err.status === 503 || err.status === 404 ||
        err.message?.includes('429') || err.message?.includes('503') || err.message?.includes('404') ||
        err.message?.includes('Quota') || err.message?.includes('quota') ||
        err.message?.includes('high demand') || err.message?.includes('Service Unavailable');

      if (isQuotaOrNotFound && model !== candidateModels[candidateModels.length - 1]) {
        console.warn(`[Gemini Warning] Model "${model}" hit quota/demand (${err.message.slice(0, 60)}...). Failing over to next candidate...`);
        continue; // Try next candidate model
      }
      break;
    }
  }

  // Safe logging without exposing secrets
  console.error('[Gemini Error]', {
    status: 'FAILED',
    errorType: 'API_ERROR',
    message: lastError ? lastError.message.replace(/key=[^&\s]+/g, 'key=[REDACTED]') : 'Unknown error',
  });

  throw new LLMError(`Gemini API error: ${lastError ? lastError.message : 'Failed to generate response'}`, 'API_ERROR');
}

// ── OpenAI-Compatible Provider ───────────────────────────────────────────────

async function generateOpenAIResponse(messages, options = {}) {
  const { signal } = options;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    throw new LLMError('LLM_API_KEY is not set for OpenAI provider', 'NO_API_KEY');
  }

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: VOXA_SYSTEM_PROMPT },
      ...messages,
    ],
    max_tokens: 500,
    temperature: 0.7,
  });

  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new LLMError('LLM request was cancelled', 'CANCELLED');
    }
    throw new LLMError(`Failed to reach LLM API: ${err.message}`, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LLMError(`LLM API error ${response.status}: ${detail}`, 'API_ERROR');
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;

  if (!text || text.trim().length === 0) {
    throw new LLMError('LLM returned empty response', 'EMPTY_RESPONSE');
  }

  return text.trim();
}

// ── Mock Provider (Development Only) ─────────────────────────────────────────

const MOCK_RESPONSES = [
  "Sure, I'll create your study schedule for tomorrow. Starting with mathematics in the morning from nine to ten thirty, followed by a short break. Then physics from eleven to twelve thirty. After lunch, you can work on your English essay from two to three thirty, and finish with computer science from four to five. This gives you balanced study blocks with breaks in between for maximum retention.",

  "Let me help you organize that. I'll plan your day starting with your most demanding subjects in the morning when your focus is sharpest. Your first block will be calculus from eight thirty to ten, then a fifteen minute break. Next, organic chemistry from ten fifteen to eleven forty five. Lunch from noon to one. In the afternoon, you can tackle your history readings from one to two thirty, and wrap up with programming practice from three to four thirty.",

  "Absolutely, I can help with that. Here's what I'd suggest for an effective study plan. Begin at nine AM with your hardest subject while your mind is fresh. Take study blocks of about ninety minutes each with short breaks. Group related subjects together. Make sure to include time for review at the end of the day. And don't forget to schedule meals and short walks to keep your energy up.",
];

let mockIndex = 0;

async function generateMockResponse(messages, options = {}) {
  const { signal } = options;
  
  // Simulate realistic LLM latency
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, 800 + Math.random() * 400);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new LLMError('LLM request was cancelled', 'CANCELLED'));
      }, { once: true });
    }
  });

  if (signal?.aborted) {
    throw new LLMError('LLM request was cancelled', 'CANCELLED');
  }

  // Check for tool results or multi-service contexts
  if (options.toolResult) {
    const tr = options.toolResult;
    if (!tr.success) {
      if (tr.error === 'AUTH_REQUIRED') {
        return "Your Google account isn't connected. Please click Connect Google Account on the dashboard to link your Calendar, Classroom, and Gmail.";
      }
      return `I couldn't access that service right now. ${tr.message || ''}`;
    }

    if (tr.service === 'agenda') {
      return "Tomorrow you have Mathematics at 10 AM, a project group meeting at 2 PM, and a dynamic programming problem set due at 5 PM in Google Classroom.";
    }
    if (tr.service === 'classroom') {
      return "You have one upcoming assignment. Your Dynamic Programming problem set for Advanced Algorithms is due tomorrow at 5 PM.";
    }
    if (tr.service === 'calendar') {
      return "You have three events tomorrow: Mathematics Seminar at 10 AM, a project group meeting at 2 PM, and an evening study session at 7 PM.";
    }
    if (tr.service === 'gmail') {
      return "You have an email from Professor Miller regarding the assignment extension and updated office hours.";
    }
    if (tr.service === 'chrome') {
      return "I've opened that in Chrome for you.";
    }
  }

  // Check for interruption-related context
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
  
  if (lastMessage.includes('focus only on assignments') || lastMessage.includes('only tell me my assignments') || lastMessage.includes('only assignments')) {
    return "Understood, focusing only on assignments. You have a Dynamic Programming problem set for Advanced Algorithms due tomorrow at 5 PM, and a Thermodynamics lab report due this Friday.";
  }

  if (lastMessage.includes('exam') || lastMessage.includes('2 pm') || lastMessage.includes('free')) {
    return "Got it. I'll keep 2 PM free for your exam and adjust your study schedule accordingly. I'll move the afternoon study blocks to the morning and add a review session right before your exam at one thirty. After the exam, you can do lighter subjects like reading or vocabulary in the evening.";
  }

  if (lastMessage.includes('cancel') || lastMessage.includes('stop') || lastMessage.includes('never mind')) {
    return "No problem at all. I've discarded the previous plan. Let me know whenever you're ready to start again or if there's something else I can help with.";
  }

  const response = MOCK_RESPONSES[mockIndex % MOCK_RESPONSES.length];
  mockIndex++;
  return response;
}

// ── Error Class ──────────────────────────────────────────────────────────────

class LLMError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
  }
}

/**
 * Validate LLM configuration at startup.
 */
function validateConfig() {
  const issues = [];
  const mode = process.env.LLM_MODE || 'live';
  const provider = process.env.LLM_PROVIDER || 'gemini';

  if (mode === 'live' && !process.env.LLM_API_KEY) {
    issues.push(`LLM_API_KEY is not set (provider: ${provider})`);
  }

  if (mode === 'mock') {
    // Mock mode doesn't need API key
  }

  return {
    valid: issues.length === 0,
    issues,
    config: {
      provider,
      model: process.env.LLM_MODEL || (provider === 'gemini' ? 'gemini-3.6-flash' : 'gpt-4o-mini'),
      mode,
      hasApiKey: !!process.env.LLM_API_KEY,
    },
  };
}

module.exports = { generateResponse, validateConfig, LLMError, VOXA_SYSTEM_PROMPT };
