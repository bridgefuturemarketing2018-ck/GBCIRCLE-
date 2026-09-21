'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { HealthChecker, THRESHOLDS } = require('../src/health/checker');
const { Healer } = require('../src/health/healer');
const { SurveillanceMonitor } = require('../src/surveillance/monitor');

// ── HealthChecker ────────────────────────────────────────────────────────────

describe('HealthChecker', () => {
  it('returns a report with overall and checks array', async () => {
    const checker = new HealthChecker();
    const report = await checker.runAll();

    assert.ok(typeof report === 'object', 'report must be an object');
    assert.ok(['healthy', 'degraded', 'unhealthy'].includes(report.overall),
      'overall must be a valid status');
    assert.ok(Array.isArray(report.checks), 'checks must be an array');
    assert.ok(report.checks.length >= 3, 'at least 3 built-in checks');
  });

  it('each check has required fields', async () => {
    const checker = new HealthChecker();
    const { checks } = await checker.runAll();

    for (const c of checks) {
      assert.ok(typeof c.name === 'string', `${c.name}: name must be string`);
      assert.ok(['healthy', 'degraded', 'unhealthy'].includes(c.status),
        `${c.name}: status must be valid`);
      assert.ok(typeof c.message === 'string', `${c.name}: message must be string`);
      assert.ok(typeof c.timestamp === 'string', `${c.name}: timestamp must be string`);
    }
  });

  it('custom check is included in results', async () => {
    const checker = new HealthChecker();
    checker.registerCheck(() => ({
      name: 'custom_test',
      status: 'healthy',
      message: 'custom check passed',
    }));

    const { checks } = await checker.runAll();
    const custom = checks.find((c) => c.name === 'custom_test');
    assert.ok(custom, 'custom check must be present');
    assert.equal(custom.status, 'healthy');
  });

  it('sets overall to degraded when one check is degraded', async () => {
    const checker = new HealthChecker();
    checker.registerCheck(() => ({
      name: 'degraded_check',
      status: 'degraded',
      message: 'simulated degradation',
    }));

    const { overall } = await checker.runAll();
    assert.ok(overall !== 'healthy', 'overall must not be healthy when a check is degraded');
  });

  it('sets overall to unhealthy when one check is unhealthy', async () => {
    const checker = new HealthChecker();
    checker.registerCheck(() => ({
      name: 'broken_check',
      status: 'unhealthy',
      message: 'simulated failure',
    }));

    const { overall } = await checker.runAll();
    assert.equal(overall, 'unhealthy');
  });

  it('marks a check as unhealthy when it throws', async () => {
    const checker = new HealthChecker();
    checker.registerCheck(() => { throw new Error('boom'); });
    const { checks } = await checker.runAll();
    const errCheck = checks.find((c) => c.status === 'unhealthy' && c.message.includes('boom'));
    assert.ok(errCheck, 'failed check must be marked unhealthy');
  });

  it('emits a report event', async () => {
    const checker = new HealthChecker();
    let emitted = null;
    checker.on('report', (r) => { emitted = r; });
    await checker.runAll();
    assert.ok(emitted !== null, 'report event must be emitted');
  });

  it('registerCheck rejects non-function', () => {
    const checker = new HealthChecker();
    assert.throws(() => checker.registerCheck('not-a-fn'), TypeError);
  });
});

// ── Healer ───────────────────────────────────────────────────────────────────

