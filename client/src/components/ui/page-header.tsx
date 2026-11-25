import * as React from 'react';
import { cn } from '../../lib/utils';
import { Breadcrumbs, type Crumb } from './breadcrumbs';

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra breadcrumbs for detail pages (the top bar already shows the section trail). */
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  /** Status chips etc. shown beside the title. */
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1.5">
        {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} className="mb-2" />}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
          {meta}
        </div>
        {description && <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
