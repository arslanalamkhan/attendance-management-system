import { LEAVE_PART_LABEL } from '@nacta/shared';
import type { AttendanceDay, DayStatus } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { leaveTint, STATUS_STYLE, statusLabel } from '../../lib/rules-ui';
import { StatusPill } from '../ui/badge';

/** Small solid dot in a leave type's colour. */
export function LeaveDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={cn('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ backgroundColor: color }} />;
}

/** "CL · Casual leave" in the type's own colour. */
export function LeavePill({ code, name, color, part, short, className }: { code: string; name: string; color: string; part?: string; short?: boolean; className?: string }) {
  const partLabel = part && part !== 'full' ? LEAVE_PART_LABEL[part as keyof typeof LEAVE_PART_LABEL] : null;
  return (
    <span
      style={leaveTint(color)}
      className={cn('inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4', className)}
      title={`${name}${partLabel ? ` (${partLabel.toLowerCase()})` : ''}`}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-semibold">{code}</span>
      {!short && <span className="truncate">{'·'} {name.replace(/ leave$/i, '')}</span>}
      {partLabel && <span className="opacity-80">{'·'} {partLabel.replace(' half', '½')}</span>}
    </span>
  );
}

/** The status of one computed day. Leave days use the leave type's colour and code. */
export function DayStatusPill({ day }: { day: Pick<AttendanceDay, 'status' | 'leave' | 'holiday'> }) {
  if (day.leave && (day.status === 'leave' || day.status === 'half_day')) {
    if (day.status === 'leave') return <LeavePill code={day.leave.code} name={day.leave.typeName} color={day.leave.color} part={day.leave.part} />;
  }
  return <StatusOnly status={day.status} holidayName={day.holiday?.name} />;
}

export function StatusOnly({ status, holidayName }: { status: DayStatus; holidayName?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <StatusPill tone={s.tone === 'outline' ? 'neutral' : s.tone} title={holidayName}>
      {statusLabel(status)}
    </StatusPill>
  );
}
