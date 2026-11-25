import * as React from 'react';
import { Link } from 'react-router-dom';
import { Braces, Check, Copy, ListTree, Monitor, Smartphone, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { AuditEntry } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { CATEGORY_META, ENTITY_LABELS, entityHref, formatStamp, humanizeKey, actionLabel } from '../../lib/audit-ui';
import { parseUserAgent } from '../../lib/user-agent';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { copyText } from '../../pages/devices/parts';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { IconButton } from '../ui/icon-button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { ActionTile, OutcomePill, UserCell } from './audit-bits';
import { ChangesDiff, Value } from './audit-diff';

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<number>();
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <IconButton
      type="button"
      size="icon-sm"
      variant="ghost"
      label={done ? 'Copied' : label}
      icon={done ? <Check className="text-success-text" /> : <Copy />}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1600);
        } else toast.error('Could not copy to the clipboard');
      }}
    />
  );
}

function MetadataList({ data }: { data: Record<string, unknown> }) {
  const [raw, setRaw] = React.useState(false);
  const entries = Object.entries(data);
  return (
    <>
      <div className="-mt-1 flex justify-end">
        <Button type="button" variant="ghost" size="sm" aria-pressed={raw} onClick={() => setRaw((r) => !r)} className="-mr-2 h-7 px-2 text-xs">
          {raw ? <ListTree aria-hidden="true" /> : <Braces aria-hidden="true" />}
          {raw ? 'Readable view' : 'Raw JSON'}
        </Button>
      </div>
      {raw ? (
        <pre tabIndex={0} className="max-h-72 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {JSON.stringify(data, null, 2)}
        </pre>
      ) : (
        <dl className="divide-y rounded-lg border text-[13px]">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 px-3 py-2">
              <dt className="text-muted-foreground">{humanizeKey(k)}</dt>
              <dd className="min-w-0">
                <Value value={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

export interface AuditDetailSheetProps {
  entry: AuditEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full detail of one audit entry: who, when, request id, diff, metadata, and pivots to related activity. */
export function AuditDetailSheet({ entry, open, onOpenChange }: AuditDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl sm:max-w-xl">
        {entry ? (
          <Detail key={entry.id} entry={entry} onClose={() => onOpenChange(false)} />
        ) : (
          <SheetHeader>
            <SheetTitle>Audit entry</SheetTitle>
            <SheetDescription>Loading the audit entry.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const { can } = useAuth();
  const ua = parseUserAgent(entry.userAgent);
  const DeviceIcon = ua.kind === 'mobile' ? Smartphone : Monitor;
  const subjectHref = entityHref(entry, can);
  const hasSubject = Boolean(entry.entityType && entry.entityId);
  const subjectSearch = hasSubject
    ? new URLSearchParams({ entityType: entry.entityType!, entityId: entry.entityId!, range: 'all', ...(entry.entityLabel ? { entityLabel: entry.entityLabel } : {}) }).toString()
    : '';

  return (
    <>
      <SheetHeader>
        <div className="flex items-start gap-3">
          <ActionTile action={entry.action} category={entry.category} />
          <div className="min-w-0 space-y-1">
            <SheetTitle className="leading-snug">{actionLabel(entry.action)}</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              Audit entry #{entry.id} · {entry.action}
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OutcomePill outcome={entry.outcome} />
          <Badge tone="outline">
            <span aria-hidden="true" className={cn('size-1.5 rounded-full', CATEGORY_META[entry.category].dot)} />
            {CATEGORY_META[entry.category].label}
          </Badge>
        </div>
      </SheetHeader>

      <SheetBody className="space-y-8">
        <Section title="Summary">
          <p className="text-sm leading-relaxed">{entry.summary}</p>
          {hasSubject && (
            <dl>
              <Fact label={ENTITY_LABELS[entry.entityType!]}>
                {subjectHref ? (
                  <Link to={subjectHref} onClick={onClose} className="rounded-sm text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {entry.entityLabel ?? entry.entityId}
                  </Link>
                ) : (
                  <span>{entry.entityLabel ?? entry.entityId}</span>
                )}
                {entry.entityId && <span className="ml-2 font-mono text-xs text-muted-foreground">id {entry.entityId}</span>}
              </Fact>
            </dl>
          )}
        </Section>

        {entry.changes && entry.changes.length > 0 && (
          <Section title={`Changes (${entry.changes.length})`}>
            <ChangesDiff changes={entry.changes} />
          </Section>
        )}

        <Section title="Who and when">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Fact label="User">
              <UserCell entry={entry} size="sm" showEmail />
            </Fact>
            <Fact label="IP address">{entry.ip ? <span className="font-mono">{entry.ip}</span> : <span className="text-muted-foreground">Not recorded</span>}</Fact>
            <Fact label="Browser and system">
              {entry.userAgent ? (
                <span className="inline-flex items-center gap-1.5" title={entry.userAgent}>
                  <DeviceIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {ua.browser} on {ua.os}
                </span>
              ) : (
                <span className="text-muted-foreground">Not recorded</span>
              )}
            </Fact>
            <Fact label="When">
              <time dateTime={entry.at} className="font-mono text-[13px] tabular-nums">
                {formatStamp(entry.at)}
              </time>
              <span className="block text-xs text-muted-foreground">{relativeTime(entry.at)}</span>
            </Fact>
          </dl>
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 py-1.5 pl-3 pr-1.5">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Request ID</p>
              <p className="truncate font-mono text-[12.5px]">{entry.requestId ?? 'Not recorded'}</p>
            </div>
            {entry.requestId && <CopyButton text={entry.requestId} label="Copy request ID" />}
          </div>
        </Section>

        {entry.metadata && Object.keys(entry.metadata).length > 0 && (
          <Section title="Metadata">
            <MetadataList data={entry.metadata} />
          </Section>
        )}

        <Section title="Related activity">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {entry.userId !== null ? (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/admin/audit?${new URLSearchParams({ userId: String(entry.userId), range: 'all' })}`}>
                  <UserRound aria-hidden="true" />
                  View all activity by this user
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                <UserRound aria-hidden="true" />
                No user on this entry
              </Button>
            )}
            {hasSubject ? (
              <Button asChild variant="secondary" size="sm">
                <Link to={`/admin/audit?${subjectSearch}`}>
                  <ListTree aria-hidden="true" />
                  View all activity on this subject
                </Link>
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled>
                <ListTree aria-hidden="true" />
                No subject on this entry
              </Button>
            )}
          </div>
        </Section>
      </SheetBody>
    </>
  );
}
