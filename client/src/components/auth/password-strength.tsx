import { Check, Circle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { evaluatePassword } from '../../lib/password';

const LABELS = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/** Live checklist + strength bar for a candidate password, derived from the shared zNewPassword rules. */
export function PasswordStrength({ password, className }: { password: string; className?: string }) {
  const rules = evaluatePassword(password);
  const met = rules.filter((r) => r.met).length;
  const score = password.length === 0 ? 0 : Math.max(1, Math.round((met / rules.length) * 4));
  const tone = score <= 1 ? 'bg-danger' : score === 2 ? 'bg-warning' : score === 3 ? 'bg-info' : 'bg-success';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn('h-1 flex-1 rounded-full bg-muted transition-colors duration-200', i <= score && tone)} />
          ))}
        </div>
        <span className="w-14 text-right text-xs font-medium text-muted-foreground" aria-live="polite">
          {password ? LABELS[score] : ''}
        </span>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Password requirements">
        {rules.map((r) => (
          <li
            key={r.message}
            className={cn('flex items-start gap-2 text-xs transition-colors', r.met ? 'text-success-text' : 'text-muted-foreground')}
          >
            {r.met ? (
              <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="mt-px size-3.5 shrink-0 opacity-50" aria-hidden="true" />
            )}
            <span>
              {r.message}
              <span className="sr-only">{r.met ? ' (met)' : ' (not met yet)'}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
