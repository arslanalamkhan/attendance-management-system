import * as React from 'react';
import { cn } from '../../lib/utils';
import { useFieldProps } from './form-field-context';

export const controlBase =
  'w-full rounded-md border border-input bg-card text-sm text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 ' +
  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger/25';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Decoration inside the left edge (icon). */
  leading?: React.ReactNode;
  /** Decoration inside the right edge (icon, button, Kbd). */
  trailing?: React.ReactNode;
  /** Monospace + tabular figures: for IDs, PINs, serial numbers. */
  mono?: boolean;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, leading, trailing, mono, invalid: _invalid, type = 'text', ...props }, ref) => {
    const field = useFieldProps({ ...props, invalid: _invalid });
    const input = (
      <input
        ref={ref}
        type={type}
        {...props}
        id={field.id}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        required={field.required}
        className={cn(
          controlBase,
          'h-9 px-3 file:border-0 file:bg-transparent file:text-sm file:font-medium',
          mono && 'font-mono text-[13px] tabular-nums',
          leading ? 'pl-9' : undefined,
          trailing ? 'pr-9' : undefined,
          className,
        )}
      />
    );
    if (!leading && !trailing) return input;
    return (
      <div className={cn('relative w-full', wrapperClassName)}>
        {leading && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-muted-foreground [&_svg]:size-4">
            {leading}
          </span>
        )}
        {input}
        {trailing && <span className="absolute inset-y-0 right-0 flex items-center pr-2 text-muted-foreground [&_svg]:size-4">{trailing}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';
