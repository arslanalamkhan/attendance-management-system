import { Camera, Check, Fingerprint, IdCard, ScanFace, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { DeviceSyncState, EmployeeStatus, TemplateCounts } from '@nacta/shared';
import { Privilege } from '@nacta/shared';
import { cn } from '../../lib/utils';
import { Badge, StatusPill } from '../../components/ui/badge';
import { Tooltip } from '../../components/ui/tooltip';

/** Active green, Disabled amber, Left grey. */
export function EmployeeStatusPill({ status, className }: { status: EmployeeStatus; className?: string }) {
  if (status === 'active') return <StatusPill tone="success" className={className}>Active</StatusPill>;
  if (status === 'disabled') return <StatusPill tone="warning" className={className}>Disabled</StatusPill>;
  return <StatusPill tone="neutral" className={className}>Left</StatusPill>;
}

export function PrivilegeBadge({ privilege }: { privilege: number }) {
  if (privilege !== Privilege.ADMIN) return <span className="text-muted-foreground">-</span>;
  return (
    <Badge tone="primary">
      <ShieldCheck aria-hidden="true" />
      Admin
    </Badge>
  );
}

/** BPS grade as a small monospace badge: "BPS 17". */
export function BpsBadge({ bps, className }: { bps: number | null; className?: string }) {
  if (bps === null) return null;
  return (
    <Badge tone="outline" className={cn('px-1.5 py-0 font-mono text-[11px] tabular-nums', className)} title={`Basic pay scale ${bps}`}>
      BPS {bps}
    </Badge>
  );
}

const SYNC_META: Record<DeviceSyncState, { label: string; detail: string }> = {
  synced: { label: 'Synced', detail: 'Devices match this record.' },
  pending: { label: 'Pending', detail: 'Commands are queued and waiting for the devices to confirm.' },
  failed: { label: 'Failed', detail: 'A device rejected a command. Open the profile for details.' },
  not_on_device: { label: 'Not on device', detail: 'Active, but not on any device yet. Push to send.' },
};

/** Synced check, pending spinner-dot, failed red, not_on_device hollow. */
export function DeviceSyncIndicator({ state, withLabel = false, className }: { state: DeviceSyncState; withLabel?: boolean; className?: string }) {
  const meta = SYNC_META[state];
  const icon =
    state === 'synced' ? (
      <span className="grid size-4 place-content-center rounded-full bg-success-subtle text-success-text [&_svg]:size-3">
        <Check aria-hidden="true" strokeWidth={3} />
      </span>
    ) : state === 'pending' ? (
      <span className="relative grid size-4 place-content-center" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-2 border-info/30 border-t-info motion-safe:animate-spin" />
        <span className="size-1 rounded-full bg-info" />
      </span>
    ) : state === 'failed' ? (
      <span className="grid size-4 place-content-center rounded-full bg-danger-subtle text-danger-text [&_svg]:size-3">
        <TriangleAlert aria-hidden="true" />
      </span>
    ) : (
      <span className="size-3.5 rounded-full border-2 border-border-strong" aria-hidden="true" />
    );
  const body = (
    <span className={cn('inline-flex items-center gap-1.5 text-[13px]', state === 'failed' && 'text-danger-text', state === 'not_on_device' && 'text-muted-foreground', className)}>
      {icon}
      {withLabel ? <span>{meta.label}</span> : <span className="sr-only">{meta.label}</span>}
    </span>
  );
  return (
    <Tooltip content={`${meta.label}: ${meta.detail}`}>
      <span tabIndex={0} className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {body}
      </span>
    </Tooltip>
  );
}

/** Photo, fingerprint and face as a tiny indicator cluster: icon (dimmed when missing) + count. */
export function BiometricCounts({ templates, hasPhoto }: { templates: TemplateCounts; hasPhoto?: boolean }) {
  const dim = (on: boolean) => (on ? 'inline-flex items-center gap-1 text-foreground' : 'inline-flex items-center gap-1 text-muted-foreground/40');
  return (
    <span className="inline-flex items-center gap-3 text-[13px] tabular-nums">
      <span className={dim(!!hasPhoto)} title={hasPhoto ? 'Photo on file' : 'No photo'}>
        <Camera className="size-4" aria-hidden="true" />
        <span className="sr-only">{hasPhoto ? 'Photo on file' : 'No photo'}</span>
      </span>
      <span className={dim(templates.fp > 0)} title={`${templates.fp} fingerprint${templates.fp === 1 ? '' : 's'}`}>
        <Fingerprint className="size-4" aria-hidden="true" />
        <span className="sr-only">Fingerprints:</span>
        {templates.fp}
      </span>
      <span className={dim(templates.face > 0)} title={`${templates.face} face template${templates.face === 1 ? '' : 's'}`}>
        <ScanFace className="size-4" aria-hidden="true" />
        <span className="sr-only">Faces:</span>
        {templates.face}
      </span>
    </span>
  );
}
/** Card number with a small card icon. */
export function CardCell({ cardNo }: { cardNo: string | null }) {
  if (!cardNo) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[13px] tabular-nums">
      <IdCard className="size-3.5 text-muted-foreground" aria-hidden="true" />
      {cardNo}
    </span>
  );
}

/** Devices truncate long names; warn before saving one that will be cut. */
export const DEVICE_NAME_LIMIT = 24;

/** Formats digits as #####-#######-# while typing. Non-digits are dropped; at most 13 digits. */
export function maskCnic(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export const dash = <span className="text-muted-foreground">-</span>;
