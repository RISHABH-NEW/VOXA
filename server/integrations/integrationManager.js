/**
 * VOXA — Central Integration Manager
 * Unifies Google Calendar, Google Classroom, Gmail, and Chrome Extension.
 * Provides a single execution interface: integrationManager.execute({ service, action, parameters })
 */

const calendar = require('./google/calendar');
const classroom = require('./google/classroom');
const gmail = require('./google/gmail');
const { chromeExtensionManager } = require('./chrome');
const { googleClientManager } = require('./google/googleClient');

// Development mock data fixtures for offline/demo testing
const MOCK_DATA = {
  calendar: {
    getTodayEvents: [
      { id: 'm-cal-1', title: 'Data Structures Lecture', start: '10:00 AM', end: '11:30 AM', location: 'Hall B' },
      { id: 'm-cal-2', title: 'Machine Learning Lab', start: '2:00 PM', end: '4:00 PM', location: 'Lab 3' },
    ],
    getTomorrowEvents: [
      { id: 'm-cal-3', title: 'Mathematics Seminar', start: '10:00 AM', end: '11:00 AM', location: 'Room 204' },
      { id: 'm-cal-4', title: 'Project Group Meeting', start: '2:00 PM', end: '3:30 PM', location: 'Library' },
      { id: 'm-cal-5', title: 'Evening Study Session', start: '7:00 PM', end: '9:00 PM', location: 'Online' },
    ],
    getUpcomingEvents: [
      { id: 'm-cal-6', title: 'Midterm Exam: Algorithms', start: 'Friday 9:00 AM', end: '11:00 AM' },
    ],
  },
  classroom: {
    getCourses: [
      { id: 'c-1', name: 'CS 301: Advanced Algorithms', section: 'A' },
      { id: 'c-2', name: 'PHYS 202: General Physics II', section: 'B' },
      { id: 'c-3', name: 'MATH 240: Linear Algebra', section: 'C' },
    ],
    getAssignments: [
      { id: 'a-1', courseName: 'CS 301: Advanced Algorithms', title: 'Dynamic Programming Problem Set', dueDate: 'Tomorrow at 5:00 PM', alternateLink: 'https://classroom.google.com' },
      { id: 'a-2', courseName: 'PHYS 202: General Physics II', title: 'Thermodynamics Lab Report', dueDate: 'Friday at 11:59 PM', alternateLink: 'https://classroom.google.com' },
    ],
    getUpcomingAssignments: [
      { id: 'a-1', courseName: 'CS 301: Advanced Algorithms', title: 'Dynamic Programming Problem Set', dueDate: 'Tomorrow at 5:00 PM', alternateLink: 'https://classroom.google.com' },
      { id: 'a-2', courseName: 'PHYS 202: General Physics II', title: 'Thermodynamics Lab Report', dueDate: 'Friday at 11:59 PM', alternateLink: 'https://classroom.google.com' },
    ],
  },
  gmail: {
    getRecentEmails: [
      { id: 'm-gm-1', from: 'Prof. Miller', subject: 'Assignment 3 Extension & Office Hours', date: 'Today', snippet: 'Office hours will be moved to 3 PM tomorrow. Also please note the assignment deadline is flexible.' },
      { id: 'm-gm-2', from: 'Google Classroom', subject: 'New assignment posted: Problem Set 4', date: 'Yesterday', snippet: 'Prof. Miller posted a new assignment in CS 301.' },
    ],
    getUnreadEmails: [
      { id: 'm-gm-1', from: 'Prof. Miller', subject: 'Assignment 3 Extension & Office Hours', date: 'Today', snippet: 'Office hours will be moved to 3 PM tomorrow. Also please note the assignment deadline is flexible.' },
    ],
    searchEmails: [
      { id: 'm-gm-1', from: 'Prof. Miller', subject: 'Assignment 3 Extension & Office Hours', date: 'Today', snippet: 'Office hours will be moved to 3 PM tomorrow.' },
    ],
  },
};

