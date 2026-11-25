import * as React from 'react';
import { Copy, History, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { WEEKDAYS, zTimingProfileInput } from '@nacta/shared';
import type { TimingProfile, TimingProfileUpdate } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { formatDate, todayYmd } from '../../../lib/dates';
import { listAttendance } from '../../../lib/endpoints/attendance';
import { createTiming, updateTiming } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { explainTiming } from '../../../lib/rules-ui';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { DatePicker } from '../../../components/ui/date-picker';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { Segmented } from '../../../components/ui/segmented';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { Switch } from '../../../components/ui/switch';
import { NumberStepper, VersionHistory, WEEK_ORDER, type Hours } from './timing-bits';

const FALLBACK_EARLIEST = '2026-07-01';

export interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new profile. */
  profile: TimingProfile | null;
  /** True during first-time setup of the default profile: shows the guided header and the past-days choice. */
  guided: boolean;
}

export function ProfileSheet({ open, onOpenChange, profile, guided }: ProfileSheetProps) {
  const last = React.useRef<TimingProfile | null>(null);
  if (profile) last.current = profile;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl sm:max-w-xl">
        <SheetHeader>
          {guided && <p className="text-xs font-semibold uppercase tracking-wide text-primary-text">Step 1 of 1: set your office hours and grace periods</p>}
          <SheetTitle>{profile ? (guided ? 'Set your office timings' : `Edit ${profile.name}`) : 'New timing profile'}</SheetTitle>
          <SheetDescription>
            {guided
              ? 'Late, early and absent are calculated from these. Saving once completes the setup; you can change them later.'
              : 'Hours for each weekday, and how much slack before someone counts as late or early.'}
          </SheetDescription>
        </SheetHeader>
        {open && <ProfileForm key={profile?.id ?? 'new'} profile={profile} guided={guided} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function ProfileForm({ profile, guided, onClose }: { profile: TimingProfile | null; guided: boolean; onClose: () => void }) {
  const [name, setName] = React.useState(profile?.name ?? '');
  const [days, setDays] = React.useState<{ on: boolean; start: string; end: string }[]>(() =>
    Array.from({ length: 7 }, (_, dow) => {
      const h: Hours = profile?.days[dow] ?? null;
      return { on: h !== null, start: h?.start ?? '09:00', end: h?.end ?? '17:00' };
    }),
  );
  const [graceLate, setGraceLate] = React.useState(profile?.graceLateMinutes ?? 15);
  const [graceEarly, setGraceEarly] = React.useState(profile?.graceEarlyMinutes ?? 15);
  const [halfH, setHalfH] = React.useState(Math.floor((profile?.halfDayBelowMinutes ?? 240) / 60));
  const [halfM, setHalfM] = React.useState((profile?.halfDayBelowMinutes ?? 240) % 60);
  const [from, setFrom] = React.useState<string | null>(todayYmd());
  const [pastChoice, setPastChoice] = React.useState<'today' | 'all'>('today');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [resolving, setResolving] = React.useState(false);
  const today = todayYmd();
  const editing = profile !== null;

  const setDay = (dow: number, patch: Partial<(typeof days)[number]>) => setDays((d) => d.map((x, i) => (i === dow ? { ...x, ...patch } : x)));
  const copyMonday = () => {
    const mon = days[1]!;
    setDays((d) => d.map((x, i) => (i >= 2 && i <= 5 ? { on: mon.on, start: mon.start, end: mon.end } : x)));
    toast.success('Monday copied to Tuesday-Friday');
  };

  const halfMinutes = halfH * 60 + halfM;
  const firstOn = WEEK_ORDER.map((d) => days[d]!).find((d) => d.on);
  const explanation = explainTiming(firstOn?.start ?? null, firstOn?.end ?? null, graceLate, graceEarly, halfMinutes);

  const save = useApiMutation<TimingProfile, TimingProfileUpdate>({
    mutationFn: (v) => (profile ? updateTiming(profile.id, v) : createTiming(v)),
    toastErrors: false,
    invalidate: [qk.timings.all, qk.daily.all, qk.leaves.all],
    successMessage: (p) => (guided ? 'Office timings saved. Setup is complete.' : profile ? `Saved ${p.name}. Applies from ${formatDate(pastChoice === 'all' ? 'all dates' : from)}.` : `Created ${p.name}`),
    onSuccess: onClose,
    onError: (e) => {
      const f = e.isValidation ? e.fieldErrors : { form: e.message };
      setErrors(f);
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name,
      days: days.map((d) => (d.on ? { start: d.start, end: d.end } : null)),
      graceLateMinutes: graceLate,
      graceEarlyMinutes: graceEarly,
      halfDayBelowMinutes: halfMinutes,
    };
    const p = zTimingProfileInput.safeParse(payload);
    const out: Record<string, string> = {};
    if (!p.success) {
      for (const i of p.error.issues) {
        const [k, idx] = i.path;
        out[k === 'days' && typeof idx === 'number' ? `day${idx}` : String(k)] ??= i.message;
      }
    }
    if (!days.some((d) => d.on)) out.days = 'Switch on at least one working day';
    if (Object.keys(out).length > 0) return setErrors(out);
    setErrors({});

    let effectiveFrom: string | undefined;
    if (editing) {
      if (guided && pastChoice === 'all') {
        setResolving(true);
        try {
          const first = await listAttendance({ sort: 'punchTime', order: 'asc', page: 1, pageSize: 1 });
          effectiveFrom = first.items[0]?.punchTime.slice(0, 10) ?? FALLBACK_EARLIEST;
        } catch {
          effectiveFrom = FALLBACK_EARLIEST;
        } finally {
          setResolving(false);
        }
      } else effectiveFrom = from ?? today;
    }
    save.mutate({ ...(p.data as TimingProfileUpdate & object), ...(effectiveFrom ? { effectiveFrom } : {}) } as TimingProfileUpdate);
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-7">
        <FormField label="Profile name" required error={errors.name}>
          <Input autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Winter hours" maxLength={60} />
        </FormField>

        <section aria-label="Working days" className="space-y-2.5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Working hours</h3>
              <p className="text-xs text-muted-foreground">Set start and end for each day, or switch a day off.</p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={copyMonday} disabled={!days[1]!.on}>
              <Copy aria-hidden="true" /> Copy Monday to weekdays
            </Button>
          </div>
          <ul className="divide-y rounded-lg border">
            {WEEK_ORDER.map((dow) => {
              const d = days[dow]!;
              const w = WEEKDAYS[dow]!;
              return (
                <li key={dow} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5', !d.on && 'bg-muted/40')}>
                  <div className="flex w-32 items-center gap-2.5">
                    <Switch aria-label={`${w.name} is a working day`} checked={d.on} onCheckedChange={(on) => setDay(dow, { on })} />
                    <span className={cn('text-sm font-medium', !d.on && 'text-muted-foreground')}>{w.name}</span>
                  </div>
                  {d.on ? (
                    <div className="flex items-center gap-2">
                      <Input type="time" mono aria-label={`${w.name} start`} value={d.start} onChange={(e) => setDay(dow, { start: e.target.value })} className="w-[7.5rem]" invalid={Boolean(errors[`day${dow}`])} />
                      <span className="text-muted-foreground" aria-hidden="true">to</span>
                      <Input type="time" mono aria-label={`${w.name} end`} value={d.end} onChange={(e) => setDay(dow, { end: e.target.value })} className="w-[7.5rem]" invalid={Boolean(errors[`day${dow}`])} />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Day off</span>
                  )}
                  {errors[`day${dow}`] && <span role="alert" className="basis-full pl-[8.5rem] text-xs font-medium text-danger-text">{errors[`day${dow}`]}</span>}
                </li>
              );
            })}
          </ul>
          {errors.days && <p role="alert" className="text-xs font-medium text-danger-text">{errors.days}</p>}
        </section>

        <section aria-label="Grace and half day" className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight">Grace periods and half days</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Late after (grace)" hint="Minutes after the start time before someone counts as late." error={errors.graceLateMinutes}>
              <NumberStepper value={graceLate} onChange={setGraceLate} suffix="min" min={0} max={240} />
            </FormField>
            <FormField label="Early before (grace)" hint="Minutes before the end time that still count as a full day." error={errors.graceEarlyMinutes}>
              <NumberStepper value={graceEarly} onChange={setGraceEarly} suffix="min" min={0} max={240} />
            </FormField>
          </div>
          <FormField label="Half day if worked less than" hint="Anything above zero but under this is a half day." error={errors.halfDayBelowMinutes}>
            <div className="flex items-center gap-2">
              <NumberStepper value={halfH} onChange={setHalfH} suffix="h" min={0} max={24} step={1} aria-label="Half-day threshold, hours" />
              <NumberStepper value={halfM} onChange={setHalfM} suffix="m" min={0} max={59} step={5} aria-label="Half-day threshold, minutes" />
            </div>
          </FormField>
          <p role="status" className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-[13px] leading-snug">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden="true" />
            {explanation}
          </p>
        </section>

        {editing && (
          <section aria-label="When this applies" className="space-y-3 rounded-lg border bg-card p-3.5">
            <h3 className="text-sm font-semibold tracking-tight">When should this apply?</h3>
            {guided && (
              <Segmented
                aria-label="Apply from"
                value={pastChoice}
                onChange={setPastChoice}
                className="w-full"
                options={[
                  { value: 'today', label: 'Apply from today' },
                  { value: 'all', label: 'Apply to all past attendance as well' },
                ]}
              />
            )}
            {guided && pastChoice === 'all' ? (
              <p role="alert" className="rounded-md bg-warning-subtle px-3 py-2 text-[13px] leading-snug text-warning-text">
                Every day already recorded will be recalculated with these timings, so late, early and absent for past days may change. This is allowed only now, during first-time setup. After this, changes apply from the date you choose, and earlier days keep their timings.
              </p>
            ) : (
              <>
                <FormField label="Applies from" error={errors.effectiveFrom}>
                  <DatePicker value={from} onChange={setFrom} isDisabled={(d) => d < today} invalid={Boolean(errors.effectiveFrom)} className="w-56" aria-label="Applies from" />
                </FormField>
                <p className="text-xs text-muted-foreground">Days before this keep their previous timings. Nothing in the past is recalculated.</p>
              </>
            )}
          </section>
        )}
        {errors.form && <p role="alert" className="text-[13px] font-medium text-danger-text">{errors.form}</p>}

        {profile && profile.versions.length > 0 && (
          <section aria-label="History" className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
              <History className="size-4 text-muted-foreground" aria-hidden="true" /> History
            </h3>
            <VersionHistory versions={profile.versions} />
          </section>
        )}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending || resolving}>
          {guided ? 'Not now' : 'Cancel'}
        </Button>
        <Button type="submit" loading={save.isPending || resolving}>
          {guided ? 'Save and finish setup' : profile ? 'Save changes' : 'Create profile'}
        </Button>
      </SheetFooter>
    </form>
  );
}
