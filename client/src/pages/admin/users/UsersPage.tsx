import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { LockKeyholeOpen, KeyRound, LogOut, MoreHorizontal, Pencil, Plus, Trash2, UserCheck, UserCog, UserX } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { AppUser, UserListQuery } from '@nacta/shared';
import { useAuth } from '../../../lib/auth';
import { listUsers } from '../../../lib/endpoints/users';
import { qk } from '../../../lib/query-keys';
import { useRoles } from '../../../hooks/use-lookups';
import { DataTable } from '../../../components/data-table/data-table';
import { DataTableFilterSelect, DataTableSearch } from '../../../components/data-table/toolbar';
import { useDataTableQuery, useDataTableState } from '../../../components/data-table/use-data-table-state';
import { Avatar } from '../../../components/ui/avatar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';
import { EmptyState } from '../../../components/ui/empty-state';
import { IconButton } from '../../../components/ui/icon-button';
import { PageHeader } from '../../../components/ui/page-header';
import { RelativeTime } from '../../devices/parts';
import { UserCreateSheet } from './UserCreateSheet';
import { UserDetailSheet } from './UserDetailSheet';
import { ProtectedBadge, UserStatusPill } from './user-parts';
import { statusOf, UserActionDialogs, useSetUserStatus, useUnlockUser, type UserConfirm } from './user-actions';
import { usePageMeta } from '../../../hooks/use-page-meta';

type FilterKey = 'q' | 'status' | 'roleId';
const FILTER_KEYS = ['q', 'status', 'roleId'] as const;

interface RowHandlers {
  selfId: number;
  open: (u: AppUser) => void;
  confirm: (c: NonNullable<UserConfirm>) => void;
  setStatus: (u: AppUser, status: 'active' | 'disabled') => void;
  unlock: (u: AppUser) => void;
}

