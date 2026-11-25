import type { WingScope } from '@nacta/shared';

/**
 * SQL condition limiting `column` (a wing id, possibly NULL) to the caller's wing scope.
 * Returns null for "all" (no restriction). Rows whose column is NULL are never inside a limited scope.
 * Pushes the id list onto `vals` and references it by position.
 */
export function scopeClause(scope: WingScope, column: string, vals: unknown[]): string | null {
  if (scope === 'all') return null;
  vals.push(scope);
  return `${column} = ANY($${vals.length}::int[])`;
}

/** True when `wingId` is a wing the scope allows (null = "no wing" is only allowed for "all"). */
export function inScope(scope: WingScope, wingId: number | null): boolean {
  if (scope === 'all') return true;
  return wingId !== null && scope.includes(wingId);
}
