/** Calendar-date helpers. Dates are "YYYY-MM-DD" strings in local time (the device clock's wall time). */

const pad = (n: number) => String(n).padStart(2, '0');

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const todayYmd = (): string => toYmd(new Date());

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function isYmd(s: string | undefined): s is string {
  return Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
}

export function addDaysYmd(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return toYmd(d);
}

/** Monday of the week containing `s`. */
export function startOfWeekYmd(s: string): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toYmd(d);
}

export function startOfMonthYmd(s: string): string {
  const d = parseYmd(s);
  return toYmd(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonthYmd(s: string): string {
  const d = parseYmd(s);
  return toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function addMonthsYmd(s: string, n: number): string {
  const d = parseYmd(s);
  return toYmd(new Date(d.getFullYear(), d.getMonth() + n, 1));
}

/** "23 Nov 2026" */
export function formatDate(s: string | null | undefined): string {
  if (!isYmd(s ?? undefined)) return s ?? '-';
  return parseYmd(s as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "November 2026" */
export function formatMonth(s: string): string {
  return parseYmd(s).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** Splits a device-local "YYYY-MM-DD HH:mm:ss" stamp. */
export function splitPunch(punchTime: string): { date: string; time: string } {
  const [date = '', time = ''] = punchTime.split(' ');
  return { date, time };
}

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month';

export function rangeForPreset(preset: RangePreset, today: string = todayYmd()): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDaysYmd(today, -1);
      return { from: y, to: y };
    }
    case 'week':
      return { from: startOfWeekYmd(today), to: today };
    case 'month':
      return { from: startOfMonthYmd(today), to: today };
  }
}
