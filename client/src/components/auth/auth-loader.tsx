import { BrandMark } from '../layout/brand';
import { isApiError } from '../../lib/api';
import { ErrorState } from '../ui/error-state';

/** Centered brand loader while /auth/me resolves (no layout shift: it is the only thing on screen). */
export function AuthLoader() {
  return (
    <div className="grid min-h-dvh place-content-center bg-background" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-5">
        <div className="relative">
          <span className="absolute inset-0 rounded-full bg-primary/20 motion-safe:animate-status-ping" aria-hidden="true" />
          <BrandMark large className="relative size-16" />
        </div>
        <p className="text-xs text-muted-foreground">Loading NACTA Attendance...</p>
      </div>
    </div>
  );
}

export function AuthLoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="grid min-h-dvh place-content-center bg-background p-4">
      <ErrorState error={error} title={isApiError(error) && error.isNetwork ? 'Cannot reach the server' : 'Could not load your session'} onRetry={onRetry} className="max-w-md" />
    </div>
  );
}


