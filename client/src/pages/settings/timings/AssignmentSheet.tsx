import * as React from 'react';
import { Lightbulb, X } from 'lucide-react';
import { toast } from 'sonner';
import { zTimingAssignmentInput } from '@nacta/shared';
import type { TimingAssignment, TimingAssignmentInput, TimingProfile } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { addDaysYmd, todayYmd } from '../../../lib/dates';
import { createAssignment } from '../../../lib/endpoints/rules';
import { qk } from '../../../lib/query-keys';
import { ORG_UNIT } from '../../../lib/terms';
import { useWings } from '../../../hooks/use-lookups';
import { Button } from '../../../components/ui/button';
import { DatePicker } from '../../../components/ui/date-picker';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { Segmented } from '../../../components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../../components/ui/sheet';
import { EmployeePicker, type PickedEmployee } from '../../../components/rules/employee-picker';
import { summarizeDays } from './timing-bits';

export interface AssignmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: TimingProfile[];
  /** First-time setup: past start dates are allowed once. */
  setupOpen: boolean;
}

export function AssignmentSheet({ open, onOpenChange, profiles, setupOpen }: AssignmentSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-lg sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add assignment</SheetTitle>
          <SheetDescription>Choose who a timing profile applies to, and for which dates. It does not change past days.</SheetDescription>
        </SheetHeader>
        {open && <AssignmentForm profiles={profiles} setupOpen={setupOpen} onClose={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  );
}

function AssignmentForm({ profiles, setupOpen, onClose }: { profiles: TimingProfile[]; setupOpen: boolean; onClose: () => void }) {
  const wings = useWings();
  const today = todayYmd();
  const [scope, setScope] = React.useState<'all' | 'wing' | 'employee'>('all');
  const [wingId, setWingId] = React.useState('');
  const [people, setPeople] = React.useState<PickedEmployee[]>([]);
  const [profileId, setProfileId] = React.useState('');
  const [from, setFrom] = React.useState<string | null>(today);
  const [to, setTo] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useApiMutation<TimingAssignment, TimingAssignmentInput>({
    mutationFn: createAssignment,
    toastErrors: false,
    invalidate: [qk.timings.all, qk.daily.all],
    successMessage: 'Assignment added',
    onSuccess: onClose,
    onError: (e) => setErrors(e.isValidation ? e.fieldErrors : { form: e.message }),
  });

  /** Ramadan example: a labelled, dated assignment you adjust. Dates here are only a starting point. */
  const applyRamadanExample = () => {
    setLabel('Ramadan');
    setScope('all');
    setFrom(today);
    setTo(addDaysYmd(today, 29));
    const match = profiles.find((p) => /ramadan/i.test(p.name));
    if (match) setProfileId(String(match.id));
    else toast.info('Pick (or first create) your Ramadan timing profile', { description: 'Then set the real start and end dates from the official moon-sighting announcement.' });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const scopeId = scope === 'wing' ? Number(wingId) || undefined : scope === 'employee' ? people[0]?.id : undefined;
    const p = zTimingAssignmentInput.safeParse({ profileId: Number(profileId) || 0, scope, scopeId, effectiveFrom: from ?? '', effectiveTo: to ?? undefined, label: label || null });
    if (!p.success) {
      const out: Record<string, string> = {};
      for (const i of p.error.issues) out[String(i.path[0])] ??= i.path[0] === 'profileId' ? 'Choose a profile' : i.message;
      return setErrors(out);
    }
    if (!setupOpen && p.data.effectiveFrom < today) return setErrors({ effectiveFrom: 'Assignments start today or later; earlier days keep their timings.' });
    setErrors({});
    save.mutate(p.data as TimingAssignmentInput);
  };

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-5">
        <button
          type="button"
          onClick={applyRamadanExample}
          className="flex w-full items-start gap-3 rounded-lg border border-dashed border-border-strong bg-muted/30 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden="true" />
          <span className="text-[13px] leading-snug">
            <span className="font-medium">Setting up Ramadan hours?</span>
            <span className="block text-muted-foreground">Fill in the label and a date range, then pick your Ramadan profile. Adjust the dates to the official announcement.</span>
          </span>
        </button>

        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">Applies to</p>
          <Segmented
            aria-label="Applies to"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'wing', label: ORG_UNIT.singular },
              { value: 'employee', label: 'One employee' },
            ]}
          />
        </div>
        {scope === 'wing' && (
          <FormField label={ORG_UNIT.singular} required error={errors.scopeId}>
            <Select value={wingId} onValueChange={setWingId}>
              <SelectTrigger>
                <SelectValue placeholder={`Choose a ${ORG_UNIT.lower}`} />
              </SelectTrigger>
              <SelectContent>
                {(wings.data ?? []).map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        )}
        {scope === 'employee' && (
          <FormField label="Employee" required error={errors.scopeId}>
            <EmployeePicker single value={people} onChange={setPeople} invalid={Boolean(errors.scopeId)} />
          </FormField>
        )}

        <FormField label="Timing profile" required error={errors.profileId}>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  <span className="flex flex-col items-start leading-tight">
                    <span>{p.name}</span>
                    <span className="text-[11px] text-muted-foreground">{summarizeDays(p.days)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Effective from" required error={errors.effectiveFrom} hint={setupOpen ? 'During first-time setup a past date is allowed.' : 'Today or later: past days keep their timings.'}>
            <DatePicker value={from} onChange={setFrom} isDisabled={setupOpen ? undefined : (d) => d < today} invalid={Boolean(errors.effectiveFrom)} aria-label="Effective from" />
          </FormField>
          <FormField label="Until (optional)" error={errors.effectiveTo} hint="Leave empty for open-ended.">
            <div className="flex items-center gap-1.5">
              <DatePicker value={to} onChange={setTo} isDisabled={(d) => (from ? d < from : false)} invalid={Boolean(errors.effectiveTo)} aria-label="Effective until" />
              {to && (
                <button type="button" aria-label="Clear end date" onClick={() => setTo(null)} className="grid size-8 shrink-0 place-content-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </FormField>
        </div>

        <FormField label="Label" hint="Optional, e.g. Ramadan." error={errors.label}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Ramadan" autoComplete="off" />
        </FormField>

        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Which one wins?</span> An employee assignment beats a {ORG_UNIT.lower} assignment, which beats everyone. Within the same level a dated assignment (like Ramadan) beats an open-ended one; if still tied, the latest start date wins.
        </p>
        {errors.form && <p role="alert" className="text-[13px] font-medium text-danger-text">{errors.form}</p>}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Add assignment
        </Button>
      </SheetFooter>
    </form>
  );
}
