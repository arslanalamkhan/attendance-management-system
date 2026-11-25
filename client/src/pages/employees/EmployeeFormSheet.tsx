import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RefreshCw } from 'lucide-react';
import type { z } from 'zod';
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, ErrorCode, GENDERS, GENDER_LABEL, Privilege, zEmployeeInput } from '@nacta/shared';
import type { Employee, EmployeeInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { createEmployee, updateEmployee } from '../../lib/endpoints/employees';
import { qk } from '../../lib/query-keys';
import { ORG_UNIT } from '../../lib/terms';
import { useSectionsOf, useWings } from '../../hooks/use-lookups';
import { Button } from '../../components/ui/button';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Textarea } from '../../components/ui/textarea';
import { DEVICE_NAME_LIMIT, maskCnic } from './employee-bits';

type FormOut = z.output<typeof zEmployeeInput>;

const NONE = '__none__';
const BPS_GRADES = Array.from({ length: 22 }, (_, i) => i + 1);

function toDefaults(e: Employee | null): EmployeeInput {
  return {
    empCode: e?.empCode ?? '',
    name: e?.name ?? '',
    fatherName: e?.fatherName ?? '',
    // A masked CNIC (read-only viewers) is never sent back.
    cnic: e?.cnic && !e.cnic.includes('*') ? e.cnic : null,
    gender: e?.gender ?? null,
    wingId: e?.wingId ?? null,
    sectionId: e?.sectionId ?? null,
    designation: e?.designation ?? '',
    bps: e?.bps ?? null,
    employmentType: e?.employmentType ?? null,
    joinDate: e?.joinDate ?? null,
    cardNo: e?.cardNo ?? '',
    devicePassword: e?.devicePassword ?? '',
    privilege: e?.privilege === Privilege.ADMIN ? Privilege.ADMIN : Privilege.USER,
    phone: e?.phone ?? '',
    email: e?.email ?? '',
    emergencyContactName: e?.emergencyContactName ?? '',
    emergencyContactPhone: e?.emergencyContactPhone ?? '',
    address: e?.address ?? '',
    notes: e?.notes ?? '',
  };
}

function FormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <div className="border-b pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export interface EmployeeFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit / null to create. */
  employee?: Employee | null;
  /** Pre-fill the organisation when adding from a filtered directory. */
  defaults?: { wingId?: number | null; sectionId?: number | null };
  onSaved?: (employee: Employee) => void;
}

export function EmployeeFormSheet({ open, onOpenChange, employee = null, defaults, onSaved }: EmployeeFormSheetProps) {
  const editing = employee !== null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit employee' : 'Add employee'}</SheetTitle>
          <SheetDescription>
            {editing
              ? 'Update the record. Status (disable, mark as left) is changed separately from the profile or the directory.'
              : 'The employee code doubles as the PIN on every terminal.'}
          </SheetDescription>
        </SheetHeader>
        <EmployeeForm employee={employee} defaults={defaults} onDone={() => onOpenChange(false)} onSaved={onSaved} />
      </SheetContent>
    </Sheet>
  );
}

