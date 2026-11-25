import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryKey, UseMutationResult } from '@tanstack/react-query';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { API_BASE, ErrorCode, endpoints, zErrorBody } from '@nacta/shared';
import { sessionBridge } from './session-bridge';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Every non-2xx response, network failure and (in dev) contract mismatch becomes an ApiError. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(init: { status: number; code: string; message: string; details?: unknown; requestId?: string }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  get isValidation(): boolean {
    return this.code === ErrorCode.VALIDATION_ERROR;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** VALIDATION_ERROR details as a `fieldName -> message` map (empty for other errors). */
  get fieldErrors(): Record<string, string> {
    return toFieldErrors(this.details);
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Best human message for any thrown value. */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

function toFieldErrors(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!details || typeof details !== 'object') return out;
  if (Array.isArray(details)) {
    for (const item of details) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const field = o.field ?? o.path;
        const msg = o.message;
        if (typeof field === 'string' && typeof msg === 'string') out[field] = msg;
      }
    }
    return out;
  }
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Request core
// ---------------------------------------------------------------------------

export type QueryParams = object;

export function toQueryString(params: QueryParams | undefined): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** A zod schema whose parsed output is T (input may differ). */
export type ResponseSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: QueryParams;
  body?: unknown;
  signal?: AbortSignal;
  /** Parsed against the response in dev builds; mismatches throw `CONTRACT_MISMATCH`. */
  schema?: ResponseSchema<T>;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

const DEV = import.meta.env.DEV;

/** /auth/me, /auth/login and /auth/logout answer 401 as part of normal operation. */
function isAuthEntryPath(path: string): boolean {
  return path === endpoints.authMe() || path === endpoints.authLogin() || path === endpoints.authLogout();
}

export async function request<T>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', query, body, signal, schema, headers: extraHeaders } = opts;
  const url = `${API_BASE}${path}${toQueryString(query)}`;

  const csrf = method !== 'GET' ? sessionBridge.getCsrfToken() : null;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        // multipart bodies get their boundary from the browser: never set Content-Type for FormData
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(extraHeaders ?? {}),
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' });
  }

  const requestId = res.headers.get('x-request-id') ?? undefined;
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
  }

  if (!res.ok) {
    const parsed = zErrorBody.safeParse(data);
    if (parsed.success) {
      const { code, message, details, requestId: bodyRequestId } = parsed.data.error;
      // Session lost (expired, revoked, signed out elsewhere): hand over to the AuthProvider.
      // Credential errors on the auth endpoints themselves are ordinary form errors.
      if (res.status === 401 && code !== ErrorCode.INVALID_CREDENTIALS && !isAuthEntryPath(path)) {
        sessionBridge.notifyUnauthenticated();
      } else if (res.status === 403 && code === ErrorCode.PASSWORD_CHANGE_REQUIRED) {
        sessionBridge.notifyPasswordChangeRequired();
      }
      throw new ApiError({ status: res.status, code, message, details, requestId: bodyRequestId ?? requestId });
    }
    if (res.status === 401 && !isAuthEntryPath(path)) sessionBridge.notifyUnauthenticated();
    throw new ApiError({
      status: res.status,
      code: res.status === 404 ? ErrorCode.NOT_FOUND : 'HTTP_ERROR',
      message: res.status === 404 ? 'The server does not have this endpoint yet.' : `Request failed (${res.status})`,
      requestId,
    });
  }

  if (DEV && schema) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      console.error(`[api] ${method} ${path} response does not match the shared contract`, parsed.error.issues);
      throw new ApiError({
        status: res.status,
        code: 'CONTRACT_MISMATCH',
        message: `Response from ${method} ${path} does not match the shared contract (see console).`,
        details: parsed.error.issues,
        requestId,
      });
    }
    return parsed.data;
  }
  return data as T;
}

type BodylessOptions<T> = Omit<RequestOptions<T>, 'method' | 'body'>;
type BodyOptions<T> = Omit<RequestOptions<T>, 'method' | 'body'>;