function RowMenu({ user, h }: { user: AppUser; h: RowHandlers }) {
  const locked = statusOf(user) === 'locked';
  const restricted = user.isSuperAdmin;
  const isSelf = user.id === h.selfId;
  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${user.name}`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={() => h.open(user)}>
            <Pencil /> {restricted ? 'View details' : 'Edit details'}
          </DropdownMenuItem>
          {!restricted && (
            <>
              <DropdownMenuItem onSelect={() => h.confirm({ kind: 'reset', user })}>
                <KeyRound /> Reset password
              </DropdownMenuItem>
              {locked && (
                <DropdownMenuItem onSelect={() => h.unlock(user)}>
                  <LockKeyholeOpen /> Unlock account
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={user.activeSessions === 0} onSelect={() => h.confirm({ kind: 'revoke', user })}>
                <LogOut /> Sign out everywhere
              </DropdownMenuItem>
              {!isSelf && (
                <>
                  <DropdownMenuSeparator />
                  {user.status === 'active' ? (
                    <DropdownMenuItem onSelect={() => h.setStatus(user, 'disabled')}>
                      <UserX /> Disable account
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => h.setStatus(user, 'active')}>
                      <UserCheck /> Enable account
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem destructive onSelect={() => h.confirm({ kind: 'delete', user })}>
                    <Trash2 /> Delete...
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const dash = <span className="text-muted-foreground">-</span>;

function buildColumns(h: RowHandlers): ColumnDef<AppUser>[] {
  return [
    {
      id: 'name',
      accessorKey: 'name',
      header: 'User',
      meta: { label: 'User', className: 'min-w-[17rem]' },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.original.name} size="sm" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              <span className="truncate">{row.original.name}</span>
              {row.original.isSuperAdmin && <ProtectedBadge />}
            </p>
            <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      enableSorting: false,
      meta: { label: 'Roles', className: 'min-w-[11rem]' },
      cell: ({ row }) => {
        const roles = row.original.roles;
        if (roles.length === 0) return <span className="text-muted-foreground">No role</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {roles.slice(0, 2).map((r) => (
              <Badge key={r.id} tone={row.original.isSuperAdmin ? 'primary' : 'neutral'}>
                {r.name}
              </Badge>
            ))}
            {roles.length > 2 && (
              <Badge tone="outline" title={roles.slice(2).map((r) => r.name).join(', ')}>
                +{roles.length - 2}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      meta: { label: 'Status' },
      cell: ({ row }) => (
        <div className="space-y-1">
          <UserStatusPill user={row.original} />
          {row.original.mustChangePassword && <p className="whitespace-nowrap text-[11px] text-muted-foreground">Temporary password</p>}
        </div>
      ),
    },
    {
      id: 'lastLoginAt',
      accessorKey: 'lastLoginAt',
      header: 'Last sign-in',
      meta: { label: 'Last sign-in' },
      cell: ({ row }) =>
        row.original.lastLoginAt ? (
          <div>
            <RelativeTime iso={row.original.lastLoginAt} />
            {row.original.lastLoginIp && <p className="font-mono text-[11px] text-muted-foreground">{row.original.lastLoginIp}</p>}
          </div>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      id: 'sessions',
      header: 'Sessions',
      enableSorting: false,
      meta: { label: 'Active sessions', align: 'right' },
      cell: ({ row }) => (row.original.activeSessions > 0 ? <span className="font-figure">{row.original.activeSessions}</span> : dash),
    },
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: 'Created',
      meta: { label: 'Created' },
      cell: ({ row }) => (
        <span className="font-figure whitespace-nowrap text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: 'Actions', className: 'w-12 pl-0 text-right' },
      cell: ({ row }) => <RowMenu user={row.original} h={h} />,
    },
  ];
}

export default function UsersPage() {
  usePageMeta({ title: 'Users' });
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const state = useDataTableState<FilterKey>({ filterKeys: FILTER_KEYS, defaultPageSize: 25, defaultSort: { id: 'name', desc: false } });
  const roles = useRoles();

  const result = useDataTableQuery<AppUser, FilterKey>({
    state,
    queryKey: (q) => qk.users.list(q as unknown as UserListQuery),
    fetcher: (q, signal) => {
      const { roleId, status, ...rest } = q;
      return listUsers(
        { ...rest, status: status === 'active' || status === 'disabled' ? status : undefined, roleId: roleId ? Number(roleId) : undefined },
        signal,
      );
    },
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<number | null>(null);
  const [confirm, setConfirm] = React.useState<UserConfirm>(null);
  const setStatus = useSetUserStatus();
  const unlock = useUnlockUser();

  // `?new=1` (command palette) opens the create sheet.
  const wantsNew = params.get('new') === '1';
  React.useEffect(() => {
    if (!wantsNew) return;
    setCreateOpen(true);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsNew, setParams]);

  const handlers = React.useMemo<RowHandlers>(
    () => ({
      selfId: me?.id ?? -1,
      open: (u) => setDetailId(u.id),
      confirm: setConfirm,
      setStatus: (u, status) => setStatus.mutate({ user: u, status }),
      unlock: (u) => unlock.mutate(u),
    }),
    [me?.id, setStatus, unlock],
  );
  const columns = React.useMemo(() => buildColumns(handlers), [handlers]);

  const items = result.data?.items ?? [];
  const detailUser = detailId === null ? null : (items.find((u) => u.id === detailId) ?? null);
  const lastDetail = React.useRef<AppUser | null>(null);
  if (detailUser) lastDetail.current = detailUser;
  const total = result.data?.total;

  const roleOptions = (roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name }));

  return (
    <>
      <PageHeader
        title="Users"
        description={
          total === undefined
            ? 'People who can sign in to this application, and the roles that define what they can do.'
            : `${total.toLocaleString()} ${total === 1 ? 'user' : 'users'}${state.hasFilters ? ' match the filters' : ''}. Roles decide what each can see and change.`
        }
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            Create user
          </Button>
        }
      />

      <DataTable<AppUser>
        id="users"
        caption="Application users"
        columns={columns}
        data={items}
        total={result.data?.total ?? 0}
        state={state}
        getRowId={(u) => String(u.id)}
        loading={result.isPending}
        fetching={result.isFetching}
        error={result.error}
        onRetry={() => void result.refetch()}
        onRowClick={(u) => setDetailId(u.id)}
        noun={{ singular: 'user', plural: 'users' }}
        toolbar={
          <>
            <DataTableSearch value={state.filters.q} onChange={(v) => state.setFilter('q', v)} placeholder="Search name or email..." label="Search users" />
            <DataTableFilterSelect
              label="Status"
              value={state.filters.status}
              onChange={(v) => state.setFilter('status', v)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              allLabel="Any status"
            />
            <DataTableFilterSelect label="Role" value={state.filters.roleId} onChange={(v) => state.setFilter('roleId', v)} options={roleOptions} allLabel="All roles" />
          </>
        }
        emptyState={
          <EmptyState
            bare
            icon={<UserCog />}
            title={state.hasFilters ? 'No users match these filters' : 'No users yet'}
            description={state.hasFilters ? 'Try a different search or clear the filters.' : 'Create the first account, then give it a role so it can sign in and do something useful.'}
            action={
              state.hasFilters ? (
                <Button variant="secondary" size="sm" onClick={state.resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden="true" />
                  Create user
                </Button>
              )
            }
          />
        }
      />

      <UserCreateSheet open={createOpen} onOpenChange={setCreateOpen} />
      <UserDetailSheet
        user={detailUser ?? (detailId !== null ? lastDetail.current : null)}
        open={detailId !== null}
        onOpenChange={(o) => !o && setDetailId(null)}
        selfId={me?.id ?? -1}
        onConfirm={setConfirm}
      />
      <UserActionDialogs target={confirm} onClose={() => setConfirm(null)} onDeleted={(u) => u.id === detailId && setDetailId(null)} />
    </>
  );
}
