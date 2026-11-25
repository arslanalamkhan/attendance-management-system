import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Cpu, Fingerprint, LoaderCircle, ScanFace, Send, TimerOff } from 'lucide-react';
import { FINGERS } from '@nacta/shared';
import type { EmployeeBiometrics, EmployeeDetail } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { enrollOnDevice, getEmployeeBiometrics } from '../../../lib/endpoints/biometrics';
import { qk } from '../../../lib/query-keys';
import { relativeTime } from '../../../lib/time';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { fingerMap, fingerName, latestFace } from './bio-utils';

export interface EnrollTarget {
  kind: 'finger' | 'face';
  fingerIndex?: number;
}

const TIMEOUT_MS = 120_000;
type Phase = 'form' | 'waiting' | 'done' | 'failed' | 'timeout';

const sig = (t: { id: number; updatedAt: string } | null | undefined) => (t ? `${t.id}:${t.updatedAt}` : null);

function currentSig(b: EmployeeBiometrics | undefined, kind: 'finger' | 'face', fingerIndex: number): string | null {
  return sig(kind === 'face' ? latestFace(b) : fingerMap(b).get(fingerIndex));
}

export interface EnrollDialogProps {
  employee: Pick<EmployeeDetail, 'id' | 'name' | 'status' | 'devices'>;
  target: EnrollTarget | null;
  onOpenChange: (open: boolean) => void;
  /** Opens the "Push to devices" dialog (shown when the employee is on no device yet). */
  onPush: () => void;
}

export function EnrollDialog({ employee, target, onOpenChange, onPush }: EnrollDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      {target && <EnrollBody key={`${target.kind}:${target.fingerIndex ?? ''}`} employee={employee} target={target} onClose={() => onOpenChange(false)} onPush={onPush} />}
    </Dialog>
  );
}

