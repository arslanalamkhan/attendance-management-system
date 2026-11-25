import type { ColumnDef } from '@tanstack/react-table';
import { Terminal } from 'lucide-react';
import type { CommandListQuery, CommandStatus, Device, DeviceCommand } from '@nacta/shared';
import { CommandStatus as COMMAND_STATUSES } from '@nacta/shared';
import { listDeviceCommands } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
import { StatusPill } from '../../components/ui/badge';
import { EmptyState } from '../../components/ui/empty-state';
import { Dash, RelativeTime } from './parts';

const TONE = { pending: 'neutral', sent: 'info', success: 'success', failed: 'danger' } as const;
const LABEL: Record<CommandStatus, string> = { pending: 'Pending', sent: 'Sent', success: 'Succeeded', failed: 'Failed' };

export function CommandStatusPill({ status }: { status: CommandStatus }) {
  return (
    <StatusPill tone={TONE[status]} live={status === 'sent'}>
      {LABEL[status]}
    </StatusPill>
  );
}

const columns: ColumnDef<DeviceCommand>[] = [
  {
    id: 'id',
    header: '#',
    meta: { label: 'ID', className: 'w-20' },
    cell: ({ row }) => <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{row.original.id}</span>,
  },
  {
    id: 'command',
    header: 'Command',
    meta: { label: 'Command', className: 'max-w-72', cellTitle: (c) => c.command },
    cell: ({ row }) => <span className="block truncate font-mono text-[13px]">{row.original.command}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    meta: { label: 'Status', className: 'w-32' },
    cell: ({ row }) => <CommandStatusPill status={row.original.status} />,
  },
  {
    id: 'returnCode',
    header: 'Return code',
    meta: { label: 'Return code', align: 'right' },
    cell: ({ row }) =>
      row.original.returnCode === null ? <Dash /> : <span className="font-mono text-[13px] tabular-nums">{row.original.returnCode}</span>,
  },
  { id: 'createdAt', header: 'Queued', meta: { label: 'Queued' }, cell: ({ row }) => <RelativeTime iso={row.original.createdAt} /> },
  { id: 'sentAt', header: 'Sent', meta: { label: 'Sent' }, cell: ({ row }) => (row.original.sentAt ? <RelativeTime iso={row.original.sentAt} /> : <Dash />) },
  {
    id: 'completedAt',
    header: 'Completed',
    meta: { label: 'Completed' },
    cell: ({ row }) => (row.original.completedAt ? <RelativeTime iso={row.original.completedAt} /> : <Dash />),
  },
  {
    id: 'result',
    header: 'Result',
    meta: { label: 'Result', className: 'max-w-64', cellTitle: (c) => c.result ?? undefined },
    cell: ({ row }) =>
      row.original.result ? <span className="block truncate font-mono text-[13px] text-muted-foreground">{row.original.result}</span> : <Dash />,
  },
];

export function DeviceCommandsTab({ device }: { device: Device }) {
  const state = useDataTableState<'status'>({ filterKeys: ['status'], defaultPageSize: 25, paramPrefix: 'cmd' });
  const result = useDataTableQuery({
    state,
    queryKey: (q) => qk.devices.commands(device.id, q as CommandListQuery),
    fetcher: (q, signal) => {
      const status = COMMAND_STATUSES.find((s) => s === q.status);
      return listDeviceCommands(device.id, { ...q, status }, signal);
    },
    refetchInterval: 5000,
  });

  return (
    <DataTable<DeviceCommand>
      id="device-commands"
      caption={`Commands sent to ${device.name}`}
      columns={columns}
      data={result.data?.items ?? []}
      total={result.data?.total ?? 0}
      state={state}
      getRowId={(c) => String(c.id)}
      loading={result.isPending}
      fetching={result.isFetching}
      error={result.error}
      onRetry={() => void result.refetch()}
      noun={{ singular: 'command', plural: 'commands' }}
      maxHeight="calc(100dvh - 24rem)"
      toolbar={
        <DataTableFilterSelect
          label="Status"
          value={state.filters.status}
          onChange={(v) => state.setFilter('status', v)}
          options={COMMAND_STATUSES.map((s) => ({ value: s, label: LABEL[s] }))}
        />
      }
      emptyState={
        <EmptyState
          bare
          icon={<Terminal />}
          title="No commands yet"
          description="Commands you send from this page, such as Refresh info or Check for new data, are listed here with their outcome."
        />
      }
    />
  );
}
