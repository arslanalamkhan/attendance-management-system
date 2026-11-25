import type { z } from 'zod';
import { ErrorCode } from '@nacta/shared';
import { AppError } from './errors';

/** `{ field: firstMessage }`, keyed by the camelCase input field (first path segment; `_` for the body itself). */
export function zodDetails(error: z.ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    if (!(key in details)) details[key] = issue.message;
  }
  return details;
}

export function parseWith<S extends z.ZodTypeAny>(schema: S, data: unknown, what: string): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, `Invalid ${what}`, zodDetails(result.error));
  }
  return result.data;
}

export const parseBody = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> =>
  parseWith(schema, body ?? {}, 'request body');

/** Query strings: empty values (`?q=&from=`) are treated as absent. */
export function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.output<S> {
  const cleaned: Record<string, unknown> = {};
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v === '') continue;
      cleaned[k] = v;
    }
  }
  return parseWith(schema, cleaned, 'query');
}
