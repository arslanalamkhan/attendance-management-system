import { endpoints, zDashboard, zReportResult } from '@nacta/shared';
import type { Dashboard, ExportFormat, ReportParams, ReportResult, ReportType } from '@nacta/shared';
import { api, downloadFile, toQueryString } from '../api';

/** GET /dashboard (dashboard.view) */
export const getDashboard = (signal?: AbortSignal) => api.get<Dashboard>(endpoints.dashboard(), { signal, schema: zDashboard });

/** GET /reports/:type (attendance.view): one page of rows for the screen. */
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
