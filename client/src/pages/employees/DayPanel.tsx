import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, FilePenLine, Fingerprint } from 'lucide-react';
import type { AttendanceDay } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { parseYmd } from '../../lib/dates';
import { listAttendance } from '../../lib/endpoints/attendance';
import { listCorrections } from '../../lib/endpoints/rules';
import { qk } from '../../lib/query-keys';
import { explainDay, formatMinutes } from '../../lib/rules-ui';
import { relativeTime } from '../../lib/time';
import { Button } from '../../components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Skeleton } from '../../components/ui/skeleton';
import { DayStatusPill } from '../../components/rules/pills';
import { MethodCell, PunchTime, PunchTypeBadge } from '../attendance/punch-cells';

export interface DayPanelProps {
  employee: { id: number; name: string };
  /** The selected date; null closes the panel. */
  date: string | null;
  day: AttendanceDay | undefined;
  onClose: () => void;
  onMarkLeave: (date: string) => void;
  onCorrect: (date: string) => void;
}

/** Side panel for one day of one employee: punches, why it has this status, and the quick actions. */
export function DayPanel({ employee, date, day, onClose, onMarkLeave, onCorrect }: DayPanelProps) {
  const { can, user } = useAuth();
  const last = React.useRef<{ date: string; day?: AttendanceDay } | null>(null);
  if (date) last.current = { date, day };
  const shown = date ?? last.current?.date ?? null;
  const shownDay = date ? day : last.current?.day;

  const punches = useQuery({
    queryKey: qk.attendance.list({ employeeId: employee.id, from: shown ?? undefined, to: shown ?? undefined, page: 1, pageSize: 50, sort: 'punchTime', order: 'asc' }),
    queryFn: ({ signal }) => listAttendance({ employeeId: employee.id, from: shown!, to: shown!, page: 1, pageSize: 50, sort: 'punchTime', order: 'asc' }, signal),
    enabled: date !== null,
  });
  const fixes = useQuery({
    queryKey: qk.daily.corrections(employee.id, shown ?? '', shown ?? ''),
    queryFn: ({ signal }) => listCorrections({ employeeId: employee.id, from: shown!, to: shown! }, signal),
    // Corrections are visible to the Super Admin only (the server hides the marker from everyone else too).
    enabled: date !== null && Boolean(shownDay?.corrected) && user?.isSuperAdmin === true,
  });

  return (
    <Sheet open={date !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-md sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{shown ? parseYmd(shown).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Day'}</SheetTitle>
          <SheetDescription>{employee.name}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          {shownDay ? (
            <section aria-label="Status" className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <DayStatusPill day={shownDay} />
                {shownDay.leave && shownDay.status === 'half_day' && <span className="text-xs text-muted-foreground">with {shownDay.leave.typeName}</span>}
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{explainDay(shownDay)}</p>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['In', shownDay.firstIn ?? '--:--'],
                  ['Out', shownDay.lastOut ?? '--:--'],
                  ['Worked', shownDay.workedMinutes > 0 ? formatMinutes(shownDay.workedMinutes) : '-'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border bg-muted/30 px-2 py-2.5">
                    <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {shownDay.timing && (
                <p className="text-xs text-muted-foreground">
                  Timing: {shownDay.timing.profileName}, {shownDay.timing.start}&ndash;{shownDay.timing.end}
                </p>
              )}
            </section>
          ) : (
            <p className="text-[13px] text-muted-foreground">No computed status for this day.</p>
          )}

          <section aria-label="Punches" className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Fingerprint className="size-3.5" aria-hidden="true" /> Punches
            </h3>
            {punches.isPending ? (
              <Skeleton className="h-16" />
            ) : punches.isError ? (
              <p className="text-[13px] text-danger-text">Punches could not be loaded.</p>
            ) : punches.data.items.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-[13px] text-muted-foreground">No punches on this day.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {punches.data.items.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                    <PunchTime punchTime={p.punchTime} />
                    <span className="flex items-center gap-2">
                      <PunchTypeBadge status={p.status} />
                      <MethodCell verifyType={p.verifyType} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {shownDay?.corrected && (
            <section aria-label="Corrections" className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FilePenLine className="size-3.5" aria-hidden="true" /> Corrections
              </h3>
              {fixes.isPending ? (
                <Skeleton className="h-12" />
              ) : (
                <ul className="divide-y rounded-lg border bg-muted/30 text-[13px]">
                  {(fixes.data ?? []).map((c) => (
                    <li key={c.id} className="px-3 py-2">
                      <p className="font-medium">{c.type === 'add_punch' ? `Punch added at ${c.time}` : `Status set to ${c.status}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.reason} &middot; {c.createdBy ?? 'Unknown'} &middot; {relativeTime(c.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </SheetBody>
        {shown && (can('leave.manage') || can('attendance.correct')) && (
          <SheetFooter>
            {can('leave.manage') && (
              <Button variant="secondary" onClick={() => onMarkLeave(shown)}>
                <CalendarOff aria-hidden="true" /> Mark leave
              </Button>
            )}
            {can('attendance.correct') && (
              <Button onClick={() => onCorrect(shown)}>
                <FilePenLine aria-hidden="true" /> Correct...
              </Button>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
