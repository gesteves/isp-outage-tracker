# ISP Outage Tracker

[![CI](https://github.com/gesteves/isp-outage-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/gesteves/isp-outage-tracker/actions/workflows/ci.yml)

A dashboard you leave open in a browser tab (an old iPad on a stand works well) that watches your internet connection and logs every outage: when it started, when it ended, and whether it was your ISP or your own network. Everything runs in the browser; there's no server and no account.

## Features

- 📊 **Monitoring**: checks connectivity every minute, and every 10 seconds while something looks wrong
- 📈 **Honest uptime**: uptime is computed over the time the app was actually watching, not since you first opened it
- 🏠 **Local vs. ISP outages**: outages while your device had no network at all (Wi-Fi off, cable unplugged) are tagged "Local network" and don't count against your ISP
- 📅 **Daily chart**: downtime per day for the last 30 days, with days the app wasn't running shown as "not monitored"
- 📝 **Outage history**: start, end, duration, cause and ISP for every outage
- 📥 **CSV export**: local and ISO 8601 timestamps, durations in seconds and minutes, cause and ISP
- 🔔 **Status notifications**: optional notifications when the internet goes down and when it comes back
- 🔆 **Keep screen on**: optional toggle so a dedicated display doesn't go to sleep
- 📴 **Works offline**: installable, and still loads if you reload it during an outage
- 🗂️ **Multi-tab safe**: with several tabs open, only one runs checks; the others mirror it
- 🔍 **ISP detection**: shows your ISP's name, and records it on each outage

## How It Works

### Checking

- Each check sends requests to several reliable endpoints (1.1.1.1, 8.8.8.8, cloudflare.com and google.com). The check fails only if **all** of them fail.
- An outage is logged after consecutive failed checks (default: 2), and its start time is backdated to the **first** failed check.
- After a failed check, the next one runs in 10 seconds instead of a full interval. Outages are confirmed in about 10 seconds, and recoveries are noticed just as quickly.
- The app also checks right away when the browser reports the network changing, and when you come back to the tab after its timers were slowed down.
- Until the first check completes, the dashboard shows "Checking your connection…" instead of guessing.

All checks run client-side, from your browser, so they measure *your* connection.

### Local network outages

If every failed check during an outage happened while the device reported no network at all, the outage is tagged **Local network**: the problem was on your side, not your ISP's. If even one failure happened while the device had a network, it counts as an ISP outage. For example, after a router reboot Wi-Fi comes back, but the internet doesn't yet.

Local outages appear in the history and the chart but are left out of ISP uptime and downtime.

### Uptime

Uptime is ISP uptime over the time the app could actually observe it:

> uptime = (monitored time − local downtime − ISP downtime) ÷ (monitored time − local downtime)

Time when the app wasn't running doesn't count either way, and the stats card shows how much of the tracked period was monitored.

### Gaps in monitoring

The app can only record what it observes. Sometimes no check runs for more than two check intervals plus a minute: the laptop slept, the tab was closed, or the iPad suspended Safari. When that happens, any open outage is closed at the last check that saw the connection down, and the failure streak restarts. That keeps an outage from stretching across hours when the app wasn't watching. Closing an outage this way doesn't send a "back online" notification.

### Multiple tabs

The first tab to open runs the checks and writes the history. Any other tab shows "Monitoring in another tab" and mirrors it live. Clearing history from any tab clears it everywhere, and when the monitoring tab closes, another open tab takes over. Without Web Locks support (older browsers, or a plain-HTTP LAN address), every tab monitors on its own.

## Dashboard Options

### Keep screen on

Keeps the display awake while the page is visible, using the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API). The setting is remembered on each device.

- Requires HTTPS (or `localhost`). Safari supports it from iPadOS/iOS 16.4; as a home-screen app, from iPadOS 18.4.
- Browsers may refuse it, e.g. in battery saver mode. The toggle then says so; tap it to try again.
- On a device dedicated to this, you can also set **Settings → Display & Brightness → Auto-Lock → Never**.

### Notify when status changes

Shows a notification when an outage starts and when the connection comes back (with how long it was down). Notifications only appear while the dashboard isn't visible, and only from the tab that runs the checks. They're local, so the "down" notification works even with no internet.

- On iPad and iPhone, web notifications only work after **Share → Add to Home Screen**.

### Install / offline

In production, a service worker caches the app so it still opens if you reload it during an outage. The connectivity checks themselves always go to the network. You can also install it: **Add to Home Screen** on iPad, or the install button in Chrome's address bar.

## Setup

### Prerequisites

- Node.js 20.9+ (required by Next.js 16; `.nvmrc` pins the current LTS)
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
NEXT_PUBLIC_CHECK_INTERVAL_SECONDS=60  # Check every 60 seconds (minimum 5)
NEXT_PUBLIC_FAILURE_THRESHOLD=2        # Log outage after 2 consecutive failures (minimum 1)
```

Invalid values (non-integers, or values below the minimum) fall back to the defaults.

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The service worker isn't registered in development; to try offline support, use the production build:

```bash
npm run build   # static site in out/
npm start       # serves out/ on http://localhost:3000
```

### 4. Development Scripts

```bash
npm test           # Jest test suite
npm run lint       # ESLint
npm run typecheck  # TypeScript, no emit
npm run build      # Production build (static export to out/)
npm start          # Serve the production build
```

CI runs lint, typecheck, tests and the build on every pull request.

## Deployment to Netlify

The app is a static export (`output: 'export'` in `next.config.mjs`), so it deploys as plain files from `out/`; `netlify.toml` already sets this up, including cache headers for the service worker.

1. Push the repository to GitHub, GitLab, or Bitbucket.
2. In [Netlify](https://www.netlify.com/), choose **Add new site → Import an existing project** and select the repository.
3. Optionally, under **Site settings → Environment variables**, set `NEXT_PUBLIC_CHECK_INTERVAL_SECONDS` and `NEXT_PUBLIC_FAILURE_THRESHOLD`.
4. Deploy. Pushes to your main branch redeploy automatically.

Serve it over HTTPS: keeping the screen on, multi-tab coordination and the service worker all require a secure context.

## Configuration

All configuration is optional. The app works out of the box with sensible defaults.

### ISP Name

The app detects your ISP name using IP geolocation (ipapi.co) and shows it on the dashboard. The result is cached for an hour, and refreshed after every outage in case the connection came back through a different ISP (e.g. a backup link). Each outage records the ISP that was active before it started.

### Check Interval

How often to check connectivity while the connection is up (in seconds, minimum 5):
```env
NEXT_PUBLIC_CHECK_INTERVAL_SECONDS=60
```

### Failure Threshold

Number of consecutive failed checks before logging an outage:
```env
NEXT_PUBLIC_FAILURE_THRESHOLD=2
```

## Data Storage

Everything is stored in your browser's localStorage:

- `isp-tracker-data`: outages, tracking start time, monitored time per day, the last check time and any in-progress failure streak. It's versioned; data from earlier versions of the app is migrated automatically the first time it loads.
- `isp-tracker-settings`: the "keep screen on" and notification toggles, per device.
- `isp-name-cache`: the detected ISP name, for an hour.

**Note**: Data is browser-specific. If you open the app in a different browser or device, you won't see the same history.

## Troubleshooting

### No outages being logged

- Keep the browser tab open
- Check browser console for errors
- Verify that `NEXT_PUBLIC_CHECK_INTERVAL_SECONDS` is set correctly (if customized)
