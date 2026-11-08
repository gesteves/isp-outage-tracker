/** Registers the offline service worker (public/sw.js). Production only: it would cache dev assets. */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(error => {
    console.error('Service worker registration failed:', error);
  });
}
