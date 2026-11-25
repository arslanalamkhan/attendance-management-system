import * as React from 'react';
import { CalendarHeart, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { zHolidayInput } from '@nacta/shared';
import type { Holiday, HolidayInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, parseYmd, todayYmd, toYmd } from '../../lib/dates';
import { createHoliday, deleteHoliday, updateHoliday } from '../../lib/endpoints/rules';
import { qk } from '../../lib/query-keys';
import { rangeLabel } from '../../lib/rules-ui';
import { ORG_UNIT } from '../../lib/terms';
import { cn } from '../../lib/utils';
import { useWings } from '../../hooks/use-lookups';
import { useHolidays } from '../../hooks/use-rules';
import { usePageMeta } from '../../hooks/use-page-meta';
import { Gate } from '../../components/auth/gate';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DatePicker } from '../../components/ui/date-picker';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { MultiCombobox } from '../../components/ui/multi-combobox';
import { PageHeader } from '../../components/ui/page-header';
import { RangePicker } from '../../components/ui/range-picker';
import { Segmented } from '../../components/ui/segmented';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';

const MONTHS = Array.from({ length: 12 }, (_, i) => i);

export default function HolidaysPage() {
  usePageMeta({ title: 'Holidays', entityType: 'holiday' });
  const { can } = useAuth();
  const canEdit = can('holidays.manage');
  const [year, setYear] = React.useState(() => new Date().getFullYear());
  const q = useHolidays(year);
  const [editing, setEditing] = React.useState<Holiday | 'new' | null>(null);
  const lastEditing = React.useRef<Holiday | 'new' | null>(null);
  if (editing) lastEditing.current = editing;
  const [deleting, setDeleting] = React.useState<Holiday | null>(null);
  const lastDeleting = React.useRef<Holiday | null>(null);
  if (deleting) lastDeleting.current = deleting;

  const remove = useApiMutation<void, Holiday>({
    mutationFn: (h) => deleteHoliday(h.id),
    invalidate: [qk.holidays.all, qk.daily.all, qk.leaves.all],
    successMessage: 'Holiday removed',
    onSuccess: () => setDeleting(null),
  });

  const items = q.data ?? [];
  const byDay = React.useMemo(() => {
    const m = new Map<string, Holiday>();
    for (const h of items) {
      for (let d = parseYmd(h.from), g = 0; toYmd(d) <= h.to && g < 400; d.setDate(d.getDate() + 1), g++) m.set(toYmd(d), h);
    }
    return m;
  }, [items]);

  const open = (h: Holiday | 'new') => setEditing(h);

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Days the office is closed, and normally-off days that are worked instead. Holidays are skipped when counting leave and never count as absent."
        actions={
          <Gate perm="holidays.manage" action="manage holidays">
            <Button onClick={() => open('new')}>
              <Plus aria-hidden="true" />
              Add holiday
            </Button>
          </Gate>
        }
      />

      <div className="mb-4 flex items-center gap-1" role="group" aria-label="Year">
        <IconButton label="Previous year" icon={<ChevronLeft />} size="icon-sm" variant="secondary" onClick={() => setYear(year - 1)} />
        <span className="w-20 text-center text-lg font-semibold tabular-nums tracking-tight" aria-live="polite">
          {year}
        </span>
        <IconButton label="Next year" icon={<ChevronRight />} size="icon-sm" variant="secondary" onClick={() => setYear(year + 1)} />
        <Button size="sm" variant="secondary" disabled={year === new Date().getFullYear()} onClick={() => setYear(new Date().getFullYear())} className="ml-1">
          This year
        </Button>
        {q.isFetching && !q.isPending && <span className="ml-2 text-xs text-muted-foreground">Updating...</span>}
      </div>

      {q.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {MONTHS.map((m) => (
            <Skeleton key={m} className="h-44" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarHeart />}
          title={`No holidays for ${year} yet`}
          description={`Add Pakistan's public holidays for ${year}–${String(year + 1).slice(2)} (Kashmir Day, Pakistan Day, Labour Day, Eid...). Dates of Islamic holidays move every year, so enter them from the official notification.`}
          action={
            canEdit ? (
              <Button onClick={() => open('new')}>
                <Plus aria-hidden="true" />
                Add the first holiday
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">Ask an administrator with the &ldquo;Manage holidays&rdquo; permission to add them.</p>
            )
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <section aria-label={`Calendar ${year}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {MONTHS.map((m) => (
              <MiniMonth key={m} year={year} month={m} byDay={byDay} onPick={(h) => canEdit && open(h)} canEdit={canEdit} />
            ))}
            <p className="col-span-full flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded bg-warning-subtle ring-1 ring-warning/40" /> Holiday
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded bg-info-subtle ring-1 ring-info/40" /> Special working day
              </span>
            </p>
          </section>

          <section aria-label="Holiday list" className="h-fit overflow-hidden rounded-lg border bg-card shadow-xs">
            <header className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
              <h2 className="text-sm font-semibold tracking-tight">{items.length} {items.length === 1 ? 'entry' : 'entries'} in {year}</h2>
            </header>
            <ul className="max-h-[36rem] divide-y overflow-y-auto">
              {items.map((h) => (
                <li key={h.id} className="group flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{h.name}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {rangeLabel(h.from, h.to)} {h.to.slice(0, 4)}
                      {parseYmd(h.from).getDay() !== undefined && h.from === h.to ? ` · ${parseYmd(h.from).toLocaleDateString('en-GB', { weekday: 'long' })}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {h.kind === 'working_day' && <Badge tone="info">Working day</Badge>}
                      <Badge tone="outline">{h.wingIds.length === 0 ? `All ${ORG_UNIT.lowerPlural}` : h.wingNames.join(', ')}</Badge>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <IconButton label={`Edit ${h.name}`} icon={<Pencil />} size="icon-sm" onClick={() => open(h)} />
                      <IconButton label={`Remove ${h.name}`} icon={<Trash2 />} size="icon-sm" variant="destructive-ghost" onClick={() => setDeleting(h)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <HolidaySheet
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        holiday={editing === 'new' ? null : (editing ?? (lastEditing.current === 'new' ? null : lastEditing.current))}
        defaultYear={year}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !remove.isPending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this holiday?</AlertDialogTitle>
            <AlertDialogDescription>
              {lastDeleting.current ? `${lastDeleting.current.name} (${rangeLabel(lastDeleting.current.from, lastDeleting.current.to)}) will become an ordinary working day again. Attendance for those days is recalculated.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending ? 'Removing...' : 'Remove holiday'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function MiniMonth({ year, month, byDay, onPick, canEdit }: { year: number; month: number; byDay: Map<string, Holiday>; onPick: (h: Holiday) => void; canEdit: boolean }) {
  const first = new Date(year, month, 1);
  const dim = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const today = todayYmd();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: dim }, (_, i) => toYmd(new Date(year, month, i + 1)))];
  const count = cells.filter((d) => d && byDay.has(d)).length;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold tracking-tight">{first.toLocaleDateString('en-GB', { month: 'long' })}</h3>
        {count > 0 && <span className="text-[11px] text-muted-foreground">{count} {count === 1 ? 'day' : 'days'}</span>}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="text-[10px] font-medium text-muted-foreground/70" role="columnheader">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />;
          const h = byDay.get(d);
          const dow = parseYmd(d).getDay();
          const base = cn('grid h-6 place-content-center rounded text-[11px] tabular-nums', dow === 0 || dow === 6 ? 'text-muted-foreground/70' : 'text-foreground', d === today && 'font-bold ring-1 ring-primary');
          if (!h) return <span key={d} className={base} role="gridcell">{Number(d.slice(8))}</span>;
          const tone = h.kind === 'holiday' ? 'bg-warning-subtle text-warning-text ring-1 ring-warning/30' : 'bg-info-subtle text-info-text ring-1 ring-info/30';
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              title={`${h.name}, ${formatDate(d)}`}
              aria-label={`${h.name}, ${formatDate(d)}${h.kind === 'working_day' ? ', special working day' : ''}`}
              onClick={() => onPick(h)}
              disabled={!canEdit}
              className={cn(base, tone, 'font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', canEdit ? 'cursor-pointer hover:brightness-95' : 'cursor-default')}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HolidaySheet({ open, onOpenChange, holiday, defaultYear }: { open: boolean; onOpenChange: (o: boolean) => void; holiday: Holiday | null; defaultYear: number }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{holiday ? `Edit ${holiday.name}` : 'Add holiday'}</SheetTitle>
          <SheetDescription>Holidays close the office; a special working day makes a normally-off day (such as a Saturday) a working day.</SheetDescription>
        </SheetHeader>
        {open && <HolidayForm key={holiday?.id ?? 'new'} holiday={holiday} defaultYear={defaultYear} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function HolidayForm({ holiday, defaultYear, onClose }: { holiday: Holiday | null; defaultYear: number; onClose: () => void }) {
  const wings = useWings();
  const todayYear = new Date().getFullYear();
  const startDate = holiday?.from ?? (defaultYear === todayYear ? todayYmd() : `${defaultYear}-01-01`);
  const [name, setName] = React.useState(holiday?.name ?? '');
  const [span, setSpan] = React.useState<'single' | 'range'>(holiday && holiday.from !== holiday.to ? 'range' : 'single');
  const [date, setDate] = React.useState<string | null>(startDate);
  const [range, setRange] = React.useState<{ from: string | null; to: string | null }>({ from: holiday?.from ?? null, to: holiday?.to ?? null });
  const [kind, setKind] = React.useState<'holiday' | 'working_day'>(holiday?.kind ?? 'holiday');
  const [allWings, setAllWings] = React.useState(!holiday || holiday.wingIds.length === 0);
  const [wingIds, setWingIds] = React.useState<string[]>((holiday?.wingIds ?? []).map(String));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useApiMutation<Holiday, HolidayInput>({
    mutationFn: (v) => (holiday ? updateHoliday(holiday.id, v) : createHoliday(v)),
    toastErrors: false,
    invalidate: [qk.holidays.all, qk.daily.all, qk.leaves.all],
    successMessage: (h) => (holiday ? `Saved ${h.name}` : `Added ${h.name}`),
    onSuccess: onClose,
    onError: (e) => setErrors(e.isValidation ? e.fieldErrors : { form: e.message }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const from = span === 'single' ? date : range.from;
    const to = span === 'single' ? date : range.to;
    const p = zHolidayInput.safeParse({ name, from: from ?? '', to: to ?? '', kind, wingIds: allWings ? [] : wingIds.map(Number) });
    if (!p.success) {
      const out: Record<string, string> = {};
      for (const i of p.error.issues) out[i.path[0] === 'from' || i.path[0] === 'to' ? 'dates' : String(i.path[0])] ??= i.message;
      return setErrors(out);
    }
    if (!allWings && wingIds.length === 0) return setErrors({ wingIds: `Choose at least one ${ORG_UNIT.lower}, or apply it to all ${ORG_UNIT.lowerPlural}` });
    setErrors({});
    save.mutate(p.data as HolidayInput);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <FormField label="Name" required error={errors.name}>
          <Input autoComplete="off" placeholder="e.g. Pakistan Day" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </FormField>

        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">Type</p>
          <Segmented
            aria-label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'holiday', label: 'Holiday' },
              { value: 'working_day', label: 'Special working day' },
            ]}
          />
          <p className="text-xs text-muted-foreground">{kind === 'holiday' ? 'The office is closed. Nobody is marked absent.' : 'A normally-off day that is worked (for example a make-up Saturday). Attendance is expected.'}</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium leading-none">When</p>
            <Segmented
              aria-label="Single day or range"
              size="sm"
              value={span}
              onChange={setSpan}
              options={[
                { value: 'single', label: 'Single day' },
                { value: 'range', label: 'Date range' },
              ]}
            />
          </div>
          {span === 'single' ? (
            <FormField error={errors.dates ?? errors.from}>
              <DatePicker value={date} onChange={setDate} invalid={Boolean(errors.dates ?? errors.from)} aria-label="Date" />
            </FormField>
          ) : (
            <FormField error={errors.dates ?? errors.to} hint="For example the days around Eid.">
              <RangePicker value={range} onChange={setRange} invalid={Boolean(errors.dates ?? errors.to)} aria-label="Date range" />
            </FormField>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium leading-none">Applies to</p>
            <Segmented
              aria-label="Applies to"
              size="sm"
              value={allWings ? 'all' : 'some'}
              onChange={(v) => setAllWings(v === 'all')}
              options={[
                { value: 'all', label: `All ${ORG_UNIT.lowerPlural}` },
                { value: 'some', label: `Selected ${ORG_UNIT.lowerPlural}` },
              ]}
            />
          </div>
          {!allWings && (
            <FormField error={errors.wingIds}>
              <MultiCombobox
                aria-label={ORG_UNIT.plural}
                options={(wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name }))}
                value={wingIds}
                onChange={setWingIds}
                placeholder={`Choose ${ORG_UNIT.lowerPlural}...`}
                invalid={Boolean(errors.wingIds)}
              />
            </FormField>
          )}
        </div>
        {errors.form && <p role="alert" className="text-[13px] font-medium text-danger-text">{errors.form}</p>}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {holiday ? 'Save changes' : 'Add holiday'}
        </Button>
      </SheetFooter>
    </form>
  );
}
