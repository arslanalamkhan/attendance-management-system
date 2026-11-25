import type { Wing } from '@nacta/shared';
import { ORG_UNIT } from './terms';

/** "All wings", "3 wings" or the names when they are known and short. */
export function describeWings(allWings: boolean, wingIds: number[], wings?: Pick<Wing, 'id' | 'name'>[]): string {
  if (allWings) return `All ${ORG_UNIT.lowerPlural}`;
  const names = wingIds.map((id) => wings?.find((d) => d.id === id)?.name).filter((n): n is string => Boolean(n));
  if (names.length === wingIds.length && names.length > 0 && names.length <= 2) return names.join(', ');
  return `${wingIds.length} ${wingIds.length === 1 ? ORG_UNIT.lower : ORG_UNIT.lowerPlural}`;
}
