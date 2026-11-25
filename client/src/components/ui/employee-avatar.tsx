import * as React from 'react';
import { cn } from '../../lib/utils';
import { photoSrc, usePhotoVersion } from '../../lib/photo-src';
import { initialsOf } from './avatar';

const SIZES = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, '2xl': 96 } as const;

export interface EmployeeAvatarProps {
  /** `id: null` renders initials only (e.g. a device user not linked to an employee). `hasPhoto: undefined` = unknown, try to load. */
  employee: { id: number | null; name: string; hasPhoto?: boolean };
  size?: keyof typeof SIZES | number;
  /** Soft ring around the photo (profile header). */
  ring?: boolean;
  /** Cache-busting token for the image. */
  version?: string | number | null;
  className?: string;
}

/**
 * Employee photo from GET /employees/:id/photo (same-origin, session cookie), loaded lazily,
 * with an initials fallback when there is no photo or it fails to load.
 */
export function EmployeeAvatar({ employee, size = 'sm', ring, version, className }: EmployeeAvatarProps) {
  const px = typeof size === 'number' ? size : SIZES[size];
  const { id, name, hasPhoto } = employee;
  const bumped = usePhotoVersion(id);
  const wants = id !== null && hasPhoto !== false;
  const src = wants ? photoSrc(id, version ?? (bumped || undefined)) : null;
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
    setLoaded(false);
  }, [src]);
  const showImg = src !== null && !failed;
  return (
    <span
      role="img"
      aria-label={name}
      style={{ width: px, height: px, fontSize: Math.max(10, Math.round(px * 0.38)) }}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary-subtle font-semibold tracking-tight text-primary-text',
        ring && 'ring-2 ring-border-strong ring-offset-2 ring-offset-background',
        className,
      )}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
      {showImg && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none', loaded ? 'opacity-100' : 'opacity-0')}
        />
      )}
    </span>
  );
}

