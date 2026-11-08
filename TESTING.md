# Testing Guide

This project includes comprehensive test coverage for the ISP Outage Tracker application.

## Test Structure

Tests are organized in the `__tests__` directory:

```
__tests__/
├── lib/
│   ├── monitor.test.ts               # Outage state machine (thresholds, backdating, gaps)
│   ├── connectivity-monitor.test.ts  # Check scheduling, persistence, clearing history
│   ├── config.test.ts                # Env var parsing and fallbacks
│   ├── storage.test.ts               # localStorage utilities
│   ├── utils.test.ts                 # Stats, duration/percentage formatting, CSV export
│   ├── connectivity.test.ts          # Multi-endpoint connectivity checking
│   └── isp-detection.test.ts         # ISP auto-detection with caching
├── hooks/
│   └── useConnectivityMonitor.test.tsx  # React hook, including StrictMode double-mount
└── components/
    ├── StatusIndicator.test.tsx  # Up / down / checking display
    ├── OutageList.test.tsx       # Outage history display and sorting
    └── StatsDisplay.test.tsx     # Statistics display
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
- ✅ **Monitor**: When outages start and end, failure thresholds, and gaps in monitoring
- ✅ **Monitor runner**: One check at a time, StrictMode safety, persistence, clearing history
- ✅ **Config**: Invalid env values fall back to defaults
- ✅ **Storage**: localStorage operations for outages and tracking data
- ✅ **Utils**: Stats calculation, duration formatting, CSV export
- ✅ **Connectivity**: Multi-endpoint connectivity checking
- ✅ **ISP Detection**: Automatic ISP name detection with caching

### Components
- ✅ **StatusIndicator**: Up / down / checking status display
- ✅ **StatsDisplay**: Uptime statistics visualization  
- ✅ **OutageList**: Outage history display and sorting

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

## Continuous Integration

Tests can be added to CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm test
```