class IntegrationManager {
  /**
   * Execute an action across any connected service.
   * @param {object} params
   * @param {string} params.service - 'calendar' | 'classroom' | 'gmail' | 'chrome' | 'agenda'
   * @param {string} params.action - Function/action name
   * @param {object} [params.parameters] - Action arguments
   * @param {AbortSignal} [params.signal] - Interruption cancellation signal
   * @param {string} [params.requestId] - Active request ID for logging & cancellation
   */
  async execute({ service, action, parameters = {}, signal, requestId }) {
    const isMock = process.env.LLM_MODE === 'mock';
    const isGoogleAuthed = googleClientManager.isAuthenticated();

    if (signal?.aborted) {
      return {
        success: false,
        service,
        action,
        error: 'CANCELLED',
        message: 'Operation was cancelled by user interruption',
        requestId,
      };
    }

    // ── CALENDAR ─────────────────────────────────────────────────────────────
    if (service === 'calendar') {
      if (!isGoogleAuthed && isMock) {
        return {
          success: true,
          service: 'calendar',
          action,
          isMock: true,
          data: MOCK_DATA.calendar[action] || MOCK_DATA.calendar.getTomorrowEvents,
        };
      }

      switch (action) {
        case 'getTodayEvents':
          return calendar.getTodayEvents({ signal });
        case 'getTomorrowEvents':
          return calendar.getTomorrowEvents({ signal });
        case 'getUpcomingEvents':
          return calendar.getUpcomingEvents({ signal, days: parameters.days || 7 });
        default:
          return { success: false, service: 'calendar', error: 'UNKNOWN_ACTION', message: `Unknown calendar action: ${action}` };
      }
    }

    // ── CLASSROOM ────────────────────────────────────────────────────────────
    if (service === 'classroom') {
      if (!isGoogleAuthed && isMock) {
        return {
          success: true,
          service: 'classroom',
          action,
          isMock: true,
          data: MOCK_DATA.classroom[action] || MOCK_DATA.classroom.getUpcomingAssignments,
        };
      }

      switch (action) {
        case 'getCourses':
          return classroom.getCourses({ signal });
        case 'getAssignments':
          return classroom.getAssignments({ signal, maxPerCourse: parameters.maxPerCourse || 5 });
        case 'getUpcomingAssignments':
          return classroom.getUpcomingAssignments({ signal });
        default:
          return { success: false, service: 'classroom', error: 'UNKNOWN_ACTION', message: `Unknown classroom action: ${action}` };
      }
    }

    // ── GMAIL ────────────────────────────────────────────────────────────────
    if (service === 'gmail') {
      if (!isGoogleAuthed && isMock) {
        return {
          success: true,
          service: 'gmail',
          action,
          isMock: true,
          data: MOCK_DATA.gmail[action] || MOCK_DATA.gmail.getRecentEmails,
        };
      }

      switch (action) {
        case 'getRecentEmails':
          return gmail.getRecentEmails({ signal, max: parameters.max || 5 });
        case 'getUnreadEmails':
          return gmail.getUnreadEmails({ signal, max: parameters.max || 5 });
        case 'searchEmails':
          return gmail.searchEmails(parameters.query || '', { signal, max: parameters.max || 5 });
        case 'getEmailById':
          return gmail.getEmailById(parameters.id, { signal });
        default:
          return { success: false, service: 'gmail', error: 'UNKNOWN_ACTION', message: `Unknown gmail action: ${action}` };
      }
    }

    // ── CHROME EXTENSION ─────────────────────────────────────────────────────
    if (service === 'chrome') {
      switch (action) {
        case 'openUrl':
          return chromeExtensionManager.openUrl(parameters.url, { signal, requestId });
        case 'openGmail':
          return chromeExtensionManager.openGmail({ signal, requestId });
        case 'openCalendar':
          return chromeExtensionManager.openCalendar({ signal, requestId });
        case 'openClassroom':
          return chromeExtensionManager.openClassroom({ signal, requestId });
        case 'getTabInfo':
          return chromeExtensionManager.getTabInfo({ signal, requestId });

        case 'openAssignment': {
          // 1. Query Classroom to get assignments
          const classRes = await this.execute({
            service: 'classroom',
            action: 'getUpcomingAssignments',
            signal,
            requestId,
          });

          if (!classRes.success || !classRes.data || classRes.data.length === 0) {
            return {
              success: false,
              service: 'chrome',
              action: 'openAssignment',
              error: 'NO_ASSIGNMENTS_FOUND',
              message: 'No assignments were found in Google Classroom to open.',
              requestId,
            };
          }

          // 2. Find matching assignment by query keyword
          const query = (parameters.query || '').toLowerCase();
          let target = classRes.data[0]; // default to first upcoming
          if (query) {
            const found = classRes.data.find(a => 
              (a.title && a.title.toLowerCase().includes(query)) ||
              (a.courseName && a.courseName.toLowerCase().includes(query))
            );
            if (found) target = found;
          }

          const assignmentUrl = target.alternateLink || 'https://classroom.google.com';

          // 3. Dispatch OPEN_URL to Chrome Extension
          const openRes = await chromeExtensionManager.openUrl(assignmentUrl, { signal, requestId });

          return {
            ...openRes,
            action: 'openAssignment',
            assignmentTitle: target.title,
            courseName: target.courseName,
            url: assignmentUrl,
            requestId,
          };
        }

        case 'openEmail': {
          // 1. Query Gmail to find relevant email
          const query = parameters.query || 'important';
          const gmailRes = await this.execute({
            service: 'gmail',
            action: 'searchEmails',
            parameters: { query, max: 1 },
            signal,
            requestId,
          });

          if (!gmailRes.success || !gmailRes.data || gmailRes.data.length === 0) {
            return {
              success: false,
              service: 'chrome',
              action: 'openEmail',
              error: 'NO_EMAILS_FOUND',
              message: `No emails matching "${query}" were found to open.`,
              requestId,
            };
          }

          const email = gmailRes.data[0];
          const emailUrl = email.id 
            ? `https://mail.google.com/mail/u/0/#inbox/${email.id}`
            : 'https://mail.google.com';

          // 2. Dispatch OPEN_URL to Chrome Extension
          const openRes = await chromeExtensionManager.openUrl(emailUrl, { signal, requestId });

          return {
            ...openRes,
            action: 'openEmail',
            emailSubject: email.subject,
            from: email.from,
            url: emailUrl,
            requestId,
          };
        }

        default:
          return { success: false, service: 'chrome', error: 'UNKNOWN_ACTION', message: `Unknown chrome action: ${action}`, requestId };
      }
    }

    // ── CROSS-SERVICE: COMBINED AGENDA ───────────────────────────────────────
    if (service === 'agenda') {
      return this.getCombinedAgenda(parameters, { signal, requestId });
    }

    return {
      success: false,
      service,
      error: 'UNKNOWN_SERVICE',
      message: `Unsupported service: ${service}`,
    };
  }

