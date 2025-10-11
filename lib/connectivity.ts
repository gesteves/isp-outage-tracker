const ENDPOINTS = [
  'https://1.1.1.1',
  'https://8.8.8.8',
  'https://cloudflare.com',
  'https://google.com',
];

const TIMEOUT_MS = 5000;

export async function checkConnectivity(): Promise<boolean> {
  const results = await Promise.allSettled(
    ENDPOINTS.map(endpoint => checkEndpoint(endpoint))
  );

  // Internet is UP if at least one endpoint succeeds
  const anySuccess = results.some(result => result.status === 'fulfilled' && result.value);
  
  return anySuccess;
}

async function checkEndpoint(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);
    // With no-cors mode, we get an opaque response
    // If we get here without error, the endpoint is reachable
    return true;
  } catch (error) {
    clearTimeout(timeoutId);
    return false;
  }
}