describe('Healer', () => {
  it('does nothing for a fully healthy report', async () => {
    const healer = new Healer();
    const report = {
      overall: 'healthy',
      checks: [{ name: 'cpu_load', status: 'healthy', message: 'ok' }],
    };
    const actions = await healer.heal(report);
    assert.equal(actions.length, 0);
  });

  it('returns a no_strategy action for unknown check names', async () => {
    const healer = new Healer();
    const report = {
      overall: 'degraded',
      checks: [{ name: 'unknown_service', status: 'degraded', message: 'down' }],
    };
    const actions = await healer.heal(report);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].action, 'no_strategy');
    assert.equal(actions[0].success, false);
  });

  it('executes registered strategy for degraded memory', async () => {
    const healer = new Healer();
    const report = {
      overall: 'degraded',
      checks: [{ name: 'memory', status: 'degraded', message: '91 % used' }],
    };
    const actions = await healer.heal(report);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].success, true);
  });

  it('custom strategy can be registered and overrides built-in', async () => {
    const healer = new Healer();
    healer.registerStrategy('cpu_load', async () => ({
      action: 'custom_cpu_heal',
      success: true,
      detail: 'custom strategy ran',
    }));

    const report = {
      overall: 'degraded',
      checks: [{ name: 'cpu_load', status: 'degraded', message: 'high load' }],
    };
    const actions = await healer.heal(report);
    assert.equal(actions[0].action, 'custom_cpu_heal');
  });

  it('handles strategy that throws and marks as failed', async () => {
    const healer = new Healer();
    healer.registerStrategy('flaky', async () => { throw new Error('strategy error'); });

    const report = {
      overall: 'unhealthy',
      checks: [{ name: 'flaky', status: 'unhealthy', message: 'down' }],
    };
    const actions = await healer.heal(report);
    assert.equal(actions[0].action, 'strategy_error');
    assert.equal(actions[0].success, false);
  });

  it('records actions in history', async () => {
    const healer = new Healer();
    const report = {
      overall: 'degraded',
      checks: [{ name: 'memory', status: 'degraded', message: 'high' }],
    };
    await healer.heal(report);
    const history = healer.getHistory();
    assert.ok(history.length >= 1);
    assert.equal(history[0].checkName, 'memory');
  });

  it('emits action event', async () => {
    const healer = new Healer();
    const events = [];
    healer.on('action', (a) => events.push(a));

    const report = {
      overall: 'degraded',
      checks: [{ name: 'memory', status: 'degraded', message: 'high' }],
    };
    await healer.heal(report);
    assert.ok(events.length >= 1);
  });

  it('registerStrategy rejects non-function', () => {
    const healer = new Healer();
    assert.throws(() => healer.registerStrategy('check', 'not-fn'), TypeError);
  });

  it('getHistory returns a copy, not the internal array', async () => {
    const healer = new Healer();
    const h1 = healer.getHistory();
    h1.push({ fake: true });
    const h2 = healer.getHistory();
    assert.equal(h2.length, 0);
  });
});

// ── SurveillanceMonitor ──────────────────────────────────────────────────────

describe('SurveillanceMonitor', () => {
  let checker, healer;

  before(() => {
    checker = new HealthChecker();
    healer = new Healer();
  });

  it('throws without checker', () => {
    assert.throws(() => new SurveillanceMonitor({ healer }), /checker is required/);
  });

  it('throws without healer', () => {
    assert.throws(() => new SurveillanceMonitor({ checker }), /healer is required/);
  });

  it('checkNow returns report and actions', async () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    const { report, actions } = await monitor.checkNow();
    assert.ok(report.checks.length > 0);
    assert.ok(Array.isArray(actions));
  });

  it('isRunning reflects start/stop state', () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    assert.equal(monitor.isRunning, false);
    monitor.start();
    assert.equal(monitor.isRunning, true);
    monitor.stop();
    assert.equal(monitor.isRunning, false);
  });

  it('emits started and stopped events', () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    const events = [];
    monitor.on('started', () => events.push('started'));
    monitor.on('stopped', () => events.push('stopped'));
    monitor.start();
    monitor.stop();
    assert.deepEqual(events, ['started', 'stopped']);
  });

  it('cycleCount starts at 0', () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    assert.equal(monitor.cycleCount, 0);
  });

  it('double start is idempotent', () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    monitor.start();
    monitor.start(); // should not throw
    monitor.stop();
  });

  it('double stop is idempotent', () => {
    const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: 60_000 });
    monitor.stop(); // not started — should not throw
  });

  it('autoHeal:false skips healing even when unhealthy', async () => {
    const c = new HealthChecker();
    c.registerCheck(() => ({ name: 'broken', status: 'unhealthy', message: 'down' }));
    const h = new Healer();
    const monitor = new SurveillanceMonitor({ checker: c, healer: h, intervalMs: 60_000, autoHeal: false });
    const { actions } = await monitor.checkNow();
    assert.equal(actions.length, 0);
  });
});
