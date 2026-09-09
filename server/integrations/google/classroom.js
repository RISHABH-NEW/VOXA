/**
 * VOXA — Google Classroom Service
 * Retrieves enrolled courses, student coursework, deadlines, and submission status.
 */

const { google } = require('googleapis');
const { googleClientManager } = require('./googleClient');

function formatDueDate(dueDate, dueTime) {
  if (!dueDate) return 'No due date';
  const { year, month, day } = dueDate;
  let dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  if (dueTime) {
    const hours = dueTime.hours || 0;
    const minutes = String(dueTime.minutes || 0).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${dateStr} at ${displayHours}:${minutes} ${ampm}`;
  }
  return dateStr;
}

/**
 * Get courses the student is enrolled in.
 */
async function getCourses(options = {}) {
  const { signal } = options;

  if (!googleClientManager.isAuthenticated()) {
    return {
      success: false,
      service: 'classroom',
      action: 'getCourses',
      error: 'AUTH_REQUIRED',
      message: "Your Google account isn't connected.",
    };
  }

  const auth = googleClientManager.getOAuth2Client();
  const classroom = google.classroom({ version: 'v1', auth });

  try {
    if (signal?.aborted) throw new Error('Operation aborted');

    const res = await classroom.courses.list({
      courseStates: ['ACTIVE'],
      studentId: 'me',
      pageSize: 20,
    });

    if (signal?.aborted) throw new Error('Operation aborted');

    const courses = (res.data.courses || []).map(c => ({
      id: c.id,
      name: c.name,
      section: c.section || '',
      alternateLink: c.alternateLink || `https://classroom.google.com/c/${c.id}`,
    }));

    return {
      success: true,
      service: 'classroom',
      action: 'getCourses',
      data: courses,
    };
  } catch (err) {
    if (signal?.aborted || err.message === 'Operation aborted') {
      return { success: false, service: 'classroom', error: 'CANCELLED', message: 'Request was cancelled' };
    }
    console.error('[Classroom getCourses Error]:', err.message);
    return {
      success: false,
      service: 'classroom',
      action: 'getCourses',
      error: 'API_ERROR',
      message: "I couldn't access Google Classroom right now.",
      details: err.message,
    };
  }
}

/**
 * Get student coursework / assignments across courses.
 */
async function getAssignments(options = {}) {
  const { signal, maxPerCourse = 5 } = options;

  const coursesRes = await getCourses(options);
  if (!coursesRes.success) return coursesRes;

  const courses = coursesRes.data;
  if (!courses || courses.length === 0) {
    return {
      success: true,
      service: 'classroom',
      action: 'getAssignments',
      data: [],
      message: 'No active courses found.',
    };
  }

  const auth = googleClientManager.getOAuth2Client();
  const classroom = google.classroom({ version: 'v1', auth });
  const allAssignments = [];

  try {
    for (const course of courses) {
      if (signal?.aborted) throw new Error('Operation aborted');

      const res = await classroom.courses.courseWork.list({
        courseId: course.id,
        courseWorkStates: ['PUBLISHED'],
        pageSize: maxPerCourse,
      });

      const works = res.data.courseWork || [];
      for (const w of works) {
        allAssignments.push({
          id: w.id,
          courseId: course.id,
          courseName: course.name,
          title: w.title,
          description: w.description || null,
          dueDate: formatDueDate(w.dueDate, w.dueTime),
          dueDateRaw: w.dueDate,
          dueTimeRaw: w.dueTime,
          alternateLink: w.alternateLink || course.alternateLink,
          maxPoints: w.maxPoints || null,
        });
      }
    }

    return {
      success: true,
      service: 'classroom',
      action: 'getAssignments',
      data: allAssignments,
    };
  } catch (err) {
    if (signal?.aborted || err.message === 'Operation aborted') {
      return { success: false, service: 'classroom', error: 'CANCELLED', message: 'Request was cancelled' };
    }
    console.error('[Classroom getAssignments Error]:', err.message);
    return {
      success: false,
      service: 'classroom',
      action: 'getAssignments',
      error: 'API_ERROR',
      message: "I couldn't access Google Classroom right now.",
      details: err.message,
    };
  }
}

/**
 * Get upcoming assignments with due dates in the future.
 */
async function getUpcomingAssignments(options = {}) {
  const result = await getAssignments(options);
  if (!result.success) return result;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  const upcoming = result.data.filter(a => {
    if (!a.dueDateRaw) return true; // Include undated active assignments
    const { year, month, day } = a.dueDateRaw;
    if (year > currentYear) return true;
    if (year === currentYear && month > currentMonth) return true;
    if (year === currentYear && month === currentMonth && day >= currentDay) return true;
    return false;
  });

  return {
    success: true,
    service: 'classroom',
    action: 'getUpcomingAssignments',
    data: upcoming,
  };
}

module.exports = {
  getCourses,
  getAssignments,
  getUpcomingAssignments,
};
