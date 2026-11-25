import * as React from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import type { ExportFormat, ReportParams, ReportType } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { downloadReport } from '../../lib/endpoints/reports';
import { exportFileName } from '../../lib/report-ui';
import { useAuth } from '../../lib/auth';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Tooltip } from '../ui/tooltip';

const NO_PERMISSION = "You don't have permission to download exports";

/** Download a report as xlsx or pdf with the given parameters. Success shows the saved file name in a toast. */
export function useReportExport(type: ReportType, params: ReportParams) {
  const mutation = useApiMutation<string, ExportFormat>({
    mutationFn: (format) => downloadReport(type, format, params, exportFileName(type, params, format)),
    successMessage: (name) => `Downloaded ${name}`,
    errorMessage: 'The export could not be created',
  });
  const busy = mutation.isPending ? (mutation.variables ?? null) : null;
  return { run: (format: ExportFormat) => mutation.mutate(format), busy };
}

/** A control the user may not use: disabled, but focusable so the reason is reachable by keyboard. */
function Disabled({ reason, children }: { reason: string; children: React.ReactNode }) {
  return (
    <Tooltip content={reason} side="bottom">
      <span tabIndex={0} role="group" aria-label={reason} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </span>
    </Tooltip>
  );
}

export interface ExportControlProps {
  type: ReportType;
  params: ReportParams;
  /** Disable with a reason (for example while a required parameter is missing). */
  blocked?: string;
  size?: 'sm' | 'md';
}

/** "Download Excel" and "Download PDF", gated by attendance.export. */
export function ReportExportButtons({ type, params, blocked, size = 'md' }: ExportControlProps) {
  const { can } = useAuth();
  const { run, busy } = useReportExport(type, params);
  const allowed = can('attendance.export');
  const buttons = (
    <>
      <Button variant="secondary" size={size} disabled={!allowed || Boolean(blocked) || busy !== null} loading={busy === 'xlsx'} onClick={() => run('xlsx')}>
        {busy !== 'xlsx' && <FileSpreadsheet aria-hidden="true" />}
        {busy === 'xlsx' ? 'Preparing Excel...' : 'Download Excel'}
      </Button>
      <Button variant="secondary" size={size} disabled={!allowed || Boolean(blocked) || busy !== null} loading={busy === 'pdf'} onClick={() => run('pdf')}>
        {busy !== 'pdf' && <FileText aria-hidden="true" />}
        {busy === 'pdf' ? 'Preparing PDF...' : 'Download PDF'}
      </Button>
    </>
  );
  const reason = !allowed ? NO_PERMISSION : (blocked ?? '');
  const out = reason ? <Disabled reason={reason}>{buttons}</Disabled> : buttons;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Export this report" aria-busy={busy !== null}>
      {reason ? <span className="inline-flex gap-2">{out}</span> : out}
    </div>
  );
}

/** One "Export" button with an Excel / PDF menu, gated by attendance.export (list pages and the time card). */
export function ExportMenu({ type, params, blocked, size = 'md', label = 'Export', note }: ExportControlProps & { label?: string; note?: string }) {
  const { can } = useAuth();
  const { run, busy } = useReportExport(type, params);
  const allowed = can('attendance.export');
  const trigger = (
    <Button variant="secondary" size={size} disabled={!allowed || Boolean(blocked)} loading={busy !== null} aria-label={busy ? 'Preparing the export' : label}>
      {busy === null && <Download aria-hidden="true" />}
      {busy !== null ? 'Preparing...' : label}
      {busy === null && <ChevronDown className="!size-3.5 text-muted-foreground" aria-hidden="true" />}
    </Button>
  );
  const reason = !allowed ? NO_PERMISSION : (blocked ?? '');
  if (reason) return <Disabled reason={reason}>{trigger}</Disabled>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[13rem]">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Download with the current filters</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => run('xlsx')}>
          <FileSpreadsheet aria-hidden="true" /> Excel workbook (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run('pdf')}>
          <FileText aria-hidden="true" /> PDF document (.pdf)
        </DropdownMenuItem>
        {note && <p className="max-w-[16rem] px-2 pb-1.5 pt-1 text-[11px] leading-snug text-muted-foreground">{note}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
