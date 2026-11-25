import { CreditCard, Fingerprint, Hand, KeyRound, ScanFace } from 'lucide-react';
import { PunchStatusLabel, VerifyTypeLabel } from '@nacta/shared';
import { Badge } from '../../components/ui/badge';
import { splitPunch } from '../../lib/dates';

/** "2026-11-23  16:29:07": date muted, time emphasised, both mono. */
export function PunchTime({ punchTime }: { punchTime: string }) {
  const { date, time } = splitPunch(punchTime);
  return (
    <span className="font-mono text-[13px] tabular-nums">
      <span className="text-muted-foreground">{date}</span> <span className="font-medium text-foreground">{time}</span>
    </span>
  );
}

const PUNCH_TONE = {
  0: 'success',
  1: 'info',
  2: 'warning',
  3: 'warning',
  4: 'primary',
  5: 'primary',
} as const;

export function PunchTypeBadge({ status }: { status: number | null }) {
  if (status === null) return <span className="text-muted-foreground">-</span>;
  const tone = PUNCH_TONE[status as keyof typeof PUNCH_TONE] ?? 'neutral';
  return <Badge tone={tone}>{PunchStatusLabel[status] ?? `Status ${status}`}</Badge>;
}

function methodIcon(v: number) {
  switch (v) {
    case 15:
      return ScanFace;
    case 1:
      return Fingerprint;
    case 2:
    case 4:
      return CreditCard;
    case 25:
      return Hand;
    default:
      return KeyRound;
  }
}

/** Icon only (compact lists such as the dashboard's live feed). */
export function MethodIcon({ verifyType, className }: { verifyType: number | null; className?: string }) {
  const Icon = methodIcon(verifyType ?? -1);
  return <Icon className={className ?? 'size-4'} aria-hidden="true" />;
}

export function MethodCell({ verifyType }: { verifyType: number | null }) {
  if (verifyType === null) return <span className="text-muted-foreground">-</span>;
  const Icon = methodIcon(verifyType);
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      {VerifyTypeLabel[verifyType] ?? `Method ${verifyType}`}
    </span>
  );
}
