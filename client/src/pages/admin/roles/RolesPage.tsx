import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Copy, Globe2, Lock, Plus, ShieldCheck, Sparkles, Building2, Users } from 'lucide-react';
import { PERMISSION_KEYS } from '@nacta/shared';
import type { Role } from '@nacta/shared';
import { describeWings } from '../../../lib/wing-scope';
import { useWings, useRoles } from '../../../hooks/use-lookups';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { IconButton } from '../../../components/ui/icon-button';
import { PageHeader } from '../../../components/ui/page-header';
import { Skeleton } from '../../../components/ui/skeleton';
import { cn } from '../../../lib/utils';
import { usePageMeta } from '../../../hooks/use-page-meta';

function RoleCard({ role, wings }: { role: Role; wings: string }) {
  const navigate = useNavigate();
  const pct = Math.round((role.permissions.length / PERMISSION_KEYS.length) * 100);
  return (
    <li className="group relative flex flex-col rounded-lg border bg-card p-5 shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-ring hover:border-border-strong hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className={cn('grid size-10 shrink-0 place-content-center rounded-lg', role.isSystem ? 'bg-primary text-primary-foreground' : 'bg-primary-subtle text-primary-text')}>
          {role.isSystem ? <Lock className="size-[18px]" aria-hidden="true" /> : <ShieldCheck className="size-5" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Link
              to={`/admin/roles/${role.id}`}
              className="truncate rounded-sm after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none"
            >
              {role.name}
            </Link>
            {role.isSystem && <Badge tone="primary" className="relative px-1.5 py-0 text-[11px]">Built-in</Badge>}
          </h2>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-[13px] leading-snug text-muted-foreground">
            {role.description ?? (role.isSystem ? 'Full access to everything, always. Cannot be edited or deleted.' : 'No description.')}
          </p>
        </div>
        <IconButton
          label={`Duplicate ${role.name}`}
          icon={<Copy />}
          size="icon-sm"
          className="relative z-10 -mr-1 -mt-1 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={() => navigate(`/admin/roles/new?from=${role.id}`)}
        />
      </div>

      <div className="mb-4 mt-4 space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Permissions</span>
          <span className="font-figure text-muted-foreground">
            {role.permissions.length} of {PERMISSION_KEYS.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="mt-auto flex items-center gap-4 border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {role.allWings ? <Globe2 className="size-3.5" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}
          {wings}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <Users className="size-3.5" aria-hidden="true" />
          <span className="font-figure">{role.userCount}</span> {role.userCount === 1 ? 'user' : 'users'}
        </span>
      </div>
    </li>
  );
}

function CardSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading roles">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-52" />
      ))}
    </div>
  );
}

export default function RolesPage() {
  usePageMeta({ title: 'Roles' });
  const roles = useRoles();
  const wings = useWings();
  const list = roles.data ?? [];
  const onlySystem = roles.isSuccess && list.every((r) => r.isSystem);

  return (
    <>
      <PageHeader
        title="Roles"
        description="A role is a named set of permissions, optionally limited to some wings. Assign roles to users to control what they can see and do."
        actions={
          <Button asChild>
            <Link to="/admin/roles/new">
              <Plus aria-hidden="true" />
              Create role
            </Link>
          </Button>
        }
      />

      {roles.isPending ? (
        <CardSkeletons />
      ) : roles.isError ? (
        <ErrorState error={roles.error} onRetry={() => void roles.refetch()} retrying={roles.isFetching} title="Could not load roles" />
      ) : (
        <div className="space-y-6">
          {onlySystem && (
            <div className="flex flex-col gap-4 rounded-lg border border-primary/25 bg-primary-subtle p-5 sm:flex-row sm:items-center">
              <div className="grid size-11 shrink-0 place-content-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="text-sm font-semibold text-primary-text">Build your first role</h2>
                <p className="text-[13px] text-primary-text/80">
                  Only the built-in Super Admin exists. Create roles that match real jobs, such as an HR officer who manages employees, or a wing coordinator who only sees their own wing&apos;s attendance.
                </p>
              </div>
              <Button asChild>
                <Link to="/admin/roles/new">
                  Create a role
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}

          {list.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck />}
              title="No roles yet"
              description="Create a role, choose its permissions, then assign it to users."
              action={
                <Button asChild>
                  <Link to="/admin/roles/new">
                    <Plus aria-hidden="true" />
                    Create role
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Roles">
              {list.map((r) => (
                <RoleCard key={r.id} role={r} wings={describeWings(r.allWings, r.wingIds, wings.data)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

