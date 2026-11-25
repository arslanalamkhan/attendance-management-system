import { endpoints, zAdmsRequest, zPage } from '@nacta/shared';
import type { AdmsLogQuery, AdmsRequest, Page } from '@nacta/shared';
import { api } from '../api';

/** GET /adms-log -> Page<AdmsRequest> (newest first) */
export const listAdmsLog = (query?: AdmsLogQuery, signal?: AbortSignal) =>
  api.get<Page<AdmsRequest>>(endpoints.admsLog(), { query, signal, schema: zPage(zAdmsRequest) });
