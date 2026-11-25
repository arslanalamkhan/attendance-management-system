import { ShieldCheck } from 'lucide-react';
import type { AppUser } from '@nacta/shared';
import { Badge, StatusPill } from '../../../components/ui/badge';
import { statusOf } from './user-actions';

export function UserStatusPill({ user }: { user: AppUser }) {
  const s = statusOf(user);
  if (s === 'disabled') return <StatusPill tone="neutral">Disabled</StatusPill>;
  if (s === 'locked')
    return <StatusPill tone="warning">Locked</StatusPill>;
  return <StatusPill tone="success">Active</StatusPill>;
}

export function ProtectedBadge() {
  return (
    <Badge tone="primary" className="px-1.5 py-0 text-[11px]">
      <ShieldCheck aria-hidden="true" /> Protected
    </Badge>
  );
}

