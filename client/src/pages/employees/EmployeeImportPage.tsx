import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CircleAlert,
  Download,
  FileSpreadsheet,
  FileUp,
  Info,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  TriangleAlert,
  UploadCloud,
  UserMinus,
  X,
} from 'lucide-react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ErrorCode } from '@nacta/shared';
import type { EmployeeImportResult, ImportPreview, ImportRow, Permission } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { commitEmployeeImport, exportEmployees, previewEmployeeImport } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { cn } from '../../lib/utils';
import { usePageMeta } from '../../hooks/use-page-meta';
import { DataTable } from '../../components/data-table/data-table';
import type { DataTablePagingState } from '../../components/data-table/use-data-table-state';
import { Badge } from '../../components/ui/badge';
import { Breadcrumbs } from '../../components/ui/breadcrumbs';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard } from '../../components/ui/stat-card';
import { Switch } from '../../components/ui/switch';
import { Tooltip } from '../../components/ui/tooltip';
import { useAuth } from '../../lib/auth';
import ForbiddenPage from '../auth/ForbiddenPage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';

const MAX_BYTES = 10 * 1024 * 1024;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

type Step = 'upload' | 'review' | 'result';

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'review', label: 'Review' },
  { key: 'result', label: 'Result' },
];

function Stepper({ step }: { step: Step }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex items-center gap-2" aria-label="Import progress">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <React.Fragment key={s.key}>
            <li className="flex items-center gap-2" aria-current={current ? 'step' : undefined}>
              <span
                className={cn(
                  'grid size-6 place-content-center rounded-full border text-xs font-semibold tabular-nums transition-colors',
                  done && 'border-primary bg-primary text-primary-foreground',
                  current && 'border-primary bg-primary-subtle text-primary-text',
                  !done && !current && 'border-border-strong text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn('text-sm', current ? 'font-semibold' : 'text-muted-foreground')}>{s.label}</span>
            </li>
            {i < STEPS.length - 1 && <span className={cn('h-px w-8 sm:w-14', i < idx ? 'bg-primary' : 'bg-border-strong')} aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Step 1: upload
// ---------------------------------------------------------------------------

function validateFile(f: File): string | null {
  if (!/\.xlsx$/i.test(f.name)) return 'Only .xlsx files are accepted. Save the sheet as an Excel Workbook (.xlsx) and try again.';
  if (f.size === 0) return 'This file is empty.';
  if (f.size > MAX_BYTES) return `This file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  return null;
}

function Dropzone({ busy, error, onFile }: { busy: boolean; error: string | null; onFile: (f: File) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <div>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          if (!busy) pick(e.dataTransfer.files);
        }}
        className={cn(
          'relative flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed bg-card px-6 py-14 text-center transition-colors',
          over ? 'border-primary bg-primary-subtle/60' : 'border-border-strong',
          error && !over && 'border-danger/50',
        )}
      >
        <span className={cn('grid size-14 place-content-center rounded-full transition-transform', over ? 'scale-110 bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary-text')}>
          {busy ? <span className="size-6 rounded-full border-[3px] border-current/30 border-t-current motion-safe:animate-spin" aria-hidden="true" /> : <UploadCloud className="size-7" aria-hidden="true" />}
        </span>
        <div className="space-y-1">
          <p className="text-base font-semibold tracking-tight">{busy ? 'Reading your spreadsheet...' : over ? 'Drop to upload' : 'Drag your Excel file here'}</p>
          <p className="text-sm text-muted-foreground">{busy ? 'Checking every row. Nothing is saved yet.' : '.xlsx up to 10 MB. Nothing is saved until you review and apply.'}</p>
        </div>
        {!busy && (
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            <FileUp aria-hidden="true" />
            Choose file
          </Button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-label="Excel file to import"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2.5 text-[13px] font-medium text-danger-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function HowItWorks() {
  const items = [
    { icon: <Download />, title: 'Download, edit, upload', body: 'Export the current data, change what you need in Excel, then upload the same file. Each row is matched by Employee Code.' },
    { icon: <Pencil />, title: 'A blank cell clears the field', body: 'The export writes every current value, so untouched rows change nothing. Delete a value to clear it.' },
    { icon: <UserMinus />, title: 'Status changes affect devices', body: 'Setting Status to Disabled or Left removes the person from the terminals. Active restores them with their fingerprints, face and photo.' },
    { icon: <Info />, title: 'Rows are never deleted', body: 'People missing from the file are left alone. You review every change before anything is applied.' },
  ];
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>How it works</CardTitle>
          <CardDescription>Update many records at once, safely.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {items.map((i) => (
            <li key={i.title} className="flex gap-3">
              <span className="grid size-8 shrink-0 place-content-center rounded-md bg-primary-subtle text-primary-text [&_svg]:size-4" aria-hidden="true">
                {i.icon}
              </span>
              <div>
                <p className="text-sm font-medium">{i.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{i.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 2: review
// ---------------------------------------------------------------------------

type RowFilter = 'all' | 'create' | 'update' | 'error' | 'device';
const FILTERS: { key: RowFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'create', label: 'Add' },
  { key: 'update', label: 'Update' },
  { key: 'error', label: 'Errors' },
  { key: 'device', label: 'Device effects' },
];

function matchesFilter(r: ImportRow, f: RowFilter): boolean {
  if (f === 'all') return true;
  if (f === 'device') return r.deviceEffect !== 'none';
  return r.action === f;
}

function fmtValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') return <em className="not-italic text-muted-foreground/80">empty</em>;
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 40 ? `${s.slice(0, 38)}…` : s;
}

function ActionBadge({ action }: { action: ImportRow['action'] }) {
  if (action === 'create')
    return (
      <Badge tone="success">
        <Plus aria-hidden="true" />
        Add
      </Badge>
    );
  if (action === 'update')
    return (
      <Badge tone="info">
        <Pencil aria-hidden="true" />
        Update
      </Badge>
    );
  if (action === 'error')
    return (
      <Badge tone="danger">
        <TriangleAlert aria-hidden="true" />
        Error
      </Badge>
    );
  return <Badge tone="neutral">Unchanged</Badge>;
}

const DEVICE_EFFECT: Record<ImportRow['deviceEffect'], { label: string; detail: string; icon: React.ReactNode; className: string } | null> = {
  none: null,
  remove: { label: 'Removed from devices', detail: 'This person will be removed from every device and cannot mark attendance.', icon: <UserMinus />, className: 'bg-warning-subtle text-warning-text' },
  restore: { label: 'Restored to devices', detail: 'This person, with fingerprints, face and photo, is restored to their devices.', icon: <RotateCcw />, className: 'bg-success-subtle text-success-text' },
  update_profile: { label: 'Profile re-sent', detail: 'Name, card or role changes are re-sent to the devices automatically.', icon: <RefreshCw />, className: 'bg-info-subtle text-info-text' },
  add: { label: 'Added to devices', detail: 'This new person is sent to the active devices.', icon: <Send />, className: 'bg-primary-subtle text-primary-text' },
};

function DeviceEffectCell({ effect }: { effect: ImportRow['deviceEffect'] }) {
  const meta = DEVICE_EFFECT[effect];
  if (!meta) return <span className="text-muted-foreground">-</span>;
  return (
    <Tooltip content={`${meta.label}: ${meta.detail}`}>
      <span tabIndex={0} className="inline-flex items-center gap-2 rounded-sm text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className={cn('grid size-6 place-content-center rounded-md [&_svg]:size-3.5', meta.className)}>{meta.icon}</span>
        <span className="hidden text-muted-foreground xl:inline">{meta.label}</span>
        <span className="sr-only xl:hidden">{meta.label}</span>
      </span>
    </Tooltip>
  );
}

const CHIP_LIMIT = 3;

function ChangesCell({ row }: { row: ImportRow }) {
  const [open, setOpen] = React.useState(false);
  const shown = open ? row.changes : row.changes.slice(0, CHIP_LIMIT);
  const extra = row.changes.length - CHIP_LIMIT;
  return (
    <div className="min-w-0 space-y-1.5 py-0.5">
      {row.changes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((c) => (
            <li
              key={c.field}
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-1.5 py-0.5 text-xs"
              title={`${c.label}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`}
            >
              <span className="font-medium">{c.label}</span>
              <span className="text-muted-foreground">:</span>
              <span className="truncate text-muted-foreground line-through decoration-muted-foreground/40">{fmtValue(c.before)}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-medium text-foreground">{fmtValue(c.after)}</span>
            </li>
          ))}
          {extra > 0 && (
            <li>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen((o) => !o);
                }}
                aria-expanded={open}
                className="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {open ? 'Show less' : `+${extra} more`}
              </button>
            </li>
          )}
        </ul>
      )}
      {row.errors.map((er, i) => (
        <p key={`e${i}`} className="flex items-start gap-1.5 text-xs font-medium text-danger-text">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {er.field ? <span className="font-semibold">{er.field}: </span> : null}
            {er.message}
          </span>
        </p>
      ))}
      {row.warnings.map((w, i) => (
        <p key={`w${i}`} className="flex items-start gap-1.5 text-xs text-warning-text">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{w}</span>
        </p>
      ))}
      {row.changes.length === 0 && row.errors.length === 0 && row.warnings.length === 0 && <span className="text-xs text-muted-foreground">New employee</span>}
    </div>
  );
}

const reviewColumns: ColumnDef<ImportRow>[] = [
  {
    id: 'row',
    header: 'Row',
    meta: { label: 'Row', className: 'w-16 align-top' },
    cell: ({ row }) => <span className="font-mono text-xs tabular-nums text-muted-foreground">{row.original.row}</span>,
  },
  {
    id: 'employee',
    header: 'Employee',
    meta: { label: 'Employee', className: 'min-w-[11rem] max-w-[16rem] align-top' },
    cell: ({ row }) => (
      <div className="min-w-0 leading-tight">
        <p className="truncate text-sm font-medium">{row.original.name ?? <span className="italic text-muted-foreground">No name</span>}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">{row.original.empCode ?? 'No code'}</p>
      </div>
    ),
  },
  { id: 'action', header: 'Action', meta: { label: 'Action', className: 'w-28 align-top' }, cell: ({ row }) => <ActionBadge action={row.original.action} /> },
  { id: 'changes', header: 'Changes', meta: { label: 'Changes', className: 'min-w-[22rem] align-top' }, cell: ({ row }) => <ChangesCell row={row.original} /> },
  { id: 'device', header: 'Devices', meta: { label: 'Device effect', className: 'w-44 align-top' }, cell: ({ row }) => <DeviceEffectCell effect={row.original.deviceEffect} /> },
];

const noSorting: SortingState = [];

function ReviewStep({
  preview,
  onReset,
  onCommitted,
  onExpired,
}: {
  preview: ImportPreview;
  onReset: () => void;
  onCommitted: (r: EmployeeImportResult) => void;
  onExpired: () => void;
}) {
  const { summary } = preview;
  const [filter, setFilter] = React.useState<RowFilter>('all');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [createMissing, setCreateMissing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const unknownCount = preview.unknownWings.length + preview.unknownSections.length;
  const valid = summary.create + summary.update;
  const counts: Record<RowFilter, number> = React.useMemo(
    () => ({
      all: preview.rows.length,
      create: preview.rows.filter((r) => r.action === 'create').length,
      update: preview.rows.filter((r) => r.action === 'update').length,
      error: preview.rows.filter((r) => r.action === 'error').length,
      device: preview.rows.filter((r) => r.deviceEffect !== 'none').length,
    }),
    [preview.rows],
  );
  const filtered = React.useMemo(() => preview.rows.filter((r) => matchesFilter(r, filter)), [preview.rows, filter]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const state: DataTablePagingState = {
    page,
    pageSize,
    sorting: noSorting,
    setPage,
    setPageSize: (n) => {
      setPageSize(n);
      setPage(1);
    },
    setSorting: () => undefined,
    hasFilters: filter !== 'all',
    resetFilters: () => {
      setFilter('all');
      setPage(1);
    },
  };

  const commit = useApiMutation<EmployeeImportResult, void>({
    mutationFn: () => commitEmployeeImport({ token: preview.token, createMissing }),
    invalidate: [qk.employees.all, qk.wings.all, qk.devices.all],
    toastErrors: false,
    onSuccess: (r) => onCommitted(r),
    onError: (e) => {
      setConfirming(false);
      if (e.status === 410 || e.code === ErrorCode.IMPORT_EXPIRED) onExpired();
    },
  });

  const apply = () => {
    if (summary.deviceRemove > 0) setConfirming(true);
    else commit.mutate();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-content-center rounded-md bg-success-subtle text-success-text" aria-hidden="true">
            <FileSpreadsheet className="size-4.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{preview.fileName}</p>
            <p className="text-xs text-muted-foreground">{plural(summary.rows, 'row', 'rows')} read. Nothing has been saved yet.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={commit.isPending}>
          <ArrowLeft aria-hidden="true" />
          Choose a different file
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" role="group" aria-label="Import summary">
        <StatCard label="To add" value={summary.create.toLocaleString()} icon={<Plus />} />
        <StatCard label="To update" value={summary.update.toLocaleString()} icon={<Pencil />} />
        <StatCard label="Unchanged" value={summary.unchanged.toLocaleString()} icon={<Check />} />
        <StatCard label="Errors" value={summary.error.toLocaleString()} icon={<TriangleAlert />} className={summary.error > 0 ? 'border-danger/40' : undefined} footnote={summary.error > 0 ? 'Skipped when applying' : undefined} />
        <StatCard label="Device removals" value={summary.deviceRemove.toLocaleString()} icon={<UserMinus />} className={summary.deviceRemove > 0 ? 'border-warning/50' : undefined} />
        <StatCard label="Restores" value={summary.deviceRestore.toLocaleString()} icon={<RotateCcw />} />
        <StatCard label="Profile updates" value={summary.deviceUpdate.toLocaleString()} icon={<RefreshCw />} />
      </div>

      {unknownCount > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning-subtle/60 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" aria-hidden="true" />
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-semibold text-warning-text">
                  {unknownCount === 1 ? 'The file uses a wing or section that does not exist yet' : `The file uses ${unknownCount} wings or sections that do not exist yet`}
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-label="Unknown wings and sections">
                  {preview.unknownWings.map((w) => (
                    <li key={`w-${w}`} className="rounded-md border border-warning/40 bg-card px-2 py-0.5 text-xs">
                      Wing: <span className="font-semibold">{w}</span>
                    </li>
                  ))}
                  {preview.unknownSections.map((s) => (
                    <li key={`s-${s.wing}-${s.section}`} className="rounded-md border border-warning/40 bg-card px-2 py-0.5 text-xs">
                      Section: <span className="font-semibold">{s.section}</span> <span className="text-muted-foreground">in {s.wing}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-muted-foreground">Rows that use them are skipped with an error, unless you let the import create them. Check for typos first.</p>
              </div>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
              <Switch checked={createMissing} onCheckedChange={setCreateMissing} aria-label="Create unknown wings and sections automatically" />
              <span className="text-sm font-medium">Create them automatically</span>
            </label>
          </div>
        </div>
      )}

      <section aria-label="Rows to review" className="space-y-3">
        <DataTable<ImportRow>
          id="employee-import-rows"
          caption="Rows in the import file"
          columns={reviewColumns}
          data={pageRows}
          total={filtered.length}
          state={state}
          getRowId={(r) => String(r.row)}
          noun={{ singular: 'row', plural: 'rows' }}
          pageSizeOptions={[25, 50, 100]}
          maxHeight="calc(100dvh - 22rem)"
          toolbar={
            <div role="tablist" aria-label="Filter rows" className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  role="tab"
                  type="button"
                  aria-selected={filter === f.key}
                  onClick={() => {
                    setFilter(f.key);
                    setPage(1);
                  }}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === f.key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f.label}
                  <span className={cn('rounded-full px-1.5 text-[11px] tabular-nums', f.key === 'error' && counts.error > 0 ? 'bg-danger-subtle text-danger-text' : 'bg-background/70 text-muted-foreground')}>
                    {counts[f.key].toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          }
          emptyState={
            <EmptyState
              bare
              icon={<Check />}
              title={preview.rows.length === 0 ? 'Nothing to change' : 'No rows in this view'}
              description={preview.rows.length === 0 ? 'Every row in the file already matches the current data.' : 'Pick another filter to see the other rows.'}
            />
          }
        />
      </section>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card/95 px-4 py-3 shadow-pop backdrop-blur">
        <div className="min-w-0 text-[13px]">
          {valid === 0 ? (
            <p className="text-muted-foreground">{summary.error > 0 ? 'There is nothing valid to apply. Fix the errors in Excel and upload again.' : 'There is nothing to apply.'}</p>
          ) : (
            <p>
              <strong className="font-semibold tabular-nums">{valid.toLocaleString()}</strong> {valid === 1 ? 'change' : 'changes'} will be applied
              {summary.error > 0 && <span className="text-muted-foreground"> · {plural(summary.error, 'row', 'rows')} with errors will be skipped</span>}
              {summary.deviceRemove > 0 && <span className="text-warning-text"> · {plural(summary.deviceRemove, 'person', 'people')} removed from devices</span>}
            </p>
          )}
          {commit.error && !(commit.error.status === 410) && (
            <p role="alert" className="mt-1 flex items-center gap-1.5 text-xs font-medium text-danger-text">
              <CircleAlert className="size-3.5" aria-hidden="true" />
              {commit.error.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onReset} disabled={commit.isPending}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={valid === 0} loading={commit.isPending}>
            {!commit.isPending && <Check aria-hidden="true" />}
            Apply {valid.toLocaleString()} {valid === 1 ? 'change' : 'changes'}
          </Button>
        </div>
      </div>

      <AlertDialog open={confirming} onOpenChange={(o) => !o && !commit.isPending && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {plural(summary.deviceRemove, 'person', 'people')} from the devices?</AlertDialogTitle>
            <AlertDialogDescription>
              This import sets {plural(summary.deviceRemove, 'employee', 'employees')} to Disabled or Left. They will be removed from every device and cannot mark attendance until enabled again. Their fingerprints, face and photo stay saved in the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commit.isPending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={commit.isPending}
              onClick={(e) => {
                e.preventDefault();
                commit.mutate(undefined, { onSettled: () => setConfirming(false) });
              }}
            >
              {commit.isPending ? 'Applying...' : `Apply ${valid.toLocaleString()} ${valid === 1 ? 'change' : 'changes'}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: result
// ---------------------------------------------------------------------------

function ResultStep({ result, preview, onAnother }: { result: EmployeeImportResult; preview: ImportPreview | null; onAnother: () => void }) {
  const stats = [
    { label: 'Added', value: result.created, icon: <Plus /> },
    { label: 'Updated', value: result.updated, icon: <Pencil /> },
    { label: 'Unchanged', value: result.unchanged, icon: <Check /> },
    { label: 'Skipped (errors)', value: result.skipped, icon: <TriangleAlert /> },
  ];
  if (result.wingsCreated > 0) stats.push({ label: 'Wings created', value: result.wingsCreated, icon: <Plus /> });
  if (result.sectionsCreated > 0) stats.push({ label: 'Sections created', value: result.sectionsCreated, icon: <Plus /> });

  const touched = (preview?.rows ?? []).filter((r) => (r.action === 'create' || r.action === 'update') && r.empCode);
  const removed = (preview?.rows ?? []).some((r) => r.deviceEffect === 'remove');

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center shadow-xs">
        <span className="grid size-14 place-content-center rounded-full bg-success-subtle text-success-text">
          <Check className="size-7" strokeWidth={3} aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight">Import complete</h2>
        <p className="max-w-lg text-sm text-muted-foreground">
          {plural(result.created + result.updated, 'employee was', 'employees were')} saved.{' '}
          {result.deviceCommandsQueued > 0
            ? `${plural(result.deviceCommandsQueued, 'device command is', 'device commands are')} queued and the terminals pick them up the next time they check in.`
            : 'No device commands were needed.'}
        </p>
      </div>

      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-4', stats.length > 4 && 'xl:grid-cols-6')} role="group" aria-label="Import result">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value.toLocaleString()} icon={s.icon} />
        ))}
        <StatCard label="Device commands queued" value={result.deviceCommandsQueued.toLocaleString()} icon={<Send />} />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Where to go next</CardTitle>
            <CardDescription>Follow the devices as they pick up the changes, or open the people you just changed.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link to="/employees?deviceSync=pending">
                <RefreshCw aria-hidden="true" />
                Waiting for devices
              </Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/employees?deviceSync=failed">
                <TriangleAlert aria-hidden="true" />
                Failed to sync
              </Link>
            </Button>
            {removed && (
              <Button variant="secondary" size="sm" asChild>
                <Link to="/employees?status=disabled">
                  <Ban aria-hidden="true" />
                  Disabled employees
                </Link>
              </Button>
            )}
            <Button variant="secondary" size="sm" asChild>
              <Link to="/employees">All employees</Link>
            </Button>
          </div>
          {touched.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Changed in this import</p>
              <ul className="flex flex-wrap gap-1.5">
                {touched.slice(0, 12).map((r) => (
                  <li key={r.row}>
                    <Link
                      to={`/employees?q=${encodeURIComponent(r.empCode!)}`}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono tabular-nums text-muted-foreground">{r.empCode}</span>
                      <span className="max-w-[10rem] truncate font-medium">{r.name}</span>
                    </Link>
                  </li>
                ))}
                {touched.length > 12 && <li className="px-1 py-1 text-xs text-muted-foreground">+{touched.length - 12} more</li>}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onAnother}>
          <FileUp aria-hidden="true" />
          Import another file
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Importing needs BOTH permissions (the route only checks one). */
function RequireAll({ perms, children }: { perms: Permission[]; children: React.ReactNode }) {
  const { can } = useAuth();
  return perms.every(can) ? <>{children}</> : <ForbiddenPage required={perms} />;
}

export default function EmployeeImportPage() {
  usePageMeta({ title: 'Import employees' });
  return (
    <RequireAll perms={['employees.import', 'employees.manage']}>
      <ImportFlow />
    </RequireAll>
  );
}

function ImportFlow() {
  const { can } = useAuth();
  const [step, setStep] = React.useState<Step>('upload');
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [result, setResult] = React.useState<EmployeeImportResult | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const upload = useApiMutation<ImportPreview, File>({
    mutationFn: (f) => previewEmployeeImport(f),
    toastErrors: false,
    onSuccess: (p) => {
      setFileError(null);
      setNotice(null);
      setPreview(p);
      setStep('review');
    },
    onError: (e) => {
      setFileError(
        e.code === ErrorCode.INVALID_FILE || e.status === 400
          ? e.message || 'This file could not be read. Make sure it is the .xlsx exported from here.'
          : e.message,
      );
    },
  });

  const download = useApiMutation<string, void>({
    mutationFn: () => exportEmployees(),
    successMessage: (n) => `Downloaded ${n}`,
    errorMessage: 'Export failed',
  });

  const onFile = (f: File) => {
    const problem = validateFile(f);
    if (problem) return setFileError(problem);
    setFileError(null);
    upload.mutate(f);
  };

  const restart = (message?: string) => {
    setPreview(null);
    setResult(null);
    setFileError(null);
    setNotice(message ?? null);
    setStep('upload');
  };

  return (
    <>
      <Breadcrumbs items={[{ label: 'Employees', to: '/employees' }, { label: 'Import from Excel' }]} className="mb-4" />
      <PageHeader
        title="Import from Excel"
        description="Download the current employees, edit them in Excel, and upload the same file to update everyone at once. You review every change before it is applied."
      />
      <Stepper step={step} />

      {step === 'upload' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            {notice && (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2.5 text-[13px] font-medium text-warning-text">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {notice}
              </p>
            )}
            <Dropzone busy={upload.isPending} error={fileError} onFile={onFile} />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">Need the latest data?</p>
                <p className="text-xs text-muted-foreground">The workbook has dropdowns for wing, section, status and more, and a Lists sheet.</p>
              </div>
              <Button variant="secondary" onClick={() => download.mutate()} loading={download.isPending} disabled={!can('employees.import')}>
                {!download.isPending && <Download aria-hidden="true" />}
                Download current data
              </Button>
            </div>
          </div>
          <HowItWorks />
        </div>
      )}

      {step === 'review' && preview && (
        <ReviewStep
          preview={preview}
          onReset={() => restart()}
          onCommitted={(r) => {
            setResult(r);
            setStep('result');
          }}
          onExpired={() => restart('That upload expired (previews last 30 minutes) or was already applied. Upload the file again to continue.')}
        />
      )}

      {step === 'result' && result && <ResultStep result={result} preview={preview} onAnother={() => restart()} />}
      {step === 'result' && !result && (
        <EmptyState icon={<X />} title="No result" description="Start a new import." action={<Button onClick={() => restart()}>Start over</Button>} />
      )}
    </>
  );
}
