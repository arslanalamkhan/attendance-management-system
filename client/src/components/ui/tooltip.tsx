import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../../lib/utils';
import { Kbd } from './kbd';

export const TooltipProvider = ({ delayDuration = 300, ...props }: TooltipPrimitive.TooltipProviderProps) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={150} {...props} />
);

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[70] max-w-xs overflow-hidden rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

export interface TooltipProps {
  content: React.ReactNode;
  /** Keyboard shortcut shown next to the text. */
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  children: React.ReactElement;
}

/** Convenience wrapper: <Tooltip content="Save"><Button/></Tooltip>. Child must accept a ref. */
export function Tooltip({ content, shortcut, side = 'top', align = 'center', disabled, children }: TooltipProps) {
  if (disabled || content === null || content === undefined || content === '') return children;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipContent side={side} align={align}>
        <span className="flex items-center gap-2">
          {content}
          {shortcut && <Kbd tone="inverse">{shortcut}</Kbd>}
        </span>
      </TooltipContent>
    </TooltipPrimitive.Root>
  );
}
