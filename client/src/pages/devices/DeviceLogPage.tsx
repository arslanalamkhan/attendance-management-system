import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Pause, Play, ScrollText } from 'lucide-react';
import type { AdmsLogQuery, AdmsRequest } from '@nacta/shared';
import { absoluteTime } from '../../lib/time';
import { listAdmsLog } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
import { Badge, StatusPill } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { CopyButton, Dash, RelativeTime } from './parts';
import { usePageMeta } from '../../hooks/use-page-meta';

type LogFilter = 'serialNumber' | 'path';

const TRUNCATE_AT = 4000;
const fullPath = (r: AdmsRequest) => (r.query ? `${r.path}?${r.query}` : r.path);

const methodTone = (m: string) => (m === 'GET' ? 'info' : m === 'POST' ? 'primary' : 'neutral');

const columns: ColumnDef<AdmsRequest>[] = [
  {
    id: 'createdAt',
    header: 'Received',
    meta: { label: 'Received', className: 'w-36' },
    cell: ({ row }) => <RelativeTime iso={row.original.createdAt} />,
  },
  {
    id: 'method',
    header: 'Method',
    meta: { label: 'Method', className: 'w-24' },
    cell: ({ row }) => <Badge tone={methodTone(row.original.method)}>{row.original.method}</Badge>,
  },
  {
    id: 'path',
    header: 'Path',
    meta: { label: 'Path', className: 'max-w-xl', cellTitle: (r) => fullPath(r) },
    cell: ({ row }) => <span className="block truncate font-mono text-[13px]">{fullPath(row.original)}</span>,
  },
  {
    id: 'serialNumber',
    header: 'Serial',
    meta: { label: 'Serial' },
    cell: ({ row }) => (row.original.serialNumber ? <span className="font-mono text-[13px]">{row.original.serialNumber}</span> : <Dash />),
  },
  {
    id: 'remoteIp',
    header: 'Remote IP',
    meta: { label: 'Remote IP' },
    cell: ({ row }) => (row.original.remoteIp ? <span className="font-mono text-[13px] tabular-nums">{row.original.remoteIp}</span> : <Dash />),
  },
  {
    id: 'size',
    header: 'Body',
    meta: { label: 'Body size', align: 'right' },
    cell: ({ row }) => {
      const n = row.original.body?.length ?? 0;
      return n === 0 ? <Dash /> : <span className="font-figure text-muted-foreground">{formatSize(n)}</span>;
    },
  },
];

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(1)} MB`;
}

function Payload({ title, value }: { title: string; value: string | null }) {
  const [showAll, setShowAll] = React.useState(false);
  const text = value ?? '';
  const long = text.length > TRUNCATE_AT;
  const shown = long && !showAll ? text.slice(0, TRUNCATE_AT) : text;
  const headingId = React.useId();

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold tracking-tight">
          {title}
          {text && <span className="font-figure ml-2 text-xs font-normal text-muted-foreground">{formatSize(text.length)}</span>}
        </h3>
        {text && <CopyButton text={text} label={`Copy ${title.toLowerCase()}`} />}
      </div>
      {text ? (
        <>
          {/* tabIndex: scrollable regions must be keyboard reachable */}
          <pre
            tabIndex={0}
            className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/60 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {shown}
            {long && !showAll && <span className="text-muted-foreground">{'\n'}... {(text.length - TRUNCATE_AT).toLocaleString()} more characters</span>}
          </pre>
          {long && (
            <Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
              {showAll ? 'Show less' : `Show all (${formatSize(text.length)})`}
            </Button>
          )}
        </>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-[13px] text-muted-foreground">Empty</p>
      )}
    </section>
  );
}

function RequestSheet({ request: current, onClose }: { request: AdmsRequest | null; onClose: () => void }) {
  // keep the last request mounted while the sheet animates closed
  const lastRef = React.useRef<AdmsRequest | null>(null);
  if (current) lastRef.current = current;
  const request = current ?? lastRef.current;
  return (
    <Sheet open={current !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-2xl sm:max-w-2xl">
        {request && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Badge tone={methodTone(request.method)}>{request.method}</Badge>
                <span className="truncate font-mono text-sm">{request.path}</span>
              </SheetTitle>
              <SheetDescription>
                Request #{request.id} received {absoluteTime(request.createdAt)}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Serial</dt>
                  <dd className="mt-1 font-mono text-[13px]">{request.serialNumber ?? <Dash />}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Remote IP</dt>
                  <dd className="mt-1 font-mono text-[13px] tabular-nums">{request.remoteIp ?? <Dash />}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    Query string
                    {request.query && <CopyButton text={request.query} label="Copy query string" />}
                  </dt>
                  <dd className="mt-1 break-all font-mono text-[13px]">{request.query ?? <Dash />}</dd>
                </div>
              </dl>
              <Payload title="Request body" value={request.body} />
              <Payload title="Response" value={request.response} />
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function DeviceLogPage() {
  usePageMeta({ title: 'Device log' });
  const state = useDataTableState<LogFilter>({ filterKeys: ['serialNumber', 'path'], defaultPageSize: 50 });
  const [paused, setPaused] = React.useState(false);
  const [selected, setSelected] = React.useState<AdmsRequest | null>(null);

  const result = useDataTableQuery<AdmsRequest, LogFilter>({
    state,
    queryKey: (q) => qk.admsLog.list(q as AdmsLogQuery),
    fetcher: (q, signal) => listAdmsLog(q, signal),
    refetchInterval: paused ? undefined : 5000,
  });

  return (
    <div>
      <PageHeader
        title="Device log"
        description="Raw requests terminals send to the ADMS port, newest first. Select a row to inspect the request and response."
        meta={
          paused ? (
            <StatusPill tone="warning">Paused</StatusPill>
          ) : (
            <StatusPill tone="success" live>
              Live
            </StatusPill>
          )
        }
      />
      <DataTable<AdmsRequest>
        id="adms-log"
        caption="Requests received from devices"
        columns={columns}
        data={result.data?.items ?? []}
        total={result.data?.total ?? 0}
        state={state}
        getRowId={(r) => String(r.id)}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        onRowClick={setSelected}
        noun={{ singular: 'request', plural: 'requests' }}
        pageSizeOptions={[25, 50, 100, 200]}
        toolbar={
          <>
            <DataTableSearch
              value={state.filters.serialNumber}
              onChange={(v) => state.setFilter('serialNumber', v)}
              placeholder="Filter by serial..."
              label="Filter by serial number"
              className="font-mono"
            />
            <DataTableSearch
              value={state.filters.path}
              onChange={(v) => state.setFilter('path', v)}
              placeholder="Filter by path, e.g. /iclock/cdata"
              label="Filter by path"
              className="font-mono"
            />
          </>
        }
        toolbarActions={
          <Button variant="secondary" size="sm" aria-pressed={paused} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        }
        emptyState={
          <EmptyState
            bare
            icon={<ScrollText />}
            title="No requests yet"
            description="Nothing has called the ADMS port so far. Once a terminal is pointed at this server, its traffic shows up here."
          />
        }
      />
      <RequestSheet request={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
