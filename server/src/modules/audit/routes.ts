import { Router, type Response } from 'express';
import { zAuditQuery, zPageViewInput, type AuditChange, type AuditEntry } from '@nacta/shared';
import { notFound, validationError } from '../../lib/errors';
import { asyncHandler, idParam } from '../../lib/http';
import { limitOffset, toPage } from '../../lib/pagination';
import { parseBody, parseQuery } from '../../lib/validate';
import { authOf, requirePermission } from '../../middleware/auth';
import * as repo from './repo';
import { allowView, audit } from './service';

export const auditRouter = Router();

const EXPORT_MAX_ROWS = 100_000;
const EXPORT_BATCH = 1000;

/** POST /audit/views: any signed-in user (the router is mounted behind requireAuth, CSRF and the password gate). */
auditRouter.post(
  '/views',
  asyncHandler(async (req, res) => {
    const v = parseBody(zPageViewInput, req.body);
    const ctx = authOf(req);
    if (allowView(ctx.session.id, v.path)) {
      audit(req, {
        action: 'view.page',
        entityType: v.entityType,
        entityId: v.entityId,
        entityLabel: v.entityLabel ?? null,
        summary: `Viewed ${v.title}`,
        metadata: { path: v.path, ...(v.query && Object.keys(v.query).length ? { query: v.query } : {}) },
      });
    } else {
      res.locals.audited = true;
    }
    res.status(204).end();
  }),
);

auditRouter.use(requirePermission('audit.view'));

/** Correction entries (SUPER_ADMIN_ONLY_AUDIT_ACTIONS) are hidden from everyone except the Super Admin account. */
const hideRestricted = (req: Parameters<typeof authOf>[0]): boolean => !authOf(req).user.isSuperAdmin;

function filtersOf(q: ReturnType<typeof parseAuditQuery>, req: Parameters<typeof authOf>[0]): repo.AuditFilters {
  return {
    hideRestricted: hideRestricted(req),
    q: q.q || undefined,
    userId: q.userId,
    action: q.action,
    category: q.category,
    outcome: q.outcome,
    entityType: q.entityType,
    entityId: q.entityId || undefined,
    from: q.from,
    to: q.to,
  };
}

function parseAuditQuery(raw: unknown) {
  const q = parseQuery(zAuditQuery, raw);
  if (q.sort !== undefined && q.sort !== 'at') {
    throw validationError('Invalid query', { sort: 'Sort must be one of: at' });
  }
  if (q.from && q.to && q.from > q.to) throw validationError('Invalid query', { to: 'The end date is before the start date' });
  return q;
}

auditRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseAuditQuery(req.query);
    const { limit, offset } = limitOffset(q);
    const { items, total } = await repo.list(filtersOf(q, req), (q.order ?? 'desc') === 'asc' ? 'ASC' : 'DESC', limit, offset);
    res.json(toPage(items, total, q));
  }),
);

// Static paths are registered before '/:id'.
auditRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { from, to } = parseQuery(zAuditQuery.pick({ from: true, to: true }), req.query);
    res.json(await repo.summary(from, to, hideRestricted(req)));
  }),
);

const CSV_COLUMNS = [
  'ID',
  'Time (Asia/Karachi)',
  'User',
  'Email',
  'Action',
  'Category',
  'Outcome',
  'Entity type',
  'Entity ID',
  'Entity',
  'Summary',
  'Changes',
  'IP',
  'Request ID',
] as const;

/** One CSV cell: quoted, with formula-injection guard for Excel. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const fmtVal = (v: unknown): string => (v === null || v === undefined ? '(empty)' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const fmtChanges = (c: AuditChange[] | null): string =>
  c ? c.map((x) => `${x.field}: ${fmtVal(x.before)} -> ${fmtVal(x.after)}`).join('; ') : '';

const karachi = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
function karachiParts(d: Date): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of karachi.formatToParts(d)) o[p.type] = p.value;
  return o;
}

function csvRow(e: AuditEntry): string {
  const p = karachiParts(new Date(e.at));
  return (
    [
      e.id,
      `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`,
      e.userName,
      e.userEmail,
      e.action,
      e.category,
      e.outcome,
      e.entityType,
      e.entityId,
      e.entityLabel,
      e.summary,
      fmtChanges(e.changes),
      e.ip,
      e.requestId,
    ]
      .map(cell)
      .join(',') + '\r\n'
  );
}

function write(res: Response, chunk: string): Promise<void> {
  return res.write(chunk) ? Promise.resolve() : new Promise((resolve) => res.once('drain', () => resolve()));
}

auditRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const q = parseAuditQuery(req.query);
    const filters = filtersOf(q, req);
    const now = karachiParts(new Date());
    const name = `nacta-audit-${now.year}${now.month}${now.day}-${now.hour}${now.minute}.csv`;
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.write('﻿' + CSV_COLUMNS.map(cell).join(',') + '\r\n');
    let rows = 0;
    try {
      for await (const batch of repo.batches(filters, EXPORT_BATCH, EXPORT_MAX_ROWS)) {
        if (res.destroyed) return;
        await write(res, batch.map(csvRow).join(''));
        rows += batch.length;
      }
    } catch (err) {
      // Headers are already sent: abort the connection so the client sees a failed download, not a short file.
      res.destroy(err instanceof Error ? err : undefined);
      return;
    }
    const { page: _p, pageSize: _s, sort: _o, order: _d, ...shown } = q;
    const applied = Object.fromEntries(Object.entries(shown).filter(([, v]) => v !== undefined && v !== ''));
    audit(req, {
      action: 'audit.export',
      entityType: 'export',
      entityLabel: name,
      summary: `Exported the audit log (${rows} row${rows === 1 ? '' : 's'})`,
      metadata: { filters: applied, rowCount: rows, truncated: rows >= EXPORT_MAX_ROWS, fileName: name },
    });
    res.end();
  }),
);

auditRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const entry = await repo.find(idParam(req.params.id, 'Audit entry'), hideRestricted(req));
    if (!entry) throw notFound('Audit entry');
    res.json(entry);
  }),
);
