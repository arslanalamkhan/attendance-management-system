import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { PageViewInput } from '@nacta/shared';
import { postPageView } from '../lib/endpoints/audit';
import { findNav } from '../lib/nav';
import { getPageMeta, subscribePageMeta } from './use-page-meta';

/** Search params that describe presentation or transient UI rather than what was viewed. */
const IGNORED_PARAMS = new Set(['page', 'pageSize', 'sort', 'order', 'entry', 'next', 'new', 'mock', 'view']);
const SETTLE_MS = 800; // debounce for rapid navigation
const LABEL_WAIT_MS = 250; // after a page publishes its metadata, send soon
const MAX_WAIT_MS = 2000;

/** Only the params that matter for the view (filters, date range, tab), as a stable record. */
function relevantQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(search);
  for (const [k, v] of params) {
    if (IGNORED_PARAMS.has(k) || v === '' || Object.keys(out).length >= 20) continue;
    out[k] = v.slice(0, 200);
  }
  return out;
}

/**
 * Reports each route change to the audit trail (POST /audit/views). Mount once in the app shell,
 * which only renders for signed-in users past the forced password change, so /login is never reported.
 * Fire-and-forget: failures are silent and never toast. Rapid navigation is debounced.
 */
export function usePageViews(): void {
  const { pathname, search } = useLocation();
  const query = useMemo(() => relevantQuery(search), [search]);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (pathname === '/login') return;
    const started = Date.now();
    let sent = false;
    let timer: number | undefined;

    const fire = () => {
      if (sent) return;
      sent = true;
      const meta = getPageMeta(pathname);
      const view: PageViewInput = {
        path: pathname.slice(0, 300),
        title: (meta?.title ?? findNav(pathname)?.item.label ?? pathname).slice(0, 120),
      };
      if (meta?.entityType) view.entityType = meta.entityType;
      if (meta?.entityId !== undefined && meta.entityId !== '') view.entityId = String(meta.entityId).slice(0, 64);
      if (meta?.entityLabel) view.entityLabel = meta.entityLabel.slice(0, 200);
      const q = JSON.parse(queryKey) as Record<string, string>;
      if (Object.keys(q).length > 0) view.query = q;
      postPageView(view);
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(fire, delay);
    };
    schedule(SETTLE_MS);

    // The page announced itself (title, entity label): send shortly after instead of waiting out the full debounce.
    const unsubscribe = subscribePageMeta(() => {
      const meta = getPageMeta(pathname);
      // An entity page without its label yet keeps waiting for the record to load (up to the debounce).
      if (sent || !meta || (meta.entityType && !meta.entityLabel)) return;
      schedule(Math.max(0, Math.min(LABEL_WAIT_MS, MAX_WAIT_MS - (Date.now() - started))));
    });

    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [pathname, queryKey]);
}
