# ISP Outage Tracker

A Next.js 15 application to track and log internet outages from your ISP. The app continuously monitors connectivity and records when the internet goes down, providing statistics and exportable logs.

## Features

- 📊 **Real-time Monitoring**: Checks connectivity every minute (configurable)
- 📈 **Statistics Dashboard**: Uptime percentage, total outages, and downtime
- 📝 **Outage Logs**: Detailed history with start/end times and duration
- 📥 **CSV Export**: Download outage logs for analysis
- 🗑️ **Clear Logs**: Reset tracking with confirmation
- 📱 **Responsive Design**: Optimized for iPad landscape orientation
- 💾 **Local Storage**: Data persists in browser localStorage
- 🚀 **No Authentication Required**: Simple setup, data stored locally in your browser
- 🔍 **Automatic ISP Detection**: Displays your ISP name automatically

## How It Works

The app uses a multi-endpoint connectivity check strategy to avoid false positives:

- Checks multiple reliable endpoints (1.1.1.1, 8.8.8.8, cloudflare.com, and the app itself)
- Marks internet as "down" only if ALL endpoints fail
- Requires consecutive failures (default: 2) before logging an outage
- All checks run client-side from your browser to detect YOUR internet status

## Setup

### Prerequisites

- Node.js 18+ installed
- Netlify account (for deployment, optional)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd isp-outage-tracker

# Use Node.js LTS version (if using nvm)
nvm install
nvm use

# Install dependencies
npm install
```

### 2. Configure Environment Variables (Optional)

If you want to customize check intervals, copy `env.example` to `.env.local`:

```bash
cp env.example .env.local
```

Edit `.env.local` with your values:

```env
NEXT_PUBLIC_CHECK_INTERVAL_SECONDS=60  # Check every 60 seconds
NEXT_PUBLIC_FAILURE_THRESHOLD=2        # Log outage after 2 consecutive failures
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment to Netlify

### 1. Push to Git

Push your code to GitHub, GitLab, or Bitbucket.

### 2. Connect to Netlify

1. Log in to [Netlify](https://www.netlify.com/)
2. Click "Add new site" → "Import an existing project"
3. Connect your Git provider and select the repository
4. Build settings should auto-detect (Next.js)

### 3. Configure Environment Variables (Optional)

In Netlify dashboard, if you want to customize settings:
1. Go to Site settings → Environment variables
2. Add optional variables:
   - `NEXT_PUBLIC_CHECK_INTERVAL_SECONDS` (optional, default: 60)
   - `NEXT_PUBLIC_FAILURE_THRESHOLD` (optional, default: 2)

### 4. Deploy

Netlify will automatically build and deploy. Subsequent pushes to your main branch will trigger automatic deployments.

## Configuration

All configuration is optional. The app works out of the box with sensible defaults.

### ISP Name

The app automatically detects your ISP name using IP geolocation (ipapi.co) and displays it in the dashboard. The result is cached for 1 hour. If detection fails, no ISP name is shown.

### Check Interval

How often to check connectivity (in seconds):
```env
NEXT_PUBLIC_CHECK_INTERVAL_SECONDS=60  # 60 seconds
```

### Failure Threshold

Number of consecutive failures before logging an outage:
```env
NEXT_PUBLIC_FAILURE_THRESHOLD=2
```

## Usage

1. Open the app in your browser (keep the tab open)
2. The app will automatically check connectivity at the configured interval
3. View real-time status, statistics, and outage history
4. Export logs to CSV for further analysis
5. Clear logs to start fresh tracking

## Data Storage

All data is stored in your browser's localStorage:
- Outage records
- Tracking start time

**Note**: Data is browser-specific. If you open the app in a different browser or device, you won't see the same history.

## Browser Tab Throttling

When the browser tab is in the background, JavaScript timers may slow down. The app will continue working, but timing precision may be slightly reduced when the tab isn't active.

## Future Enhancements

- Authentication with Google OAuth for multi-device access
- Backend database storage for persistent data across devices
- Real-time notifications
- Historical trend charts
- Network speed testing
- Multiple ISP tracking

## Troubleshooting

### No outages being logged

- Keep the browser tab open
- Check browser console for errors
- Verify that `NEXT_PUBLIC_CHECK_INTERVAL_SECONDS` is set correctly (if customized)


