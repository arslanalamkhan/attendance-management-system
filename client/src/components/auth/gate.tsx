import * as React from 'react';
import type { Permission } from '@nacta/shared';
import { useAuth } from '../../lib/auth';
import { Tooltip } from '../ui/tooltip';

export interface GateProps {
  /** Permission(s) required. An array means ALL of them. */
  perm: Permission | Permission[];
  /** Completes "You don't have permission to ...", e.g. "add employees". */
  action: string;
  /** Remove the control entirely instead of disabling it. */
  hide?: boolean;
  /** A single control (Button, IconButton, ...) that accepts `disabled`. */
  children: React.ReactElement<{ disabled?: boolean }>;
}

/**
 * Permission-aware wrapper for a button: enabled when allowed; otherwise disabled with a
 * tooltip explaining why (focusable, so keyboard and screen-reader users get the reason too).
 */
export function Gate({ perm, action, hide, children }: GateProps) {
  const { can } = useAuth();
  const needed = Array.isArray(perm) ? perm : [perm];
  if (needed.every(can)) return children;
  if (hide) return null;
  const reason = `You don't have permission to ${action}`;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} role="group" aria-label={reason} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {React.cloneElement(children, { disabled: true })}
      </span>
    </Tooltip>
  );
}

/** Renders children only when the user holds ALL the permissions. */
export function Can({ perm, children }: { perm: Permission | Permission[]; children: React.ReactNode }) {
  const { can } = useAuth();
  const needed = Array.isArray(perm) ? perm : [perm];
  return needed.every(can) ? <>{children}</> : null;
}
