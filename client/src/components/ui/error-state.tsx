import * as React from 'react';
import { RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { isApiError } from '../../lib/api';

export interface ErrorStateProps {
  /** Pass the thrown error to get a tailored message, code and request id. */
  error?: unknown;
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  bare?: boolean;
}

export function ErrorState({ error, title, description, onRetry, retrying, className, bare }: ErrorStateProps) {
  const api = isApiError(error) ? error : null;
  const offline = api?.isNetwork ?? false;
  const heading = title ?? (offline ? 'Server unreachable' : 'Something went wrong');
  const body =
    description ??
    (api
      ? api.message
      : error instanceof Error
        ? error.message
        : 'We could not load this content. Please try again.');
  const Icon = offline ? WifiOff : TriangleAlert;

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-14 text-center',
        !bare && 'rounded-lg border bg-card',
        className,
      )}
    >
      <div className="grid size-11 place-content-center rounded-xl bg-danger-subtle text-danger-text">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{heading}</h3>
        <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>
        {api && (api.code || api.requestId) && (
          <p className="pt-1 font-mono text-[11px] text-muted-foreground">
            {[api.status ? `HTTP ${api.status}` : null, api.code, api.requestId ? `req ${api.requestId}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          {!retrying && <RefreshCw aria-hidden="true" />}
          Try again
        </Button>
      )}
    </div>
  );
}
