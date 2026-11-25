/** True when `YYYY-MM-DD` is a real calendar date (the shared zDate schema only checks the shape). */
export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// ---------- calendar-date arithmetic on "YYYY-MM-DD" strings (no timezone involved) ----------

const toUtc = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (s: string, n: number): string => fromUtc(toUtc(s) + n * 86_400_000);
/** Whole days from a to b (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
/** 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (s: string): number => new Date(toUtc(s)).getUTCDay();
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---------- "now" in the server timezone ----------

/** All attendance dates and "today" are Pakistan time. */
export const SERVER_TZ = 'Asia/Karachi';

export interface LocalNow {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SERVER_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function localNowAt(d: Date): LocalNow {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

let clock: (() => Date) | null = null;
/** Tests pin the clock; pass null to restore the real one. */
export const setClock = (fn: (() => Date) | null): void => {
  clock = fn;
};
export const localNow = (): LocalNow => localNowAt(clock ? clock() : new Date());
export const todayLocal = (): string => localNow().date;
