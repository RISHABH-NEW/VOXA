/**
 * VOXA — Command Router & Intent Classifier
 * Determines if a voice command targets an external integration, a browser action,
 * a cross-service query, or standard conversational interaction.
 */

class CommandRouter {
  /**
   * Route user text to an integration command or conversation intent.
   * @param {string} text - User voice input
   * @param {object} context - Prior conversation context
   * @returns {object} { requiresIntegration: boolean, service, action, parameters, intent }
   */
  route(text, context = {}) {
    const raw = (text || '').trim();
    const lower = raw.toLowerCase();

    // ── 1. Chrome Extension Actions ──────────────────────────────────────────
    if (lower.includes('open gmail') || lower.includes('open my email') || lower.includes('open inbox')) {
      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openGmail',
        parameters: {},
        intent: 'CHROME_ACTION',
        description: 'Opening Gmail in Chrome',
      };
    }

    if (lower.includes('open google calendar') || lower.includes('open my calendar') || lower.includes('open calendar')) {
      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openCalendar',
        parameters: {},
        intent: 'CHROME_ACTION',
        description: 'Opening Google Calendar in Chrome',
      };
    }

    if (lower.includes('open google classroom') || lower.includes('open classroom') || lower.includes('open my classes')) {
      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openClassroom',
        parameters: {},
        intent: 'CHROME_ACTION',
        description: 'Opening Google Classroom in Chrome',
      };
    }

    // Active tab query
    if (lower.includes('active tab') || lower.includes('current tab') || lower.includes('what tab is open') || lower.includes('get tab info')) {
      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'getTabInfo',
        parameters: {},
        intent: 'CHROME_ACTION',
        description: 'Getting current active tab info',
      };
    }

    // Open specific assignment: "open my physics assignment", "open math homework", "open that assignment", "open this assignment"
    if (lower.includes('assignment') && (lower.includes('open') || lower.includes('view') || lower.includes('show'))) {
      let subjectQuery = '';
      if (lower.includes('physics')) subjectQuery = 'physics';
      else if (lower.includes('math') || lower.includes('linear algebra')) subjectQuery = 'math';
      else if (lower.includes('algorithm') || lower.includes('cs') || lower.includes('computer')) subjectQuery = 'algorithm';
      else if (context?.lastAssignment?.title) subjectQuery = context.lastAssignment.title;

      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openAssignment',
        parameters: { query: subjectQuery },
        intent: 'CHROME_ACTION',
        description: subjectQuery ? `Opening ${subjectQuery} assignment in Chrome` : 'Opening upcoming assignment in Chrome',
      };
    }

    // Open specific email: "open the email from my professor", "open that email", "open email"
    if (lower.includes('email') && !lower.includes('unread') && (lower.includes('open') || lower.includes('view') || /\bread\b/.test(lower))) {
      let emailQuery = '';
      if (lower.includes('professor')) emailQuery = 'professor';
      else if (lower.includes('classroom')) emailQuery = 'classroom';
      else if (context?.lastEmail?.from) emailQuery = context.lastEmail.from;

      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openEmail',
        parameters: { query: emailQuery || 'important' },
        intent: 'CHROME_ACTION',
        description: emailQuery ? `Opening email from ${emailQuery} in Chrome` : 'Opening recent email in Chrome',
      };
    }

    // Open arbitrary URL: "open https://..." or "open url ..."
    const urlMatch = raw.match(/https?:\/\/[^\s]+/i);
    if (urlMatch && (lower.includes('open') || lower.includes('navigate') || lower.includes('go to'))) {
      return {
        requiresIntegration: true,
        service: 'chrome',
        action: 'openUrl',
        parameters: { url: urlMatch[0] },
        intent: 'CHROME_ACTION',
        description: `Opening URL ${urlMatch[0]} in Chrome`,
      };
    }

    // ── 2. Cross-Service Queries: Calendar + Classroom (+ Gmail) ───────────
    // Check if user specifically asks for assignments only (interruption recovery e.g. "Focus only on assignments" or "Only tell me my assignments")
    const isAssignmentsOnly = (
      lower.includes('only tell me my assignments') ||
      lower.includes('focus only on assignments') ||
      lower.includes('only assignments') ||
      lower.includes('just assignments')
    );

    if (isAssignmentsOnly) {
      return {
        requiresIntegration: true,
        service: 'classroom',
        action: 'getUpcomingAssignments',
        parameters: {},
        intent: 'CLASSROOM_ASSIGNMENTS',
        description: 'Fetching upcoming assignments',
      };
    }

    // Combined query: "What do I have tomorrow?", "Tell me everything I have tomorrow", "Do I have anything important tomorrow?"
    if (
      lower.includes('what do i have tomorrow') ||
      lower.includes('tell me everything i have tomorrow') ||
      lower.includes('tell me everything i have scheduled tomorrow') ||
      lower.includes('everything tomorrow') ||
      lower.includes('anything important tomorrow') ||
      lower.includes('what is happening tomorrow')
    ) {
      return {
        requiresIntegration: true,
        service: 'agenda',
        action: 'getCombinedAgenda',
        parameters: { day: 'tomorrow', includeEmail: lower.includes('important') || lower.includes('everything') },
        intent: 'COMBINED_AGENDA',
        description: 'Checking Calendar & Classroom for tomorrow',
      };
    }

    if (
      lower.includes('what do i have today') ||
      lower.includes('what is my schedule today') ||
      lower.includes('tell me everything today') ||
      lower.includes('everything today')
    ) {
      return {
        requiresIntegration: true,
        service: 'agenda',
        action: 'getCombinedAgenda',
        parameters: { day: 'today', includeEmail: lower.includes('important') },
        intent: 'COMBINED_AGENDA',
        description: 'Checking Calendar & Classroom for today',
      };
    }

    // ── 3. Google Calendar Queries ───────────────────────────────────────────
    if (
      lower.includes('schedule tomorrow') ||
      lower.includes('events tomorrow') ||
      lower.includes('classes tomorrow') ||
      lower.includes('calendar tomorrow')
    ) {
      return {
        requiresIntegration: true,
        service: 'calendar',
        action: 'getTomorrowEvents',
        parameters: {},
        intent: 'CALENDAR_QUERY',
        description: 'Fetching tomorrow’s calendar events',
      };
    }

    if (
      lower.includes('schedule today') ||
      lower.includes('events today') ||
      lower.includes('calendar today') ||
      lower.includes('my schedule for today')
    ) {
      return {
        requiresIntegration: true,
        service: 'calendar',
        action: 'getTodayEvents',
        parameters: {},
        intent: 'CALENDAR_QUERY',
        description: 'Fetching today’s calendar events',
      };
    }

    if (lower.includes('events this week') || lower.includes('upcoming events') || lower.includes('upcoming calendar')) {
      return {
        requiresIntegration: true,
        service: 'calendar',
        action: 'getUpcomingEvents',
        parameters: { days: 7 },
        intent: 'CALENDAR_QUERY',
        description: 'Fetching upcoming week events',
      };
    }

    // ── 4. Google Classroom Queries ──────────────────────────────────────────
    if (
      lower.includes('assignment') ||
      lower.includes('due tomorrow') ||
      lower.includes('classroom deadlines') ||
      lower.includes('deadlines') ||
      lower.includes('overdue') ||
      lower.includes('what is due') ||
      lower.includes("what's due")
    ) {
      return {
        requiresIntegration: true,
        service: 'classroom',
        action: 'getUpcomingAssignments',
        parameters: {},
        intent: 'CLASSROOM_ASSIGNMENTS',
        description: 'Fetching upcoming assignments and deadlines',
      };
    }

    if (lower.includes('courses am i enrolled') || lower.includes('enrolled courses') || lower.includes('what courses') || lower.includes('my classes')) {
      return {
        requiresIntegration: true,
        service: 'classroom',
        action: 'getCourses',
        parameters: {},
        intent: 'CLASSROOM_COURSES',
        description: 'Fetching enrolled Classroom courses',
      };
    }

    // ── 5. Gmail Queries ─────────────────────────────────────────────────────
    if (lower.includes('unread email') || lower.includes('unread emails') || lower.includes('any unread')) {
      return {
        requiresIntegration: true,
        service: 'gmail',
        action: 'getUnreadEmails',
        parameters: { max: 5 },
        intent: 'GMAIL_UNREAD',
        description: 'Fetching unread emails',
      };
    }

    if (lower.includes('latest email') || lower.includes('recent email') || lower.includes('show my emails') || lower.includes('check my email')) {
      // Check if querying specific sender
      if (lower.includes('professor')) {
        return {
          requiresIntegration: true,
          service: 'gmail',
          action: 'searchEmails',
          parameters: { query: 'professor' },
          intent: 'GMAIL_SEARCH',
          description: 'Searching emails from professor',
        };
      }
      return {
        requiresIntegration: true,
        service: 'gmail',
        action: 'getRecentEmails',
        parameters: { max: 5 },
        intent: 'GMAIL_RECENT',
        description: 'Fetching recent inbox emails',
      };
    }

    if (lower.includes('email from') || lower.includes('emails about') || lower.includes('find email')) {
      let query = '';
      if (lower.includes('professor')) query = 'professor';
      else if (lower.includes('classroom')) query = 'Classroom';
      else if (lower.includes('assignment')) query = 'assignment';
      else query = raw.replace(/find|emails?|about|from/gi, '').trim();

      return {
        requiresIntegration: true,
        service: 'gmail',
        action: 'searchEmails',
        parameters: { query: query || 'important' },
        intent: 'GMAIL_SEARCH',
        description: `Searching emails for "${query}"`,
      };
    }

    // ── 6. Conversational / No Tool Required ────────────────────────────────
    return {
      requiresIntegration: false,
      intent: 'CONVERSATIONAL',
      service: null,
      action: null,
      description: null,
    };
  }
}

const commandRouter = new CommandRouter();

module.exports = {
  commandRouter,
};
