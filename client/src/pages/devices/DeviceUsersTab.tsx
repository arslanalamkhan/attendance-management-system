import * as React from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { CloudDownload, FingerprintPattern, MoreHorizontal, ScanFace, Trash2, UserRoundPlus, Users } from 'lucide-react';
import type { Device, DeviceUser, DeviceUserListQuery } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { deleteDeviceUser, fetchDeviceUsers, importDeviceUsers, listDeviceUsers } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { DataTable } from '../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../components/data-table/use-data-table-state';
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
import { Badge } from '../../components/ui/badge';
import { EmployeeAvatar } from '../../components/ui/employee-avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Switch } from '../../components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { useAuth } from '../../lib/auth';
import { Gate } from '../../components/auth/gate';
import { Dash, RelativeTime } from './parts';

type UserFilter = 'q' | 'linked';

function Privilege({ value }: { value: number | null }) {
  if (value === null) return <Dash />;
  if (value === 14) return <Badge tone="primary">Admin</Badge>;
  if (value === 0) return <span className="text-muted-foreground">User</span>;
  return <span className="text-muted-foreground">Level {value}</span>;
}

function Templates({ fp, face }: { fp: number; face: number }) {
  return (
    <span className="flex items-center gap-3 text-[13px]">
      <span className={fp > 0 ? 'inline-flex items-center gap-1' : 'inline-flex items-center gap-1 text-muted-foreground'}>
        <FingerprintPattern className="size-4" aria-hidden="true" />
        <span className="font-figure">{fp}</span>
        <span className="sr-only">fingerprints</span>
      </span>
      <span className={face > 0 ? 'inline-flex items-center gap-1' : 'inline-flex items-center gap-1 text-muted-foreground'}>
        <ScanFace className="size-4" aria-hidden="true" />
        <span className="font-figure">{face}</span>
        <span className="sr-only">faces</span>
      </span>
    </span>
  );
}

