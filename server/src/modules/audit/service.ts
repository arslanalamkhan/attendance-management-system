import type { Request } from 'express';
import { AUDIT_ACTIONS, type AuditAction, type AuditChange, type AuditEntityType, type AuditOutcome } from '@nacta/shared';
import { logger } from '../../lib/logger';
import * as repo from './repo';

export const REDACTED = '[redacted]';

/** Field / key names whose values are never stored (compared case-insensitively, ignoring "_" and "-"). */
const SENSITIVE_KEYS = new Set([
  'password',
  'temporarypassword',
  'devicepassword',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'csrf',
  'csrftoken',
  'xcsrftoken',
  'cookie',
  'setcookie',
  'authorization',
  'sessiontoken',
]);
const normKey = (k: string) => k.toLowerCase().replace(/[_\-\s]/g, '');
export const isSensitiveKey = (k: string): boolean => SENSITIVE_KEYS.has(normKey(k));
const HASH_LIKE = /^\$(argon2|2[aby]\$|pbkdf2|scrypt)/i;

/** Deep copy with every sensitive key (and anything that looks like a password hash) replaced by "[redacted]". */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as unknown as T;
  if (typeof value === 'string') return (HASH_LIKE.test(value) ? REDACTED : value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (value instanceof Date) return value.toISOString() as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

const norm = (v: unknown): unknown => (v === undefined ? null : v);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/**
 * Field-level changes between two objects, for the listed fields only and only where the value differs.
 * `labels` renames a field for display ("departmentName" -> "wing").
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  fields: readonly string[],
  labels: Record<string, string> = {},
): AuditChange[] {
  const out: AuditChange[] = [];
  for (const f of fields) {
    const b = norm(before?.[f]);
    const a = norm(after?.[f]);
    if (same(b, a)) continue;
    const field = labels[f] ?? f;
    out.push(isSensitiveKey(f) ? { field, before: REDACTED, after: REDACTED } : { field, before: b, after: a });
  }
  return out;
}

export interface AuditActor {
  id: number | null;
  email: string | null;
  name: string | null;
}

export interface AuditInput {
  action: AuditAction;
  outcome?: AuditOutcome;
  entityType?: AuditEntityType;
  entityId?: string | number;
  entityLabel?: string | null;
  summary: string;
  changes?: AuditChange[] | null;
  metadata?: Record<string, unknown> | null;
  /** For events that happen before a session exists (sign-in) or with no signed-in user (failed sign-in). */
  actor?: AuditActor | null;
  sessionId?: string | null;
}

const clip = (s: string | null | undefined, n: number): string | null => (s ? String(s).slice(0, n) : null);

const pending = new Set<Promise<void>>();

/** Resolves when every audit write started so far has finished (used by tests and graceful shutdown). */
export async function flushAudit(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

async function insertWithRetry(row: repo.NewAuditRow): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await repo.insert(row);
      return;
    } catch (err) {
      if (attempt === 3) {
        logger.error({ err, action: row.action, summary: row.summary }, '[audit] could not write audit entry');
        return;
      }
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}

/**
 * Record one audit entry. Never throws and never blocks the response: the insert runs in the background
 * (retried, errors logged). Fills user, session, IP, user agent and request id from `req` and marks the response
 * as audited so the generic api.write net stays quiet.
 */
export function audit(req: Request, input: AuditInput): void {
  try {
    if (req.res) req.res.locals.audited = true;
    const def = AUDIT_ACTIONS[input.action];
    const actor: AuditActor | null =
      input.actor !== undefined
        ? input.actor
        : req.auth
          ? { id: req.auth.user.id, email: req.auth.user.email, name: req.auth.user.name }
          : null;
    const row: repo.NewAuditRow = {
      userId: actor?.id ?? null,
      userEmail: actor?.email ?? null,
      userName: actor?.name ?? null,
      sessionId: input.sessionId !== undefined ? input.sessionId : (req.auth?.session.id ?? null),
      ip: req.ip ? req.ip.replace(/^::ffff:/i, '') : null,
      userAgent: clip(req.get('user-agent'), 400),
      requestId: req.id !== undefined ? clip(String(req.id), 128) : null,
      action: input.action,
      category: def.category,
      outcome: input.outcome ?? 'success',
      entityType: input.entityType ?? null,
      entityId: input.entityId !== undefined ? String(input.entityId) : null,
      entityLabel: clip(input.entityLabel, 300),
      summary: input.summary.slice(0, 1000),
      changes: input.changes && input.changes.length ? redact(input.changes) : null,
      metadata: input.metadata ? redact(input.metadata) : null,
    };
    const p = insertWithRetry(row)
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  } catch (err) {
    logger.error({ err }, '[audit] could not build audit entry');
  }
}

// ---------- per-key rate limits (in memory) ----------

class WindowGate {
  private readonly seen = new Map<string, number>();
  constructor(private readonly windowMs: number) {}
  /** True when `key` was not seen within the window (and records it now). */
  allow(key: string, now = Date.now()): boolean {
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.set(key, now);
    if (this.seen.size > 5000) {
      for (const [k, t] of this.seen) if (now - t >= this.windowMs) this.seen.delete(k);
    }
    return true;
  }
  clear(): void {
    this.seen.clear();
  }
}

const deniedGate = new WindowGate(60_000);
const viewGate = new WindowGate(60_000);
export const resetAuditGates = (): void => {
  deniedGate.clear();
  viewGate.clear();
};
/** True the first time per session + path within 60 seconds. */
export const allowView = (sessionId: string, path: string): boolean => viewGate.allow(`${sessionId}|${path}`);

/** "/api/v1/employees/12/x" -> "/employees/:id/x": ids are generalised so one route is one key. */
export function routeOf(req: Request): string {
  const p = (req.originalUrl.split('?')[0] ?? '').replace(/^\/api\/v1/, '');
  return p.replace(/\/\d+(?=\/|$)/g, '/:id').replace(/\/[0-9a-f]{64}(?=\/|$)/g, '/:session');
}

/** Log an access.denied entry, at most once per session per route per minute. */
export function auditDenied(req: Request, summary: string, metadata: Record<string, unknown>): void {
  if (req.res) req.res.locals.deniedLogged = true;
  const route = `${req.method} ${routeOf(req)}`;
  const who = req.auth?.session.id ?? `ip:${req.ip ?? ''}`;
  if (!deniedGate.allow(`${who}|${route}`)) {
    if (req.res) req.res.locals.audited = true; // still counts as handled: no api.write for a denied call
    return;
  }
  audit(req, { action: 'access.denied', outcome: 'denied', summary, metadata: { route, ...metadata } });
}

// ---------- readable summaries ----------

/** One value for a sentence: null -> "none", arrays comma-joined, long text clipped. */
export function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'none';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : 'none';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/** "wing Operations -> Admin; phone none -> 0300..." (first 4 changes, then "+N more"). */
export function changeSummary(changes: AuditChange[]): string {
  const parts = changes.slice(0, 4).map((c) =>
    c.before === REDACTED || c.after === REDACTED ? `${c.field} changed` : `${c.field} ${show(c.before)} -> ${show(c.after)}`,
  );
  if (changes.length > 4) parts.push(`+${changes.length - 4} more`);
  return parts.join('; ');
}

/** "777 · Arslan Alam Khan" */
export const employeeLabel = (e: { empCode: string; name: string }): string => `${e.empCode} · ${e.name}`;
export const userLabel = (u: { name: string; email: string }): string => `${u.name} (${u.email})`;
