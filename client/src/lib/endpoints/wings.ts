import { z } from 'zod';
import { endpoints, zSection, zWing } from '@nacta/shared';
import type { Section, SectionInput, Wing, WingInput } from '@nacta/shared';
import { api } from '../api';

/** GET /wings -> Wing[] (each with its sections) */
export const listWings = (signal?: AbortSignal) => api.get<Wing[]>(endpoints.wings(), { signal, schema: z.array(zWing) });

/** POST /wings -> 201 Wing. 409 DUPLICATE_WING on name or code. */
export const createWing = (input: WingInput) => api.post<Wing>(endpoints.wings(), input, { schema: zWing });

/** PUT /wings/:id -> Wing */
export const updateWing = (id: number, input: WingInput) => api.put<Wing>(endpoints.wing(id), input, { schema: zWing });

/** DELETE /wings/:id -> 204. Employees keep their record; the wing is cleared. */
export const deleteWing = (id: number) => api.delete(endpoints.wing(id));

/** POST /wings/:id/sections -> 201 Section. 409 DUPLICATE_SECTION. */
export const createSection = (wingId: number, input: SectionInput) =>
  api.post<Section>(endpoints.wingSections(wingId), input, { schema: zSection });

/** PUT /sections/:id -> Section */
export const updateSection = (id: number, input: SectionInput) => api.put<Section>(endpoints.section(id), input, { schema: zSection });

/** DELETE /sections/:id -> 204 */
export const deleteSection = (id: number) => api.delete(endpoints.section(id));
