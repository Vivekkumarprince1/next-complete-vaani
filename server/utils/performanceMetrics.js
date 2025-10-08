/**
 * Server-side Performance Metrics (CommonJS)
 * Mirrors the client-side performanceMetrics utility but exported for server use.
 */
class PerformanceMetrics {
  constructor() {
    this.metrics = [];
    this.maxHistorySize = 200;
  }

  startTracking(requestId) {
    const metric = {
      requestId,
      timestamps: {
        audioCapture: null,
        audioProcessed: null,
        serverReceived: null,
        recognitionStart: null,
        recognitionEnd: null,
        translationStart: null,
        translationEnd: null,
        clientReceived: null,
        displayed: null
      },
      durations: {
        audioProcessing: 0,
        transmission: 0,
        recognition: 0,
        translation: 0,
        serverTotal: 0,
        returnTransmission: 0,
        display: 0,
        endToEnd: 0
      }
    };
    return metric;
  }

  recordTimestamp(metric, phase) {
    if (!metric || !metric.timestamps) return;
    metric.timestamps[phase] = Date.now();
    this._calculateDurations(metric);
  }

  _calculateDurations(metric) {
    const ts = metric.timestamps;
    const dur = metric.durations;

    if (ts.audioCapture && ts.audioProcessed) dur.audioProcessing = ts.audioProcessed - ts.audioCapture;
    if (ts.audioProcessed && ts.serverReceived) dur.transmission = ts.serverReceived - ts.audioProcessed;
    if (ts.recognitionStart && ts.recognitionEnd) dur.recognition = ts.recognitionEnd - ts.recognitionStart;
    if (ts.translationStart && ts.translationEnd) dur.translation = ts.translationEnd - ts.translationStart;
    if (ts.serverReceived && ts.translationEnd) dur.serverTotal = ts.translationEnd - ts.serverReceived;
    if (ts.translationEnd && ts.clientReceived) dur.returnTransmission = ts.clientReceived - ts.translationEnd;
    if (ts.clientReceived && ts.displayed) dur.display = ts.displayed - ts.clientReceived;
    if (ts.audioCapture && ts.displayed) dur.endToEnd = ts.displayed - ts.audioCapture;
  }

  complete(metric) {
    if (!metric) return;
    this._calculateDurations(metric);
    this.metrics.push(metric);
    if (this.metrics.length > this.maxHistorySize) this.metrics.shift();
    // Minimal logging on server
    try {
      const dur = metric.durations || {};
      console.log(`📊 [server-metrics] request=${metric.requestId} recognition=${dur.recognition || 0}ms translation=${dur.translation || 0}ms serverTotal=${dur.serverTotal || 0}ms endToEnd=${dur.endToEnd || 0}ms`);
    } catch (e) {}
  }

  export() {
    return JSON.parse(JSON.stringify(this.metrics));
  }
}

module.exports = new PerformanceMetrics();
