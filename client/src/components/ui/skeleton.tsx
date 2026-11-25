import * as React from 'react';
import { cn } from '../../lib/utils';

/** Loading placeholder. Shimmer is disabled automatically under prefers-reduced-motion. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-foreground/[0.06] after:to-transparent motion-safe:after:animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}
