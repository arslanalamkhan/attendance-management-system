import { PASSWORD_MIN_LENGTH, zNewPassword } from '@nacta/shared';

const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l, o
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const DIGITS = '23456789'; // no 0, 1
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** Uniform random integer in [0, max) without modulo bias. */
function randomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while ((buf[0] as number) >= limit);
  return (buf[0] as number) % max;
}

const pick = (set: string) => set[randomInt(set.length)] as string;

/** Cryptographically random password that satisfies the shared policy (readable: no 0/O/1/l/I). */
export function generateStrongPassword(length = 16): string {
  const len = Math.max(length, PASSWORD_MIN_LENGTH);
  for (let attempt = 0; attempt < 20; attempt++) {
    const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
    while (chars.length < len) chars.push(pick(ALL));
    // Fisher-Yates shuffle so the guaranteed characters are not always first.
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
    }
    const candidate = chars.join('');
    if (zNewPassword.safeParse(candidate).success) return candidate;
  }
  throw new Error('Could not generate a password');
}

export interface PasswordRule {
  message: string;
  met: boolean;
}

/** The rule messages of zNewPassword, in order, discovered by validating an empty string (every rule fails). */
const RULE_MESSAGES: string[] = (() => {
  const r = zNewPassword.safeParse('');
  return r.success ? [] : Array.from(new Set(r.error.issues.map((i) => i.message)));
})();

/** Live checklist derived from the shared zod schema, so the UI can never drift from the policy. */
export function evaluatePassword(password: string): PasswordRule[] {
  const failing = new Set<string>();
  const r = zNewPassword.safeParse(password);
  if (!r.success) for (const i of r.error.issues) failing.add(i.message);
  return RULE_MESSAGES.map((message) => ({ message, met: !failing.has(message) }));
}
