import { z } from 'zod';

/** API base path. Every JSON endpoint lives under it. Device (ADMS) endpoints do not. */
export const API_BASE = '/api/v1';

/** ISO-8601 timestamp string with timezone, e.g. "2026-11-23T10:45:44.523Z". */
export const zIsoDateTime = z.string();
/** Calendar date "YYYY-MM-DD". */
export const zDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Not a real date');
/** Device-local wall clock "YYYY-MM-DD HH:mm:ss" (no timezone; as the terminal recorded it). */
export const zLocalDateTime = z.string();

export const zId = z.coerce.number().int().positive();

/** Trims; empty string becomes null. For optional text fields in forms. */
export const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

/** Query-string boolean: accepts true/false/1/0. */
export const zQueryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

// ---------- Errors ----------
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_DEVICE: 'DUPLICATE_DEVICE',
  DUPLICATE_EMP_CODE: 'DUPLICATE_EMP_CODE',
  DUPLICATE_DEPARTMENT: 'DUPLICATE_DEPARTMENT',
  DUPLICATE_WING: 'DUPLICATE_WING',
  DUPLICATE_SECTION: 'DUPLICATE_SECTION',
  NO_BIOMETRIC_BACKUP: 'NO_BIOMETRIC_BACKUP',
  TEMPLATE_INCOMPATIBLE: 'TEMPLATE_INCOMPATIBLE',
  LEAVE_OVERLAP: 'LEAVE_OVERLAP',
  DUPLICATE_LEAVE_TYPE: 'DUPLICATE_LEAVE_TYPE',
  PROFILE_IN_USE: 'PROFILE_IN_USE',
  NOT_ON_DEVICE: 'NOT_ON_DEVICE',
  IMPORT_EXPIRED: 'IMPORT_EXPIRED',
  INVALID_FILE: 'INVALID_FILE',
  EMP_CODE_ON_DEVICE: 'EMP_CODE_ON_DEVICE',
  DUPLICATE_ROLE: 'DUPLICATE_ROLE',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  CSRF_INVALID: 'CSRF_INVALID',
  PROTECTED_ACCOUNT: 'PROTECTED_ACCOUNT',
  PROTECTED_ROLE: 'PROTECTED_ROLE',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Error body for every non-2xx JSON response: `{ error: { code, message, details?, requestId? } }`.
 * For VALIDATION_ERROR, `details` is `Record<fieldName, message>` keyed by the camelCase input field.
 */
export const zErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorBody = z.infer<typeof zErrorBody>;

// ---------- Pagination / sorting ----------
export const MAX_PAGE_SIZE = 500;

export const zPageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  /** Column key from the endpoint's allowed sort list. */
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type PageQuery = z.infer<typeof zPageQuery>;

/** Paginated list response: `{ items, total, page, pageSize }`. */
export const zPage = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export const zQueued = z.object({ queued: z.number().int() });
export type Queued = z.infer<typeof zQueued>;
