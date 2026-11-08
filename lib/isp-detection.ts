const ISP_CACHE_KEY = 'isp-name-cache';
const ISP_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

interface ISPInfo {
  name: string;
  timestamp: number;
}

export async function detectISP(): Promise<string | null> {
  // Check if we have a cached ISP name
  if (typeof window !== 'undefined') {
    const cached = localStorage.getItem(ISP_CACHE_KEY);
    if (cached) {
      try {
        const ispInfo: ISPInfo = JSON.parse(cached);
        const age = Date.now() - ispInfo.timestamp;
        
        // Use cached value if less than 1 hour old
        if (age < ISP_CACHE_DURATION && ispInfo.name) {
          return ispInfo.name;
        }
      } catch {
        // Invalid cache, continue to fetch
      }
    }
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
      const ispName = data.org || data.asn?.org || null;
      
      if (ispName && typeof window !== 'undefined') {
        // Remove common prefixes like "AS12345 " from ISP names
        const cleanName = ispName.replace(/^AS\d+\s+/i, '');
        
        // Cache the result
        const ispInfo: ISPInfo = {
          name: cleanName,
          timestamp: Date.now(),
        };
        localStorage.setItem(ISP_CACHE_KEY, JSON.stringify(ispInfo));
        
        return cleanName;
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

