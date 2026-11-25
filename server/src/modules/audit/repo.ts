import { SUPER_ADMIN_ONLY_AUDIT_ACTIONS, type AuditChange, type AuditEntry } from '@nacta/shared';
import { pool } from '../../db/pool';
import { likeContains } from '../../lib/pagination';

export interface NewAuditRow {
  userId: number | null;
  userEmail: string | null;
  userName: string | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  action: string;
  category: string;
  outcome: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  changes: AuditChange[] | null;
  metadata: Record<string, unknown> | null;
}

export async function insert(r: NewAuditRow): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (user_id, user_email, user_name, session_id, ip, user_agent, request_id, action, category,
                             outcome, entity_type, entity_id, entity_label, summary, changes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb)`,
    [
      r.userId,
      r.userEmail,
      r.userName,
      r.sessionId,
      r.ip,
      r.userAgent,
      r.requestId,
      r.action,
      r.category,
      r.outcome,
      r.entityType,
      r.entityId,
      r.entityLabel,
      r.summary,
      r.changes ? JSON.stringify(r.changes) : null,
      r.metadata ? JSON.stringify(r.metadata) : null,
    ],
  );
}

export interface AuditFilters {
  q?: string;
  userId?: number;
  action?: string;
  category?: string;
  outcome?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  /** Hide SUPER_ADMIN_ONLY_AUDIT_ACTIONS (set for every caller who is not the Super Admin). */
  hideRestricted?: boolean;
}

/** The server's calendar (Pakistan). `from`/`to` are inclusive dates in this zone. */
const TZ = 'Asia/Karachi';

function where(f: AuditFilters, vals: unknown[]): string {
  const c: string[] = [];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    c.push(sql.replace('?', `$${vals.length}`));
  };
  if (f.q) {
    vals.push(likeContains(f.q));
    const p = `$${vals.length}`;
    c.push(`(summary ILIKE ${p} OR entity_label ILIKE ${p} OR user_email ILIKE ${p} OR user_name ILIKE ${p})`);
  }
  if (f.userId !== undefined) add('user_id = ?', f.userId);
  if (f.action) add('action = ?', f.action);
  if (f.category) add('category = ?', f.category);
  if (f.outcome) add('outcome = ?', f.outcome);
  if (f.entityType) add('entity_type = ?', f.entityType);
  if (f.entityId) add('entity_id = ?', f.entityId);
  if (f.from) add(`at >= (?::date::timestamp AT TIME ZONE '${TZ}')`, f.from);
  if (f.to) add(`at < ((?::date + 1)::timestamp AT TIME ZONE '${TZ}')`, f.to);
  if (f.hideRestricted) add('action <> ALL(?::text[])', [...SUPER_ADMIN_ONLY_AUDIT_ACTIONS]);
  return c.length ? `WHERE ${c.join(' AND ')}` : '';
}

interface Row {
  id: string;
  at: Date;
  user_id: number | null;
  user_email: string | null;
  user_name: string | null;
  session_id: string | null;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  action: string;
  category: string;
  outcome: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_label: string | null;
  summary: string;
  changes: AuditChange[] | null;
  metadata: Record<string, unknown> | null;
}

const COLS = `id, at, user_id, user_email, user_name, session_id, ip, user_agent, request_id, action, category, outcome,
  entity_type, entity_id, entity_label, summary, changes, metadata`;

export const toEntry = (r: Row): AuditEntry =>
  ({
    id: Number(r.id),
    at: r.at.toISOString(),
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    action: r.action,
    category: r.category,
    outcome: r.outcome,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    summary: r.summary,
    changes: r.changes,
    metadata: r.metadata,
    ip: r.ip,
    userAgent: r.user_agent,
    requestId: r.request_id,
  }) as AuditEntry;

export async function list(
  f: AuditFilters,
  order: 'ASC' | 'DESC',
  limit: number,
  offset: number,
): Promise<{ items: AuditEntry[]; total: number }> {
  const vals: unknown[] = [];
  const w = where(f, vals);
  const total = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM audit_logs ${w}`, vals);
  const { rows } = await pool.query<Row>(
    `SELECT ${COLS} FROM audit_logs ${w} ORDER BY at ${order}, id ${order} LIMIT ${limit} OFFSET ${offset}`,
    vals,
  );
  return { items: rows.map(toEntry), total: Number(total.rows[0]?.n ?? 0) };
}

