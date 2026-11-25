/** In-memory sliding-window limiter for login attempts, keyed by client IP. */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

const hits = new Map<string, number[]>();

/** Records an attempt. Returns null when allowed, otherwise the seconds until the oldest attempt leaves the window. */
export function recordLoginAttempt(ip: string, now = Date.now()): number | null {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    hits.set(ip, recent);
    return Math.max(1, Math.ceil((recent[0]! + WINDOW_MS - now) / 1000));
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return null;
}

/** Tests only. */
export function resetLoginRateLimit(): void {
  hits.clear();
}
