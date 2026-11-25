import { Router } from 'express';
import { z } from 'zod';
import { REPORT_PERMISSIONS, REPORT_TYPES, reportPermission, zExportFormat, type ReportType } from '@nacta/shared';
import { notFound, validationError } from '../../lib/errors';
import { asyncHandler } from '../../lib/http';
import { parseQuery } from '../../lib/validate';
import { assertPermission, authOf, requirePermission } from '../../middleware/auth';
import { audit } from '../audit/service';
import { MAX_PDF_ROWS } from './common';
import { buildReport, exportFileName, isReportType, resolveParams, toResult } from './index';
import { buildPdf, PDF_MIME } from './pdf';
import type { ReportContext, ReportParams } from './types';
import { buildXlsx, XLSX_MIME } from './xlsx';

export const reportsRouter = Router();

const typeOf = (raw: string | undefined): ReportType => {
  if (!raw || !isReportType(raw)) throw notFound('Report');
  return raw;
};

// Every report is granted on its own (reports.<type>); the routes below first let anyone holding any report in.
const anyReport = requirePermission(...REPORT_PERMISSIONS);

/** The filters an export was run with, for the audit trail (only the parameters this report uses). */
function auditedFilters(type: ReportType, p: ReportParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys: string[] = [...REPORT_TYPES[type].params, ...(type === 'daily' ? ['q'] : type === 'punch_log' ? ['sectionId', 'q'] : [])];
  for (const key of keys) {
    const v = p[key as keyof ReportParams];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

reportsRouter.get(
  '/:type',
  anyReport,
  asyncHandler(async (req, res) => {
    const type = typeOf(req.params.type);
    assertPermission(req, reportPermission(type));
    const p = resolveParams(type, req.query);
    const a = authOf(req);
    const ctx: ReportContext = { scope: a.scope, isSuperAdmin: a.user.isSuperAdmin };
    res.set('Cache-Control', 'no-store');
    res.json(toResult(type, p, await buildReport(type, p, ctx, true)));
  }),
);

const zExportQuery = z.object({ format: zExportFormat });

reportsRouter.get(
  '/:type/export',
  anyReport,
  asyncHandler(async (req, res) => {
    const type = typeOf(req.params.type);
    assertPermission(req, reportPermission(type));
    assertPermission(req, 'attendance.export');
    const { format } = parseQuery(zExportQuery, req.query);
    const p = resolveParams(type, req.query);
    const a = authOf(req);
    const ctx: ReportContext = { scope: a.scope, isSuperAdmin: a.user.isSuperAdmin };
    const data = await buildReport(type, p, ctx, false);
    if (format === 'pdf' && data.total > MAX_PDF_ROWS) {
      throw validationError('This report is too large for a PDF', { format: `${data.total.toLocaleString('en-US')} rows; export Excel instead, or narrow the filters (PDF limit ${MAX_PDF_ROWS.toLocaleString('en-US')})` });
    }
    const gen = { name: a.user.name, at: new Date() };
    const file = format === 'xlsx' ? await buildXlsx(data, gen) : await buildPdf(data, gen);
    const fileName = exportFileName(data, format);

    audit(req, {
      action: 'attendance.export',
      entityType: 'export',
      entityLabel: fileName,
      summary: `Exported ${data.title} as ${format.toUpperCase()}: ${data.subtitle} (${data.total} ${data.total === 1 ? 'row' : 'rows'})`,
      metadata: { type, format, filters: auditedFilters(type, p), rowCount: data.total, fileName },
    });

    res.set({
      'Content-Type': format === 'xlsx' ? XLSX_MIME : PDF_MIME,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(file.length),
      'Cache-Control': 'no-store',
    });
    res.end(file);
  }),
);
