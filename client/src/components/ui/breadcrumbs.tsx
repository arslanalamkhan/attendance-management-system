import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <React.Fragment key={`${c.label}-${i}`}>
              <li className={cn('min-w-0 truncate', last && 'font-medium text-foreground')}>
                {c.to && !last ? (
                  <Link
                    to={c.to}
                    className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current={last ? 'page' : undefined}>{c.label}</span>
                )}
              </li>
              {!last && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
