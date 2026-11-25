export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function absoluteTime(iso: string | null): string {
  if (!iso) return 'Never seen';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

const VERIFY: Record<number, string> = { 1: 'Fingerprint', 3: 'Password', 4: 'Card', 15: 'Face' };
const PUNCH: Record<number, string> = {
  0: 'Check-in',
  1: 'Check-out',
  2: 'Break-out',
  3: 'Break-in',
  4: 'OT-in',
  5: 'OT-out',
};

export const verifyLabel = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : (VERIFY[v] ?? String(v));
export const punchLabel = (v: number | null | undefined): string =>
  v === null || v === undefined ? '-' : (PUNCH[v] ?? String(v));
