import * as React from 'react';
import type { TimingAssignment } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { addDaysYmd, formatDate, todayYmd } from '../../../lib/dates';
import { setAssignmentEnd } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { Button } from '../../../components/ui/button';
import { DatePicker } from '../../../components/ui/date-picker';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';

/**
 * End a timing assignment that has already started, move its end date, or make it open-ended again.
 * The server never lets an end date fall before yesterday, so days already judged keep their timings.
 */
export function EndAssignmentDialog({ assignment, onOpenChange }: { assignment: TimingAssignment | null; onOpenChange: (open: boolean) => void }) {
  const today = todayYmd();
  const yesterday = addDaysYmd(today, -1);
  // Keep showing the last assignment while the dialog animates closed.
  const last = React.useRef<TimingAssignment | null>(null);
  if (assignment) last.current = assignment;
  const a = assignment ?? last.current;

  const [end, setEnd] = React.useState<string | null>(today);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (assignment) {
      // Default: end today, unless it already ends in the future (then offer that date for editing).
      setEnd(assignment.effectiveTo && assignment.effectiveTo >= today ? assignment.effectiveTo : today);
      setError(null);
    }
  }, [assignment, today]);

  const minEnd = a ? (a.effectiveFrom > yesterday ? a.effectiveFrom : yesterday) : yesterday;

  const save = useApiMutation<TimingAssignment, string | null>({
    mutationFn: (to) => setAssignmentEnd(a!.id, to),
    invalidate: [qk.timings.all, qk.daily.all],
    toastErrors: false,
    successMessage: (_d, to) => (to ? `${a!.scopeLabel} follows ${a!.profileName} until ${formatDate(to)}` : `${a!.scopeLabel} now follows ${a!.profileName} with no end date`),
    onSuccess: () => onOpenChange(false),
    onError: (e) => setError(e.fieldErrors.effectiveTo ?? e.message),
  });

  const submit = (to: string | null) => {
    setError(null);
    if (to !== null && to < minEnd) {
      setError(`The end date can't be before ${formatDate(minEnd)}: earlier days already used this timing.`);
      return;
    }
    save.mutate(to);
  };

  return (
    <Dialog open={assignment !== null} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>End assignment</DialogTitle>
          <DialogDescription>
            {a ? (
              <>
                <span className="font-medium text-foreground">{a.scopeLabel}</span> has followed <span className="font-medium text-foreground">{a.profileName}</span>
                {a.label ? ` (${a.label})` : ''} since {formatDate(a.effectiveFrom)}. Choose the last day it applies; from the next day they go back to their usual timing.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormField label="Last day" error={error} hint={`Days up to and including this date keep ${a?.profileName ?? 'this timing'}. It can't be before ${formatDate(minEnd)}.`}>
            <DatePicker
              value={end}
              onChange={(v) => { setEnd(v); setError(null); }}
              isDisabled={(ymd) => ymd < minEnd}
              invalid={Boolean(error)}
              aria-label="Last day of the assignment"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            {minEnd <= yesterday && (
              <Button type="button" size="sm" variant="secondary" onClick={() => { setEnd(yesterday); setError(null); }}>
                Yesterday
              </Button>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={() => { setEnd(today); setError(null); }}>
              Today
            </Button>
            {a?.effectiveTo && (
              <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => submit(null)}>
                Remove end date (open-ended)
              </Button>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={save.isPending || !end} onClick={() => submit(end)}>
            {save.isPending ? 'Saving...' : end ? `End after ${formatDate(end)}` : 'End assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
