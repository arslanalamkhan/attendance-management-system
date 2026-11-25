import type { CommandType, Device } from '@nacta/shared';
import { useApiMutation } from '../../lib/api';
import { deleteDevice, enqueueDeviceCommand } from '../../lib/endpoints';
import { qk } from '../../lib/query-keys';
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

export const COMMAND_LABEL: Record<CommandType, string> = {
  info: 'Refresh info',
  check: 'Check for new data',
  reboot: 'Reboot',
  syncTime: 'Sync time',
};

/** Queue a command for a device. The terminal picks it up on its next poll. */
export function useEnqueueCommand() {
  return useApiMutation<unknown, { device: Device; type: CommandType }>({
    mutationFn: ({ device, type }) => enqueueDeviceCommand(device.id, { type }),
    invalidate: [qk.devices.all],
    successMessage: (_d, { type, device }) => `${COMMAND_LABEL[type]} queued for ${device.name}`,
    errorMessage: 'Could not queue the command',
  });
}

export function useDeleteDevice() {
  return useApiMutation<void, Device>({
    mutationFn: (device) => deleteDevice(device.id),
    invalidate: [qk.devices.all, qk.overview()],
    successMessage: (_d, device) => `Deleted ${device.name}`,
    errorMessage: 'Could not delete the device',
  });
}

export type DeviceConfirm = { kind: 'reboot' | 'delete'; device: Device } | null;

/** The two confirmations shared by the list row menu and the detail header. */
export function DeviceConfirmDialogs({
  target,
  onClose,
  onDeleted,
}: {
  target: DeviceConfirm;
  onClose: () => void;
  onDeleted?: (device: Device) => void;
}) {
  const enqueue = useEnqueueCommand();
  const del = useDeleteDevice();
  const device = target?.device;
  const busy = enqueue.isPending || del.isPending;

  return (
    <>
      <AlertDialog open={target?.kind === 'reboot'} onOpenChange={(o) => !o && !busy && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reboot {device?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The terminal restarts on its next poll and is offline for about a minute. Nobody can punch in or out during that time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (device) enqueue.mutate({ device, type: 'reboot' }, { onSuccess: onClose });
              }}
            >
              {enqueue.isPending ? 'Queuing...' : 'Reboot device'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={target?.kind === 'delete'} onOpenChange={(o) => !o && !busy && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {device?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the device ({device?.serialNumber}) together with its attendance logs and command history. It cannot be
              undone. If the terminal is still pointed at this server it will register itself again as a new device.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep device</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (device)
                  del.mutate(device, {
                    onSuccess: () => {
                      onClose();
                      onDeleted?.(device);
                    },
                  });
              }}
            >
              {del.isPending ? 'Deleting...' : 'Delete device'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