export const api = {
  get: <T>(path: string, opts?: BodylessOptions<T>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: BodyOptions<T>) => request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: BodyOptions<T>) => request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: BodyOptions<T>) => request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T = void>(path: string, opts?: BodylessOptions<T>) => request<T>(path, { ...opts, method: 'DELETE' }),
};

/** POST multipart/form-data (file uploads) with the CSRF header; errors map to ApiError like every other call. */
export const postMultipart = <T>(path: string, form: FormData, opts?: BodyOptions<T>) => request<T>(path, { ...opts, method: 'POST', body: form });

/** PUT multipart/form-data (e.g. photo replace). */
export const putMultipart = <T>(path: string, form: FormData, opts?: BodyOptions<T>) => request<T>(path, { ...opts, method: 'PUT', body: form });

/**
 * GET a binary file (e.g. an .xlsx export) and hand it to the browser as a download.
 * `path` may include a query string. Returns the file name that was used.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError({ status: 0, code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' });
  }
  if (!res.ok) {
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = undefined;
    }
    const parsed = zErrorBody.safeParse(data);
    if (res.status === 401) sessionBridge.notifyUnauthenticated();
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError({ status: res.status, code, message, details });
    }
    throw new ApiError({
      status: res.status,
      code: res.status === 404 ? ErrorCode.NOT_FOUND : 'HTTP_ERROR',
      message: res.status === 404 ? 'The server does not have this endpoint yet.' : `Download failed (${res.status})`,
    });
  }
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface UseApiMutationOptions<TData, TVars, TForm extends FieldValues> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Server VALIDATION_ERROR details are mapped onto this form's fields. */
  form?: UseFormReturn<TForm>;
  /** Success toast. `false` disables it. */
  successMessage?: string | false | ((data: TData, vars: TVars) => string);
  /** Fallback error toast title (the server message is used as description). */
  errorMessage?: string;
  /** Set false when the caller renders the error itself (e.g. inline on the sign-in card). */
  toastErrors?: boolean;
  /** Query keys (prefix match) invalidated after success. */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void | Promise<void>;
  onError?: (error: ApiError, vars: TVars) => void;
}

/**
 * Mutation helper: toasts, query invalidation and form-field error mapping in one place.
 * Use for every write so error handling is consistent across the product.
 */
export function useApiMutation<TData, TVars = void, TForm extends FieldValues = FieldValues>(
  options: UseApiMutationOptions<TData, TVars, TForm>,
): UseMutationResult<TData, ApiError, TVars> {
  const qc = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: async (vars) => {
      try {
        return await options.mutationFn(vars);
      } catch (e) {
        throw e instanceof ApiError
          ? e
          : new ApiError({ status: 0, code: 'CLIENT', message: errorMessage(e) });
      }
    },
    onSuccess: async (data, vars) => {
      if (options.invalidate?.length) {
        await Promise.all(options.invalidate.map((queryKey) => qc.invalidateQueries({ queryKey })));
      }
      const msg = options.successMessage;
      if (typeof msg === 'string') toast.success(msg);
      else if (typeof msg === 'function') toast.success(msg(data, vars));
      await options.onSuccess?.(data, vars);
    },
    onError: (error, vars) => {
      const fields = error.isValidation ? error.fieldErrors : {};
      const names = Object.keys(fields);
      if (options.toastErrors === false) {
        if (options.form && names.length > 0) {
          for (const name of names) options.form.setError(name as FieldPath<TForm>, { type: 'server', message: fields[name] });
        }
      } else if (options.form && names.length > 0) {
        let first = true;
        for (const name of names) {
          options.form.setError(
            name as FieldPath<TForm>,
            { type: 'server', message: fields[name] },
            { shouldFocus: first },
          );
          first = false;
        }
        toast.error('Please correct the highlighted fields');
      } else if (error.isValidation && names.length > 0) {
        toast.error(options.errorMessage ?? 'Some values are invalid', {
          description: names.map((n) => `${n}: ${fields[n]}`).join(' · '),
        });
      } else {
        toast.error(options.errorMessage ?? error.message, {
          description: options.errorMessage ? error.message : undefined,
        });
      }
      options.onError?.(error, vars);
    },
  });
}
