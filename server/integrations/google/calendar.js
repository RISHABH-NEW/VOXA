/**
 * VOXA — Google Calendar Service
 * Fetches real events from Google Calendar with time filtering and cancellation support.
 */

const { google } = require('googleapis');
const { googleClientManager } = require('./googleClient');

function formatEventTime(dateStr, dateTimeStr) {
  if (dateTimeStr) {
    const d = new Date(dateTimeStr);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return 'All Day';
}

function getDayBounds(offsetDays = 0) {
  const start = new Date();
  start.setDate(start.getDate() + offsetDays);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setHours(23, 59, 59, 999);

  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Fetch events from Google Calendar within a specific time window.
 */
async function fetchEvents(timeMin, timeMax, options = {}) {
  const { signal } = options;

  if (!googleClientManager.isAuthenticated()) {
    return {
      success: false,
      service: 'calendar',
      error: 'AUTH_REQUIRED',
      message: "Your Google account isn't connected.",
    };
  }

  const auth = googleClientManager.getOAuth2Client();
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    const items = res.data.items || [];
    const formattedEvents = items.map(item => {
      const startRaw = item.start?.dateTime || item.start?.date;
      const endRaw = item.end?.dateTime || item.end?.date;
      return {
        id: item.id,
        title: item.summary || 'Untitled Event',
        start: formatEventTime(item.start?.date, item.start?.dateTime),
        end: formatEventTime(item.end?.date, item.end?.dateTime),
        startTimeIso: startRaw,
        endTimeIso: endRaw,
        location: item.location || null,
        description: item.description || null,
      };
    });

    return {
      success: true,
      service: 'calendar',
      data: formattedEvents,
    };
  } catch (err) {
    if (signal?.aborted || err.message === 'Operation aborted') {
      return {
        success: false,
        service: 'calendar',
        error: 'CANCELLED',
        message: 'Request was cancelled',
      };
    }

    console.error('[Calendar Service Error]:', err.message);
    return {
      success: false,
      service: 'calendar',
      error: 'API_ERROR',
      message: "I couldn't access your calendar right now.",
      details: err.message,
    };
  }
}

async function getTodayEvents(options = {}) {
  const { start, end } = getDayBounds(0);
  const result = await fetchEvents(start, end, options);
  return { ...result, action: 'getTodayEvents' };
}

async function getTomorrowEvents(options = {}) {
  const { start, end } = getDayBounds(1);
  const result = await fetchEvents(start, end, options);
  return { ...result, action: 'getTomorrowEvents' };
}

async function getUpcomingEvents(options = {}) {
  const days = options.days || 7;
  const start = new Date().toISOString();
  const endD = new Date();
  endD.setDate(endD.getDate() + days);
  const end = endD.toISOString();

  const result = await fetchEvents(start, end, options);
  return { ...result, action: 'getUpcomingEvents' };
}

module.exports = {
  getTodayEvents,
  getTomorrowEvents,
  getUpcomingEvents,
  fetchEvents,
};
