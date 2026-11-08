# Testing Guide

This project includes comprehensive test coverage for the ISP Outage Tracker application.

## Test Structure

Tests are organized in the `__tests__` directory:

```
__tests__/
├── lib/
│   ├── monitor.test.ts               # State machine: thresholds, backdating, gaps, local vs ISP, retry delay
│   ├── connectivity-monitor.test.ts  # Runner: scheduling, persistence, ISP, notifications, multiple tabs
│   ├── tab-coordinator.test.ts       # Leader election (Web Locks) and messaging (BroadcastChannel)
│   ├── storage.test.ts               # Versioned data, validation, migration from version 1
│   ├── settings.test.ts              # Per-device settings and cross-tab sync
│   ├── stats.test.ts                 # Honest uptime, monitored time per day, daily breakdown
│   ├── format.test.ts                # Durations, percentages, relative times
│   ├── csv.test.ts                   # CSV columns and download
│   ├── notifications.test.ts         # Status-change notifications and their conditions
│   ├── config.test.ts                # Env var parsing and fallbacks
│   ├── connectivity.test.ts          # Multi-endpoint connectivity checking
│   └── isp-detection.test.ts         # ISP auto-detection with caching
├── hooks/
│   ├── useConnectivityMonitor.test.tsx  # React hook, StrictMode, network-change events
│   ├── useWakeLock.test.tsx             # Keep screen on: re-acquiring, refusals, release
│   └── useDocumentStatus.test.tsx       # Status in the tab title and favicon
└── components/
    ├── StatusIndicator.test.tsx  # Up / down / checking display
    ├── StatsDisplay.test.tsx     # Uptime, monitored time, ISP vs local figures
    ├── DailyChart.test.tsx       # Bars, selection, keyboard, legend, table view
    ├── OutageList.test.tsx       # History, sorting, ISP and local badges
    ├── ConfirmDialog.test.tsx    # Native <dialog>: confirm, cancel, Esc, backdrop
    └── Toggle.test.tsx           # Accessible switch
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage
```

## Test Coverage

The test suite covers:

### Core Functionality
- ✅ **Monitor**: When outages start and end, failure thresholds, gaps in monitoring, local vs ISP causes
- ✅ **Monitor runner**: One check at a time, fast re-checks, StrictMode safety, persistence, clearing history
- ✅ **Multiple tabs**: Only the leader checks; followers mirror it; handover when the leader closes
- ✅ **Storage**: Versioned data, validation, and migration from the old format
- ✅ **Stats**: Uptime over monitored time, daily breakdown split at local midnight
- ✅ **Notifications, wake lock, tab title**: Browser APIs faked in jsdom

### Components
- ✅ **Dashboard pieces**: Status, stats, daily chart, history, confirm dialog, toggles

### Not covered by Jest

The service worker (`public/sw.js`) and real cross-tab behavior need a real browser. Check them against the production build (`npm run build && npm start`): load the page, confirm in DevTools → Application that the service worker is active, then stop the server and reload; the app should still load. Open a second tab to see "Monitoring in another tab".

## Test Framework

- **Jest**: Test runner and assertion library
- **React Testing Library**: Component testing utilities
- **jsdom**: Browser environment simulation

## Writing Tests

### Example Test

```typescript
import { render, screen } from '@testing-library/react'
import StatusIndicator from '@/components/StatusIndicator'

describe('StatusIndicator', () => {
  it('should show "up" when online', () => {
    render(<StatusIndicator status="up" />)
    expect(screen.getByText(/Your internet is/)).toBeInTheDocument()
    expect(screen.getByText('up')).toBeInTheDocument()
  })
})
```

Time-dependent logic is easiest to test through the pure state machine in `lib/monitor.ts`, or with
`jest.useFakeTimers()` and an injected `check` function for `createConnectivityMonitor`.

### Mocking

`jest.setup.ts` provides:
- `localStorage`: an in-memory mock, reset before each test
- `fetch`: a `jest.fn()` that tests override as needed
- `<dialog>`: `showModal()` and `close()`, which jsdom doesn't implement

Time-dependent code takes its dependencies as arguments (`now`, `check`, `coordinator`, …), so tests use `jest.useFakeTimers()` and fakes instead of real networks, tabs or clocks.

## Continuous Integration

`.github/workflows/ci.yml` runs lint, typecheck, the test suite and a production build on every pull request and on pushes to `main`.
