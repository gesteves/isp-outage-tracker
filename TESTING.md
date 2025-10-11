# Testing Guide

This project includes comprehensive test coverage for the ISP Outage Tracker application.

## Test Structure

Tests are organized in the `__tests__` directory:

```
__tests__/
├── lib/
│   ├── storage.test.ts        # localStorage utilities tests
│   ├── utils.test.ts           # Utility functions tests  
│   ├── connectivity.test.ts    # Connectivity checking tests
│   └── isp-detection.test.ts   # ISP auto-detection tests
└── components/
    ├── StatusIndicator.test.tsx  # Status display component tests
    ├── OutageList.test.tsx        # Outage list component tests
    └── StatsDisplay.test.tsx      # Statistics display tests
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
- ✅ **Storage**: localStorage operations for outages and tracking data
- ✅ **Utils**: Stats calculation, duration formatting, CSV export
- ✅ **Connectivity**: Multi-endpoint connectivity checking
- ✅ **ISP Detection**: Automatic ISP name detection with caching

### Components
- ✅ **StatusIndicator**: Online/offline status display
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
  it('should show "Internet is UP" when online', () => {
    render(<StatusIndicator isOnline={true} />)
    expect(screen.getByText('Internet is UP')).toBeInTheDocument()
  })
})
```

### Mocking

The test setup includes mocks for:
- `localStorage` - For storage operations
- `fetch` - For network requests
- `Date.now()` - For time-based tests

## Known Issues

The jest.setup.js file needs the localStorage mock properly configured. If tests fail with "mockClear is not a function", ensure jest.setup.js properly recreates jest mocks in beforeEach.

## Continuous Integration

Tests can be added to CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm test
```

