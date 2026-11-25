import { Link } from 'react-router-dom';
import type { AuditCategory, AuditEntry, AuditOutcome } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { CATEGORY_META, ENTITY_LABELS, OUTCOME_META, actionIcon, actionLabel, entityHref, formatStamp } from '../../lib/audit-ui';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/avatar';
import { EmployeeAvatar } from '../ui/employee-avatar';
import { StatusPill } from '../ui/badge';
import { Tooltip } from '../ui/tooltip';

/** Coloured icon tile for an action; the colour comes from its category. */
export function ActionTile({ action, category, size = 'md', className }: { action: AuditEntry['action']; category: AuditCategory; size?: 'sm' | 'md'; className?: string }) {
  const Icon = actionIcon(action, category);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-content-center rounded-md',
        size === 'sm' ? 'size-7 [&_svg]:size-3.5' : 'size-8 [&_svg]:size-4',
        CATEGORY_META[category].tile,
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** Icon tile + action label (the "Action" column). */
export function ActionCell({ entry }: { entry: Pick<AuditEntry, 'action' | 'category'> }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ActionTile action={entry.action} category={entry.category} size="sm" />
      <span className="truncate font-medium">{actionLabel(entry.action)}</span>
    </div>
  );
}

export function OutcomePill({ outcome, className }: { outcome: AuditOutcome; className?: string }) {
  const m = OUTCOME_META[outcome];
  return (
    <StatusPill tone={m.tone} className={className}>
      {m.label}
    </StatusPill>
  );
}

/** Small category label with its colour dot. */
export function CategoryDot({ category, className }: { category: AuditCategory; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span aria-hidden="true" className={cn('size-2 rounded-full', CATEGORY_META[category].dot)} />
      {CATEGORY_META[category].label}
    </span>
  );
}

export const AnonymousLabel = 'Anonymous';

/** Avatar + name (or "Anonymous"). */
export function UserCell({ entry, size = 'xs', showEmail = false }: { entry: Pick<AuditEntry, 'userName' | 'userEmail' | 'userId'>; size?: 'xs' | 'sm'; showEmail?: boolean }) {
  const name = entry.userName ?? entry.userEmail;
  if (!name) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-content-center rounded-full border border-dashed border-border-strong text-[10px]">
          ?
        </span>
        <span className="truncate italic">{AnonymousLabel}</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size={size} />
      <div className="min-w-0 leading-tight">
        <p className="truncate">{name}</p>
        {showEmail && entry.userName && entry.userEmail && <p className="truncate text-xs text-muted-foreground">{entry.userEmail}</p>}
      </div>
    </div>
  );
}

/** Subject of an entry: a link to the employee/device/user/role when the viewer may open it. */
export function SubjectCell({ entry, className }: { entry: Pick<AuditEntry, 'entityType' | 'entityId' | 'entityLabel'>; className?: string }) {
  const { can } = useAuth();
  if (!entry.entityType || !(entry.entityLabel || entry.entityId)) return <span className="text-muted-foreground">-</span>;
  const label = entry.entityLabel ?? `${ENTITY_LABELS[entry.entityType]} ${entry.entityId}`;
  const href = entityHref(entry, can);
  const empId = entry.entityType === 'employee' && entry.entityId && /^\d+$/.test(entry.entityId) ? Number(entry.entityId) : null;
  const body = (
    <div className={cn('min-w-0 leading-tight', className)}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{ENTITY_LABELS[entry.entityType]}</p>
      {href ? (
        <Link
          to={href}
          onClick={(e) => e.stopPropagation()}
          className="block truncate rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
        </Link>
      ) : (
        <p className="truncate">{label}</p>
      )}
    </div>
  );
  if (empId === null) return body;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <EmployeeAvatar employee={{ id: empId, name: label }} size="xs" />
      {body}
    </div>
  );
}
/** Absolute time in mono, relative time in a tooltip. */
export function Stamp({ iso, clockOnly, className }: { iso: string; clockOnly?: boolean; className?: string }) {
  const full = formatStamp(iso);
  const [date, time] = full.split(', ');
  return (
    <Tooltip content={`${relativeTime(iso)} · ${full}`} side="top">
      <time dateTime={iso} className={cn('cursor-default whitespace-nowrap font-mono text-[12.5px] tabular-nums', className)}>
        {clockOnly ? time : (
          <>
            <span className="text-muted-foreground">{date}</span> {time}
          </>
        )}
      </time>
    </Tooltip>
  );
}
