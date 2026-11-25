import { addDaysYmd, formatDate, isYmd, startOfMonthYmd, todayYmd } from '../../../lib/dates';

export type RangeKey = 'today' | '7d' | '30d' | 'month' | 'all' | 'custom';

export const DEFAULT_RANGE: RangeKey = '7d';

export const RANGE_PRESETS: { key: Exclude<RangeKey, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

export interface ResolvedRange {
  key: RangeKey;
  from?: string;
  to?: string;
}

const KEYS: readonly string[] = ['today', '7d', '30d', 'month', 'all', 'custom'];

/** URL params -> concrete calendar range. Presets are relative to today, so shared links stay meaningful. */
export function resolveRange(rangeParam: string | undefined, from: string | undefined, to: string | undefined, today: string = todayYmd()): ResolvedRange {
  const key = (rangeParam && KEYS.includes(rangeParam) ? rangeParam : DEFAULT_RANGE) as RangeKey;
  switch (key) {
    case 'today':
      return { key, from: today, to: today };
    case '7d':
      return { key, from: addDaysYmd(today, -6), to: today };
    case '30d':
      return { key, from: addDaysYmd(today, -29), to: today };
    case 'month':
      return { key, from: startOfMonthYmd(today), to: today };
    case 'all':
      return { key };
    case 'custom': {
      const f = isYmd(from) ? from : undefined;
      const t = isYmd(to) ? to : undefined;
      if (!f && !t) return resolveRange(undefined, undefined, undefined, today);
      return f && t && f > t ? { key, from: t, to: f } : { key, from: f, to: t };
    }
  }
}

export function rangeLabel(r: ResolvedRange): string {
  if (r.key !== 'custom') return RANGE_PRESETS.find((p) => p.key === r.key)?.label ?? '';
  if (r.from && r.to) return r.from === r.to ? formatDate(r.from) : `${formatDate(r.from)} - ${formatDate(r.to)}`;
  return r.from ? `From ${formatDate(r.from)}` : `Until ${formatDate(r.to)}`;
}
