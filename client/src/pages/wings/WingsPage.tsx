import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, MoreHorizontal, Pencil, Plus, Trash2, UserRound, Users } from 'lucide-react';
import type { Wing } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { deleteWing } from '../../lib/endpoints/wings';
import { qk } from '../../lib/query-keys';
import { useAuth } from '../../lib/auth';
import { ORG_UNIT } from '../../lib/terms';
import { useWings } from '../../hooks/use-lookups';
import { usePageMeta } from '../../hooks/use-page-meta';
import { Gate } from '../../components/auth/gate';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { IconButton } from '../../components/ui/icon-button';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
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
import { WingSheet } from './WingSheet';

const MAX_CHIPS = 6;
const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`;

function WingCard({ wing, canEdit, onEdit, onDelete }: { wing: Wing; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const shown = wing.sections.slice(0, MAX_CHIPS);
  const extra = wing.sections.length - shown.length;
  return (
    <Card className="flex flex-col p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold tracking-tight">{wing.name}</h2>
            {wing.code && (
              <Badge tone="primary" className="shrink-0 font-mono text-[11px] tracking-wide">
                {wing.code}
              </Badge>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
            <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
            {wing.headName ?? <span className="italic">No head set</span>}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Actions for ${wing.name}`} icon={<MoreHorizontal />} size="icon-sm" tooltip={false} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil /> {canEdit ? 'Edit and sections' : 'View details'}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to={`/employees?wingId=${wing.id}`}>
                <Users /> View employees
              </Link>
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onSelect={onDelete}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-figure text-3xl font-semibold tracking-tight">{wing.employeeCount.toLocaleString()}</span>
        <span className="text-sm text-muted-foreground">{wing.employeeCount === 1 ? 'employee' : 'employees'}</span>
      </div>

      <div className="mt-4 min-h-[2rem]">
        {wing.sections.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sections</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Sections of ${wing.name}`}>
            {shown.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/employees?wingId=${wing.id}&sectionId=${s.id}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-2.5 py-0.5 text-xs transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`${s.name}: ${people(s.employeeCount)}`}
                >
                  {s.name}
                  <span className="tabular-nums text-muted-foreground">{s.employeeCount}</span>
                </Link>
              </li>
            ))}
            {extra > 0 && (
              <li>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  +{extra} more
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between border-t pt-3">
        <Link
          to={`/employees?wingId=${wing.id}`}
          className="inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Users className="size-3.5" aria-hidden="true" />
          View employees
        </Link>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {canEdit ? 'Edit' : 'Details'}
        </Button>
      </div>
    </Card>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading wings">
      {Array.from({ length: 6 }, (_, i) => (
        <Card key={i} className="space-y-4 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-20" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function WingsPage() {
  usePageMeta({ title: ORG_UNIT.plural });
  const { can } = useAuth();
  const canEdit = can('wings.manage');
  const wings = useWings();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = React.useState<{ wingId: number | null } | null>(null);
  const [toDelete, setToDelete] = React.useState<Wing | null>(null);
  const lastDeleted = React.useRef<Wing | null>(null);
  if (toDelete) lastDeleted.current = toDelete;

  // `?new=1` opens the add sheet (command palette / deep links).
  const wantsNew = params.get('new') === '1';
  React.useEffect(() => {
    if (!wantsNew) return;
    if (canEdit) setSheet({ wingId: null });
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [wantsNew, canEdit, setParams]);

  const list = wings.data ?? [];
  const editingWing = sheet?.wingId ? (list.find((w) => w.id === sheet.wingId) ?? null) : null;
  const totalPeople = list.reduce((n, w) => n + w.employeeCount, 0);

  const remove = useApiMutation<void, number>({
    mutationFn: (id) => deleteWing(id),
    invalidate: [qk.wings.all, qk.employees.all],
    successMessage: 'Wing deleted',
    onSuccess: () => setToDelete(null),
  });

  const target = toDelete ?? lastDeleted.current;

  return (
    <>
      <PageHeader
        title={ORG_UNIT.plural}
        description={
          wings.data
            ? `${list.length} ${list.length === 1 ? 'wing' : 'wings'} with ${people(totalPeople)} assigned. Sections group people inside a wing.`
            : 'The organisational units people belong to, and the sections inside them.'
        }
        actions={
          <Gate perm="wings.manage" action="add wings">
            <Button onClick={() => setSheet({ wingId: null })}>
              <Plus aria-hidden="true" />
              Add wing
            </Button>
          </Gate>
        }
      />

      {wings.isPending ? (
        <GridSkeleton />
      ) : wings.isError ? (
        <ErrorState error={wings.error} onRetry={() => void wings.refetch()} retrying={wings.isFetching} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No wings yet"
          description="Create the first wing, then add sections and assign employees to them."
          action={
            <Gate perm="wings.manage" action="add wings">
              <Button size="sm" onClick={() => setSheet({ wingId: null })}>
                <Plus aria-hidden="true" />
                Add wing
              </Button>
            </Gate>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((w) => (
            <WingCard key={w.id} wing={w} canEdit={canEdit} onEdit={() => setSheet({ wingId: w.id })} onDelete={() => setToDelete(w)} />
          ))}
        </div>
      )}

      <WingSheet
        open={sheet !== null}
        onOpenChange={(o) => !o && setSheet(null)}
        wing={editingWing}
        onCreated={(w) => setSheet({ wingId: w.id })}
      />

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && !remove.isPending && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {target && target.employeeCount > 0
                ? `${people(target.employeeCount)} will keep their record but lose this wing${target.sections.length ? ' and its sections' : ''}. Their attendance history is not affected.`
                : `No one is assigned to this wing.${target?.sections.length ? ' Its sections are deleted too.' : ''}`}{' '}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) remove.mutate(toDelete.id);
              }}
            >
              {remove.isPending ? 'Deleting...' : 'Delete wing'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
