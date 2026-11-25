import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock3, History, Trash2 } from 'lucide-react';
import { zCorrectionInput } from '@nacta/shared';
import type { Correction, CorrectionInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate } from '../../lib/dates';
import { createCorrection, deleteCorrection, listCorrections } from '../../lib/endpoints/rules';
import { qk } from '../../lib/query-keys';
import { relativeTime } from '../../lib/time';
import { Button } from '../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { Segmented } from '../../components/ui/segmented';
import { Skeleton } from '../../components/ui/skeleton';
import { Textarea } from '../../components/ui/textarea';

export interface CorrectionTarget {
  employeeId: number;
  name: string;
  date: string;
}

type Kind = 'add_punch' | 'set_status';
type Status = 'present' | 'absent' | 'half_day';
const STATUS_LABEL: Record<Status, string> = { present: 'Present', half_day: 'Half day', absent: 'Absent' };

export function CorrectionDialog({ target, onOpenChange }: { target: CorrectionTarget | null; onOpenChange: (open: boolean) => void }) {
  const last = React.useRef<CorrectionTarget | null>(null);
  if (target) last.current = target;
  const shown = target ?? last.current;
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {shown ? `${shown.name} · ${formatDate(shown.date)}. ` : ''}Original punches are never changed; a correction sits on top of them.
          </DialogDescription>
        </DialogHeader>
        {shown && target && <CorrectionBody key={`${shown.employeeId}-${shown.date}`} target={shown} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionBody({ target, onClose }: { target: CorrectionTarget; onClose: () => void }) {
  const [kind, setKind] = React.useState<Kind>('add_punch');
  const [time, setTime] = React.useState('');
  const [status, setStatus] = React.useState<Status>('present');
  const [reason, setReason] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Existing corrections (and removing them) are visible to the Super Admin only; correctors can add but not see.
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const existing = useQuery({
    queryKey: qk.daily.corrections(target.employeeId, target.date, target.date),
    queryFn: ({ signal }) => listCorrections({ employeeId: target.employeeId, from: target.date, to: target.date }, signal),
    enabled: isSuperAdmin,
  });
  const invalidate = [qk.daily.all, qk.attendance.all];

  const save = useApiMutation<Correction, CorrectionInput>({
    mutationFn: createCorrection,
    toastErrors: false,
    invalidate,
    successMessage: kind === 'add_punch' ? 'Punch added' : 'Day status set',
    onSuccess: onClose,
    onError: (e) => setErrors(e.isValidation ? e.fieldErrors : { form: e.message }),
  });
  const remove = useApiMutation<void, number>({ mutationFn: deleteCorrection, invalidate: [...invalidate, qk.daily.corrections(target.employeeId, target.date, target.date)], successMessage: 'Correction removed' });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = { employeeId: target.employeeId, date: target.date, type: kind, time: kind === 'add_punch' ? time : undefined, status: kind === 'set_status' ? status : undefined, reason };
    const p = zCorrectionInput.safeParse(input);
    if (!p.success) {
      const out: Record<string, string> = {};
      for (const i of p.error.issues) out[String(i.path[0])] ??= i.message;
      return setErrors(out);
    }
    setErrors({});
    save.mutate(p.data as CorrectionInput);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogBody className="space-y-5">
        {isSuperAdmin && (existing.isPending || (existing.data && existing.data.length > 0)) && (
          <section aria-label="Existing corrections" className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="size-3.5" aria-hidden="true" /> Already corrected on this day
            </h3>
            {existing.isPending ? (
              <Skeleton className="h-12" />
            ) : (
              <ul className="divide-y rounded-lg border bg-muted/30">
                {existing.data?.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                    <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{c.type === 'add_punch' ? `Punch added at ${c.time}` : `Status set to ${STATUS_LABEL[c.status as Status] ?? c.status}`}</p>
                      <p className="truncate text-xs text-muted-foreground" title={c.reason}>
                        {c.reason} {'·'} {c.createdBy ?? 'Unknown'} {'·'} {relativeTime(c.createdAt)}
                      </p>
                    </div>
                    <IconButton label="Remove this correction" icon={<Trash2 />} size="icon-sm" variant="destructive-ghost" loading={remove.isPending && remove.variables === c.id} onClick={() => remove.mutate(c.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">What needs correcting?</p>
          <Segmented
            aria-label="Correction type"
            value={kind}
            onChange={setKind}
            className="w-full"
            options={[
              { value: 'add_punch', label: 'Add missing punch' },
              { value: 'set_status', label: 'Set day status' },
            ]}
          />
        </div>

        {kind === 'add_punch' ? (
          <FormField label="Punch time" required error={errors.time} hint="The first punch of the day counts as arrival, the last as departure.">
            <Input type="time" mono value={time} onChange={(e) => setTime(e.target.value)} className="w-40" />
          </FormField>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-none">Day status</p>
            <Segmented
              aria-label="Day status"
              value={status}
              onChange={setStatus}
              options={(['present', 'half_day', 'absent'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            {errors.status && <p role="alert" className="text-xs font-medium text-danger-text">{errors.status}</p>}
            <p className="text-xs text-muted-foreground">Overrides the computed status, for example an official meeting outside the office.</p>
          </div>
        )}

        <FormField label="Reason" required error={errors.reason} hint="Required. Shown in the audit log.">
          <Textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Forgot to punch out; confirmed by the section officer" />
        </FormField>
        {errors.form && <p role="alert" className="text-[13px] font-medium text-danger-text">{errors.form}</p>}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save correction
        </Button>
      </DialogFooter>
    </form>
  );
}
