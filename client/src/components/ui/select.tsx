import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../../lib/utils';
import { controlBase } from './input';
import { useFieldProps } from './form-field-context';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  invalid?: boolean;
}

export const SelectTrigger = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, SelectTriggerProps>(
  ({ className, children, invalid, ...props }, ref) => {
    const field = useFieldProps({ ...props, invalid, 'aria-invalid': props['aria-invalid'] });
    return (
      <SelectPrimitive.Trigger
        ref={ref}
        {...props}
        id={field.id}
        aria-invalid={field['aria-invalid']}
        aria-describedby={field['aria-describedby']}
        className={cn(
          controlBase,
          'flex h-9 items-center justify-between gap-2 px-3 text-left data-[placeholder]:text-muted-foreground [&>span]:truncate',
          className,
        )}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    );
  },
);
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-[60] max-h-80 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-pop',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
        position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ScrollUpButton className="flex h-6 cursor-default items-center justify-center">
        <ChevronUp className="size-4" aria-hidden="true" />
      </SelectPrimitive.ScrollUpButton>
      <SelectPrimitive.Viewport
        className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectPrimitive.ScrollDownButton className="flex h-6 cursor-default items-center justify-center">
        <ChevronDown className="size-4" aria-hidden="true" />
      </SelectPrimitive.ScrollDownButton>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-8 w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-8 text-sm outline-none transition-colors',
      'focus:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[state=checked]:font-medium',
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <span className="absolute right-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-primary-text" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </span>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
));
SelectSeparator.displayName = 'SelectSeparator';
