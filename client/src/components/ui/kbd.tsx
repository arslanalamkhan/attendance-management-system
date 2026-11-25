import * as React from 'react';
import { cn } from '../../lib/utils';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'inverse';
}

export function Kbd({ className, tone = 'default', ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded border px-1 font-sans text-[11px] font-medium leading-none',
        tone === 'default'
          ? 'border-border-strong bg-muted text-muted-foreground'
          : 'border-background/25 bg-background/10 text-background',
        className,
      )}
      {...props}
    />
  );
}
