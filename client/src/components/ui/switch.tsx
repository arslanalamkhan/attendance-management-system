import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';
import { useFieldProps } from './form-field-context';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => {
  const field = useFieldProps({ ...props, 'aria-invalid': props['aria-invalid'] });
  return (
    <SwitchPrimitive.Root
      ref={ref}
      {...props}
      id={field.id}
      aria-describedby={field['aria-describedby']}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-primary-foreground data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
});
Switch.displayName = 'Switch';
