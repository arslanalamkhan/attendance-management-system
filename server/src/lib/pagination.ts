import type { Page, PageQuery } from '@nacta/shared';
import { validationError } from './errors';

/** Builds the ORDER BY body for a direction ('ASC' | 'DESC'). Every column expression is a fixed, trusted SQL string. */
export type SortExpr = (dir: 'ASC' | 'DESC') => string;

/** Plain column: `col <dir>, tiebreak <dir>`. */
export const byColumn =
  (col: string, tiebreak?: string, nullsLast = false): SortExpr =>
  (dir) =>
    `${col} ${dir}${nullsLast ? ' NULLS LAST' : ''}${tiebreak ? `, ${tiebreak} ${dir}` : ''}`;

/** Digit strings sorted by numeric value (PINs, employee codes); anything non-numeric sorts after, by text. */
export const byNumericText =
  (col: string, tiebreak?: string): SortExpr =>
  (dir) =>
    `(CASE WHEN ${col} ~ '^[0-9]{1,18}$' THEN ${col}::bigint END) ${dir} NULLS LAST, ${col} ${dir}${
      tiebreak ? `, ${tiebreak} ${dir}` : ''
    }`;

export interface SortConfig {
  /** Allow-list: API sort key -> SQL expression builder. */
  keys: Record<string, SortExpr>;
  defaultKey: string;
  defaultOrder: 'asc' | 'desc';
}

export function orderBy(query: Pick<PageQuery, 'sort' | 'order'>, cfg: SortConfig): string {
  const key = query.sort ?? cfg.defaultKey;
  const build = Object.hasOwn(cfg.keys, key) ? cfg.keys[key] : undefined;
  if (!build) {
    throw validationError('Invalid query', { sort: `Sort must be one of: ${Object.keys(cfg.keys).join(', ')}` });
  }
  // Sort direction defaults to the configured one only when the default key is used.
  const order = query.order ?? (query.sort === undefined || query.sort === cfg.defaultKey ? cfg.defaultOrder : 'asc');
  return build(order === 'desc' ? 'DESC' : 'ASC');
}

export function limitOffset(query: Pick<PageQuery, 'page' | 'pageSize'>): { limit: number; offset: number } {
  return { limit: query.pageSize, offset: Math.min((query.page - 1) * query.pageSize, Number.MAX_SAFE_INTEGER) };
}

export function toPage<T>(items: T[], total: number, query: Pick<PageQuery, 'page' | 'pageSize'>): Page<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Escape `%`, `_` and `\` so user text is matched literally by ILIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
export const likeContains = (s: string) => `%${escapeLike(s)}%`;