function EnrollBody({ employee, target, onClose, onPush }: { employee: EnrollDialogProps['employee']; target: EnrollTarget; onClose: () => void; onPush: () => void }) {
  const qc = useQueryClient();
  const devices = employee.devices.filter((d) => d.onDevice);
  const [kind, setKind] = React.useState<'finger' | 'face'>(target.kind);
  const [fingerIndex, setFingerIndex] = React.useState<number>(target.fingerIndex ?? 6);
  const [deviceId, setDeviceId] = React.useState<string>(devices[0] ? String(devices[0].deviceId) : '');
  const [overwrite, setOverwrite] = React.useState(true);
  const [phase, setPhase] = React.useState<Phase>('form');
  const [commandId, setCommandId] = React.useState<number | null>(null);
  const [startedAt, setStartedAt] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const baseline = React.useRef<string | null>(null);

  const waiting = phase === 'waiting';
  const bio = useQuery({
    queryKey: qk.employees.biometrics(employee.id),
    queryFn: ({ signal }) => getEmployeeBiometrics(employee.id, signal),
    refetchInterval: waiting ? 3000 : false,
  });

  const device = devices.find((d) => String(d.deviceId) === deviceId);
  const first = employee.name.split(/\s+/)[0] ?? employee.name;
  const targetLabel = kind === 'face' ? 'face' : `${fingerName(fingerIndex).toLowerCase()} finger`;
  const alreadyEnrolled = currentSig(bio.data, kind, fingerIndex) !== null;
  const stale = device?.lastSeenAt ? Date.now() - new Date(device.lastSeenAt).getTime() > 10 * 60_000 : true;

  const enroll = useApiMutation<{ commandId: number }>({
    mutationFn: () =>
      enrollOnDevice(employee.id, { deviceId: Number(deviceId), kind, ...(kind === 'finger' ? { fingerIndex } : {}), overwrite }),
    successMessage: false,
    errorMessage: 'Could not start enrolment',
    invalidate: [qk.employees.biometrics(employee.id)],
    onSuccess: (r) => {
      baseline.current = currentSig(qc.getQueryData<EmployeeBiometrics>(qk.employees.biometrics(employee.id)), kind, fingerIndex);
      setCommandId(r.commandId);
      setStartedAt(Date.now());
      setNow(Date.now());
      setPhase('waiting');
    },
  });

  // clock for the countdown and the timeout
  React.useEffect(() => {
    if (!waiting) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [waiting]);

  // watch for the new template, a failed command, or the timeout
  React.useEffect(() => {
    if (!waiting) return;
    const cmd = bio.data?.activity.find((a) => a.commandId === commandId);
    const s = currentSig(bio.data, kind, fingerIndex);
    if (s !== null && s !== baseline.current) {
      setPhase('done');
      void qc.invalidateQueries({ queryKey: qk.employees.all });
    } else if (cmd?.status === 'failed') {
      setPhase('failed');
    } else if (now - startedAt > TIMEOUT_MS) {
      setPhase('timeout');
    }
  }, [waiting, bio.data, now, startedAt, commandId, kind, fingerIndex, qc]);

  const cmd = bio.data?.activity.find((a) => a.commandId === commandId);
  const remaining = Math.max(0, Math.ceil((TIMEOUT_MS - (now - startedAt)) / 1000));
  const stepIndex = cmd?.status === 'success' ? 2 : cmd?.status === 'sent' ? 1 : 0;
  const retry = () => {
    setPhase('form');
    setCommandId(null);
  };

  return (
    <DialogContent size="md" onInteractOutside={(e) => waiting && e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>{kind === 'face' ? 'Enrol face on a device' : 'Enrol fingerprint on a device'}</DialogTitle>
        <DialogDescription>The employee completes enrolment at the terminal; the template syncs back here automatically.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-5">
        {phase === 'form' && (
          <>
            {devices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border-strong bg-muted/40 p-5 text-center">
                <span className="mx-auto grid size-10 place-content-center rounded-lg border bg-card text-muted-foreground">
                  <Cpu className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold">{first} is not on any device yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                  {employee.status === 'active'
                    ? 'A terminal can only enrol someone it already knows. Push the employee to a device first, then come back here.'
                    : 'Only active employees can be enrolled. Enable the employee first.'}
                </p>
                {employee.status === 'active' && (
                  <Button
                    className="mt-4"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onPush();
                    }}
                  >
                    <Send aria-hidden="true" />
                    Push to devices
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="What to enrol">
                  {(['finger', 'face'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={kind === k}
                      onClick={() => setKind(k)}
                      className={cn(
                        'flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        kind === k ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {k === 'finger' ? <Fingerprint className="size-4" aria-hidden="true" /> : <ScanFace className="size-4" aria-hidden="true" />}
                      {k === 'finger' ? 'Fingerprint' : 'Face'}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="enroll-device" className="text-[13px] font-medium">
                    Device
                  </label>
                  <Select value={deviceId} onValueChange={setDeviceId}>
                    <SelectTrigger id="enroll-device" aria-label="Device">
                      <SelectValue placeholder="Choose a device" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((d) => (
                        <SelectItem key={d.deviceId} value={String(d.deviceId)}>
                          {d.deviceName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {stale && device && (
                    <p className="flex items-start gap-1.5 text-xs text-warning-text">
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      This terminal was last seen {device.lastSeenAt ? relativeTime(device.lastSeenAt) : 'a long time ago'}. It may not receive the request until it reconnects.
                    </p>
                  )}
                </div>

                {kind === 'finger' && (
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium" id="enroll-finger-label">
                      Finger
                    </p>
                    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-labelledby="enroll-finger-label">
                      {(['left', 'right'] as const).map((hand) => (
                        <div key={hand} className="space-y-1.5">
                          <p className="text-xs text-muted-foreground">{hand === 'left' ? 'Left hand' : 'Right hand'}</p>
                          <div className="grid grid-cols-5 gap-1">
                            {FINGERS.filter((f) => f.hand === hand).map((f) => {
                                const has = fingerMap(bio.data).has(f.index);
                                const selected = fingerIndex === f.index;
                                return (
                                  <button
                                    key={f.index}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={`${f.name}${has ? ', already enrolled' : ''}`}
                                    title={`${f.name}${has ? ' (enrolled)' : ''}`}
                                    onClick={() => setFingerIndex(f.index)}
                                    className={cn(
                                      'relative grid h-10 place-content-center rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                      selected ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-strong bg-card text-muted-foreground hover:bg-muted',
                                    )}
                                  >
                                    {f.name.split(' ')[1]!.slice(0, 3)}
                                    {has && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" aria-hidden="true" />}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {alreadyEnrolled && (
                  <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 px-3 py-2.5">
                    <div>
                      <p className="text-[13px] font-medium">Replace the existing template</p>
                      <p className="text-xs text-muted-foreground">This {kind === 'face' ? 'face' : 'finger'} is already enrolled.</p>
                    </div>
                    <Switch checked={overwrite} onCheckedChange={setOverwrite} aria-label="Replace the existing template" />
                  </div>
                )}

                <div className="rounded-lg border border-primary/25 bg-primary-subtle p-4">
                  <p className="text-sm font-semibold text-primary-text">What happens next</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-foreground/90">
                    Ask <strong>{first}</strong> to go to <strong>{device?.deviceName ?? 'the chosen terminal'}</strong>. The terminal will prompt for the {targetLabel}
                    {kind === 'finger' ? ' (3 scans)' : ' (look straight at the camera)'}.
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'waiting' && (
          <div className="space-y-5 py-2 text-center" aria-live="polite">
            <div className="relative mx-auto grid size-20 place-content-center">
              <span className="absolute inset-0 rounded-full border-2 border-primary/30 motion-safe:animate-ping" aria-hidden="true" />
              <span className="absolute inset-2 rounded-full border-2 border-primary/20" aria-hidden="true" />
              <span className="relative grid size-14 place-content-center rounded-full bg-primary-subtle text-primary-text">
                {kind === 'face' ? <ScanFace className="size-7" aria-hidden="true" /> : <Fingerprint className="size-7" aria-hidden="true" />}
              </span>
            </div>
            <div>
              <p className="text-sm font-semibold">Waiting for {first} at {device?.deviceName}</p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted-foreground">
                The terminal is asking for the {targetLabel}. This page updates by itself when the template arrives.
              </p>
            </div>
            <ol className="mx-auto flex max-w-sm items-center justify-between gap-2 text-xs">
              {['Queued', 'Sent to terminal', 'Waiting for scans'].map((s, i) => (
                <li key={s} className={cn('flex flex-1 flex-col items-center gap-1.5', i <= stepIndex ? 'text-primary-text' : 'text-muted-foreground')}>
                  <span className={cn('grid size-6 place-content-center rounded-full border text-[11px] font-semibold', i < stepIndex ? 'border-primary bg-primary text-primary-foreground' : i === stepIndex ? 'border-primary' : 'border-border-strong')}>
                    {i < stepIndex ? <Check className="size-3.5" aria-hidden="true" /> : i === stepIndex ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> : i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="text-xs tabular-nums text-muted-foreground">
              Checking every 3 seconds · gives up in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
            </p>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-3 py-4 text-center" aria-live="polite">
            <div className="relative mx-auto grid size-20 place-content-center">
              <span className="absolute inset-0 rounded-full bg-success/20 motion-safe:animate-ping [animation-iteration-count:2]" aria-hidden="true" />
              <span className="relative grid size-16 place-content-center rounded-full bg-success text-white shadow-md motion-safe:animate-in motion-safe:zoom-in-50">
                <Check className="size-8" strokeWidth={3} aria-hidden="true" />
              </span>
            </div>
            <p className="text-base font-semibold">{kind === 'face' ? 'Face' : fingerName(fingerIndex)} enrolled</p>
            <p className="text-[13px] text-muted-foreground">
              The template from {device?.deviceName} is saved. It will be pushed to {employee.name}&apos;s other devices.
            </p>
          </div>
        )}

        {(phase === 'failed' || phase === 'timeout') && (
          <div className="space-y-4" aria-live="polite">
            <div className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-subtle p-4 text-danger-text">
              {phase === 'failed' ? <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" /> : <TimerOff className="mt-0.5 size-5 shrink-0" aria-hidden="true" />}
              <div>
                <p className="text-sm font-semibold">{phase === 'failed' ? 'The terminal rejected the request' : 'No template arrived in 2 minutes'}</p>
                <p className="mt-0.5 text-[13px]">
                  {phase === 'failed' ? `${device?.deviceName ?? 'The device'} reported a failure for this command.` : `Nothing was received from ${device?.deviceName ?? 'the device'}.`}
                </p>
              </div>
            </div>
            <div>
              <p className="text-[13px] font-medium">Things to check</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-muted-foreground">
                <li>The terminal is switched on and online (Devices page). Offline terminals pick the request up when they reconnect.</li>
                <li>{first} is actually on this device and active. Push the employee again if unsure.</li>
                <li>{first} went to the terminal and completed all {kind === 'finger' ? '3 scans' : 'face steps'} before the prompt timed out.</li>
                <li>Try another terminal, or send the request again.</li>
              </ul>
            </div>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        {phase === 'form' && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {devices.length > 0 && (
              <Button onClick={() => enroll.mutate()} loading={enroll.isPending} disabled={!deviceId || employee.status !== 'active'}>
                {!enroll.isPending && <Send aria-hidden="true" />}
                Send to device
              </Button>
            )}
          </>
        )}
        {phase === 'waiting' && (
          <Button variant="secondary" onClick={onClose}>
            Close (enrolment continues on the device)
          </Button>
        )}
        {phase === 'done' && <Button onClick={onClose}>Done</Button>}
        {(phase === 'failed' || phase === 'timeout') && (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={retry}>Try again</Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
