import * as React from 'react';
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Copy, Info, Lock, ShieldCheck, Trash2, TriangleAlert, Users } from 'lucide-react';
import type { z } from 'zod';
import { ErrorCode, PERMISSION_KEYS, PERMISSIONS, zRoleInput } from '@nacta/shared';
import type { Permission, Role, RoleInput } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { createRole, deleteRole, updateRole } from '../../../lib/endpoints/roles';
import { qk } from '../../../lib/query-keys';
import { missingDependencies } from '../../../lib/permission-deps';
import { cn } from '../../../lib/utils';
import { useRoles } from '../../../hooks/use-lookups';
import { ActivityFeed } from '../../../components/audit/activity-feed';
import { useAuth } from '../../../lib/auth';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { usePageMeta } from '../../../hooks/use-page-meta';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { Textarea } from '../../../components/ui/textarea';
import { Tooltip } from '../../../components/ui/tooltip';
import { KEYS_BY_MODULE, PermissionMatrix } from './permission-matrix';
import { WingScopeField } from './wing-scope-field';
import { ORG_UNIT } from '../../../lib/terms';

const zRoleForm = zRoleInput.refine((v) => v.allWings || v.wingIds.length > 0, {
  path: ['wingIds'],
  message: `Choose at least one ${ORG_UNIT.lower}`,
});
type FormOut = z.output<typeof zRoleForm>;

function defaultsFor(role: Role | null, copy: boolean): RoleInput {
  return {
    name: role ? (copy ? `${role.name} (copy)`.slice(0, 60) : role.name) : '',
    description: role?.description ?? '',
    permissions: role ? [...role.permissions] : [],
    allWings: role?.allWings ?? true,
    wingIds: role ? [...role.wingIds] : [],
  };
}

function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading role" className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Skeleton className="h-52" />
          <Skeleton className="h-40" />
          <Skeleton className="h-96" />
        </div>
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}

/** /admin/roles/new and /admin/roles/:id */
export default function RoleEditorPage() {
  const { id: rawId } = useParams();
  const [params] = useSearchParams();
  const isNew = rawId === undefined;
  const id = Number(rawId);
  const fromId = Number(params.get('from'));
  const roles = useRoles();
  const knownRole = !isNew && Number.isInteger(id) ? roles.data?.find((r) => r.id === id) : undefined;
  usePageMeta({ title: isNew ? 'New role' : 'Role editor', entityType: isNew ? undefined : 'role', entityId: !isNew && Number.isInteger(id) ? id : undefined, entityLabel: knownRole?.name });

  if (roles.isPending) return <EditorSkeleton />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} retrying={roles.isFetching} title="Could not load roles" />;

  const list = roles.data;
  if (isNew) {
    const template = Number.isInteger(fromId) && fromId > 0 ? (list.find((r) => r.id === fromId) ?? null) : null;
    return <RoleEditor key={`new-${template?.id ?? 'blank'}`} role={null} template={template} />;
  }
  const role = Number.isInteger(id) ? list.find((r) => r.id === id) : undefined;
  if (!role) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Role not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild variant="secondary">
            <Link to="/admin/roles">
              <ArrowLeft aria-hidden="true" />
              Back to roles
            </Link>
          </Button>
        }
      />
    );
  }
  return <RoleEditor key={`${role.id}-${role.updatedAt}`} role={role} template={null} />;
}

