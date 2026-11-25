import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useFieldProps } from './form-field-context';

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => {
  const field = useFieldProps({ ...props, 'aria-invalid': props['aria-invalid'] });
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      {...props}
      id={field.id}
      aria-invalid={field['aria-invalid']}
      aria-describedby={field['aria-describedby']}
      className={cn(
        'peer grid size-4 shrink-0 place-content-center rounded-[5px] border border-input bg-card shadow-xs transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="grid place-content-center text-current">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3" strokeWidth={3} aria-hidden="true" />
        ) : (
          <Check className="size-3" strokeWidth={3} aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = 'Checkbox';
