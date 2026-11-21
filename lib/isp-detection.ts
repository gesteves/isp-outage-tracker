const ISP_CACHE_KEY = 'isp-name-cache';
const ISP_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/** What the public IP says about the connection. Any part can be unknown. */
export interface NetworkInfo {
  /** ISP name, e.g. "Comcast Cable". */
  name: string | null;
  /** Public IPv4 address. */
  ipv4: string | null;
  /** Public IPv6 address. Null also when the connection has no IPv6. */
  ipv6: string | null;
  /** Autonomous system number, e.g. "AS7922". */
  asn: string | null;
}

interface CachedNetworkInfo extends NetworkInfo {
  timestamp: number;
}

/** ISP name and ASN. Reached over IPv4 or IPv6, whichever the browser picks. */
const ISP_URL = 'https://ipapi.co/json/';
/** Answer only over IPv4 and only over IPv6, so each address is looked up on its own. */
const IPV4_URL = 'https://api.ipify.org?format=json';
const IPV6_URL = 'https://api6.ipify.org?format=json';

const TIMEOUT_MS = 5000;

const AS_PREFIX = /^AS(\d+)\s+/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** IPv4 addresses are dotted; anything with a colon is IPv6. Null if it's neither. */
export function ipFamily(ip: string | null | undefined): 'v4' | 'v6' | null {
  if (!ip) return null;
  if (IPV4.test(ip)) return 'v4';
  return ip.includes(':') ? 'v6' : null;
}

/** "AS7922" from "AS7922", "7922", 7922, or { asn: 7922 }. */
function parseAsn(raw: unknown): string | null {
  const value = raw && typeof raw === 'object' ? (raw as { asn?: unknown }).asn : raw;
  if (typeof value === 'number' && Number.isInteger(value)) return `AS${value}`;
  const match = typeof value === 'string' ? /^(?:AS)?(\d+)$/i.exec(value.trim()) : null;
  return match ? `AS${match[1]}` : null;
}

function readCache(): NetworkInfo | null {
  const raw = localStorage.getItem(ISP_CACHE_KEY);
  if (!raw) return null;
  try {
    const cached = JSON.parse(raw) as Partial<CachedNetworkInfo>;
    // Entries from before IPv4 and IPv6 were looked up separately: treat them as a miss.
    if (!('ipv4' in cached) || typeof cached.timestamp !== 'number') return null;
    if (Date.now() - cached.timestamp >= ISP_CACHE_DURATION) return null;
    return { name: cached.name ?? null, ipv4: cached.ipv4 ?? null, ipv6: cached.ipv6 ?? null, asn: cached.asn ?? null };
  } catch {
    return null; // Invalid cache, fetch again.
  }
}

/** The JSON body, or null if the request failed, timed out or wasn't ok. */
async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch (error) {
    // Silently fail; the dashboard just won't show what this lookup would have found.
    console.debug(`Lookup failed: ${url}`, error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** The address an IP lookup returned, if it's of the family asked for. */
async function lookupIp(url: string, family: 'v4' | 'v6'): Promise<string | null> {
  const ip = stringOrNull((await fetchJson(url))?.ip);
  return ipFamily(ip) === family ? ip : null;
}

/**
 * Detects the ISP name, public IPv4 and IPv6 addresses and ASN. The addresses are looked
 * up separately, because a single lookup returns whichever family the browser happened
 * to use, and a switch between them would look like a new address. Results are cached
 * for an hour; `force` skips the cache, e.g. after an outage, when a failover connection
 * may have a different ISP or the IP may have changed.
 */
export async function detectISP({ force = false }: { force?: boolean } = {}): Promise<NetworkInfo | null> {
  if (!force && typeof window !== 'undefined') {
    const cached = readCache();
    if (cached) return cached;
  }

  // Free services that need no API key. An IPv6 lookup fails when there's no IPv6.
  const [isp, ipv4, ipv6] = await Promise.all([
    fetchJson(ISP_URL),
    lookupIp(IPV4_URL, 'v4'),
    lookupIp(IPV6_URL, 'v6'),
  ]);

  const rawName = stringOrNull(isp?.org) ?? stringOrNull((isp?.asn as { org?: unknown } | undefined)?.org);
  // The ISP lookup's own address fills in a family whose lookup failed.
  const ispIp = stringOrNull(isp?.ip);
  const info: NetworkInfo = {
    // Remove common prefixes like "AS12345 " from ISP names
    name: rawName ? rawName.replace(AS_PREFIX, '') : null,
    ipv4: ipv4 ?? (ipFamily(ispIp) === 'v4' ? ispIp : null),
    ipv6: ipv6 ?? (ipFamily(ispIp) === 'v6' ? ispIp : null),
    asn: parseAsn(isp?.asn) ?? parseAsn(rawName?.match(AS_PREFIX)?.[1]),
  };

  if (!info.name && !info.ipv4 && !info.ipv6) return null;
  if (typeof window !== 'undefined') {
    const cached: CachedNetworkInfo = { ...info, timestamp: Date.now() };
    localStorage.setItem(ISP_CACHE_KEY, JSON.stringify(cached));
  }
  return info;
}

export function clearISPCache(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ISP_CACHE_KEY);
  }
}
