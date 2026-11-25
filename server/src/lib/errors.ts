import { ErrorCode } from '@nacta/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    /** Set when the error hides a resource outside the caller's wing scope; the error handler audits it as access.denied. */
    public readonly deniedReason?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(404, ErrorCode.NOT_FOUND, `${what} not found`);

/** 404 for a resource that exists but is outside the caller's wing scope (indistinguishable to the client, audited as denied). */
export const outOfScope = (what: string) =>
  new AppError(404, ErrorCode.NOT_FOUND, `${what} not found`, undefined, `${what} is outside the caller's wing scope`);

export const validationError = (message: string, details: Record<string, string>) =>
  new AppError(400, ErrorCode.VALIDATION_ERROR, message, details);

/** Postgres error code carried by a pg DatabaseError. */
export const pgCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string'
    ? (err as { code: string }).code
    : undefined;

export const MAX_INT = 2147483647;

