import * as React from 'react';
import { CalendarX2, ChevronDown, Clock3, Info, Pencil, Plus, RefreshCcw, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TimingAssignment, TimingProfile } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { addDaysYmd, formatDate, todayYmd } from '../../../lib/dates';
import { deleteAssignment, deleteTiming, makeTimingDefault, recomputeAttendance } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { explainTiming } from '../../../lib/rules-ui';
import { ORG_UNIT } from '../../../lib/terms';
import { cn } from '../../../lib/utils';
import { useAssignments, useTimings, useTimingSetup } from '../../../hooks/use-rules';
import { usePageMeta } from '../../../hooks/use-page-meta';
import { Gate } from '../../../components/auth/gate';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../../components/ui/alert-dialog';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { IconButton } from '../../../components/ui/icon-button';
import { PageHeader } from '../../../components/ui/page-header';
import { RangePicker } from '../../../components/ui/range-picker';
import { Skeleton } from '../../../components/ui/skeleton';
import { AssignmentSheet } from './AssignmentSheet';
import { EndAssignmentDialog } from './EndAssignmentDialog';
import { ProfileSheet } from './ProfileSheet';
import { VersionHistory, WEEK_ORDER, WeekStrip } from './timing-bits';

export default function TimingsPage() {
  usePageMeta({ title: 'Office timings', entityType: 'timing' });
  const { can } = useAuth();
  const canManage = can('timings.manage');
  const timings = useTimings();
  const assignments = useAssignments();
  const { configured } = useTimingSetup();
  const profiles = timings.data ?? [];
  const def = profiles.find((p) => p.isDefault);
  const guided = configured === false;

  const [editing, setEditing] = React.useState<TimingProfile | 'new' | null>(null);
  const lastEditing = React.useRef<TimingProfile | 'new' | null>(null);
  if (editing) lastEditing.current = editing;
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<TimingProfile | null>(null);
  const lastDeleting = React.useRef<TimingProfile | null>(null);
  if (deleting) lastDeleting.current = deleting;
  const [unassign, setUnassign] = React.useState<TimingAssignment | null>(null);
  const lastUnassign = React.useRef<TimingAssignment | null>(null);
  if (unassign) lastUnassign.current = unassign;
  const [ending, setEnding] = React.useState<TimingAssignment | null>(null);
  const today = todayYmd();
  const yesterday = addDaysYmd(today, -1);

  const shownProfile = editing ?? lastEditing.current;
  // First-time setup: open the default profile in the guided editor once.
  const autoOpened = React.useRef(false);
  React.useEffect(() => {
    if (guided && canManage && def && !autoOpened.current) {
      autoOpened.current = true;
      setEditing(def);
    }
  }, [guided, canManage, def]);

  const makeDefault = useApiMutation<TimingProfile, TimingProfile>({
    mutationFn: (p) => makeTimingDefault(p.id),
    invalidate: [qk.timings.all, qk.daily.all],
    successMessage: (p) => `${p.name} is now the default`,
  });
  const removeProfile = useApiMutation<void, TimingProfile>({
    mutationFn: (p) => deleteTiming(p.id),
    invalidate: [qk.timings.all],
    successMessage: 'Profile deleted',
    onSuccess: () => setDeleting(null),
    onError: () => setDeleting(null),
  });
  const removeAssignment = useApiMutation<void, TimingAssignment>({
    mutationFn: (a) => deleteAssignment(a.id),
    invalidate: [qk.timings.all, qk.daily.all],
    successMessage: 'Assignment removed',
    onSuccess: () => setUnassign(null),
  });

  return (
    <>
      <PageHeader
        title="Office timings"
        description="Working hours and grace periods decide who is late, early or absent. Changes apply from the date you choose; earlier days keep the timings that were in force then."
        actions={
          <Gate perm="timings.manage" action="manage office timings">
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              New profile
            </Button>
          </Gate>
        }
      />

      {guided && (
        <div role="status" className="mb-5 flex items-start gap-3 rounded-lg border border-info/30 bg-info-subtle/70 px-4 py-3.5">
          <Info className="mt-0.5 size-5 shrink-0 text-info-text" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-[13px] leading-snug text-info-text">
            <p className="text-sm font-semibold">Office timings haven&apos;t been set yet</p>
            <p>{canManage ? 'Set your office hours and grace periods once; late, early and absent are calculated from them.' : 'Ask an administrator to set them up.'}</p>
          </div>
          {canManage && def && (
            <Button size="sm" onClick={() => setEditing(def)}>
              Set up now
            </Button>
          )}
        </div>
      )}

      <section aria-label="Timing profiles" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Profiles</h2>
        {timings.isPending ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-56" />
            <Skeleton className="h-56" />
          </div>
        ) : timings.isError ? (
          <ErrorState error={timings.error} onRetry={() => void timings.refetch()} retrying={timings.isFetching} />
        ) : profiles.length === 0 ? (
          <EmptyState icon={<Clock3 />} title="No timing profiles" description="Create the first profile to start calculating late, early and absent." action={canManage ? <Button onClick={() => setEditing('new')}>New profile</Button> : undefined} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {profiles.map((p) => (
              <ProfileCard
                key={p.id}
                p={p}
                canManage={canManage}
                busyDefault={makeDefault.isPending && makeDefault.variables?.id === p.id}
                onEdit={() => setEditing(p)}
                onMakeDefault={() => makeDefault.mutate(p)}
                onDelete={() => setDeleting(p)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Assignments" className="mt-8 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Assignments</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
              Who follows which profile, and when. An employee assignment beats a {ORG_UNIT.lower} assignment, which beats everyone; a dated assignment (such as Ramadan) beats an open-ended one. Anyone not covered follows the default profile.
            </p>
          </div>
          <Gate perm="timings.manage" action="manage office timings">
            <Button variant="secondary" onClick={() => setAssignOpen(true)} disabled={profiles.length === 0}>
              <Plus aria-hidden="true" />
              Add assignment
            </Button>
          </Gate>
        </div>
        <Card className="overflow-hidden">
          {assignments.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : assignments.isError ? (
            <ErrorState bare error={assignments.error} onRetry={() => void assignments.refetch()} retrying={assignments.isFetching} />
          ) : (assignments.data ?? []).length === 0 ? (
            <EmptyState bare icon={<Clock3 />} title="Everyone follows the default profile" description="Add an assignment for seasonal hours such as Ramadan, or for one wing or person." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Timing assignments</caption>
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-medium">Applies to</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Profile</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Effective</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Label</th>
                    <th scope="col" className="w-12 px-4 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {assignments.data!.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{a.scopeLabel}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{a.scope === 'all' ? 'Everyone' : a.scope === 'wing' ? ORG_UNIT.singular : 'Employee'}</span>
                      </td>
                      <td className="px-4 py-2.5">{a.profileName}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {formatDate(a.effectiveFrom)} {'→'} {a.effectiveTo ? formatDate(a.effectiveTo) : <span className="text-muted-foreground">open-ended</span>}
                      </td>
                      <td className="px-4 py-2.5">{a.label ? <Badge tone="primary">{a.label}</Badge> : <span className="text-muted-foreground">-</span>}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        {canManage &&
                          (a.effectiveFrom > today ? (
                            // Not started yet: can be removed completely.
                            <IconButton label={`Remove assignment for ${a.scopeLabel}`} icon={<Trash2 />} size="icon-sm" variant="destructive-ghost" onClick={() => setUnassign(a)} />
                          ) : a.effectiveTo && a.effectiveTo < yesterday ? (
                            // Finished before yesterday: history only, nothing to change.
                            <span className="text-xs text-muted-foreground">Ended</span>
                          ) : (
                            // Running (or ends soon): end it or move the end date; past days are untouched.
                            <Button size="sm" variant="ghost" onClick={() => setEnding(a)}>
                              <CalendarX2 aria-hidden="true" />
                              {a.effectiveTo ? 'Change end' : 'End'}
                            </Button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {canManage && <RecalculateCard />}

      <ProfileSheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        profile={editing === 'new' ? null : (editing ?? (lastEditing.current === 'new' ? null : lastEditing.current))}
        guided={guided && shownProfile !== null && shownProfile !== 'new' && shownProfile.isDefault}
      />
      <AssignmentSheet open={assignOpen} onOpenChange={setAssignOpen} profiles={profiles} setupOpen={guided} />
      <EndAssignmentDialog assignment={ending} onOpenChange={(o) => !o && setEnding(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !removeProfile.isPending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this profile?</AlertDialogTitle>
            <AlertDialogDescription>{lastDeleting.current ? `${lastDeleting.current.name} will be deleted. A profile that is the default or is used by an assignment cannot be deleted.` : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeProfile.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={(e) => { e.preventDefault(); if (deleting) removeProfile.mutate(deleting); }}>
              {removeProfile.isPending ? 'Deleting...' : 'Delete profile'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unassign !== null} onOpenChange={(o) => !o && !removeAssignment.isPending && setUnassign(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              {lastUnassign.current ? `This assignment hasn't started yet (it would begin ${formatDate(lastUnassign.current.effectiveFrom)}), so it will be removed completely. ${lastUnassign.current.scopeLabel} keeps their current timing.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeAssignment.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={(e) => { e.preventDefault(); if (unassign) removeAssignment.mutate(unassign); }}>
              {removeAssignment.isPending ? 'Removing...' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProfileCard({ p, canManage, busyDefault, onEdit, onMakeDefault, onDelete }: { p: TimingProfile; canManage: boolean; busyDefault: boolean; onEdit: () => void; onMakeDefault: () => void; onDelete: () => void }) {
  const [open, setOpen] = React.useState(false);
  const firstOn = WEEK_ORDER.map((d) => p.days[d]).find((d) => d);
  return (
    <Card className={cn('flex flex-col p-5', p.isDefault && 'border-primary/40')}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold tracking-tight">{p.name}</h3>
            {p.isDefault && <Badge tone="primary"><Star aria-hidden="true" /> Default</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.assignmentCount === 0 ? 'Not assigned' : `${p.assignmentCount} ${p.assignmentCount === 1 ? 'assignment' : 'assignments'}`}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1">
            <IconButton label={`Edit ${p.name}`} icon={<Pencil />} size="icon-sm" variant="secondary" onClick={onEdit} />
            {!p.isDefault && <IconButton label={`Delete ${p.name}`} icon={<Trash2 />} size="icon-sm" variant="destructive-ghost" onClick={onDelete} />}
          </div>
        )}
      </div>
      <WeekStrip days={p.days} />
      <p className="mt-3 text-[13px] leading-snug text-muted-foreground">{explainTiming(firstOn?.start ?? null, firstOn?.end ?? null, p.graceLateMinutes, p.graceEarlyMinutes, p.halfDayBelowMinutes)}</p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          History ({p.versions.length})
        </button>
        {canManage && !p.isDefault && (
          <Button size="sm" variant="secondary" loading={busyDefault} onClick={onMakeDefault}>
            Make default
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 border-t pt-3">
          <VersionHistory versions={p.versions} />
        </div>
      )}
    </Card>
  );
}

function RecalculateCard() {
  const [range, setRange] = React.useState<{ from: string | null; to: string | null }>({ from: addDaysYmd(todayYmd(), -7), to: todayYmd() });
  const [confirm, setConfirm] = React.useState(false);
  const run = useApiMutation<{ queuedDays: number }, { from: string; to: string }>({
    mutationFn: recomputeAttendance,
    toastErrors: true,
    onSuccess: (r) => {
      setConfirm(false);
      toast.success(`Recalculation queued for ${r.queuedDays} ${r.queuedDays === 1 ? 'day' : 'days'}`);
    },
  });
  const ok = Boolean(range.from && range.to);
  return (
    <section aria-label="Recalculate attendance" className="mt-8">
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">Recalculate attendance</h2>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
            Re-applies the rules that were in force on each day to the dates you choose. Useful after data fixes, such as a late-arriving punch or a corrected holiday. It does not change which timings applied.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72">
            <RangePicker value={range} onChange={setRange} aria-label="Dates to recalculate" />
          </div>
          <Button variant="secondary" disabled={!ok} onClick={() => setConfirm(true)}>
            <RefreshCcw aria-hidden="true" />
            Recalculate
          </Button>
        </div>
      </Card>
      <AlertDialog open={confirm} onOpenChange={(o) => !run.isPending && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate attendance?</AlertDialogTitle>
            <AlertDialogDescription>
              {range.from && range.to ? `Attendance from ${formatDate(range.from)} to ${formatDate(range.to)} will be worked out again using the rules in force on each of those days. Corrections and leave are kept.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={run.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (range.from && range.to) run.mutate({ from: range.from, to: range.to });
              }}
            >
              {run.isPending ? 'Queuing...' : 'Recalculate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
