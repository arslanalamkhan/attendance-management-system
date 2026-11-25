import type { Dashboard } from '@nacta/shared';

export type SeriesKey = 'present' | 'late' | 'leave' | 'absent' | 'pending';

/** One visual language for the five "today" buckets, shared by the KPI tiles and the wing bars. */
export const SERIES: { key: SeriesKey; label: string; bar: string; dot: string }[] = [
  { key: 'present', label: 'Present', bar: 'bg-success', dot: 'bg-success' },
  { key: 'late', label: 'Late', bar: 'bg-warning', dot: 'bg-warning' },
  { key: 'leave', label: 'On leave', bar: 'bg-info', dot: 'bg-info' },
  { key: 'absent', label: 'Absent', bar: 'bg-danger', dot: 'bg-danger' },
  { key: 'pending', label: 'Not in yet', bar: 'bg-muted-foreground/30', dot: 'bg-muted-foreground/50' },
];

export type TodayCounts = Record<SeriesKey, number> & { headcount: number };

/** Today's counts for everyone in scope, or for one wing (the contract has no wing parameter, so the wing rows are summed). */
export function todayCounts(d: Dashboard, wingKey: string | null): TodayCounts {
  const rows = wingKey !== null ? d.byWing.filter((x) => String(x.wingId) === wingKey) : d.byWing;
  if (rows.length > 0) {
    // Summed from the wing rows so the tiles always agree with the wing bars (and with a wing filter).
    const sum = (f: (w: (typeof rows)[number]) => number) => rows.reduce((s, w) => s + f(w), 0);
    return { present: sum((w) => w.present), late: sum((w) => w.late), leave: sum((w) => w.onLeave), absent: sum((w) => w.absent), pending: sum((w) => w.pending), headcount: wingKey !== null ? sum((w) => w.headcount) : d.headcount };
  }
  return {
    present: d.today.present ?? 0,
    late: d.today.late ?? 0,
    leave: d.today.leave ?? 0,
    absent: d.today.absent ?? 0,
    pending: d.today.pending ?? 0,
    headcount: d.headcount,
  };
}

/** Daily attendance filtered by status (and wing). */
export function dailyHref(status?: SeriesKey, wingId?: number | null): string {
  const sp = new URLSearchParams();
  if (status) sp.set('status', status);
  if (wingId) sp.set('wingId', String(wingId));
  const q = sp.toString();
  return `/attendance/daily${q ? `?${q}` : ''}`;
}

/** "09:14:22" out of "2026-11-24 09:14:22", an ISO stamp or a bare time. */
export function clockOf(stamp: string): string {
  const m = /(\d{2}:\d{2}(?::\d{2})?)/.exec(stamp);
  return m?.[1] ?? stamp;
}

export const sharePct = (n: number, total: number): number => (total > 0 ? Math.round((n / total) * 100) : 0);
