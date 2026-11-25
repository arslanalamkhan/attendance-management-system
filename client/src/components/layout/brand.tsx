import { cn } from '../../lib/utils';

/** Official NACTA emblem (client/public). Full-resolution source for large displays, a 64px copy for small ones. */
export const NACTA_LOGO = '/NACTA_Pakistan_logo.png';
export const NACTA_LOGO_SMALL = '/nacta-logo-64.png';

/**
 * The NACTA emblem. Circular with a transparent background, so it works on light, dark and brand-green surfaces.
 * Every brand usage goes through this component.
 */
export function BrandMark({ className, large }: { className?: string; large?: boolean }) {
  return (
    <img
      src={large ? NACTA_LOGO : NACTA_LOGO_SMALL}
      alt="National Counter Terrorism Authority emblem"
      width={large ? 319 : 64}
      height={large ? 319 : 64}
      draggable={false}
      className={cn('size-8 shrink-0 select-none rounded-full object-contain', className)}
    />
  );
}

export function BrandLockup({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 overflow-hidden">
      <BrandMark className="size-9" />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold tracking-tight">NACTA Attendance</p>
          <p className="truncate text-[11px] text-muted-foreground">National Counter Terrorism Authority</p>
        </div>
      )}
    </div>
  );
}
