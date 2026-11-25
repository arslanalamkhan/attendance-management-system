import { z } from 'zod';
import { endpoints, zAppUser, zPage } from '@nacta/shared';
import type { AppUser, Page, ResetPasswordInput, UserCreateInput, UserListQuery, UserUpdateInput } from '@nacta/shared';
import { api } from '../api';

/** GET /users -> Page<AppUser> */
export const listUsers = (query?: UserListQuery, signal?: AbortSignal) =>
  api.get<Page<AppUser>>(endpoints.users(), { query, signal, schema: zPage(zAppUser) });

/** GET /users/:id -> AppUser */
export const getUser = (id: number, signal?: AbortSignal) => api.get<AppUser>(endpoints.user(id), { signal, schema: zAppUser });

/** POST /users -> 201 AppUser */
export const createUser = (input: UserCreateInput) => api.post<AppUser>(endpoints.users(), input, { schema: zAppUser });

/** PUT /users/:id -> AppUser */
export const updateUser = (id: number, input: UserUpdateInput) => api.put<AppUser>(endpoints.user(id), input, { schema: zAppUser });

/** DELETE /users/:id -> 204 */
export const deleteUser = (id: number) => api.delete(endpoints.user(id));

/** POST /users/:id/reset-password -> 204 */
export const resetUserPassword = (id: number, input: ResetPasswordInput) =>
  api.post<void>(endpoints.userResetPassword(id), input);

/** POST /users/:id/revoke-sessions -> { revoked } */
export const revokeUserSessions = (id: number) =>
  api.post<{ revoked: number }>(endpoints.userRevokeSessions(id), undefined, { schema: z.object({ revoked: z.number() }) });

/** POST /users/:id/unlock -> AppUser */
export const unlockUser = (id: number) => api.post<AppUser>(endpoints.userUnlock(id), undefined, { schema: zAppUser });
