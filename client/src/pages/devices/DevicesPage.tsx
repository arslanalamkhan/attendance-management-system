import * as React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ChevronDown,
  Cpu,
  Eye,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ScanSearch,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Device } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { getHealth, listDevices } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { DataTable } from '../../components/data-table/data-table';
import { useDataTableState } from '../../components/data-table/use-data-table-state';
import { Badge, DeviceStatusPill } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { IconButton } from '../../components/ui/icon-button';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { StatCard } from '../../components/ui/stat-card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAuth } from '../../lib/auth';
import { Gate } from '../../components/auth/gate';
import { DeviceConfirmDialogs, useEnqueueCommand, type DeviceConfirm } from './device-actions';
import { DeviceFormSheet } from './DeviceFormSheet';
import { Count, CopyButton, Dash, RelativeTime } from './parts';
import { usePageMeta } from '../../hooks/use-page-meta';

// ---------------------------------------------------------------------------
// "Connect a device" setup card
// ---------------------------------------------------------------------------

function SetupCard({ forceOpen }: { forceOpen: boolean }) {
  const [open, setOpen] = React.useState(false);
  const health = useQuery({ queryKey: qk.health(), queryFn: ({ signal }) => getHealth(signal), staleTime: 60_000 });
  const expanded = forceOpen || open;
  const ips = health.data?.serverIps ?? [];
  const port = health.data?.admsPort;
  const panelId = React.useId();

  return (
    <Card className="mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={forceOpen}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="grid size-8 shrink-0 place-content-center rounded-md bg-primary-subtle text-primary-text" aria-hidden="true">
          <Wifi className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold tracking-tight">Connect a device</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            Point a terminal at this server and it registers itself.
          </span>
        </span>
        {!forceOpen && (
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        )}
      </button>
      {expanded && (
        <div id={panelId} className="space-y-4 border-t px-5 py-4">
          <p className="max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            On the terminal open <span className="font-medium text-foreground">Menu, Comm., Cloud Server Setting</span>. Set the{' '}
            <span className="font-medium text-foreground">Server Address</span> to one of the addresses below and the{' '}
            <span className="font-medium text-foreground">Server Port</span> to the ADMS port. Devices appear in the list as soon as they call in.
          </p>
          {health.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : health.isError ? (
            <ErrorState bare className="py-6" error={health.error} onRetry={() => void health.refetch()} retrying={health.isFetching} title="Could not load server addresses" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">ADMS port</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium tabular-nums">{port}</span>
                  <CopyButton text={String(port)} label="Copy port" />
                </div>
              </div>
              {ips.length === 0 ? (
                <p className="self-center text-[13px] text-muted-foreground sm:col-span-2">
                  This server reported no network addresses. Check that it is connected to the same network as the terminal.
                </p>
              ) : (
                ips.map((ip) => (
                  <div key={ip} className="rounded-md border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Server address</p>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-medium tabular-nums">{ip}</span>
                      <CopyButton text={ip} label={`Copy address ${ip}`} />
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

type SortKey = 'status' | 'name' | 'serialNumber' | 'ipAddress' | 'location' | 'userCount' | 'faceCount' | 'fpCount' | 'attCount' | 'lastSeenAt';

function sortDevices(devices: Device[], sort: string | undefined, desc: boolean): Device[] {
  if (!sort) return devices;
  const key = sort as SortKey;
  const dir = desc ? -1 : 1;
  return [...devices].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    // empty values always sink to the bottom
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    if (key === 'lastSeenAt') return (new Date(String(av)).getTime() - new Date(String(bv)).getTime()) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
}

interface RowHandlers {
  onEdit: (d: Device) => void;
  onConfirm: (c: NonNullable<DeviceConfirm>) => void;
  onOpen: (d: Device) => void;
  onCommand: (d: Device, type: 'info' | 'check') => void;
}

function RowActions({ device, h }: { device: Device; h: RowHandlers }) {
  const { can } = useAuth();
  const canManage = can('devices.manage');
  const canCommand = can('devices.command');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label={`Actions for ${device.name}`}
          icon={<MoreHorizontal />}
          size="icon-sm"
          tooltip={false}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="truncate">{device.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => h.onOpen(device)}>
          <Eye /> View details
        </DropdownMenuItem>
        {canManage && (
          <DropdownMenuItem onSelect={() => h.onEdit(device)}>
            <Pencil /> Edit
          </DropdownMenuItem>
        )}
        {canCommand && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => h.onCommand(device, 'info')}>
              <RefreshCw /> Refresh info
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => h.onCommand(device, 'check')}>
              <ScanSearch /> Check for new data
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => h.onConfirm({ kind: 'reboot', device })}>
              <Power /> Reboot...
            </DropdownMenuItem>
          </>
        )}
        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => h.onConfirm({ kind: 'delete', device })}>
              <Trash2 /> Delete...
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function buildColumns(h: RowHandlers): ColumnDef<Device>[] {
  return [
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      meta: { label: 'Status', className: 'w-28' },
      cell: ({ row }) => <DeviceStatusPill status={row.original.status} />,
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: 'Name',
      meta: { label: 'Name', className: 'min-w-44' },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{row.original.name}</span>
          {row.original.autoRegistered && <Badge tone="info">New</Badge>}
          {!row.original.isActive && <Badge tone="outline">Inactive</Badge>}
        </div>
      ),
    },
    {
      id: 'serialNumber',
      accessorKey: 'serialNumber',
      header: 'Serial',
      meta: { label: 'Serial' },
      cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.serialNumber}</span>,
    },
    {
      id: 'ipAddress',
      accessorKey: 'ipAddress',
      header: 'Last IP',
      meta: { label: 'Last IP' },
      cell: ({ row }) => (row.original.ipAddress ? <span className="font-mono text-[13px]">{row.original.ipAddress}</span> : <Dash />),
    },
    {
      id: 'location',
      accessorKey: 'location',
      header: 'Location',
      meta: { label: 'Location', className: 'max-w-56', cellTitle: (d) => d.location ?? undefined },
      cell: ({ row }) =>
        row.original.location ? (
          <span className="flex items-center gap-1.5 truncate text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate text-foreground">{row.original.location}</span>
          </span>
        ) : (
          <Dash />
        ),
    },
    { id: 'userCount', accessorKey: 'userCount', header: 'Users', meta: { label: 'Users', align: 'right' }, cell: ({ row }) => <Count value={row.original.userCount} /> },
    { id: 'faceCount', accessorKey: 'faceCount', header: 'Faces', meta: { label: 'Faces', align: 'right' }, cell: ({ row }) => <Count value={row.original.faceCount} /> },
    { id: 'fpCount', accessorKey: 'fpCount', header: 'Fingerprints', meta: { label: 'Fingerprints', align: 'right' }, cell: ({ row }) => <Count value={row.original.fpCount} /> },
    { id: 'attCount', accessorKey: 'attCount', header: 'Logs', meta: { label: 'Logs', align: 'right' }, cell: ({ row }) => <Count value={row.original.attCount} /> },
    {
      id: 'lastSeenAt',
      accessorKey: 'lastSeenAt',
      header: 'Last seen',
      meta: { label: 'Last seen' },
      cell: ({ row }) => <RelativeTime iso={row.original.lastSeenAt} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: 'Actions', className: 'w-12 pl-0 text-right' },
      cell: ({ row }) => (
        <div className="flex justify-end">
          <RowActions device={row.original} h={h} />
        </div>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DevicesPage() {
  usePageMeta({ title: 'Devices' });
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const state = useDataTableState<never>({ filterKeys: [], defaultPageSize: 25, defaultSort: { id: 'name', desc: false } });
  const query = useQuery({
    queryKey: qk.devices.list(),
    queryFn: ({ signal }) => listDevices(signal),
    refetchInterval: 10_000,
  });
  const enqueue = useEnqueueCommand();

  const [formOpen, setFormOpen] = React.useState(false);
  const [formDevice, setFormDevice] = React.useState<Device | null>(null);
  const openForm = (device: Device | null) => {
    setFormDevice(device);
    setFormOpen(true);
  };
  const [confirm, setConfirm] = React.useState<DeviceConfirm>(null);

  // `?new=1` opens the add sheet (deep link from the command palette / empty states), then tidies the URL.
  const wantsNew = params.get('new') === '1';
  const canAddDevice = useAuth().can('devices.manage');
  React.useEffect(() => {
    if (!wantsNew) return;
    if (canAddDevice) openForm(null);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsNew, canAddDevice, setParams]);

  const devices = query.data;
  const total = devices?.length ?? 0;
  const online = devices?.filter((d) => d.status === 'online').length ?? 0;
  const offline = devices?.filter((d) => d.status === 'offline').length ?? 0;
  const unknown = total - online - offline;
  const noDevices = !query.isPending && !query.isError && total === 0;

  const sorted = React.useMemo(
    () => sortDevices(devices ?? [], state.sorting[0]?.id, state.sorting[0]?.desc ?? false),
    [devices, state.sorting],
  );
  const pageRows = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);

  // Snap back when the list shrinks below the current page (e.g. after a delete).
  const { page, pageSize, setPage } = state;
  React.useEffect(() => {
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last);
  }, [total, page, pageSize, setPage]);

  const columns = React.useMemo(
    () =>
      buildColumns({
        onEdit: (d) => openForm(d),
        onConfirm: setConfirm,
        onOpen: (d) => navigate(`/devices/${d.id}`),
        onCommand: (device, type) => enqueue.mutate({ device, type }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate],
  );

  const openAdd = () => openForm(null);

  return (
    <div>
      <PageHeader
        title="Devices"
        description="Biometric terminals that push attendance to this server."
        actions={
          <Gate perm="devices.manage" action="add devices">
            <Button onClick={openAdd}>
              <Plus aria-hidden="true" />
              Add device
            </Button>
          </Gate>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Total devices" icon={<Cpu />} value={total.toLocaleString()} loading={query.isPending} footnote={unknown > 0 ? `${unknown} not yet reporting` : 'Registered on this server'} />
        <StatCard label="Online" icon={<Wifi />} value={online.toLocaleString()} unit={total > 0 ? `of ${total.toLocaleString()}` : undefined} loading={query.isPending} footnote="Reported in recently" />
        <StatCard label="Offline" icon={<WifiOff />} value={offline.toLocaleString()} unit={total > 0 ? `of ${total.toLocaleString()}` : undefined} loading={query.isPending} footnote={offline > 0 ? 'Not reporting, check power and network' : 'Everything is reporting'} />
      </div>

      <SetupCard forceOpen={noDevices} />

      <DataTable<Device>
        id="devices"
        caption="Devices"
        columns={columns}
        data={pageRows}
        total={total}
        state={state}
        getRowId={(d) => String(d.id)}
        loading={query.isPending}
        fetching={query.isFetching && !query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(d) => navigate(`/devices/${d.id}`)}
        noun={{ singular: 'device', plural: 'devices' }}
        pageSizeOptions={[10, 25, 50]}
        maxHeight="none"
        emptyState={
          <EmptyState
            bare
            icon={<Cpu />}
            title="No devices yet"
            description="Point a terminal at this server using the steps above, or pre-register one by its serial number."
            action={
              <Gate perm="devices.manage" action="add devices">
                <Button onClick={openAdd}>
                  <Plus aria-hidden="true" />
                  Add a device manually
                </Button>
              </Gate>
            }
          />
        }
      />

      <DeviceFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        device={formDevice}
        onSaved={(d) => {
          if (!formDevice) navigate(`/devices/${d.id}`);
        }}
      />
      <DeviceConfirmDialogs target={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}



