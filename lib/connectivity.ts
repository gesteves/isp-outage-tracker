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
    // With no-cors the response is opaque, so its status can't be read; only
    // whether the request resolved. Resolving means the endpoint is reachable.
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

