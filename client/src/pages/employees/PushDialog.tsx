import * as React from 'react';
import { Send } from 'lucide-react';
import type { Queued } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { pushEmployees } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { useDevices } from '../../hooks/use-lookups';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { EmptyState } from '../../components/ui/empty-state';
import { ErrorState } from '../../components/ui/error-state';
import { Skeleton } from '../../components/ui/skeleton';
import { DeviceStatusPill } from '../../components/ui/badge';

export interface PushTarget {
  /** Employee ids, or 'all' for every employee. */
  employeeIds: number[] | 'all';
  /** How many employees this affects (for the summary and the button). */
  count: number;
  /** Shown when a single employee is pushed. */
  name?: string;
  onDone?: () => void;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function PushDialog({ target, onOpenChange }: { target: PushTarget | null; onOpenChange: (open: boolean) => void }) {
  // Keep the last target while the close animation plays.
  const last = React.useRef<PushTarget | null>(null);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Push to devices</DialogTitle>
          <DialogDescription>
            Sends the employee record (name, card, privilege, password and templates) to the selected terminals. Commands are queued and delivered the next time each device checks in.
          </DialogDescription>
        </DialogHeader>
        {shown && <PushForm key={String(shown.employeeIds === 'all' ? 'all' : shown.employeeIds.join(','))} target={shown} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PushForm({ target, onClose }: { target: PushTarget; onClose: () => void }) {
  const devices = useDevices();
  const list = devices.data ?? [];
  const activeIds = React.useMemo(() => list.filter((d) => d.isActive).map((d) => d.id), [list]);
  // null = untouched: every active device is checked.
  const [picked, setPicked] = React.useState<Set<number> | null>(null);
  const selected = picked ?? new Set(activeIds);
  const selectedIds = list.filter((d) => selected.has(d.id)).map((d) => d.id);

  const push = useApiMutation<Queued, number[]>({
    mutationFn: (deviceIds) => pushEmployees({ employeeIds: target.employeeIds, deviceIds }),
    invalidate: [qk.devices.all],
    successMessage: (q) => `Queued ${plural(q.queued, 'command', 'commands')} for the devices`,
    errorMessage: 'Push failed',
    onSuccess: () => {
      target.onDone?.();
      onClose();
    },
  });

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const who = target.name && target.count === 1 ? target.name : plural(target.count, 'employee', 'employees');
  const everyone = target.employeeIds === 'all';

  return (
    <>
      <DialogBody className="space-y-4">
        {devices.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading devices">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : devices.isError ? (
          <ErrorState error={devices.error} onRetry={() => void devices.refetch()} retrying={devices.isFetching} />
        ) : list.length === 0 ? (
          <EmptyState icon={<Send />} title="No devices registered" description="Register a terminal first, then you can push employees to it." />
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-2 flex w-full items-center justify-between text-[13px] font-medium">
              <span>Devices</span>
              <button
                type="button"
                className="rounded-sm text-xs font-normal text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setPicked(selectedIds.length === activeIds.length ? new Set() : new Set(activeIds))}
              >
                {selectedIds.length === activeIds.length ? 'Clear' : 'Select all active'}
              </button>
            </legend>
            <ul className="space-y-2">
              {list.map((d) => {
                const id = `push-device-${d.id}`;
                const checked = selected.has(d.id);
                return (
                  <li key={d.id}>
                    <label
                      htmlFor={id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50',
                        checked && 'border-primary/50 bg-primary-subtle/60',
                      )}
                    >
                      <Checkbox id={id} checked={checked} onCheckedChange={(v) => toggle(d.id, v === true)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {d.serialNumber} · seen {relativeTime(d.lastSeenAt)}
                        </span>
                      </span>
                      {!d.isActive && <span className="text-xs text-muted-foreground">Inactive</span>}
                      <DeviceStatusPill status={d.status} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground" aria-live="polite">
          {everyone ? (
            <>
              This affects <strong className="font-semibold text-foreground">every employee ({target.count.toLocaleString()})</strong>
            </>
          ) : (
            <>
              This affects <strong className="font-semibold text-foreground">{who}</strong>
            </>
          )}{' '}
          on <strong className="font-semibold tabular-nums text-foreground">{plural(selectedIds.length, 'device', 'devices')}</strong>.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={push.isPending}>
          Cancel
        </Button>
        <Button onClick={() => push.mutate(selectedIds)} loading={push.isPending} disabled={selectedIds.length === 0 || target.count === 0}>
          {!push.isPending && <Send aria-hidden="true" />}
          Push {plural(target.count, 'employee', 'employees')}
        </Button>
      </DialogFooter>
    </>
  );
}
