import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  'aria-label': string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Radio-group segmented control with arrow-key navigation. */
export function Segmented<T extends string>({ value, onChange, options, className, size = 'md', ...rest }: SegmentedProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    for (let step = 1; step <= options.length; step++) {
      const j = (i + dir * step + options.length * 2) % options.length;
      if (!options[j]!.disabled) {
        onChange(options[j]!.value);
        refs.current[j]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={rest['aria-label']} className={cn('inline-flex rounded-lg bg-muted p-0.5', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex-1 whitespace-nowrap rounded-md font-medium transition-[background-color,color,box-shadow] duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
              on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
