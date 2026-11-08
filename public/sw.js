/*
 * Offline support: caches the app shell so the dashboard still loads if you reload
 * it during an outage. Registered from lib/register-sw.ts in production only.
 *
 * Only same-origin GET requests are handled. Cross-origin requests (the
 * connectivity checks to 1.1.1.1, 8.8.8.8 etc. and the ISP lookup) are never
 * intercepted, so they always reflect the real network.
 */

const CACHE = 'isp-outage-tracker-v1';
const SHELL_URL = '/';
const NAVIGATION_TIMEOUT_MS = 3000;
const STATIC_PREFIX = '/_next/static/';

/** Every hashed build asset the page references. */
function staticAssets(html) {
  return Array.from(new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []));
}

async function cacheShell(cache, response) {
  const html = await response.clone().text();
  await cache.put(SHELL_URL, response);
  return html;
}

/** Caches each asset individually, so one failure doesn't abort the rest. */
async function cacheAssets(cache, urls) {
  await Promise.allSettled(
    urls.map(async url => {
      if (await cache.match(url)) return;
      const response = await fetch(url);
      if (response.ok) await cache.put(url, response);
    }),
  );
}

/** After a deploy, drop build assets the new page no longer references. */
async function pruneAssets(cache, keep) {
  const keepSet = new Set(keep);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(request => {
        const { pathname } = new URL(request.url);
        return pathname.startsWith(STATIC_PREFIX) && !keepSet.has(pathname);
      })
      .map(request => cache.delete(request)),
  );
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch(SHELL_URL, { cache: 'no-store' });
      if (response.ok) {
        const html = await cacheShell(cache, response);
        await cacheAssets(cache, staticAssets(html));
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/** Network first so deploys show up right away; the cached shell when offline. */
async function handleNavigation(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT_MS);
    if (response.ok && new URL(event.request.url).pathname === SHELL_URL) {
      // Clone now: once the page starts reading the body, it can't be cloned.
      const copy = response.clone();
      event.waitUntil(
        (async () => {
          const previous = await cache.match(SHELL_URL);
          const previousHtml = previous ? await previous.text() : null;
          const html = await cacheShell(cache, copy);
          const assets = staticAssets(html);
          await cacheAssets(cache, assets);
          // Only prune when the page changed (a new deploy). Within one build,
          // lazily loaded chunks aren't in the HTML and must be kept.
          if (previousHtml !== null && previousHtml !== html) await pruneAssets(cache, assets);
        })(),
      );
    }
    return response;
  } catch {
    return (await cache.match(event.request)) || (await cache.match(SHELL_URL)) || Response.error();
  }
}

/** Build assets have hashed names and never change, so the cache wins. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** Icons, manifest and the like: fresh when online, cached when not. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
  } else if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
