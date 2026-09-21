# gbcircle

Compliance — Wellness Surveillance & Healing System for the besttol-App ecosystem.

## Overview

`besttol` provides **all-time surveillance** of the application ecosystem with automatic detection and healing of degraded or unhealthy components:

| Component | Description |
|---|---|
| **HealthChecker** | Runs built-in (CPU load, memory, process uptime) and custom wellness checks |
| **Healer** | Applies corrective actions for every non-healthy check result |
| **SurveillanceMonitor** | Orchestrates continuous polling, reporting, and healing |

## Quick Start

```bash
# Install dependencies
npm install

# One-shot: check, heal if needed, then exit
npm start

# Daemon: continuous surveillance (Ctrl-C to stop)
npm run monitor
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `BESTTOL_INTERVAL_MS` | `30000` | Polling interval in milliseconds |
| `BESTTOL_AUTO_HEAL` | `true` | Set to `false` to disable automatic healing |

## Tests

```bash
npm test
```

## Continuous Surveillance (CI)

The GitHub Actions workflow (`.github/workflows/surveillance.yml`) runs wellness checks:
- On every push and pull request
- On a schedule every **30 minutes** for around-the-clock monitoring

## Extending

### Custom health check

```js
const { HealthChecker } = require('./src/health/checker');
const checker = new HealthChecker();

checker.registerCheck(async () => {
  const ok = await pingDatabase();
  return {
    name: 'database',
    status: ok ? 'healthy' : 'unhealthy',
    message: ok ? 'DB reachable' : 'DB unreachable',
  };
});
```

### Custom healing strategy

```js
const { Healer } = require('./src/health/healer');
const healer = new Healer();

healer.registerStrategy('database', async (checkResult) => {
  await restartDbConnection();
  return { action: 'db_reconnect', success: true, detail: 'Reconnected to database' };
});
```
