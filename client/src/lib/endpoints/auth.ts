import { z } from 'zod';
import { endpoints, zSessionInfo, zSessionSummary } from '@nacta/shared';
import type { ChangePasswordInput, LoginInput, SessionInfo, SessionSummary } from '@nacta/shared';
import { api } from '../api';

/** GET /auth/me -> SessionInfo (401 when signed out) */
export const getMe = (signal?: AbortSignal) => api.get<SessionInfo>(endpoints.authMe(), { signal, schema: zSessionInfo });

/**
 * Background permission check (focus / every 5 min). The header tells the server NOT to count it as activity,
 * so a forgotten open tab still reaches the idle timeout.
 */
export const getMeQuietly = () =>
  api.get<SessionInfo>(endpoints.authMe(), { schema: zSessionInfo, headers: { 'X-Background-Refresh': '1' } });

/** POST /auth/login -> SessionInfo */
export const login = (input: LoginInput) => api.post<SessionInfo>(endpoints.authLogin(), input, { schema: zSessionInfo });

/** POST /auth/logout -> 204 */
export const logout = () => api.post<void>(endpoints.authLogout());

/** POST /auth/change-password -> SessionInfo */
export const changePassword = (input: ChangePasswordInput) =>
  api.post<SessionInfo>(endpoints.authChangePassword(), input, { schema: zSessionInfo });

/** GET /auth/sessions -> SessionSummary[] */
export const listSessions = (signal?: AbortSignal) =>
  api.get<SessionSummary[]>(endpoints.authSessions(), { signal, schema: z.array(zSessionSummary) });

/** DELETE /auth/sessions/:id -> 204 */
export const revokeSession = (id: string) => api.delete(endpoints.authSession(id));

/** POST /auth/sessions/revoke-others -> { revoked } */
export const revokeOtherSessions = () =>
  api.post<{ revoked: number }>(endpoints.authRevokeOthers(), undefined, { schema: z.object({ revoked: z.number() }) });