function RoleEditor({ role, template }: { role: Role | null; template: Role | null }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [tabParams, setTabParams] = useSearchParams();
  const editing = role !== null;
  const locked = role?.isSystem ?? false;
  const showHistory = role !== null && can('audit.view');
  const historyTab = showHistory && tabParams.get('tab') === 'history';
  const setTab = (v: string) =>
    setTabParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === 'history') next.set('tab', 'history');
        else next.delete('tab');
        return next;
      },
      { replace: true },
    );

  const form = useForm<RoleInput, unknown, FormOut>({
    resolver: zodResolver(zRoleForm),
    defaultValues: defaultsFor(role ?? template, template !== null),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, watch, setValue } = form;
  const permissions = (watch('permissions') ?? []) as Permission[];
  const selected = React.useMemo(() => new Set<Permission>(permissions), [permissions]);
  const dirty = formState.isDirty;

  // ---- unsaved-changes guard (in-app navigation + tab close) ----
  const bypass = React.useRef(false);
  const dirtyRef = React.useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && !bypass.current && currentLocation.pathname !== nextLocation.pathname);
  React.useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const leave = (to: string) => {
    bypass.current = true;
    navigate(to);
  };

  const save = useApiMutation<Role, FormOut, RoleInput>({
    form,
    mutationFn: (v) => (role ? updateRole(role.id, v) : createRole(v)),
    invalidate: [qk.roles.all, qk.users.all],
    successMessage: (r) => (editing ? `Saved ${r.name}` : `Created role ${r.name}`),
    errorMessage: 'Could not save the role',
    onError: (err) => {
      if (err.code === ErrorCode.DUPLICATE_ROLE) form.setError('name', { type: 'server', message: 'A role with this name already exists' }, { shouldFocus: true });
    },
    onSuccess: () => leave('/admin/roles'),
  });

  const missingAll = React.useMemo(() => {
    const need = new Set<Permission>();
    for (const k of permissions) for (const m of missingDependencies(k, selected)) need.add(m);
    return [...need];
  }, [permissions, selected]);

  const setPermissions = (next: Permission[]) => setValue('permissions', next, { shouldDirty: true, shouldTouch: true });
  const total = PERMISSION_KEYS.length;
  const pct = Math.round((permissions.length / total) * 100);
  const wingIds = watch('wingIds') ?? [];
  const allWings = watch('allWings') ?? true;

  const onSubmit = handleSubmit((v) => save.mutate(v));

  const title = editing ? role.name : template ? 'New role from template' : 'New role';

  const summary = (
    <Card className="lg:sticky lg:top-6">
      <CardHeader className="p-5 pb-0">
        <div>
          <CardTitle>Summary</CardTitle>
          <CardDescription>{locked ? 'Built-in role. Read only.' : dirty ? 'You have unsaved changes.' : editing ? 'No changes yet.' : 'Choose what this role can do.'}</CardDescription>
        </div>
        {dirty && !locked && <span className="mt-1 size-2 rounded-full bg-warning" role="img" aria-label="Unsaved changes" />}
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="font-figure text-3xl font-semibold tracking-tight" aria-live="polite">
            {permissions.length}
            <span className="text-base font-normal text-muted-foreground"> of {total} permissions</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={permissions.length} aria-label="Permissions selected">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <ul className="space-y-1.5 text-[13px]">
          {KEYS_BY_MODULE.map(({ module, keys }) => {
            const n = keys.filter((k) => selected.has(k)).length;
            return (
              <li key={module} className="flex items-center justify-between">
                <span className={n === 0 ? 'text-muted-foreground' : undefined}>{module}</span>
                <span className={cn('font-figure', n === 0 ? 'text-muted-foreground' : 'font-medium')}>
                  {n}/{keys.length}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="rounded-md bg-muted/60 px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">{ORG_UNIT.plural}: </span>
          <span className="font-medium">{allWings ? `All ${ORG_UNIT.lowerPlural}` : `${wingIds.length} selected`}</span>
        </div>

        {missingAll.length > 0 && !locked && (
          <div role="status" className="space-y-2 rounded-md bg-warning-subtle px-3 py-2.5 text-xs text-warning-text">
            <p className="flex items-start gap-1.5">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              {missingAll.length} suggested {missingAll.length === 1 ? 'permission is' : 'permissions are'} missing: {missingAll.map((m) => PERMISSIONS[m].label).join(', ')}.
            </p>
            <Button
              type="button"
              variant="link"
              className="h-auto text-xs font-semibold text-warning-text"
              onClick={() => setPermissions(PERMISSION_KEYS.filter((k) => selected.has(k) || missingAll.includes(k)))}
            >
              Add {missingAll.length === 1 ? 'it' : 'all'}
            </Button>
          </div>
        )}
        {permissions.length === 0 && !locked && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />A role with no permissions cannot do anything yet.
          </p>
        )}

        {!locked && (
          <div className="hidden gap-2 lg:flex">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => navigate('/admin/roles')} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={save.isPending} disabled={editing && !dirty}>
              {editing ? 'Save changes' : 'Create role'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <form onSubmit={onSubmit} noValidate className="pb-24 lg:pb-0">
      <PageHeader
        breadcrumbs={[{ label: 'Roles', to: '/admin/roles' }, { label: editing ? role.name : 'New role' }]}
        title={title}
        meta={
          <>
            {locked && (
              <Badge tone="primary">
                <Lock aria-hidden="true" /> Built-in
              </Badge>
            )}
            {editing && (
              <Badge tone="outline">
                <Users aria-hidden="true" /> {role.userCount} {role.userCount === 1 ? 'user' : 'users'}
              </Badge>
            )}
          </>
        }
        description={
          locked
            ? 'Super Admin always has every permission across all wings. It cannot be edited or deleted.'
            : editing
              ? 'Change what people with this role can see and do. Changes apply the next time they load a page.'
              : template
                ? `Starting from ${template.name}. Give it a name and adjust the permissions.`
                : 'Name the role, pick its permissions and choose which wings it covers.'
        }
        actions={
          editing && (
            <Button type="button" variant="secondary" onClick={() => navigate(`/admin/roles/new?from=${role.id}`)}>
              <Copy aria-hidden="true" />
              Duplicate role
            </Button>
          )
        }
      />

      {showHistory && (
        <Tabs value={historyTab ? 'history' : 'settings'} onValueChange={setTab} className="mb-6">
          <TabsList aria-label="Role sections">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {historyTab && role && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>History</CardTitle>
              <CardDescription>Who created or changed this role, and exactly which permissions were added or removed.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <ActivityFeed filter={{ entityType: 'role', entityId: String(role.id) }} hide="subject" emptyDescription="Changes to this role will appear here." />
          </CardContent>
        </Card>
      )}

      <div className={cn(historyTab && 'hidden')}>
      {locked && (
        <div className="mb-6 flex gap-3 rounded-lg border border-primary/25 bg-primary-subtle p-3.5 text-[13px] text-primary-text">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>This role is built in and locked. Use &ldquo;Duplicate role&rdquo; to create an editable copy with the same permissions.</p>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Details</CardTitle>
                <CardDescription>Shown when assigning roles to users.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField label="Role name" required error={formState.errors.name} hint="For example: HR Officer, Wing Coordinator, Auditor.">
                <Input autoComplete="off" autoFocus={!editing} readOnly={locked} placeholder="e.g. HR Officer" maxLength={60} {...register('name')} />
              </FormField>
              <FormField label="Description" error={formState.errors.description as { message?: string } | undefined} hint="Optional. Helps other admins understand the role.">
                <Textarea rows={2} readOnly={locked} placeholder="What is this role for?" maxLength={300} {...register('description')} />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>{ORG_UNIT.singular} scope</CardTitle>
                <CardDescription>Limits employees, attendance and dashboard data to specific {ORG_UNIT.lowerPlural}.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Controller
                control={control}
                name="allWings"
                render={() => (
                  <WingScopeField
                    allWings={locked ? true : allWings}
                    wingIds={wingIds}
                    disabled={locked}
                    error={(formState.errors.wingIds as { message?: string } | undefined)?.message}
                    onChange={(v) => {
                      setValue('allWings', v.allWings, { shouldDirty: true });
                      setValue('wingIds', v.wingIds, { shouldDirty: true, shouldValidate: formState.isSubmitted });
                    }}
                  />
                )}
              />
            </CardContent>
          </Card>

          <section aria-labelledby="permissions-heading" className="space-y-3">
            <div>
              <h2 id="permissions-heading" className="text-base font-semibold tracking-tight">
                Permissions
              </h2>
              <p className="text-[13px] text-muted-foreground">Switch on everything this role may do. Anything left off is hidden or disabled for its users.</p>
            </div>
            <PermissionMatrix selected={locked ? new Set(PERMISSION_KEYS) : selected} onChange={setPermissions} readOnly={locked} />
          </section>

          {editing && !locked && <DangerZone role={role} onDeleted={() => leave('/admin/roles')} />}
        </div>

        <div className="order-first lg:order-none lg:self-stretch">{summary}</div>
      </div>

      </div>

      {!locked && !historyTab && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <p className="font-figure mr-auto text-sm">
            <span className="font-semibold">{permissions.length}</span>
            <span className="text-muted-foreground"> of {total} permissions</span>
          </p>
          <Button type="button" variant="secondary" onClick={() => navigate('/admin/roles')} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={editing && !dirty}>
            {editing ? 'Save' : 'Create'}
          </Button>
        </div>
      )}

      <AlertDialog open={blocker.state === 'blocked'} onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>Your changes to this role have not been saved. If you leave now they will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.state === 'blocked' && blocker.proceed()}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function DangerZone({ role, onDeleted }: { role: Role; onDeleted: () => void }) {
  const [open, setOpen] = React.useState(false);
  const del = useApiMutation<void, void>({
    mutationFn: () => deleteRole(role.id),
    invalidate: [qk.roles.all, qk.users.all],
    successMessage: `Deleted role ${role.name}`,
    errorMessage: 'Could not delete the role',
    onSuccess: () => {
      setOpen(false);
      onDeleted();
    },
  });
  const blocked = role.userCount > 0;
  return (
    <section aria-label="Danger zone" className="rounded-lg border border-danger/30 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-lg">
          <h3 className="text-sm font-semibold text-danger-text">Delete role</h3>
          {blocked ? (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {role.userCount} {role.userCount === 1 ? 'user has' : 'users have'} this role. Move {role.userCount === 1 ? 'them' : 'them'} to another role first, from{' '}
              <Link to={`/admin/users?roleId=${role.id}`} className="font-medium text-primary-text underline-offset-4 hover:underline">
                the Users page
              </Link>
              , then you can delete it.
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">No users hold this role. Deleting it cannot be undone.</p>
          )}
        </div>
        <Tooltip content={blocked ? 'Reassign its users before deleting' : ''}>
          <span className="inline-flex" tabIndex={blocked ? 0 : undefined}>
            <Button type="button" variant="destructive-ghost" disabled={blocked} onClick={() => setOpen(true)}>
              <Trash2 aria-hidden="true" />
              Delete role...
            </Button>
          </span>
        </Tooltip>
      </div>
      <AlertDialog open={open} onOpenChange={(o) => !del.isPending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
            <AlertDialogDescription>The role and its permission set are removed. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Keep role</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                del.mutate();
              }}
            >
              {del.isPending ? 'Deleting...' : 'Delete role'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}


