import * as React from 'react';
import { ErrorCode, LEAVE_PARTS, LEAVE_PART_LABEL, zLeaveUpdate } from '@nacta/shared';
import type { Leave, LeaveUpdate } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { updateLeave } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { useHolidays, useLeaveTypes } from '../../../hooks/use-rules';
import { holidayOn } from '../../../lib/rules-ui';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { RangePicker } from '../../../components/ui/range-picker';
import { Segmented } from '../../../components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { Textarea } from '../../../components/ui/textarea';
import { EmployeeAvatar } from '../../../components/ui/employee-avatar';
import { LeaveDot } from '../../../components/rules/pills';

export function EditLeaveSheet({ leave, onOpenChange }: { leave: Leave | null; onOpenChange: (open: boolean) => void }) {
  const last = React.useRef<Leave | null>(null);
  if (leave) last.current = leave;
  const shown = leave ?? last.current;
  return (
    <Sheet open={leave !== null} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit leave</SheetTitle>
          <SheetDescription>Change the type, dates or reason for this person&apos;s leave. The change is recorded in the audit log.</SheetDescription>
        </SheetHeader>
        {shown && leave && <EditForm key={shown.id} leave={shown} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({ leave, onClose }: { leave: Leave; onClose: () => void }) {
  const types = useLeaveTypes();
  const holidays = useHolidays();
  const [typeId, setTypeId] = React.useState(String(leave.leaveTypeId));
  const [from, setFrom] = React.useState<string | null>(leave.from);
  const [to, setTo] = React.useState<string | null>(leave.to);
  const [part, setPart] = React.useState<(typeof LEAVE_PARTS)[number]>(leave.part);
  const [reason, setReason] = React.useState(leave.reason ?? '');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const single = from !== null && from === to;

  const save = useApiMutation<Leave, LeaveUpdate>({
    mutationFn: (v) => updateLeave(leave.id, v),
    toastErrors: false,
    invalidate: [qk.leaves.all, qk.daily.all],
    successMessage: 'Leave updated',
    onSuccess: onClose,
    onError: (e) => setErrors(e.code === ErrorCode.LEAVE_OVERLAP ? { dates: e.message } : e.isValidation ? e.fieldErrors : { form: e.message }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = zLeaveUpdate.safeParse({ leaveTypeId: Number(typeId) || 0, from: from ?? '', to: to ?? '', part: single ? part : 'full', reason: reason || null });
    if (!p.success) {
      const out: Record<string, string> = {};
      for (const i of p.error.issues) out[i.path[0] === 'from' || i.path[0] === 'to' ? 'dates' : String(i.path[0])] ??= i.message;
      return setErrors(out);
    }
    setErrors({});
    save.mutate(p.data as LeaveUpdate);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
          <EmployeeAvatar employee={{ id: leave.employeeId, name: leave.employeeName }} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{leave.employeeName}</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">{leave.empCode}</span>
              {leave.wingName ? ` · ${leave.wingName}` : ''}
            </p>
          </div>
        </div>
        <FormField label="Leave type" required error={errors.leaveTypeId}>
          <Select value={typeId} onValueChange={setTypeId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(types.data ?? [])
                .filter((t) => t.isActive || t.id === leave.leaveTypeId)
                .map((t) => (
                  <SelectItem key={t.id} value={String(t.id)}>
                    <span className="flex items-center gap-2">
                      <LeaveDot color={t.color} />
                      <span className="font-mono text-xs font-semibold">{t.code}</span>
                      {t.name}
                    </span>
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Dates" required error={errors.dates} hint="Pick the same day twice for a single day.">
          <RangePicker
            value={{ from, to }}
            onChange={(r) => {
              setFrom(r.from);
              setTo(r.to);
            }}
            markFor={(d) => (holidayOn(d, holidays.data) ? 'holiday' : undefined)}
            invalid={Boolean(errors.dates)}
          />
        </FormField>
        {single && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-none">Part of the day</p>
            <Segmented aria-label="Part of the day" value={part} onChange={setPart} options={LEAVE_PARTS.map((p) => ({ value: p, label: LEAVE_PART_LABEL[p] }))} />
            {errors.part && <p role="alert" className="text-xs font-medium text-danger-text">{errors.part}</p>}
          </div>
        )}
        <FormField label="Reason" error={errors.reason} hint="Optional.">
          <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        {errors.form && <p role="alert" className="text-[13px] font-medium text-danger-text">{errors.form}</p>}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save changes
        </Button>
      </SheetFooter>
    </form>
  );
}