  /**
   * Cross-service query combining Calendar events, Classroom deadlines, and Gmail.
   */
  async getCombinedAgenda(parameters = {}, options = {}) {
    const { signal, requestId } = options;
    const isTomorrow = parameters.day === 'tomorrow' || !parameters.day;

    // Run queries in parallel with abort signal
    const [calendarRes, classroomRes, gmailRes] = await Promise.all([
      isTomorrow
        ? this.execute({ service: 'calendar', action: 'getTomorrowEvents', signal, requestId })
        : this.execute({ service: 'calendar', action: 'getTodayEvents', signal, requestId }),
      this.execute({ service: 'classroom', action: 'getUpcomingAssignments', signal, requestId }),
      parameters.includeEmail
        ? this.execute({ service: 'gmail', action: 'getRecentEmails', parameters: { max: 3 }, signal, requestId })
        : Promise.resolve({ success: true, service: 'gmail', data: [] }),
    ]);

    if (signal?.aborted) {
      return { success: false, service: 'agenda', error: 'CANCELLED', message: 'Request cancelled' };
    }

    return {
      success: true,
      service: 'agenda',
      action: isTomorrow ? 'getTomorrowAgenda' : 'getTodayAgenda',
      data: {
        events: calendarRes.success ? calendarRes.data : [],
        assignments: classroomRes.success ? classroomRes.data : [],
        emails: gmailRes.success ? gmailRes.data : [],
        services: {
          calendar: calendarRes.success ? 'ok' : calendarRes.error,
          classroom: classroomRes.success ? 'ok' : classroomRes.error,
          gmail: gmailRes.success ? 'ok' : gmailRes.error,
        },
      },
    };
  }

  /**
   * Return comprehensive connection and readiness status of all integrations.
   */
  getStatus() {
    const googleStatus = googleClientManager.getStatus();
    const chromeStatus = chromeExtensionManager.getStatus();

    return {
      google: googleStatus,
      chrome: chromeStatus,
      services: {
        calendar: googleStatus.services.calendar,
        classroom: googleStatus.services.classroom,
        gmail: googleStatus.services.gmail,
        chrome: {
          connected: chromeStatus.connected,
          status: chromeStatus.connected ? 'Connected ✓' : 'Not Connected',
        },
      },
    };
  }
}

const integrationManager = new IntegrationManager();

module.exports = {
  integrationManager,
  MOCK_DATA,
};
