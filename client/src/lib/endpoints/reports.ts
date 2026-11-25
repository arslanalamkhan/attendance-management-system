import { endpoints, zDashboard, zReportResult, zTodaySummary } from '@nacta/shared';
import type { TodaySummary, Dashboard, ExportFormat, ReportParams, ReportResult, ReportType } from '@nacta/shared';
import { api, downloadFile, toQueryString } from '../api';

/** GET /dashboard (dashboard.view) */
export const getDashboard = (signal?: AbortSignal) => api.get<Dashboard>(endpoints.dashboard(), { signal, schema: zDashboard });

/** GET /dashboard/today (any signed-in user, limited to their wings): the simple dashboard. */
export const getTodaySummary = (signal?: AbortSignal) => api.get<TodaySummary>(endpoints.dashboardToday(), { signal, schema: zTodaySummary });

/** GET /reports/:type (reports.<type>): one page of rows for the screen. */
export const getReport = (type: ReportType, query: ReportParams, signal?: AbortSignal) =>
  api.get<ReportResult>(endpoints.report(type), { query, signal, schema: zReportResult });

/** Params the file export understands: everything except the on-screen paging. */
export function exportParams(params: ReportParams): Omit<ReportParams, 'page' | 'pageSize'> {
  const { page: _page, pageSize: _pageSize, ...rest } = params;
  return rest;
}

/** GET /reports/:type/export?format=...&params (attendance.export, audited). Resolves to the saved file name. */
export const downloadReport = (type: ReportType, format: ExportFormat, params: ReportParams, fallbackName: string) =>
  downloadFile(`${endpoints.reportExport(type)}${toQueryString({ format, ...exportParams(params) })}`, fallbackName);
