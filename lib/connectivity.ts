import { CheckFailure } from '@/types';

/** Reachable by IP address, so they work without DNS. */
const IP_TARGETS = ['https://1.1.1.1', 'https://8.8.8.8'];
/** Need DNS. Reaching one of these is what browsing needs: DNS and routing both work. */
const NAME_TARGETS = ['https://cloudflare.com', 'https://google.com'];

/** How long each target gets to answer. A failing check usually takes this long. */
export const CHECK_TIMEOUT_MS = 5000;

export interface CheckOutcome {
  online: boolean;
  /** Only when offline: 'dns' if an IP target still answered, 'all' if nothing did. */
  failure?: CheckFailure;
  /** Fastest successful response (ms), or null if nothing answered. */
  latencyMs: number | null;
}

/**
 * The internet is up if a target reached by name answers. When none do, the
 * IP targets tell a DNS failure (an IP still answers) apart from a total one.
 */
export async function checkConnectivity(): Promise<CheckOutcome> {
  const [ipTimes, nameTimes] = await Promise.all([
    Promise.all(IP_TARGETS.map(checkEndpoint)),
    Promise.all(NAME_TARGETS.map(checkEndpoint)),
  ]);
  const answered = (times: Array<number | null>) => times.some(ms => ms !== null);

  const successes = [...ipTimes, ...nameTimes].filter((ms): ms is number => ms !== null);
  const latencyMs = successes.length > 0 ? Math.round(Math.min(...successes)) : null;

  if (answered(nameTimes)) return { online: true, latencyMs };
  return { online: false, failure: answered(ipTimes) ? 'dns' : 'all', latencyMs };
}

/** Response time in ms, or null if the request failed or timed out. */
async function checkEndpoint(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    // With no-cors the response is opaque, so its status can't be read; only
    // whether the request resolved. Resolving means the endpoint is reachable.
    await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
      cache: 'no-store',
    });
    return performance.now() - startedAt;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