export async function find(id: number, hideRestricted = false): Promise<AuditEntry | null> {
  const { rows } = await pool.query<Row>(
    `SELECT ${COLS} FROM audit_logs WHERE id = $1 ${hideRestricted ? 'AND action <> ALL($2::text[])' : ''}`,
    hideRestricted ? [id, [...SUPER_ADMIN_ONLY_AUDIT_ACTIONS]] : [id],
  );
  return rows[0] ? toEntry(rows[0]) : null;
}

/** Keyset-paged batches (newest first) so exports never hold more than one batch in memory. */
export async function* batches(f: AuditFilters, batchSize: number, maxRows: number): AsyncGenerator<AuditEntry[]> {
  let remaining = maxRows;
  let cursor: { at: string; id: string } | null = null; // t as text keeps microsecond precision
  while (remaining > 0) {
    const vals: unknown[] = [];
    let w = where(f, vals);
    if (cursor) {
      vals.push(cursor.at, cursor.id);
      const k = `(at, id) < ($${vals.length - 1}::timestamptz, $${vals.length}::bigint)`;
      w = w ? `${w} AND ${k}` : `WHERE ${k}`;
    }
    const take = Math.min(batchSize, remaining);
    const { rows } = await pool.query<Row & { at_text: string }>(
      `SELECT ${COLS}, at::text AS at_text FROM audit_logs ${w} ORDER BY at DESC, id DESC LIMIT ${take}`,
      vals,
    );
    if (!rows.length) return;
    yield rows.map(toEntry);
    remaining -= rows.length;
    const last = rows[rows.length - 1] as Row & { at_text: string };
    cursor = { at: last.at_text, id: last.id };
    if (rows.length < take) return;
  }
}

export async function count(f: AuditFilters): Promise<number> {
  const vals: unknown[] = [];
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM audit_logs ${where(f, vals)}`, vals);
  return Number(rows[0]?.n ?? 0);
}

export interface SummaryRow {
  total: number;
  signIns: number;
  failedSignIns: number;
  changes: number;
  exports: number;
  denied: number;
  activeUsers: number;
}

export async function summary(from: string | undefined, to: string | undefined, hideRestricted = false): Promise<SummaryRow> {
  const { rows } = await pool.query<Record<string, string>>(
    `WITH r AS (
       SELECT (COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date - 6)::timestamp AT TIME ZONE '${TZ}') AS lo,
              ((COALESCE($2::date, (now() AT TIME ZONE '${TZ}')::date) + 1)::timestamp AT TIME ZONE '${TZ}') AS hi
     )
     SELECT count(*) AS total,
            count(*) FILTER (WHERE a.action = 'auth.login') AS sign_ins,
            count(*) FILTER (WHERE a.action = 'auth.login_failed') AS failed_sign_ins,
            count(*) FILTER (WHERE a.category IN ('create', 'update', 'delete')) AS changes,
            count(*) FILTER (WHERE a.category = 'export') AS exports,
            count(*) FILTER (WHERE a.outcome = 'denied') AS denied,
            count(DISTINCT a.user_id) AS active_users
     FROM audit_logs a, r WHERE a.at >= r.lo AND a.at < r.hi
       AND ($3::boolean IS NOT TRUE OR a.action <> ALL($4::text[]))`,
    [from ?? null, to ?? null, hideRestricted, [...SUPER_ADMIN_ONLY_AUDIT_ACTIONS]],
  );
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    total: n('total'),
    signIns: n('sign_ins'),
    failedSignIns: n('failed_sign_ins'),
    changes: n('changes'),
    exports: n('exports'),
    denied: n('denied'),
    activeUsers: n('active_users'),
  };
}


