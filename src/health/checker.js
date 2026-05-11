'use strict';

/**
 * HealthChecker — assesses the wellness of besttol-App ecosystem components.
 *
 * Each check returns a result object:
 *   { name, status: 'healthy'|'degraded'|'unhealthy', message, timestamp }
 */

const { EventEmitter } = require('events');
const os = require('os');

// Thresholds for system metrics
const THRESHOLDS = {
  cpuLoadPercent: 90,       // warn when 1-min load avg > 90 % of logical CPUs
  memoryUsedPercent: 90,    // warn when used RAM > 90 %
  diskFreeBytes: 100 * 1024 * 1024, // warn when free disk < 100 MB (approximated via os)
  uptimeMinimumSeconds: 0,  // uptime check always passes when process is alive
};

class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    this.thresholds = { ...THRESHOLDS, ...options.thresholds };
    this.customChecks = [];
  }

  /**
   * Register a custom check function.
   * fn must return (or resolve) an object { name, status, message }.
   */
  registerCheck(fn) {
    if (typeof fn !== 'function') throw new TypeError('Check must be a function');
    this.customChecks.push(fn);
    return this;
  }

  // ── Built-in checks ──────────────────────────────────────────────────────────

  _checkCpuLoad() {
    const cpus = os.cpus().length;
    const loadAvg = os.loadavg()[0]; // 1-minute load average
    const percent = cpus > 0 ? (loadAvg / cpus) * 100 : 0;
    const status = percent >= this.thresholds.cpuLoadPercent ? 'degraded' : 'healthy';
    return {
      name: 'cpu_load',
      status,
      message: `1-min load avg ${loadAvg.toFixed(2)} across ${cpus} CPU(s) (${percent.toFixed(1)} %)`,
      timestamp: new Date().toISOString(),
    };
  }

  _checkMemory() {
    const total = os.totalmem();
    const free = os.freemem();
    const usedPercent = total > 0 ? ((total - free) / total) * 100 : 0;
    const status = usedPercent >= this.thresholds.memoryUsedPercent ? 'degraded' : 'healthy';
    return {
      name: 'memory',
      status,
      message: `${usedPercent.toFixed(1)} % of ${(total / 1024 / 1024).toFixed(0)} MB used`,
      timestamp: new Date().toISOString(),
    };
  }

  _checkProcessUptime() {
    const uptime = process.uptime();
    const status = uptime >= this.thresholds.uptimeMinimumSeconds ? 'healthy' : 'unhealthy';
    return {
      name: 'process_uptime',
      status,
      message: `Process has been running for ${uptime.toFixed(0)} second(s)`,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Run all built-in and custom checks.
   * @returns {Promise<{ overall: string, checks: Array }>}
   */
  async runAll() {
    const results = [
      this._checkCpuLoad(),
      this._checkMemory(),
      this._checkProcessUptime(),
    ];

    for (const fn of this.customChecks) {
      try {
        const result = await Promise.resolve(fn());
        results.push({ timestamp: new Date().toISOString(), ...result });
      } catch (err) {
        results.push({
          name: fn.name || 'custom_check',
          status: 'unhealthy',
          message: `Check threw an error: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
      }
    }

    const priorities = { unhealthy: 2, degraded: 1, healthy: 0 };
    const overall = results.reduce((worst, r) => {
      return (priorities[r.status] ?? 0) > (priorities[worst] ?? 0) ? r.status : worst;
    }, 'healthy');

    const report = { overall, checks: results };
    this.emit('report', report);
    return report;
  }
}

module.exports = { HealthChecker, THRESHOLDS };
