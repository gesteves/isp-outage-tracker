/** @type {import('next').NextConfig} */
const nextConfig = {
  // Everything runs in the browser, so the build is a plain static site in out/.
  // That's what lets the service worker (public/sw.js) serve the app offline.
  output: 'export',
};

export default nextConfig;
