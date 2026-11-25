import * as React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorCode, LEAVE_PARTS, LEAVE_PART_LABEL, zLeaveInput } from '@nacta/shared';
import type { Leave, LeaveInput } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { addDaysYmd, formatDate, isYmd, parseYmd, startOfWeekYmd, todayYmd, endOfMonthYmd } from '../../../lib/dates';
import { createLeaves } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { describeSkipped, estimateWorkingDays, holidayOn, rangeLabel, specialWorkingOn } from '../../../lib/rules-ui';
import { useDefaultTiming, useHolidays, useLeaveTypes } from '../../../hooks/use-rules';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import type { DayMark } from '../../../components/ui/calendar';
import { DatePicker } from '../../../components/ui/date-picker';
import { FormField } from '../../../components/ui/form-field';
import { RangePicker, type RangePreset } from '../../../components/ui/range-picker';
import { Segmented } from '../../../components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { Skeleton } from '../../../components/ui/skeleton';
import { Textarea } from '../../../components/ui/textarea';
import { Tooltip } from '../../../components/ui/tooltip';
import { EmployeePicker, type PickedEmployee } from '../../../components/rules/employee-picker';
import { LeaveDot, LeavePill } from '../../../components/rules/pills';

export interface MarkLeaveInitial {
  employees?: PickedEmployee[];
  date?: string;
  from?: string;
  to?: string;
  leaveTypeId?: number;
}

interface Conflict {
  employeeId: number;
  name: string;
  dates: string[];
  type?: { name: string; code: string; color: string };
}

function parseConflicts(details: unknown): Conflict[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map((d) => {
      // Server shape: dates: [{ from, to }] (the clashing part). Older/other shapes: "a..b" strings.
      const raw = d.dates;
      const toRange = (x: unknown): string =>
        x && typeof x === 'object' && 'from' in x
          ? `${String((x as { from: unknown }).from)}..${String((x as { to?: unknown }).to ?? (x as { from: unknown }).from)}`
          : String(x);
      const dates = Array.isArray(raw) ? raw.map(toRange) : typeof raw === 'string' ? [raw] : [];
      const t = (d.leaveType ?? d.type) as { name?: string; code?: string; color?: string } | undefined;
      return {
        employeeId: Number(d.employeeId),
        name: String(d.name ?? `Employee ${d.employeeId}`),
        dates,
        type: t && t.name && t.code && t.color ? { name: t.name, code: t.code, color: t.color } : undefined,
      };
    });
}

/** "2026-11-24..2026-11-26" -> "24-26 Nov". */
function conflictDates(dates: string[]): string {
  return dates
    .map((d) => {
      const [a, b] = d.split('..');
      return rangeLabel(a!, b ?? a!);
    })
    .join(', ');
}

const PRESETS: RangePreset[] = [
  { label: 'Next 3 days', range: () => ({ from: todayYmd(), to: addDaysYmd(todayYmd(), 2) }) },
  { label: 'This week', range: () => ({ from: todayYmd(), to: addDaysYmd(startOfWeekYmd(todayYmd()), 6) }) },
  { label: 'Next week', range: () => ({ from: addDaysYmd(startOfWeekYmd(todayYmd()), 7), to: addDaysYmd(startOfWeekYmd(todayYmd()), 13) }) },
  { label: 'Next 2 weeks', range: () => ({ from: addDaysYmd(startOfWeekYmd(todayYmd()), 7), to: addDaysYmd(startOfWeekYmd(todayYmd()), 20) }) },
  { label: 'Rest of this month', range: () => ({ from: todayYmd(), to: endOfMonthYmd(todayYmd()) }) },
];

export interface MarkLeaveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: MarkLeaveInitial;
}

