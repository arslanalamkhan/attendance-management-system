import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-4 whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        neutral: 'border-transparent bg-muted text-foreground',
        primary: 'border-transparent bg-primary-subtle text-primary-text',
        success: 'border-transparent bg-success-subtle text-success-text',
        warning: 'border-transparent bg-warning-subtle text-warning-text',
        danger: 'border-transparent bg-danger-subtle text-danger-text',
        info: 'border-transparent bg-info-subtle text-info-text',
        outline: 'border-border-strong bg-transparent text-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

const dotColor: Record<Tone, string> = {
  neutral: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  outline: 'bg-muted-foreground',
};

export interface StatusPillProps extends Omit<BadgeProps, 'tone'> {
  tone: Tone;
  /** Animated ping on the dot (live statuses such as "Online"). Respects reduced motion. */
  live?: boolean;
}

/** Status indicator: coloured dot + text. Colour is never the only signal (the label is always shown). */
export function StatusPill({ tone, live, className, children, ...props }: StatusPillProps) {
  return (
    <Badge tone={tone} className={cn('pl-2', className)} {...props}>
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        {live && <span className={cn('absolute inset-0 rounded-full motion-safe:animate-status-ping', dotColor[tone])} />}
        <span className={cn('relative size-2 rounded-full', dotColor[tone])} />
      </span>
      {children}
    </Badge>
  );
}

/** Device status -> pill (shared Device.status). */
export function DeviceStatusPill({ status }: { status: 'online' | 'offline' | 'unknown' }) {
  if (status === 'online')
    return (
      <StatusPill tone="success" live>
        Online
      </StatusPill>
    );
  if (status === 'offline') return <StatusPill tone="danger">Offline</StatusPill>;
  return <StatusPill tone="neutral">Unknown</StatusPill>;
}
