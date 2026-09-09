/**
 * VOXA — Metrics Tracker
 * Records real timing data for interruption-to-audio-stop latency,
 * event timelines, and demo checklist state.
 * 
 * All values are measured with performance.now() — never fabricated.
 */

class VoxaMetrics {
  constructor() {
    // Latency measurements
    this.latencies = []; // Array of { value, timestamp }
    
    // Event timeline for current interaction
    this.timeline = [];
    
    // Demo checklist
    this.checklist = {
      voiceDetected: false,
      rimeSpeaking: false,
      interruptionDetected: false,
      audioStopped: false,
      staleResponseBlocked: false,
      contextUpdated: false,
      newResponseGenerated: false,
      recoverySuccessful: false,
    };

    // Session start
    this.sessionStartTime = null;
    
    // Pipeline latencies
    this.latestToolLatency = null;
    this.latestLlmLatency = null;
    this.latestTtsLatency = null;
  }

  recordToolLatency(ms) {
    this.latestToolLatency = ms;
  }

  recordLlmLatency(ms) {
    this.latestLlmLatency = ms;
  }

  recordTtsLatency(ms) {
    this.latestTtsLatency = ms;
  }

  startSession() {
    this.sessionStartTime = performance.now();
    this.timeline = [];
    this.resetChecklist();
  }

  recordEvent(name, timestamp = null) {
    const ts = timestamp || performance.now();
    const relative = this.sessionStartTime
      ? (ts - this.sessionStartTime) / 1000
      : ts / 1000;

    this.timeline.push({
      name,
      absoluteTime: ts,
      relativeTime: relative,
      formattedTime: this._formatTime(relative),
    });
  }

  _formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
  }

  recordStressTestResult(r) {
    this.stressTestResults.push(r);
  }

  recordInterruptionLatency(interruptionTime, audioStopTime) {
    const latencyMs = audioStopTime - interruptionTime;
    this.latencies.push({
      value: latencyMs,
      timestamp: Date.now(),
    });
    return latencyMs;
  }

  /**
   * Get latency statistics.
   * Returns null values if no measurements exist.
   */
  getLatencyStats() {
    if (this.latencies.length === 0) {
      return {
        current: null,
        average: null,
        min: null,
        max: null,
        count: 0,
        label: 'Not measured',
      };
    }

    const values = this.latencies.map(l => l.value);
    const current = values[values.length - 1];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    return {
      current: Math.round(current * 100) / 100,
      average: Math.round(avg * 100) / 100,
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      count: values.length,
      label: `${Math.round(current)}ms`,
    };
  }

  // ── Demo Checklist ───────────────────────────────────────────────────────

  markChecklistItem(item, value = true) {
    if (item in this.checklist) {
      this.checklist[item] = value;
    }
  }

  resetChecklist() {
    for (const key in this.checklist) {
      this.checklist[key] = false;
    }
  }

  getChecklistItems() {
    const labels = {
      voiceDetected: 'Voice detected',
      rimeSpeaking: 'Rime speaking',
      interruptionDetected: 'Interruption detected',
      audioStopped: 'Audio stopped',
      staleResponseBlocked: 'Stale response blocked',
      contextUpdated: 'Context updated',
      newResponseGenerated: 'New response generated',
      recoverySuccessful: 'Recovery successful',
    };

    return Object.entries(this.checklist).map(([key, value]) => ({
      key,
      label: labels[key] || key,
      completed: value,
    }));
  }

  // ── Stress Test ──────────────────────────────────────────────────────────

  recordStressTestResult(result) {
    this.stressTestResults.push({
      ...result,
      timestamp: Date.now(),
    });
  }

  getStressTestSummary() {
    if (this.stressTestResults.length === 0) return null;

    const passed = this.stressTestResults.filter(r => r.passed).length;
    const total = this.stressTestResults.length;

    return {
      passed,
      total,
      allPassed: passed === total,
      results: this.stressTestResults,
    };
  }

  // ── Rendering Helpers ────────────────────────────────────────────────────

  /**
   * Get the timeline as formatted text lines.
   */
  getTimelineDisplay() {
    return this.timeline.map(event => ({
      time: event.formattedTime,
      name: event.name,
    }));
  }

  /**
   * Export all metrics as a plain object for display.
   */
  exportMetrics() {
    return {
      latency: this.getLatencyStats(),
      timeline: this.getTimelineDisplay(),
      checklist: this.getChecklistItems(),
      stressTest: this.getStressTestSummary(),
    };
  }
}

window.VoxaMetrics = VoxaMetrics;
