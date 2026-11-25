import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium',
    'transition-[background-color,border-color,color,box-shadow] duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover',
        secondary: 'border border-border-strong bg-card text-foreground shadow-xs hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted data-[state=open]:bg-muted',
        subtle: 'bg-muted text-foreground hover:bg-accent',
        destructive: 'bg-danger text-danger-on shadow-xs hover:bg-danger-hover',
        'destructive-ghost': 'text-danger-text hover:bg-danger-subtle',
        link: 'h-auto rounded-sm p-0 text-primary-text underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-5 text-sm',
        'icon-sm': 'size-8',
        icon: 'size-9',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as the child element (e.g. a router Link) instead of a <button>. */
  asChild?: boolean;
  /** Shows a spinner and blocks interaction while an action is in flight. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, type, ...props }, ref) => {
    const classes = cn(buttonVariants({ variant, size }), className);
    if (asChild) {
      return (
        <Slot ref={ref} className={classes} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
