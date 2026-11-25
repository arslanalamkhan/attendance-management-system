import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, CircleAlert, LogOut, Play, TriangleAlert, UserCheck } from 'lucide-react';
import { ErrorCode } from '@nacta/shared';
import type { EmployeeDetail, EmployeeStatus } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { changeEmployeeStatus, getEmployee } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { todayYmd } from '../../lib/dates';
import { relativeTime } from '../../lib/time';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

export interface StatusChangeTarget {
  id: number;
  name: string;
  /** Current status. */
  status: EmployeeStatus;
  /** The status to move to. */
  to: EmployeeStatus;
  /** Called after the change was accepted (before device progress settles). */
  onChanged?: (employee: EmployeeDetail) => void;
}

const COPY: Record<EmployeeStatus, { title: string; cta: string; icon: React.ReactNode }> = {
  disabled: { title: 'Disable employee', cta: 'Disable employee', icon: <Ban aria-hidden="true" /> },
  left: { title: 'Mark as left', cta: 'Mark as left', icon: <LogOut aria-hidden="true" /> },
  active: { title: 'Enable employee', cta: 'Enable employee', icon: <Play aria-hidden="true" /> },
};

const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The plain-language device effect, shown before anything happens. */
export function deviceEffectText(name: string, to: EmployeeStatus, deviceNames: string[] | null): string {
  const where = deviceNames === null ? 'every device' : deviceNames.length === 0 ? 'the devices (none hold them right now)' : joinNames(deviceNames);
  if (to === 'active') {
    return `${name} will be restored to ${deviceNames === null ? 'the devices they were removed from' : where}, with their fingerprints, face and photo, and can mark attendance again.`;
  }
  const tail = 'Their fingerprints, face and photo stay saved in the app';
  if (to === 'disabled') return `${name} will be removed from ${where} and won't be able to mark attendance. ${tail} and are restored when you enable them.`;
  return `${name} will be removed from ${where} and won't be able to mark attendance. Their attendance history is kept. ${tail}; marking them active again restores them.`;
}

const isSettled = (s: string) => s === 'success' || s === 'failed';

