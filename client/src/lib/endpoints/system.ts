import { endpoints, zHealth, zOverview } from '@nacta/shared';
import type { Health, Overview } from '@nacta/shared';
import { api } from '../api';

/** GET /health */
export const getHealth = (signal?: AbortSignal) => api.get<Health>(endpoints.health(), { schema: zHealth, signal });

/** GET /overview */
export const getOverview = (signal?: AbortSignal) =>
  api.get<Overview>(endpoints.overview(), { schema: zOverview, signal });