export function MarkLeaveSheet({ open, onOpenChange, initial }: MarkLeaveSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Mark leave</SheetTitle>
          <SheetDescription>Record leave for one person or many, for a single day or a date range. It takes effect in attendance straight away.</SheetDescription>
        </SheetHeader>
        {/* Remount per opening so the form always starts from `initial`. */}
        {open && <MarkLeaveForm initial={initial} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function MarkLeaveForm({ initial, onClose }: { initial?: MarkLeaveInitial; onClose: () => void }) {
  const types = useLeaveTypes();
  const holidays = useHolidays();
  const timing = useDefaultTiming();

  const isRangeInitial = Boolean(initial?.from && initial?.to && initial.from !== initial.to);
  const [people, setPeople] = React.useState<PickedEmployee[]>(initial?.employees ?? []);
  const [typeId, setTypeId] = React.useState<string>(initial?.leaveTypeId ? String(initial.leaveTypeId) : '');
  const [mode, setMode] = React.useState<'single' | 'range'>(isRangeInitial ? 'range' : 'single');
  const [date, setDate] = React.useState<string | null>(initial?.date ?? initial?.from ?? todayYmd());
  const [part, setPart] = React.useState<(typeof LEAVE_PARTS)[number]>('full');
  const [range, setRange] = React.useState<{ from: string | null; to: string | null }>({ from: initial?.from ?? null, to: initial?.to ?? null });
  const [reason, setReason] = React.useState('');
  const [conflicts, setConflicts] = React.useState<Conflict[] | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const activeTypes = (types.data ?? []).filter((t) => t.isActive);
  const type = types.data?.find((t) => String(t.id) === typeId);
  // Reset the conflict list as soon as the request changes: it no longer describes what will be sent.
  const touch = () => {
    setConflicts(null);
    setErrors({});
  };

  const from = mode === 'single' ? date : range.from;
  const to = mode === 'single' ? date : range.to;
  const effPart = mode === 'single' ? part : 'full';

  const markFor = (d: string): DayMark => {
    if (holidayOn(d, holidays.data)) return 'holiday';
    if (specialWorkingOn(d, holidays.data)) return 'working';
    const dow = parseYmd(d).getDay();
    return (timing ? timing.days[dow] == null : dow === 0 || dow === 6) ? 'off' : undefined;
  };

  const estimate = React.useMemo(() => (from && to ? estimateWorkingDays(from, to, holidays.data, timing) : null), [from, to, holidays.data, timing]);

  const mutation = useApiMutation<Leave[], LeaveInput>({
    mutationFn: createLeaves,
    toastErrors: false,
    invalidate: [qk.leaves.all, qk.daily.all],
    successMessage: (_d, v) => {
      const n = v.employeeIds.length;
      const who = n === 1 ? (people[0]?.name ?? '1 person') : `${n} people`;
      return `${type?.name ?? 'Leave'} marked for ${who}, ${rangeLabel(v.from, v.to)}`;
    },
    onSuccess: () => onClose(),
    onError: (e) => {
      if (e.code === ErrorCode.LEAVE_OVERLAP) {
        setConflicts(parseConflicts(e.details));
        return;
      }
      if (e.isValidation) setErrors(e.fieldErrors);
      else toast.error('Could not mark leave', { description: e.message });
    },
  });

  const submit = (replace: boolean) => {
    const parsed = zLeaveInput.safeParse({
      employeeIds: people.map((p) => p.id),
      leaveTypeId: Number(typeId) || 0,
      from: from ?? '',
      to: to ?? '',
      part: effPart,
      reason: reason || null,
      replaceOverlapping: replace,
    });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= i.message;
      if (out.leaveTypeId) out.leaveTypeId = 'Choose a leave type';
      if (out.from || out.to) {
        const m = out.from ?? out.to;
        delete out.from;
        delete out.to;
        out.dates = m === 'Use YYYY-MM-DD' || m === 'Required' ? 'Choose the date' + (mode === 'range' ? 's' : '') : m!;
      }
      setErrors(out);
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data as LeaveInput);
  };

  const preview = (() => {
    if (!estimate || !from || !to) return null;
    const people_n = people.length;
    const skip = describeSkipped(estimate);
    if (estimate.count === 0) return { warn: true, text: `No working days in ${rangeLabel(from, to)}${skip ? ` (${skip})` : ''}. Nothing would be counted.` };
    const days = effPart === 'full' ? `${estimate.count} working ${estimate.count === 1 ? 'day' : 'days'}` : `Half a working day (${LEAVE_PART_LABEL[effPart].toLowerCase()})`;
    return { warn: false, text: `${days}${skip ? ` (${skip})` : ''}${people_n > 1 ? `, for ${people_n} people` : ''}` };
  })();

  return (
    <>
      <form
        id="mark-leave-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <SheetBody className="space-y-6">
          <FormField label="People" required error={errors.employeeIds}>
            <EmployeePicker
              value={people}
              invalid={Boolean(errors.employeeIds)}
              onChange={(p) => {
                setPeople(p);
                touch();
              }}
            />
          </FormField>

          <FormField label="Leave type" required error={errors.leaveTypeId}>
            {types.isPending ? (
              <Skeleton className="h-9" />
            ) : types.isError ? (
              <p className="text-[13px] text-danger-text">Leave types could not be loaded. Close this panel and try again.</p>
            ) : (
              <Select
                value={typeId}
                onValueChange={(v) => {
                  setTypeId(v);
                  touch();
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a leave type" />
                </SelectTrigger>
                <SelectContent>
                  {activeTypes.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      <span className="flex items-center gap-2">
                        <LeaveDot color={t.color} />
                        <span className="font-mono text-xs font-semibold">{t.code}</span>
                        <span>{t.name}</span>
                        {t.countsAsPresent && <Badge tone="outline" className="ml-1 px-1.5 py-0 text-[10px]">counts as present</Badge>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium leading-none">Duration</p>
              <Segmented
                aria-label="Duration"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  touch();
                }}
                options={[
                  { value: 'single', label: 'Single day' },
                  { value: 'range', label: 'Date range' },
                ]}
              />
            </div>

            {mode === 'single' ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <FormField label="Date" error={errors.dates}>
                  <DatePicker
                    value={date}
                    markFor={markFor}
                    invalid={Boolean(errors.dates)}
                    onChange={(d) => {
                      setDate(d);
                      touch();
                    }}
                  />
                </FormField>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium leading-none">Part of the day</p>
                  <Segmented
                    aria-label="Part of the day"
                    value={part}
                    onChange={(p) => {
                      setPart(p);
                      touch();
                    }}
                    options={LEAVE_PARTS.map((p) => ({ value: p, label: LEAVE_PART_LABEL[p] }))}
                  />
                </div>
              </div>
            ) : (
              <FormField label="From - to" error={errors.dates} hint="Full days only. Weekends and holidays inside the range are skipped when counting.">
                <RangePicker
                  value={range}
                  presets={PRESETS}
                  markFor={markFor}
                  invalid={Boolean(errors.dates)}
                  onChange={(r) => {
                    setRange(r);
                    touch();
                  }}
                />
              </FormField>
            )}

            {preview && (
              <div
                role="status"
                className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ${preview.warn ? 'border-warning/40 bg-warning-subtle text-warning-text' : 'bg-muted/40 text-foreground'}`}
              >
                <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <p className="min-w-0 flex-1 leading-snug">
                  {preview.text}
                  {from && to && isYmd(from) && from !== to && <span className="text-muted-foreground"> {'·'} {formatDate(from)} to {formatDate(to)}</span>}
                </p>
                <Tooltip content="Worked out in your browser from the holiday calendar and the default office timings. The server's count is the one that is recorded." side="left">
                  <span tabIndex={0} className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Badge tone="outline" className="text-[10px] uppercase">Estimate</Badge>
                  </span>
                </Tooltip>
              </div>
            )}
          </div>

          <FormField label="Reason" hint="Optional. Visible to anyone who can see this leave." error={errors.reason}>
            <Textarea
              rows={2}
              maxLength={300}
              placeholder="e.g. Family function"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>

          {conflicts && (
            <section aria-label="Overlapping leave" role="alert" className="space-y-3 rounded-lg border border-warning/50 bg-warning-subtle/60 p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-warning-text">
                    {conflicts.length} {conflicts.length === 1 ? 'person already has' : 'people already have'} leave on these dates
                  </p>
                  <p className="text-[13px] text-warning-text/90">Nothing was saved. You can replace the existing leave with this one, or change the dates or people.</p>
                </div>
              </div>
              <ul className="max-h-40 divide-y divide-warning/20 overflow-y-auto rounded-md border border-warning/30 bg-card">
                {conflicts.map((c) => (
                  <li key={c.employeeId} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{conflictDates(c.dates)}</span>
                    {c.type ? <LeavePill code={c.type.code} name={c.type.name} color={c.type.color} short /> : <Badge tone="neutral">Leave</Badge>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          {conflicts ? (
            <Button type="button" variant="destructive" loading={mutation.isPending} onClick={() => submit(true)}>
              Replace overlapping leave
            </Button>
          ) : (
            <Button type="submit" loading={mutation.isPending}>
              {people.length > 1 ? `Mark leave for ${people.length} people` : 'Mark leave'}
            </Button>
          )}
        </SheetFooter>
      </form>
    </>
  );
}