export function DeviceUsersTab({ device }: { device: Device }) {
  const { can } = useAuth();
  const canDeviceUsers = can('devices.users');
  const canImport = canDeviceUsers && can('employees.manage');
  const state = useDataTableState<UserFilter>({
    filterKeys: ['q', 'linked'],
    defaultPageSize: 50,
    defaultSort: { id: 'pin', desc: false },
    paramPrefix: 'users',
  });
  const result = useDataTableQuery({
    state,
    queryKey: (q) => qk.devices.users(device.id, q as DeviceUserListQuery),
    fetcher: (q, signal) => {
      const query: DeviceUserListQuery = { ...q, linked: q.linked === 'true' || q.linked === 'false' ? q.linked : undefined };
      return listDeviceUsers(device.id, query, signal);
    },
  });

  const [removing, setRemoving] = React.useState<DeviceUser | null>(null);
  const [importAllOpen, setImportAllOpen] = React.useState(false);
  const [overwrite, setOverwrite] = React.useState(false);

  const fetchUsers = useApiMutation<{ queued: number }>({
    mutationFn: () => fetchDeviceUsers(device.id),
    invalidate: [qk.devices.all],
    successMessage: 'Fetch queued. Users appear here after the terminal next calls in.',
    errorMessage: 'Could not queue the fetch',
  });

  const importUsers = useApiMutation<{ created: number; updated: number; skipped: number }, { pins?: string[]; overwrite: boolean }>({
    mutationFn: (vars) => importDeviceUsers(device.id, vars),
    invalidate: [qk.devices.all, qk.employees.all, qk.overview()],
    successMessage: (r) => `Import finished: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped`,
    errorMessage: 'Import failed',
  });

  const removeUser = useApiMutation<{ queued: number }, DeviceUser>({
    mutationFn: (u) => deleteDeviceUser(device.id, u.pin),
    invalidate: [qk.devices.all],
    successMessage: (_r, u) => `Removal of PIN ${u.pin} queued. The terminal deletes it on its next poll.`,
    errorMessage: 'Could not queue the removal',
  });

  const columns = React.useMemo<ColumnDef<DeviceUser>[]>(
    () => [
      {
        id: 'pin',
        accessorKey: 'pin',
        header: 'PIN',
        meta: { label: 'PIN', className: 'w-28' },
        cell: ({ row }) => <span className="font-mono text-[13px] tabular-nums">{row.original.pin}</span>,
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: 'Name',
        meta: { label: 'Name', className: 'min-w-40' },
        cell: ({ row }) =>
          row.original.name ? (
            <span className="flex items-center gap-2.5">
              <EmployeeAvatar employee={{ id: row.original.employeeId, name: row.original.name }} size="sm" />
              <span className="font-medium">{row.original.name}</span>
            </span>
          ) : (
            <Dash />
          ),
      },
      {
        id: 'cardNo',
        header: 'Card',
        meta: { label: 'Card' },
        cell: ({ row }) =>
          row.original.cardNo ? <span className="font-mono text-[13px] tabular-nums">{row.original.cardNo}</span> : <Dash />,
      },
      {
        id: 'privilege',
        header: 'Privilege',
        meta: { label: 'Privilege' },
        cell: ({ row }) => <Privilege value={row.original.privilege} />,
      },
      {
        id: 'employee',
        header: 'Linked employee',
        meta: { label: 'Linked employee', className: 'min-w-44' },
        cell: ({ row }) =>
          row.original.employeeId !== null ? (
            <Link
              to={`/employees/${row.original.employeeId}`}
              className="rounded-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.original.employeeName ?? `Employee ${row.original.employeeId}`}
            </Link>
          ) : (
            <Badge tone="outline">Not linked</Badge>
          ),
      },
      {
        id: 'templates',
        header: 'Templates',
        meta: { label: 'Templates' },
        cell: ({ row }) => <Templates fp={row.original.templates.fp} face={row.original.templates.face} />,
      },
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
        meta: { label: 'Actions', className: 'w-12 pl-0' },
        cell: ({ row }) =>
          !canDeviceUsers ? null : (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions for PIN ${row.original.pin}`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem destructive onSelect={() => setRemoving(row.original)}>
                  <Trash2 /> Remove from device...
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [canDeviceUsers],
  );

  const total = result.data?.total ?? 0;

  return (
    <>
      <DataTable<DeviceUser>
        id="device-users"
        caption={`Users stored on ${device.name}`}
        columns={columns}
        data={result.data?.items ?? []}
        total={total}
        state={state}
        getRowId={(u) => u.pin}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        selectable={canImport}
        noun={{ singular: 'user', plural: 'users' }}
        maxHeight="calc(100dvh - 24rem)"
        toolbar={
          <>
            <DataTableSearch
              value={state.filters.q}
              onChange={(v) => state.setFilter('q', v)}
              placeholder="Search PIN, name or card..."
              label="Search device users"
            />
            <DataTableFilterSelect
              label="Employee"
              value={state.filters.linked}
              onChange={(v) => state.setFilter('linked', v)}
              allLabel="All users"
              options={[
                { value: 'true', label: 'Linked' },
                { value: 'false', label: 'Not linked' },
              ]}
            />
          </>
        }
        toolbarActions={
          <>
            <Gate perm="devices.users" action="fetch users from devices">
              <Button variant="secondary" size="sm" onClick={() => fetchUsers.mutate()} loading={fetchUsers.isPending}>
                {!fetchUsers.isPending && <CloudDownload aria-hidden="true" />}
                Fetch from device
              </Button>
            </Gate>
            <Gate perm={['devices.users', 'employees.manage']} action="import device users as employees">
              <Button size="sm" onClick={() => setImportAllOpen(true)} disabled={total === 0 && !state.hasFilters}>
                <UserRoundPlus aria-hidden="true" />
                Import all
              </Button>
            </Gate>
          </>
        }
        bulkActions={({ ids, clear }) => (
          <Button
            size="sm"
            loading={importUsers.isPending}
            onClick={() => importUsers.mutate({ pins: ids, overwrite: false }, { onSuccess: clear })}
          >
            {!importUsers.isPending && <UserRoundPlus aria-hidden="true" />}
            Import selected
          </Button>
        )}
        emptyState={
          <EmptyState
            bare
            icon={<Users />}
            title="No users on this device yet"
            description="Ask the terminal to send its user list. Records arrive after its next poll, usually within a minute."
            action={
              <Gate perm="devices.users" action="fetch users from devices">
                <Button variant="secondary" onClick={() => fetchUsers.mutate()} loading={fetchUsers.isPending}>
                  {!fetchUsers.isPending && <CloudDownload aria-hidden="true" />}
                  Fetch from device
                </Button>
              </Gate>
            }
          />
        }
      />

      <AlertDialog open={importAllOpen} onOpenChange={(o) => !importUsers.isPending && setImportAllOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import all users from {device.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Creates an employee record for every user stored on this device, using the PIN as the employee code. PINs that already
              match an employee are skipped unless you choose to overwrite them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border bg-muted/40 p-3">
            <FormField
              label="Overwrite existing employees"
              inline
              hint="Replace name, card and privilege on matching employees with the values stored on the device."
            >
              <Switch checked={overwrite} onCheckedChange={setOverwrite} />
            </FormField>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importUsers.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={importUsers.isPending}
              onClick={(e) => {
                e.preventDefault();
                importUsers.mutate({ overwrite }, { onSuccess: () => setImportAllOpen(false) });
              }}
            >
              {importUsers.isPending ? 'Importing...' : overwrite ? 'Import and overwrite' : 'Import all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && !removeUser.isPending && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove PIN {removing?.pin} from the device?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.name ? `${removing.name} will` : 'This user will'} no longer be able to punch on {device.name}. Their face and fingerprint
              templates stored on the terminal are deleted too. The employee record on this server is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeUser.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeUser.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (removing) removeUser.mutate(removing, { onSuccess: () => setRemoving(null) });
              }}
            >
              {removeUser.isPending ? 'Queuing...' : 'Remove from device'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


