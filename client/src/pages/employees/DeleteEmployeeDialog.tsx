import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { useApiMutation } from '../../lib/api';
import { deleteEmployee } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';

export interface DeleteTarget {
  id: number;
  name: string;
  empCode: string;
  deviceCount: number;
  /** When known, "Mark as left instead" is only offered to employees who have not left yet. */
  status?: 'active' | 'disabled' | 'left';
}

export interface DeleteEmployeeDialogProps {
  employee: DeleteTarget | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (employee: DeleteTarget) => void;
  /** Offer the safe alternative: open the "Mark as left" status dialog for this employee. */
  onMarkLeft?: (employee: DeleteTarget) => void;
}

/**
 * Permanent deletion. Reserved for the Super Admin (the server refuses everyone else). Deleting also removes the
 * employee's leave records, attendance corrections and calculated attendance days, so the dialog steers towards
 * "Mark as left" and requires typing the employee code to confirm.
 */
export function DeleteEmployeeDialog({ employee, onOpenChange, onDeleted, onMarkLeft }: DeleteEmployeeDialogProps) {
  const last = React.useRef<DeleteTarget | null>(null);
  if (employee) last.current = employee;
  const shown = employee ?? last.current;
  const [removeFromDevices, setRemoveFromDevices] = React.useState(false);
  const [typed, setTyped] = React.useState('');

  // fresh choice every time the dialog opens
  React.useEffect(() => {
    if (employee) {
      setRemoveFromDevices(false);
      setTyped('');
    }
  }, [employee]);

  const remove = useApiMutation<void, DeleteTarget>({
    mutationFn: (e) => deleteEmployee(e.id, { removeFromDevices }),
    invalidate: [qk.employees.all, qk.wings.all],
    successMessage: (_d, e) => `Deleted ${e.name}`,
    errorMessage: 'Could not delete employee',
    onSuccess: (_d, e) => {
      onOpenChange(false);
      onDeleted?.(e);
    },
  });

  const confirmed = shown !== null && typed.trim() === shown.empCode;

  return (
    <AlertDialog open={employee !== null} onOpenChange={(o) => !remove.isPending && onOpenChange(o)}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete {shown?.name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <div className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2.5 text-[13px] text-danger-text">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">This deletes their attendance history and cannot be undone:</p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>all leave records and attendance corrections</li>
                    <li>every calculated attendance day (present, late, absent ...)</li>
                    <li>their punches stay on file but show as an unknown PIN <span className="font-mono">{shown?.empCode}</span></li>
                  </ul>
                </div>
              </div>
              <p className="text-[13px] text-muted-foreground">
                If the person has left NACTA or should no longer mark attendance, <span className="font-medium text-foreground">mark them as Left</span> instead: they are removed from the terminals and their history is kept for reports.
              </p>
            </div>
          </AlertDialogDescription>
          <div className="space-y-3 pt-2">
            <FormField
              inline
              label="Also remove from devices"
              hint={
                shown && shown.deviceCount > 0
                  ? `Queues a delete command on every active terminal (currently on ${shown.deviceCount}). Their templates are erased there.`
                  : 'Queues a delete command on every active terminal.'
              }
            >
              <Checkbox checked={removeFromDevices} onCheckedChange={(v) => setRemoveFromDevices(v === true)} />
            </FormField>
            <FormField label={<>Type the employee code <span className="font-mono">{shown?.empCode}</span> to confirm</>}>
              <Input
                value={typed}
                onChange={(ev) => setTyped(ev.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="font-mono"
                aria-label={`Type ${shown?.empCode ?? 'the employee code'} to confirm`}
              />
            </FormField>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-between">
          {onMarkLeft && shown && shown.status !== 'left' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => {
                onOpenChange(false);
                onMarkLeft(shown);
              }}
            >
              Mark as left instead
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel disabled={remove.isPending}>Keep employee</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending || !confirmed}
              onClick={(e) => {
                e.preventDefault();
                if (shown && confirmed) remove.mutate(shown);
              }}
            >
              {remove.isPending ? 'Deleting...' : 'Delete permanently'}
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
