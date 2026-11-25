import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { zNewPassword } from '@nacta/shared';
import { validationError } from '../../lib/errors';
import { isCommonPassword } from './common-passwords';

// argon2id, OWASP-recommended minimum parameters (19 MiB, 2 passes, 1 lane).
// (Algorithm is an ambient const enum, so its value is spelled out: Argon2id = 2.)
const ARGON2ID = 2 as Algorithm;
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/** Verify against a throw-away hash so an unknown email costs the same time as a wrong password. */
export async function burnVerifyTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-only');
  await verifyPassword(await dummyHash, password);
}

/** The part of the email before "@", lower-case. */
const localPart = (email: string): string => (email.split('@')[0] ?? '').toLowerCase();

/**
 * Server-side password rules beyond the shared zNewPassword shape: not a common password and does not contain the
 * email's local-part. Returns an error message or null.
 */
export function passwordProblem(password: string, email: string): string | null {
  const shape = zNewPassword.safeParse(password);
  if (!shape.success) return shape.error.issues[0]?.message ?? 'Invalid password';
  const lower = password.toLowerCase();
  const local = localPart(email);
  // Short local parts ("a", "jo") would block almost everything, so only check meaningful ones.
  if (local.length >= 3 && lower.includes(local)) return 'The password must not contain your email name';
  if (isCommonPassword(password)) return 'This password is too common. Choose a less guessable one';
  return null;
}

/** Throws a 400 VALIDATION_ERROR keyed by `field` when the password breaks a rule. */
export function assertPasswordPolicy(password: string, email: string, field: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw validationError('Invalid request body', { [field]: problem });
}
