import * as React from 'react';
import { cn } from '../../lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Every empty state should offer a next step. */
  action?: React.ReactNode;
  className?: string;
  /** Remove the dashed frame (when already inside a card/table). */
  bare?: boolean;
}

export function EmptyState({ icon, title, description, action, className, bare }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-14 text-center',
        !bare && 'rounded-lg border border-dashed border-border-strong bg-card',
        className,
      )}
    >
      {icon && (
        <div className="grid size-11 place-content-center rounded-xl border bg-muted text-muted-foreground shadow-xs [&_svg]:size-5">
          {icon}
        </div>
      )}
      <div className="max-w-sm space-y-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
