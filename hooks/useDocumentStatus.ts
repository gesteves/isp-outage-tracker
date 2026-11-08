'use client';

import { useEffect } from 'react';
import { ConnectionStatus } from '@/lib/monitor';

const LABELS: Record<ConnectionStatus, string> = {
  up: 'Up',
  down: 'Down',
  unknown: 'Checking…',
};

const COLORS: Record<ConnectionStatus, string> = {
  up: '#16a34a',
  down: '#dc2626',
  unknown: '#9ca3af',
};

export function statusIconUrl(status: ConnectionStatus): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="${COLORS[status]}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Puts the connection status in the tab title and favicon, so it's visible from
 * other tabs. (Safari mostly ignores favicon changes; the title still updates.)
 */
export function useDocumentStatus(status: ConnectionStatus, baseTitle = 'ISP Outage Tracker'): void {
  useEffect(() => {
    const originalTitle = document.title;
    document.title = `${LABELS[status]} · ${baseTitle}`;

    let links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'));
    let added: HTMLLinkElement | null = null;
    if (links.length === 0) {
      added = document.createElement('link');
      added.rel = 'icon';
      document.head.appendChild(added);
      links = [added];
    }

    const originals = links.map(link => ({ link, href: link.getAttribute('href'), type: link.type }));
    const href = statusIconUrl(status);
    links.forEach(link => {
      link.href = href;
      link.type = 'image/svg+xml';
    });

    return () => {
      document.title = originalTitle;
      added?.remove();
      originals.forEach(({ link, href: originalHref, type }) => {
        if (link === added) return;
        if (originalHref === null) link.removeAttribute('href');
        else link.setAttribute('href', originalHref);
        link.type = type;
      });
    };
  }, [status, baseTitle]);
}
