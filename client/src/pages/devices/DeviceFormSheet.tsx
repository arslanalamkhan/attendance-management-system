import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { zDeviceInput } from '@nacta/shared';
import type { Device, DeviceInput } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { createDevice, updateDevice } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Switch } from '../../components/ui/switch';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';

type DeviceFormOut = z.output<typeof zDeviceInput>;

const blank: DeviceInput = { name: '', serialNumber: '', location: '', isActive: true };

function valuesFor(device: Device | null): DeviceInput {
  return device
    ? { name: device.name, serialNumber: device.serialNumber, location: device.location ?? '', isActive: device.isActive }
    : blank;
}

export interface DeviceFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new device. */
  device: Device | null;
  onSaved?: (device: Device) => void;
}

export function DeviceFormSheet({ open, onOpenChange, device, onSaved }: DeviceFormSheetProps) {
  const form = useForm<DeviceInput, unknown, DeviceFormOut>({
    resolver: zodResolver(zDeviceInput),
    defaultValues: valuesFor(device),
    mode: 'onTouched',
  });
  const { register, control, handleSubmit, reset, setError, formState } = form;
  const editing = device !== null;

  // Re-seed whenever the sheet opens (or switches device) so stale edits never leak between uses.
  React.useEffect(() => {
    if (open) reset(valuesFor(device));
  }, [open, device, reset]);

  const save = useApiMutation<Device, DeviceFormOut, DeviceInput>({
    form,
    mutationFn: (v) => (device ? updateDevice(device.id, v) : createDevice(v)),
    invalidate: [qk.devices.all, qk.overview()],
    successMessage: (d) => (editing ? `Saved ${d.name}` : `Added ${d.name}`),
    errorMessage: editing ? 'Could not save the device' : 'Could not add the device',
    onSuccess: (d) => {
      onOpenChange(false);
      onSaved?.(d);
    },
    onError: (err) => {
      if (err.code === 'DUPLICATE_DEVICE') {
        setError('serialNumber', { type: 'server', message: 'A device with this serial number already exists' }, { shouldFocus: true });
      }
    },
  });

  return (
    <Sheet open={open} onOpenChange={(o) => (save.isPending ? undefined : onOpenChange(o))}>
      <SheetContent>
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="flex h-full min-h-0 flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? `Edit ${device.name}` : 'Add device'}</SheetTitle>
            <SheetDescription>
              {editing
                ? 'Change how this terminal is named and described. Its serial number identifies it to the server.'
                : 'Register a terminal by serial number before it connects. Terminals that call in on their own appear automatically.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-5">
            <FormField label="Name" required error={formState.errors.name}>
              <Input autoComplete="off" placeholder="Main entrance" {...register('name')} />
            </FormField>
            <FormField
              label="Serial number"
              required
              error={formState.errors.serialNumber}
              hint="Printed on the terminal label, also under Menu, System Info, Device Info."
            >
              <Input mono autoComplete="off" spellCheck={false} placeholder="VDE2244500040" {...register('serialNumber')} />
            </FormField>
            <FormField label="Location" error={formState.errors.location} hint="Optional. Where the terminal is mounted.">
              <Input autoComplete="off" placeholder="Ground floor, Block B" {...register('location')} />
            </FormField>
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <FormField label="Active" inline hint="Inactive devices are skipped when pushing employees.">
                  <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                </FormField>
              )}
            />
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              {editing ? 'Save changes' : 'Add device'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
