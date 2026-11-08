'use client';

import { useEffect, useState } from 'react';

/** Current time (epoch ms), re-rendering every `intervalMs`. One ticker drives every live value on the page. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
