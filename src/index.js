'use strict';

/**
 * besttol — Wellness Surveillance & Healing System
 *
 * Entry point.  Run with:
 *   node src/index.js          # single check-and-heal pass
 *   node src/index.js --daemon # continuous surveillance (Ctrl-C to stop)
 */

const { HealthChecker } = require('./health/checker');
const { Healer } = require('./health/healer');
const { SurveillanceMonitor } = require('./surveillance/monitor');

// ── Configuration (can be overridden via environment variables) ──────────────
const INTERVAL_MS = Number(process.env.BESTTOL_INTERVAL_MS) || 30_000;
const AUTO_HEAL = process.env.BESTTOL_AUTO_HEAL !== 'false';

// ── Bootstrap ────────────────────────────────────────────────────────────────
const checker = new HealthChecker();
const healer = new Healer();
const monitor = new SurveillanceMonitor({ checker, healer, intervalMs: INTERVAL_MS, autoHeal: AUTO_HEAL });

// Forward healer events for visibility
healer.on('action', (action) => {
  if (!action.success) {
    console.warn(`[Healer] ⚠ Action "${action.action}" for "${action.checkName}" did not succeed: ${action.detail}`);
  }
});

// ── Run ──────────────────────────────────────────────────────────────────────
const isDaemon = process.argv.includes('--daemon');

(async () => {
  console.log('🔍 besttol Wellness Surveillance — starting up…');

  if (isDaemon) {
    // Continuous mode: start the scheduled monitor
    monitor.start();

    // Also run one immediate cycle so there is output right away
    await monitor.checkNow();

    // Keep the process alive; graceful shutdown on signal
    const shutdown = () => {
      monitor.stop();
      console.log('\n👋 besttol surveillance shut down gracefully.');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // One-shot mode: run checks, heal if needed, then exit
    const { report, actions } = await monitor.checkNow();
    console.log('\n── Summary ──────────────────────────────────────────────');
    console.log(`Overall status : ${report.overall.toUpperCase()}`);
    console.log(`Checks run     : ${report.checks.length}`);
    console.log(`Healing actions: ${actions.length}`);
    if (actions.length > 0) {
      actions.forEach((a) => console.log(`  • [${a.checkName}] ${a.action} — ${a.detail}`));
    }
    console.log('────────────────────────────────────────────────────────');

    process.exit(report.overall === 'unhealthy' ? 1 : 0);
  }
})();

module.exports = { checker, healer, monitor };
