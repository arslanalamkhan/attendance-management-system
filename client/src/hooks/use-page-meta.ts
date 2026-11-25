import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { AuditEntityType } from '@nacta/shared';

/** What a page tells the audit trail about itself when it is viewed. */
export interface PageMeta {
  /** Human title, e.g. "Employee profile". */
  title: string;
  entityType?: AuditEntityType;
  entityId?: string | number;
  /** Human label of the entity, e.g. "777 · Arslan Alam Khan". Pass it once it is known. */
  entityLabel?: string | null;
}

interface Registered {
  pathname: string;
  meta: PageMeta;
}

// A tiny module-level store: pages publish their metadata, `usePageViews` reads it.
// Keyed by pathname so a stale entry from the previous page can never be attributed to the next one.
let current: Registered | null = null;
const listeners = new Set<() => void>();

export function getPageMeta(pathname: string): PageMeta | null {
  return current && current.pathname === pathname ? current.meta : null;
}

export function subscribePageMeta(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Declare the current page's title (and entity, on profile/detail pages) for page-view auditing.
 * Call it once near the top of each page component. Pass `entityLabel` as soon as the record has loaded;
 * the view is sent a moment after navigation, so a label that arrives quickly is included.
 */
export function usePageMeta(meta: PageMeta): void {
  const { pathname } = useLocation();
  const { title, entityType, entityId, entityLabel } = meta;
  const id = entityId === undefined ? undefined : String(entityId);
  useEffect(() => {
    current = { pathname, meta: { title, entityType, entityId: id, entityLabel } };
    listeners.forEach((l) => l());
  }, [pathname, title, entityType, id, entityLabel]);
}
