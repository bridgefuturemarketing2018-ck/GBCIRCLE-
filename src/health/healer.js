'use strict';

/**
 * Healer — applies corrective actions when wellness checks reveal problems.
 *
 * Healing strategies are registered per check name and executed automatically
 * when the surveillance monitor reports degraded or unhealthy results.
 */

const { EventEmitter } = require('events');

class Healer extends EventEmitter {
  constructor() {
    super();
    // Map<checkName, healFn>
    this._strategies = new Map();
    this._history = [];

    // Register built-in strategies
    this._registerBuiltins();
  }

  /**
   * Register a healing strategy for a specific check name.
   * @param {string} checkName  - must match the `name` field from HealthChecker results
   * @param {Function} strategy - async function(checkResult) => { action, success, detail }
   */
  registerStrategy(checkName, strategy) {
    if (typeof strategy !== 'function') throw new TypeError('Strategy must be a function');
    this._strategies.set(checkName, strategy);
    return this;
  }

  // ── Built-in healing strategies ──────────────────────────────────────────────

  _registerBuiltins() {
    // CPU load: trigger GC and emit guidance
    this.registerStrategy('cpu_load', async (result) => {
      if (global.gc) {
        global.gc();
      }
      return {
        action: 'gc_hint',
        success: true,
        detail: 'Suggested garbage collection to relieve CPU pressure. Review high-CPU processes.',
      };
    });

    // Memory: force GC and log guidance
    this.registerStrategy('memory', async (result) => {
      if (global.gc) {
        global.gc();
      }
      return {
        action: 'gc_and_alert',
        success: true,
        detail: 'Triggered garbage collection. If memory pressure persists, consider restarting the process.',
      };
    });

    // Process uptime: nothing automated, just log
    this.registerStrategy('process_uptime', async (result) => ({
      action: 'uptime_alert',
      success: true,
      detail: 'Process uptime check registered. No automatic restart configured.',
    }));
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Attempt to heal all non-healthy checks in a report.
   * @param {{ overall: string, checks: Array }} report
   * @returns {Promise<Array>} healing actions taken
   */
  async heal(report) {
    const actions = [];

    for (const check of report.checks) {
      if (check.status === 'healthy') continue;

      const strategy = this._strategies.get(check.name);
      if (!strategy) {
        const entry = {
          checkName: check.name,
          status: check.status,
          action: 'no_strategy',
          success: false,
          detail: `No healing strategy registered for "${check.name}"`,
          timestamp: new Date().toISOString(),
        };
        this._history.push(entry);
        actions.push(entry);
        this.emit('action', entry);
        continue;
      }

      try {
        const result = await Promise.resolve(strategy(check));
        const entry = {
          checkName: check.name,
          status: check.status,
          ...result,
          timestamp: new Date().toISOString(),
        };
        this._history.push(entry);
        actions.push(entry);
        this.emit('action', entry);
      } catch (err) {
        const entry = {
          checkName: check.name,
          status: check.status,
          action: 'strategy_error',
          success: false,
          detail: `Healing strategy threw: ${err.message}`,
          timestamp: new Date().toISOString(),
        };
        this._history.push(entry);
        actions.push(entry);
        this.emit('action', entry);
      }
    }

    return actions;
  }

  /**
   * Return a copy of the full healing history.
   */
  getHistory() {
    return [...this._history];
  }
}

module.exports = { Healer };
