import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { useNow } from '../../hooks/use-now';
import { absoluteTime, relativeTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { IconButton } from '../../components/ui/icon-button';
import { Tooltip } from '../../components/ui/tooltip';

/** Muted em dash for empty values. */
export function Dash() {
  return (
    <span className="text-muted-foreground" aria-label="Not available">
      -
    </span>
  );
}

/** Relative time that ticks live, with the absolute time in a tooltip. */
export function RelativeTime({ iso, className }: { iso: string | null; className?: string }) {
  const now = useNow();
  if (!iso) return <span className={cn('text-muted-foreground', className)}>Never</span>;
  return (
    <Tooltip content={absoluteTime(iso)} side="top">
      <time dateTime={iso} className={cn('font-figure cursor-default whitespace-nowrap', className)}>
        {relativeTime(iso, now)}
      </time>
    </Tooltip>
  );
}

/** Tabular number, or a dash when the device has not reported it yet. */
export function Count({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Dash />;
  return <span className="font-figure">{value.toLocaleString()}</span>;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <IconButton
      label={done ? 'Copied' : label}
      icon={done ? <Check className="text-success-text" /> : <Copy />}
      size="icon-sm"
      variant="ghost"
      className={className}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1600);
        } else {
          toast.error('Could not copy to the clipboard');
        }
      }}
    />
  );
}
