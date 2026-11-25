import * as React from 'react';
import { cn } from '../../lib/utils';

export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20">
      <div className="mb-4">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className={className}>{children}</div>
    </section>
  );
}

/** Bordered specimen area with an optional caption. */
export function Specimen({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="space-y-2.5">
      {label && <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>}
      <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border bg-card p-5 shadow-xs', className)}>{children}</div>
    </div>
  );
}
