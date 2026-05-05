'use strict';

/**
 * SurveillanceMonitor — continuously checks the wellness of the besttol-App
 * ecosystem and triggers healing when problems are detected.
 *
 * Usage:
 *   const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 30_000 });
 *   monitor.start();
 *   // ... later ...
 *   monitor.stop();
 */

const { EventEmitter } = require('events');

const DEFAULT_INTERVAL_MS = 30_000; // 30 seconds

class SurveillanceMonitor extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('../health/checker').HealthChecker} opts.checker
   * @param {import('../health/healer').Healer}         opts.healer
   * @param {number}  [opts.intervalMs]  polling interval in milliseconds
   * @param {boolean} [opts.autoHeal]    automatically run healer on non-healthy reports (default true)
   * @param {Function} [opts.logger]     custom logging function (default console.log)
   */
  constructor({ checker, healer, intervalMs = DEFAULT_INTERVAL_MS, autoHeal = true, logger } = {}) {
    super();
    if (!checker) throw new Error('checker is required');
    if (!healer) throw new Error('healer is required');

    this.checker = checker;
    this.healer = healer;
    this.intervalMs = intervalMs;
    this.autoHeal = autoHeal;
    this.logger = logger || ((msg) => console.log(`[SurveillanceMonitor] ${msg}`));

    this._timer = null;
    this._running = false;
    this._cycleCount = 0;
  }

  // ── Control ──────────────────────────────────────────────────────────────────

  /**
   * Start continuous surveillance.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this.logger(`Surveillance started — polling every ${this.intervalMs / 1000}s`);
    this.emit('started');
    this._schedule();
  }

  /**
   * Stop surveillance.
   */
  stop() {
    if (!this._running) return;
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this.logger('Surveillance stopped');
    this.emit('stopped');
  }

  /** True while the monitor is active. */
  get isRunning() {
    return this._running;
  }

  /** Number of completed surveillance cycles since start(). */
  get cycleCount() {
    return this._cycleCount;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  _schedule() {
    if (!this._running) return;
    this._timer = setTimeout(() => this._cycle(), this.intervalMs);
  }

  async _cycle() {
    if (!this._running) return;
    this._cycleCount += 1;

    let report;
    try {
      report = await this.checker.runAll();
    } catch (err) {
      this.logger(`ERROR during health check: ${err.message}`);
      this.emit('error', err);
      this._schedule();
      return;
    }

    this._logReport(report);
    this.emit('report', report);

    if (this.autoHeal && report.overall !== 'healthy') {
      try {
        const actions = await this.healer.heal(report);
        if (actions.length > 0) {
          this.emit('healed', { report, actions });
          actions.forEach((a) =>
            this.logger(`HEAL [${a.checkName}] → ${a.action}: ${a.detail}`)
          );
        }
      } catch (err) {
        this.logger(`ERROR during healing: ${err.message}`);
        this.emit('error', err);
      }
    }

    this._schedule();
  }

  _logReport(report) {
    const overallIcon = { healthy: '✅', degraded: '⚠️ ', unhealthy: '❌' };
    const checkIcon   = { healthy: '  ✓', degraded: '  ⚠', unhealthy: '  ✗' };
    this.logger(
      `${overallIcon[report.overall] || '❓'} Cycle #${this._cycleCount} — overall: ${report.overall.toUpperCase()}`
    );
    for (const c of report.checks) {
      this.logger(`${checkIcon[c.status] || '  ?'} [${c.name}] ${c.message}`);
    }
  }

  /**
   * Run a single surveillance cycle immediately (outside the scheduled loop).
   * Useful for ad-hoc checks.
   */
  async checkNow() {
    const report = await this.checker.runAll();
    this._logReport(report);
    if (this.autoHeal && report.overall !== 'healthy') {
      const actions = await this.healer.heal(report);
      return { report, actions };
    }
    return { report, actions: [] };
  }
}

module.exports = { SurveillanceMonitor, DEFAULT_INTERVAL_MS };
