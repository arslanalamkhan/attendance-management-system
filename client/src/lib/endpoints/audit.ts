import { z } from 'zod';
import { API_BASE, endpoints, zAuditEntry, zAuditSummary, zErrorBody, zPage } from '@nacta/shared';
import type { AuditEntry, AuditQuery, AuditSummary, Page, PageViewInput } from '@nacta/shared';
import { ApiError, api, toQueryString } from '../api';
import { sessionBridge } from '../session-bridge';

/** GET /audit -> Page<AuditEntry> (newest first by default). */
export const listAudit = (query?: AuditQuery, signal?: AbortSignal) =>
  api.get<Page<AuditEntry>>(endpoints.audit(), { query, signal, schema: zPage(zAuditEntry) });

/** GET /audit/:id -> AuditEntry */
export const getAuditEntry = (id: number, signal?: AbortSignal) =>
  api.get<AuditEntry>(endpoints.auditEntry(id), { signal, schema: zAuditEntry });

/** GET /audit/summary?from&to -> AuditSummary */
export const getAuditSummary = (range: { from?: string; to?: string }, signal?: AbortSignal) =>
  api.get<AuditSummary>(endpoints.auditSummary(), { query: range, signal, schema: zAuditSummary as z.ZodType<AuditSummary, z.ZodTypeDef, unknown> });

/** POST /audit/views -> 204. Fire-and-forget: never throws, never toasts. */
export function postPageView(view: PageViewInput): void {
  api.post<void>(endpoints.auditViews(), view).catch(() => undefined);
}

/**
 * GET /audit/export (text/csv) with the same filters as the list. Downloads the file through a
 * temporary link; the CSV is never parsed. Paging/sort params are dropped so the whole filtered set is exported.
 */
export async function downloadAuditCsv(query: AuditQuery): Promise<string> {
  const { page: _page, pageSize: _pageSize, sort: _sort, order: _order, ...filters } = query;
  void _page, _pageSize, _sort, _order;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${endpoints.auditExport()}${toQueryString(filters)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'text/csv' },
    });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' });
  }
  if (!res.ok) {
    let parsed: ReturnType<typeof zErrorBody.safeParse> | null = null;
    try {
      parsed = zErrorBody.safeParse(await res.json());
    } catch {
      parsed = null;
    }
    if (res.status === 401) sessionBridge.notifyUnauthenticated();
    if (parsed?.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError({ status: res.status, code, message, details });
    }
    throw new ApiError({ status: res.status, code: 'HTTP_ERROR', message: `Export failed (${res.status})` });
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const filename = named ? decodeURIComponent(named) : `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return filename;
}
