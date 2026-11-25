import { z } from 'zod';
import { endpoints, zRole } from '@nacta/shared';
import type { Role, RoleInput } from '@nacta/shared';
import { api } from '../api';

/** GET /roles -> Role[] */
export const listRoles = (signal?: AbortSignal) => api.get<Role[]>(endpoints.roles(), { signal, schema: z.array(zRole) });

/** POST /roles -> 201 Role */
export const createRole = (input: RoleInput) => api.post<Role>(endpoints.roles(), input, { schema: zRole });

/** PUT /roles/:id -> Role */
export const updateRole = (id: number, input: RoleInput) => api.put<Role>(endpoints.role(id), input, { schema: zRole });

/** DELETE /roles/:id -> 204 (409 when users are assigned) */
export const deleteRole = (id: number) => api.delete(endpoints.role(id));
