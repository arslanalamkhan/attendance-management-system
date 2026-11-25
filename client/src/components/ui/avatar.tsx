import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const avatarVariants = cva('relative flex shrink-0 overflow-hidden rounded-full', {
  variants: {
    size: { xs: 'size-6 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-lg', xl: 'size-20 text-2xl' },
  },
  defaultVariants: { size: 'md' },
});

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return (first + last).toUpperCase();
}

export interface AvatarProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>, 'children'>,
    VariantProps<typeof avatarVariants> {
  name: string;
  src?: string | null;
}

/** Photo with an initials fallback. `name` is also the accessible label. */
export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size, name, src, ...props }, ref) => (
    <AvatarPrimitive.Root ref={ref} className={cn(avatarVariants({ size }), className)} {...props}>
      {src && <AvatarPrimitive.Image src={src} alt={name} className="aspect-square size-full object-cover" />}
      <AvatarPrimitive.Fallback
        aria-label={name}
        role="img"
        delayMs={src ? 400 : 0}
        className="flex size-full items-center justify-center bg-primary-subtle font-semibold tracking-tight text-primary-text"
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  ),
);
Avatar.displayName = 'Avatar';
