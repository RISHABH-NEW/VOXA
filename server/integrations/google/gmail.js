/**
 * VOXA — Gmail Service Layer
 * Read-only interface for student emails, unread messages, and keyword search.
 * Privacy-first: extracts only sender, subject, date, and brief snippet.
 */

const { google } = require('googleapis');
const { googleClientManager } = require('./googleClient');

function parseHeader(headers, name) {
  const h = headers.find(item => item.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

/**
 * Fetch list of messages matching query and format lightweight summary.
 */
async function listAndFormatEmails(q = '', maxResults = 5, options = {}) {
  const { signal } = options;

  if (!googleClientManager.isAuthenticated()) {
    return {
      success: false,
      service: 'gmail',
      error: 'AUTH_REQUIRED',
      message: "Your Google account isn't connected.",
    };
  }

  const auth = googleClientManager.getOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    if (signal?.aborted) throw new Error('Operation aborted');

    const res = await gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults,
    });

    if (signal?.aborted) throw new Error('Operation aborted');

    const messageIds = res.data.messages || [];
    if (messageIds.length === 0) {
      return {
        success: true,
        service: 'gmail',
        data: [],
        message: 'No matching emails found.',
      };
    }

    const emails = [];
    for (const item of messageIds) {
      if (signal?.aborted) throw new Error('Operation aborted');

      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: item.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });

      const headers = msgRes.data.payload?.headers || [];
      const from = parseHeader(headers, 'From') || 'Unknown Sender';
      const subject = parseHeader(headers, 'Subject') || '(No Subject)';
      const date = parseHeader(headers, 'Date') || '';
      const snippet = msgRes.data.snippet || '';

      emails.push({
        id: item.id,
        threadId: item.threadId,
        from: from.replace(/<.*>/, '').trim() || from,
        fromFull: from,
        subject,
        date,
        snippet: snippet.slice(0, 150),
        url: `https://mail.google.com/mail/u/0/#inbox/${item.id}`,
      });
    }

    return {
      success: true,
      service: 'gmail',
      data: emails,
    };
  } catch (err) {
    if (signal?.aborted || err.message === 'Operation aborted') {
      return { success: false, service: 'gmail', error: 'CANCELLED', message: 'Request was cancelled' };
    }
    console.error('[Gmail Service Error]:', err.message);
    return {
      success: false,
      service: 'gmail',
      error: 'API_ERROR',
      message: "I couldn't access Gmail right now.",
      details: err.message,
    };
  }
}

async function getRecentEmails(options = {}) {
  const max = options.max || 5;
  const result = await listAndFormatEmails('in:inbox', max, options);
  return { ...result, action: 'getRecentEmails' };
}

async function getUnreadEmails(options = {}) {
  const max = options.max || 5;
  const result = await listAndFormatEmails('is:unread in:inbox', max, options);
  return { ...result, action: 'getUnreadEmails' };
}

async function searchEmails(query, options = {}) {
  const max = options.max || 5;
  const result = await listAndFormatEmails(query, max, options);
  return { ...result, action: 'searchEmails', query };
}

async function getEmailById(id, options = {}) {
  const { signal } = options;

  if (!googleClientManager.isAuthenticated()) {
    return {
      success: false,
      service: 'gmail',
      action: 'getEmailById',
      error: 'AUTH_REQUIRED',
      message: "Your Google account isn't connected.",
    };
  }

  const auth = googleClientManager.getOAuth2Client();
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    if (signal?.aborted) throw new Error('Operation aborted');

    const msgRes = await gmail.users.messages.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });

    const headers = msgRes.data.payload?.headers || [];
    const from = parseHeader(headers, 'From') || 'Unknown';
    const subject = parseHeader(headers, 'Subject') || '(No Subject)';
    const date = parseHeader(headers, 'Date') || '';
    const snippet = msgRes.data.snippet || '';

    return {
      success: true,
      service: 'gmail',
      action: 'getEmailById',
      data: {
        id,
        from: from.replace(/<.*>/, '').trim(),
        fromFull: from,
        subject,
        date,
        snippet,
        url: `https://mail.google.com/mail/u/0/#inbox/${id}`,
      },
    };
  } catch (err) {
    if (signal?.aborted || err.message === 'Operation aborted') {
      return { success: false, service: 'gmail', action: 'getEmailById', error: 'CANCELLED', message: 'Request was cancelled' };
    }
    return {
      success: false,
      service: 'gmail',
      action: 'getEmailById',
      error: 'API_ERROR',
      message: "I couldn't retrieve that email.",
      details: err.message,
    };
  }
}

module.exports = {
  getRecentEmails,
  getUnreadEmails,
  searchEmails,
  getEmailById,
};
