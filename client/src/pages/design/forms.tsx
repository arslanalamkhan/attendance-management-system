import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Mail, Plus, Save, Search, Trash2, Download } from 'lucide-react';
import { zDeviceInput } from '@nacta/shared';
import type { DeviceInput } from '@nacta/shared';
import { ApiError, useApiMutation } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { Textarea } from '../../components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Section, Specimen } from './section';

type DeviceFormOut = z.output<typeof zDeviceInput>;

const WINGS = [
  { value: 'adm', label: 'Administration', hint: 'ADM' },
  { value: 'ops', label: 'Operations', hint: 'OPS' },
  { value: 'int', label: 'Intelligence Coordination', hint: 'INT' },
  { value: 'pol', label: 'Policy & Research', hint: 'POL' },
  { value: 'it', label: 'Information Technology', hint: 'IT' },
  { value: 'fin', label: 'Finance', hint: 'FIN' },
];

function ButtonsBlock() {
  const [loading, setLoading] = React.useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Specimen label="Variants">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="destructive-ghost">Remove</Button>
        <Button variant="link">Link</Button>
      </Specimen>
      <Specimen label="Sizes and icons">
        <Button size="sm">
          <Plus /> Small
        </Button>
        <Button size="md">
          <Save /> Medium
        </Button>
        <Button size="lg">
          <Download /> Large
        </Button>
        <IconButton label="Search" icon={<Search />} variant="secondary" />
        <IconButton label="Delete" icon={<Trash2 />} variant="destructive-ghost" />
      </Specimen>
      <Specimen label="States">
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 1800);
          }}
        >
          {loading ? 'Saving...' : 'Click to load'}
        </Button>
        <Button variant="secondary" loading>
          Loading
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </Specimen>
    </div>
  );
}

function ControlsBlock() {
  const [wing, setWing] = React.useState<string | null>('ops');
  const [checked, setChecked] = React.useState<boolean | 'indeterminate'>('indeterminate');
  const [on, setOn] = React.useState(true);
  return (
    <div className="grid gap-6 rounded-lg border bg-card p-5 shadow-xs md:grid-cols-2 xl:grid-cols-3">
      <FormField label="Full name" hint="As printed on the CNIC.">
        <Input placeholder="Ayesha Khan" />
      </FormField>
      <FormField label="Search" hint="With a leading icon.">
        <Input leading={<Search />} placeholder="Search employees..." />
      </FormField>
      <FormField label="Employee code" hint="Mono + tabular for identifiers.">
        <Input mono defaultValue="000817" />
      </FormField>
      <FormField label="Email" error="Enter a valid email address" required>
        <Input leading={<Mail />} defaultValue="ayesha@" />
      </FormField>
      <FormField label="Disabled">
        <Input disabled defaultValue="Read only" />
      </FormField>
      <FormField label="Notes" hint="Textarea resizes vertically.">
        <Textarea placeholder="Anything the next person should know..." />
      </FormField>
      <FormField label="Select (Radix)">
        <Select defaultValue="ops">
          <SelectTrigger>
            <SelectValue placeholder="Choose a wing" />
          </SelectTrigger>
          <SelectContent>
            {WINGS.map((w) => (
              <SelectItem key={w.value} value={w.value}>
                {w.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField label="Combobox (cmdk)" hint="Type to filter.">
        <Combobox options={WINGS} value={wing} onChange={setWing} placeholder="Choose a wing" searchPlaceholder="Search wings..." clearable />
      </FormField>
      <div className="space-y-4">
        <FormField label="Send credentials by email" inline>
          <Checkbox checked={checked} onCheckedChange={setChecked} />
        </FormField>
        <FormField label="Device is active" inline hint="Inactive devices are ignored by pushes.">
          <Switch checked={on} onCheckedChange={setOn} />
        </FormField>
      </div>
    </div>
  );
}

function ValidationForm() {
  const form = useForm<DeviceInput, unknown, DeviceFormOut>({
    resolver: zodResolver(zDeviceInput),
    defaultValues: { name: '', serialNumber: '', location: '', isActive: true },
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, reset, formState } = form;

  const save = useApiMutation<DeviceFormOut, DeviceFormOut, DeviceInput>({
    form,
    // Demo only: nothing is sent to the real API. Serial VDE2244500040 simulates a server-side VALIDATION_ERROR.
    mutationFn: async (v) => {
      await new Promise((r) => window.setTimeout(r, 800));
      if (v.serialNumber.toUpperCase() === 'VDE2244500040') {
        throw new ApiError({
          status: 422,
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: { serialNumber: 'A device with this serial number already exists' },
        });
      }
      return v;
    },
    successMessage: (d) => `Device “${d.name}” saved (demo, nothing was sent to the server)`,
    onSuccess: () => reset(),
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Add device</CardTitle>
          <CardDescription>
            React Hook Form + the shared <code className="font-mono text-xs">zDeviceInput</code> schema. Submit empty for client errors; use serial{' '}
            <code className="font-mono text-xs">VDE2244500040</code> to see a server error land on the field.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="grid gap-5 sm:grid-cols-2">
          <FormField label="Device name" error={formState.errors.name} required>
            <Input placeholder="Main entrance" {...register('name')} />
          </FormField>
          <FormField label="Serial number" error={formState.errors.serialNumber} required hint="Printed on the terminal label.">
            <Input mono placeholder="VDE2244500040" {...register('serialNumber')} />
          </FormField>
          <FormField label="Location" className="sm:col-span-2" error={formState.errors.location} hint="Optional.">
            <Textarea rows={2} placeholder="Ground floor, Block B" {...register('location')} />
          </FormField>
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <FormField label="Active" inline hint="Inactive devices are ignored by pushes." className="sm:col-span-2">
                <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
              </FormField>
            )}
          />
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => reset()}>
              Reset
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save device
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function FormsSection() {
  return (
    <>
      <Section id="buttons" title="Buttons" description="One button, seven variants. Loading blocks double submits and announces itself to assistive tech.">
        <ButtonsBlock />
      </Section>
      <Section id="controls" title="Form controls" description="Wrapped in FormField, controls inherit their id, hint and error wiring automatically.">
        <ControlsBlock />
      </Section>
      <Section id="forms" title="Forms and validation" description="Client validation from the shared zod schemas, server VALIDATION_ERROR details mapped onto fields by useApiMutation.">
        <ValidationForm />
      </Section>
    </>
  );
}