export function StatusChangeDialog({ target, onOpenChange }: { target: StatusChangeTarget | null; onOpenChange: (open: boolean) => void }) {
  const last = React.useRef<StatusChangeTarget | null>(null);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        {shown && <StatusChangeBody key={`${shown.id}-${shown.to}`} target={shown} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function StatusChangeBody({ target, onClose }: { target: StatusChangeTarget; onClose: () => void }) {
  const { to, name } = target;
  const copy = COPY[to];
  const qc = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [date, setDate] = React.useState(todayYmd());
  const [stage, setStage] = React.useState<'form' | 'needs-force' | 'progress'>('form');
  const [serverNote, setServerNote] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  // Device names for the plain-language effect (and the progress list afterwards).
  const detail = useQuery({
    queryKey: qk.employees.detail(target.id),
    queryFn: ({ signal }) => getEmployee(target.id, signal),
    // While the change settles, keep refetching until every device command is done.
    refetchInterval: (q) => {
      if (stage !== 'progress') return false;
      const d = q.state.data;
      const open = d?.devices.some((x) => x.lastCommand && !isSettled(x.lastCommand.status));
      return open ? 2000 : false;
    },
  });
  const held = detail.data ? detail.data.devices.filter((d) => d.onDevice).map((d) => d.deviceName) : null;
  const removedFrom = detail.data ? detail.data.devices.filter((d) => !d.onDevice && d.lastCommand).map((d) => d.deviceName) : null;
  const effectNames = to === 'active' ? (removedFrom && removedFrom.length > 0 ? removedFrom : null) : held;

  const change = useApiMutation<EmployeeDetail, boolean>({
    mutationFn: (force) =>
      changeEmployeeStatus(target.id, {
        status: to,
        reason: reason.trim() || undefined,
        effectiveDate: to === 'left' && date ? date : undefined,
        force,
      }),
    invalidate: [qk.employees.all, qk.wings.all],
    toastErrors: false,
    onSuccess: (d) => {
      qc.setQueryData(qk.employees.detail(target.id), d);
      target.onChanged?.(d);
      setSubmitted(true);
      setStage('progress');
    },
    onError: (e) => {
      if (e.code === ErrorCode.NO_BIOMETRIC_BACKUP) {
        setServerNote(e.message);
        setStage('needs-force');
      } else {
        setServerNote(e.message);
        setStage('form');
      }
    },
  });

  const devices = detail.data?.devices.filter((d) => d.lastCommand) ?? [];
  const working = devices.some((d) => d.lastCommand && !isSettled(d.lastCommand.status));
  const failed = devices.filter((d) => d.lastCommand?.status === 'failed');

  // ---- progress ----
  if (stage === 'progress') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{to === 'active' ? `${name} is enabled` : to === 'left' ? `${name} is marked as left` : `${name} is disabled`}</DialogTitle>
          <DialogDescription>
            {working ? 'The change is saved. Waiting for the devices to confirm it.' : failed.length ? 'The change is saved, but some devices did not confirm it.' : 'The change is saved and the devices have confirmed it.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {devices.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
              {detail.isFetching && !detail.data ? 'Checking the devices...' : 'No device commands were needed.'}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card" aria-live="polite" aria-label="Device progress">
              {devices.map((d) => {
                const s = d.lastCommand!.status;
                return (
                  <li key={d.deviceId} className="flex items-center gap-3 px-3 py-2.5">
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-content-center rounded-full',
                        s === 'success' && 'bg-success-subtle text-success-text',
                        s === 'failed' && 'bg-danger-subtle text-danger-text',
                        !isSettled(s) && 'bg-info-subtle text-info-text',
                      )}
                    >
                      {s === 'success' ? (
                        <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                      ) : s === 'failed' ? (
                        <TriangleAlert className="size-3.5" aria-hidden="true" />
                      ) : (
                        <span className="size-3.5 rounded-full border-2 border-info/30 border-t-info motion-safe:animate-spin" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{d.deviceName}</span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {d.lastCommand!.command} · {relativeTime(d.lastCommand!.at)}
                      </span>
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">{s === 'sent' ? 'Sent, waiting' : s === 'pending' ? 'Queued' : s === 'success' ? 'Confirmed' : 'Failed'}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {working && <p className="text-xs text-muted-foreground">Devices check in every few seconds. You can close this: the status on the profile keeps updating.</p>}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{working ? 'Close, keep waiting' : 'Done'}</Button>
        </DialogFooter>
      </>
    );
  }

  // ---- no biometric backup warning ----
  if (stage === 'needs-force') {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>The server could not back up {name}&apos;s biometrics first.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div role="alert" className="flex gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-3.5 py-3 text-warning-text">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="space-y-1 text-[13px]">
              <p className="font-semibold">No biometric backup stored in the app</p>
              <p>
                {serverNote ?? `${name}'s fingerprints or face are only on a device, not saved in the app.`} If you disable them now, the templates on the device are removed and
                cannot be restored. They will need to enrol again when you enable them.
              </p>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground">Go back to keep them active, or wait for the devices to report their data first and try again.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setStage('form')} disabled={change.isPending}>
            Back
          </Button>
          <Button variant="destructive" loading={change.isPending} onClick={() => change.mutate(true)}>
            Disable anyway — they will need to re-enrol
          </Button>
        </DialogFooter>
      </>
    );
  }

  // ---- form ----
  return (
    <>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>
          {to === 'active' ? 'Restores access on the devices.' : to === 'left' ? 'Records the separation and removes the person from the devices.' : 'Temporarily blocks the person from the devices.'}
        </DialogDescription>
      </DialogHeader>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setServerNote(null);
          change.mutate(false);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <DialogBody className="space-y-4">
          <div className={cn('flex gap-3 rounded-lg px-3.5 py-3 text-[13px]', to === 'active' ? 'bg-success-subtle text-success-text' : 'bg-muted text-foreground')}>
            {to === 'active' ? <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <p>{deviceEffectText(name, to, detail.isPending ? null : effectNames)}</p>
          </div>

          {to === 'left' && (
            <FormField label="Effective date" hint="The separation date. Defaults to today.">
              <Input type="date" value={date} max={undefined} onChange={(e) => setDate(e.target.value)} />
            </FormField>
          )}
          <FormField label="Reason" hint={to === 'active' ? 'Optional. Shown in the audit log.' : 'Optional but recommended. Shown on the profile and in the audit log.'}>
            <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={to === 'left' ? 'e.g. Transferred, retired, resigned' : to === 'disabled' ? 'e.g. On leave without pay, under inquiry' : 'e.g. Returned from leave'} />
          </FormField>

          {serverNote && stage === 'form' && (
            <p role="alert" className="flex items-start gap-2 text-[13px] font-medium text-danger-text">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {serverNote}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={change.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant={to === 'active' ? 'primary' : 'destructive'} loading={change.isPending} disabled={submitted}>
            {!change.isPending && copy.icon}
            {copy.cta}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