function EmployeeForm({
  employee,
  defaults,
  onDone,
  onSaved,
}: {
  employee: Employee | null;
  defaults?: EmployeeFormSheetProps['defaults'];
  onDone: () => void;
  onSaved?: (e: Employee) => void;
}) {
  const editing = employee !== null;
  const wings = useWings();
  const form = useForm<EmployeeInput, unknown, FormOut>({
    resolver: zodResolver(zEmployeeInput),
    defaultValues: { ...toDefaults(employee), ...(!employee && defaults ? { wingId: defaults.wingId ?? null, sectionId: defaults.sectionId ?? null } : {}) },
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, formState, watch, setValue } = form;
  const name = watch('name') ?? '';
  const wingId = watch('wingId') ?? null;
  const sections = useSectionsOf(wingId);

  const save = useApiMutation<Employee, FormOut, EmployeeInput>({
    form,
    mutationFn: (v) => (employee ? updateEmployee(employee.id, v) : createEmployee(v)),
    invalidate: [qk.employees.all, qk.wings.all],
    successMessage: (e) => (editing ? `Saved changes to ${e.name}` : `Added ${e.name}`),
    onError: (err) => {
      if (err.code === ErrorCode.DUPLICATE_EMP_CODE || err.code === ErrorCode.EMP_CODE_ON_DEVICE) {
        form.setError('empCode', { type: 'server', message: err.message }, { shouldFocus: true });
      }
    },
    onSuccess: (e) => {
      onSaved?.(e);
      onDone();
    },
  });

  const wingOptions = (wings.data ?? []).map((w) => ({ value: String(w.id), label: w.name, hint: w.code ?? undefined }));
  const sectionOptions = sections.map((s) => ({ value: String(s.id), label: s.name }));
  const lengthWarn = name.length > DEVICE_NAME_LIMIT;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex min-h-0 flex-1 flex-col">
      <SheetBody className="space-y-8">
        <FormSection title="Identity">
          <FormField
            label="Employee code"
            required
            error={formState.errors.empCode}
            hint={editing ? 'This is the PIN on the terminals. Changing it means pushing again.' : 'Digits only, up to 9. Used as the PIN on every terminal.'}
          >
            <Input mono inputMode="numeric" autoComplete="off" placeholder="e.g. 1042" {...register('empCode')} />
          </FormField>
          <FormField
            label="Full name"
            required
            error={formState.errors.name}
            hint={
              lengthWarn ? (
                <span className="text-warning-text">
                  Terminals show only the first {DEVICE_NAME_LIMIT} characters: “{name.slice(0, DEVICE_NAME_LIMIT)}”.
                </span>
              ) : undefined
            }
          >
            <Input autoComplete="off" placeholder="Ayesha Khan" {...register('name')} />
          </FormField>
          <FormField label="Father's name" error={formState.errors.fatherName}>
            <Input autoComplete="off" {...register('fatherName')} />
          </FormField>
          <Controller
            control={control}
            name="cnic"
            render={({ field, fieldState }) => (
              <FormField label="CNIC" error={fieldState.error} hint="13 digits. The dashes are added for you.">
                <Input
                  mono
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="#####-#######-#"
                  maxLength={15}
                  value={typeof field.value === 'string' ? field.value : ''}
                  onChange={(e) => field.onChange(maskCnic(e.target.value) || null)}
                  onBlur={field.onBlur}
                  ref={field.ref}
                />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="gender"
            render={({ field, fieldState }) => (
              <FormField label="Gender" error={fieldState.error}>
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {GENDERS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {GENDER_LABEL[g]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        </FormSection>

        <FormSection title="Organisation">
          <Controller
            control={control}
            name="wingId"
            render={({ field, fieldState }) => (
              <FormField label={ORG_UNIT.singular} error={fieldState.error}>
                <Combobox
                  options={wingOptions}
                  value={field.value === null || field.value === undefined ? null : String(field.value)}
                  onChange={(v) => {
                    field.onChange(v === null ? null : Number(v));
                    setValue('sectionId', null, { shouldDirty: true });
                  }}
                  placeholder={wings.isPending ? 'Loading...' : `No ${ORG_UNIT.lower}`}
                  searchPlaceholder={`Search ${ORG_UNIT.lowerPlural}...`}
                  emptyText={`No ${ORG_UNIT.lowerPlural} found.`}
                  clearable
                />
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="sectionId"
            render={({ field, fieldState }) => (
              <FormField label="Section" error={fieldState.error} hint={!wingId ? `Choose a ${ORG_UNIT.lower} first.` : sectionOptions.length === 0 ? `This ${ORG_UNIT.lower} has no sections.` : undefined}>
                <Combobox
                  options={sectionOptions}
                  value={field.value === null || field.value === undefined ? null : String(field.value)}
                  onChange={(v) => field.onChange(v === null ? null : Number(v))}
                  placeholder="No section"
                  searchPlaceholder="Search sections..."
                  emptyText="No sections found."
                  disabled={!wingId || sectionOptions.length === 0}
                  clearable
                />
              </FormField>
            )}
          />
          <FormField label="Designation" error={formState.errors.designation}>
            <Input autoComplete="off" placeholder="Deputy Director" {...register('designation')} />
          </FormField>
          <Controller
            control={control}
            name="bps"
            render={({ field, fieldState }) => (
              <FormField label="BPS grade" error={fieldState.error} hint="Basic pay scale, 1 to 22.">
                <Select value={field.value ? String(field.value) : NONE} onValueChange={(v) => field.onChange(v === NONE ? null : Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>Not applicable</SelectItem>
                    {BPS_GRADES.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        BPS {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="employmentType"
            render={({ field, fieldState }) => (
              <FormField label="Employment type" error={fieldState.error}>
                <Select value={field.value ?? NONE} onValueChange={(v) => field.onChange(v === NONE ? null : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {EMPLOYMENT_TYPE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <Controller
            control={control}
            name="joinDate"
            render={({ field, fieldState }) => (
              <FormField label="Join date" error={fieldState.error}>
                <Input type="date" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} onBlur={field.onBlur} ref={field.ref} />
              </FormField>
            )}
          />
        </FormSection>

        <FormSection title="Device access" description="How the person identifies at the terminal.">
          <FormField label="Card number" error={formState.errors.cardNo}>
            <Input mono autoComplete="off" placeholder="0012345678" {...register('cardNo')} />
          </FormField>
          <FormField label="Device password" error={formState.errors.devicePassword} hint="Optional PIN typed on the terminal keypad.">
            <Input mono autoComplete="off" {...register('devicePassword')} />
          </FormField>
          <Controller
            control={control}
            name="privilege"
            render={({ field, fieldState }) => (
              <FormField label="Device role" error={fieldState.error}>
                <Select value={String(field.value ?? Privilege.USER)} onValueChange={(v) => field.onChange(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(Privilege.USER)}>User</SelectItem>
                    <SelectItem value={String(Privilege.ADMIN)}>Admin (can open the terminal menu)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
          <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-xs text-muted-foreground sm:col-span-2">
            <RefreshCw className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Changes to name, card, password or role are re-sent to the devices automatically when the person is on them.
          </p>
        </FormSection>

        <FormSection title="Contact">
          <FormField label="Phone" error={formState.errors.phone}>
            <Input type="tel" autoComplete="off" placeholder="+92 300 1234567" {...register('phone')} />
          </FormField>
          <FormField label="Email" error={formState.errors.email}>
            <Input type="email" autoComplete="off" placeholder="name@nacta.gov.pk" {...register('email')} />
          </FormField>
          <FormField label="Emergency contact" error={formState.errors.emergencyContactName}>
            <Input autoComplete="off" placeholder="Name" {...register('emergencyContactName')} />
          </FormField>
          <FormField label="Emergency phone" error={formState.errors.emergencyContactPhone}>
            <Input type="tel" autoComplete="off" {...register('emergencyContactPhone')} />
          </FormField>
          <FormField label="Address" className="sm:col-span-2" error={formState.errors.address}>
            <Textarea rows={2} autoComplete="off" {...register('address')} />
          </FormField>
        </FormSection>

        <FormSection title="Notes">
          <FormField label="Notes" className="sm:col-span-2" error={formState.errors.notes} hint="Visible to administrators only.">
            <Textarea rows={3} placeholder="Anything the next person should know..." {...register('notes')} />
          </FormField>
        </FormSection>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {editing ? 'Save changes' : 'Add employee'}
        </Button>
      </SheetFooter>
    </form>
  );
}
