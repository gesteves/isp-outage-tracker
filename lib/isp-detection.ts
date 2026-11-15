const ISP_CACHE_KEY = 'isp-name-cache';
const ISP_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/** What the public IP says about the connection. Any part can be unknown. */
export interface NetworkInfo {
  /** ISP name, e.g. "Comcast Cable". */
  name: string | null;
  /** Public IP address. */
  ip: string | null;
  /** Autonomous system number, e.g. "AS7922". */
  asn: string | null;
}

interface CachedNetworkInfo extends NetworkInfo {
  timestamp: number;
}

const AS_PREFIX = /^AS(\d+)\s+/i;

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
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
    // Entries from before the IP was recorded have no `ip` key: treat them as a miss.
    if (!('ip' in cached) || typeof cached.timestamp !== 'number') return null;
    if (Date.now() - cached.timestamp >= ISP_CACHE_DURATION) return null;
    return { name: cached.name ?? null, ip: cached.ip ?? null, asn: cached.asn ?? null };
  } catch {
    return null; // Invalid cache, fetch again.
  }
}

/**
 * Detects the ISP name, public IP and ASN. Results are cached for an hour;
 * `force` skips the cache, e.g. after an outage, when a failover connection
 * may have a different ISP or the IP may have changed.
 */
export async function detectISP({ force = false }: { force?: boolean } = {}): Promise<NetworkInfo | null> {
  if (!force && typeof window !== 'undefined') {
    const cached = readCache();
    if (cached) return cached;
  }

  // Try to detect ISP using free IP geolocation API (ipapi.co: free tier, no API key required)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://ipapi.co/json/', {
      signal: controller.signal,
    });

    if (response.ok) {
      const data = await response.json();
      const rawName = stringOrNull(data.org) ?? stringOrNull(data.asn?.org);
      const info: NetworkInfo = {
        // Remove common prefixes like "AS12345 " from ISP names
        name: rawName ? rawName.replace(AS_PREFIX, '') : null,
        ip: stringOrNull(data.ip),
        asn: parseAsn(data.asn) ?? parseAsn(rawName?.match(AS_PREFIX)?.[1]),
      };

      if (info.name || info.ip) {
        if (typeof window !== 'undefined') {
          const cached: CachedNetworkInfo = { ...info, timestamp: Date.now() };
          localStorage.setItem(ISP_CACHE_KEY, JSON.stringify(cached));
        }
        return info;
      }
    }
  } catch (error) {
    // Silently fail; the dashboard just won't show an ISP name.
    console.debug('ISP detection failed:', error);
  } finally {
    clearTimeout(timeoutId);
  }

  return null;
}

export function clearISPCache(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(ISP_CACHE_KEY);
  }
}
