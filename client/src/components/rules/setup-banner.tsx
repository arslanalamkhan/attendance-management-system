import { Link } from 'react-router-dom';
import { ArrowRight, Clock3 } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useTimingSetup } from '../../hooks/use-rules';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/** Shown until someone has saved the office timings: late, early and absent all depend on them. Renders nothing otherwise. */
export function TimingSetupBanner({ className }: { className?: string }) {
  const { can } = useAuth();
  const { configured } = useTimingSetup();
  if (configured !== false) return null;
  const mayConfigure = can('timings.manage');
  return (
    <div role="status" className={cn('mb-4 flex flex-col gap-3 rounded-lg border border-info/30 bg-info-subtle/70 px-4 py-3.5 sm:flex-row sm:items-center', className)}>
      <span className="grid size-9 shrink-0 place-content-center rounded-lg bg-info-subtle text-info-text" aria-hidden="true">
        <Clock3 className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-info-text">{mayConfigure ? 'Set your office timings' : "Office timings haven't been set up yet"}</p>
        <p className="text-[13px] leading-snug text-info-text/85">
          {mayConfigure ? 'Late, early and absent are calculated from them.' : 'Late, early and absent are calculated from them. Ask an administrator to set them up.'}
        </p>
      </div>
      {mayConfigure && (
        <Button asChild size="sm">
          <Link to="/settings/timings">
            Office timings
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </div>
  );
}
