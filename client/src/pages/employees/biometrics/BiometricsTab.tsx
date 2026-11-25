import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, Fingerprint, History, ImageOff, ImageUp, Plus, ScanFace, Sparkles, Trash2 } from 'lucide-react';
import { FINGERS } from '@nacta/shared';
import type { BiometricTemplate, EmployeeDetail } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { deleteBiometricTemplate, deleteEmployeePhoto, getEmployeeBiometrics } from '../../../lib/endpoints/biometrics';
import { bumpPhotoVersion, photoSrc } from '../../../lib/photo-src';
import { qk } from '../../../lib/query-keys';
import { relativeTime, absoluteTime } from '../../../lib/time';
import { useAuth } from '../../../lib/auth';
import { cn } from '../../../lib/utils';
import { Gate } from '../../../components/auth/gate';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Badge, StatusPill } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { EmptyState } from '../../../components/ui/empty-state';
import { ErrorState } from '../../../components/ui/error-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { Switch } from '../../../components/ui/switch';
import { commandLabel, fingerMap, fingerName, isInFlight, latestFace, longDay, sourceLabel, statusMeta, templateSummary, versionLabel } from './bio-utils';
import { EnrollDialog, type EnrollTarget } from './EnrollDialog';
import { HandsDiagram } from './hands-diagram';
import { PhotoDialog } from './PhotoDialog';

function photoVersion(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, window.location.origin).searchParams.get('v');
  } catch {
    return null;
  }
}

function BiometricsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading biometrics" className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-40" />
      </div>
      <div className="space-y-4 lg:col-span-3">
        <Skeleton className="h-96" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export function BiometricsTab({ employee: e, onPush }: { employee: EmployeeDetail; onPush: () => void }) {
  const { can } = useAuth();
  const canEdit = can('employees.biometrics');
  const query = useQuery({
    queryKey: qk.employees.biometrics(e.id),
    queryFn: ({ signal }) => getEmployeeBiometrics(e.id, signal),
    // while an enrolment or photo command is in flight, keep the picture fresh
    refetchInterval: (q) => (q.state.data?.activity.some(isInFlight) ? 3000 : false),
  });
  const b = query.data;

  const [enroll, setEnroll] = React.useState<EnrollTarget | null>(null);
  const [photoOpen, setPhotoOpen] = React.useState<{ tab: 'upload' | 'camera'; createFace?: boolean } | null>(null);
  const [deleting, setDeleting] = React.useState<BiometricTemplate | null>(null);
  const [removePhoto, setRemovePhoto] = React.useState(false);
  const [fromDevices, setFromDevices] = React.useState(true);

  const delTemplate = useApiMutation<void, BiometricTemplate>({
    mutationFn: (t) => deleteBiometricTemplate(e.id, t.id, { fromDevices }),
    invalidate: [qk.employees.all],
    successMessage: fromDevices ? 'Deleted. Removal from the devices is queued.' : 'Deleted from the app',
    errorMessage: 'Could not delete the template',
    onSuccess: () => setDeleting(null),
  });
  const delPhoto = useApiMutation<void>({
    mutationFn: () => deleteEmployeePhoto(e.id),
    invalidate: [qk.employees.all],
    successMessage: 'Photo removed from the app',
    errorMessage: 'Could not remove the photo',
    onSuccess: () => {
      bumpPhotoVersion(e.id);
      setRemovePhoto(false);
    },
  });

  if (query.isPending) return <BiometricsSkeleton />;
  if (query.isError && !b) return <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  if (!b) return null;

  const fingers = fingerMap(b);
  const face = latestFace(b);
  const onDeviceCount = e.devices.filter((d) => d.onDevice).length;
  const live = b.activity.some(isInFlight);
  const version = photoVersion(b.photo?.url);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        {/* ------------------------------------------------------------ photo */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Photo</CardTitle>
              <CardDescription>Shown across the app and used by the terminals.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-xl border bg-muted shadow-xs">
              {b.photo ? (
                <img src={photoSrc(e.id, version)} alt={`Photo of ${e.name}`} loading="lazy" decoding="async" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-content-center justify-items-center gap-2 text-muted-foreground">
                  <ImageOff className="size-8" aria-hidden="true" />
                  <span className="text-[13px]">No photo yet</span>
                </div>
              )}
            </div>
            <p className="text-center text-[13px] text-muted-foreground">
              {b.photo ? (
                <>
                  <span className="font-medium text-foreground">{b.photo.source === 'device' ? `From ${b.photo.sourceDeviceName ?? 'a device'}` : 'Uploaded in app'}</span>
                  <span aria-hidden="true"> · </span>
                  <span title={absoluteTime(b.photo.updatedAt)}>{longDay(b.photo.updatedAt)}</span>
                </>
              ) : (
                'Add a photo so colleagues and the terminals can recognise this person.'
              )}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Gate perm="employees.biometrics" action="upload photos">
                <Button size="sm" onClick={() => setPhotoOpen({ tab: 'upload' })}>
                  <ImageUp aria-hidden="true" />
                  Upload photo
                </Button>
              </Gate>
              <Gate perm="employees.biometrics" action="take photos">
                <Button size="sm" variant="secondary" onClick={() => setPhotoOpen({ tab: 'camera' })}>
                  <Camera aria-hidden="true" />
                  Take photo
                </Button>
              </Gate>
              {b.photo && (
                <Gate perm="employees.biometrics" action="remove photos" hide>
                  <Button size="sm" variant="destructive-ghost" onClick={() => setRemovePhoto(true)}>
                    <Trash2 aria-hidden="true" />
                    Remove photo
                  </Button>
                </Gate>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ face */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Face</CardTitle>
              <CardDescription>Template the terminals use for face recognition.</CardDescription>
            </div>
            {face ? <StatusPill tone="success">Enrolled</StatusPill> : <StatusPill tone="neutral">Not enrolled</StatusPill>}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={cn('grid size-11 shrink-0 place-content-center rounded-xl [&_svg]:size-6', face ? 'bg-primary text-primary-foreground' : 'border border-dashed border-border-strong text-muted-foreground')}>
                <ScanFace aria-hidden="true" />
              </span>
              <p className="text-[13px] text-muted-foreground">
                {face ? (
                  <>
                    <span className="font-medium text-foreground">{versionLabel(face.version)}</span> · {sourceLabel(face.source, face.sourceDeviceName)} · {longDay(face.updatedAt)}
                    {b.faces.length > 1 && <> · {b.faces.length} templates</>}
                  </>
                ) : (
                  'No face template yet. Create one from a photo, or enrol at a terminal.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Gate perm="employees.biometrics" action="create face templates">
                <Button size="sm" onClick={() => setPhotoOpen({ tab: 'upload', createFace: true })}>
                  <Sparkles aria-hidden="true" />
                  Create face from photo
                </Button>
              </Gate>
              <Gate perm="employees.biometrics" action="enrol faces on devices">
                <Button size="sm" variant="secondary" onClick={() => setEnroll({ kind: 'face' })}>
                  <ScanFace aria-hidden="true" />
                  Enrol face on device…
                </Button>
              </Gate>
              {face && (
                <Gate perm="employees.biometrics" action="delete face templates" hide>
                  <Button size="sm" variant="destructive-ghost" onClick={() => setDeleting(face)}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </Gate>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-3">
        {/* ------------------------------------------------------------ fingerprints */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fingerprints</CardTitle>
              <CardDescription>Select a finger to enrol it on a terminal or delete it.</CardDescription>
            </div>
            <Badge tone={fingers.size > 0 ? 'primary' : 'outline'} className="shrink-0 tabular-nums">
              <Fingerprint aria-hidden="true" />
              {fingers.size} of 10 fingers
            </Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <HandsDiagram fingers={fingers} canEdit={canEdit} onEnrol={(i) => setEnroll({ kind: 'finger', fingerIndex: i })} onDelete={(t) => setDeleting(t)} />
            <ul className="grid gap-x-6 gap-y-1 border-t pt-4 text-[13px] sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-5" aria-label="Fingers as a list">
              {[...FINGERS].map((f) => {
                const t = fingers.get(f.index);
                return (
                  <li key={f.index} className="flex items-center justify-between gap-3 py-1">
                    <span className={t ? 'font-medium' : 'text-muted-foreground'}>{f.name}</span>
                    <span className={cn('inline-flex items-center gap-1.5 text-xs', t ? 'text-primary-text' : 'text-muted-foreground')}>
                      <span className={cn('size-2 rounded-full', t ? 'bg-primary' : 'border border-border-strong')} aria-hidden="true" />
                      {t ? `${versionLabel(t.version)} · ${t.source === 'device' ? (t.sourceDeviceName ?? 'device') : 'app'}` : 'Not enrolled'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {fingers.size === 0 && (
              <p className="text-[13px] text-muted-foreground">
                Nothing enrolled yet. Choose any finger above, then <Plus className="inline size-3.5" aria-hidden="true" /> &ldquo;Enrol on device…&rdquo; and ask the employee to scan at the terminal.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------ activity */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent biometric activity</CardTitle>
              <CardDescription>Enrolment requests and photo or template commands for this person.</CardDescription>
            </div>
            {live && (
              <StatusPill tone="info" live>
                Updating live
              </StatusPill>
            )}
          </CardHeader>
          {b.activity.length === 0 ? (
            <EmptyState bare icon={<History />} title="No activity yet" description="Requests to enrol on a device, and photos sent to terminals, will be listed here." />
          ) : (
            <ul className="mt-3 divide-y border-t">
              {b.activity.map((a) => {
                const s = statusMeta(a.status);
                return (
                  <li key={a.commandId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{commandLabel(a.command)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.deviceName} · <span className="font-mono">{a.command}</span>
                      </p>
                    </div>
                    <StatusPill tone={s.tone} live={s.live}>
                      {s.label}
                    </StatusPill>
                    <span className="w-24 text-right text-xs text-muted-foreground" title={absoluteTime(a.completedAt ?? a.createdAt)}>
                      {relativeTime(a.completedAt ?? a.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <EnrollDialog employee={e} target={enroll} onOpenChange={(o) => !o && setEnroll(null)} onPush={onPush} />
      {photoOpen && (
        <PhotoDialog
          employee={{ id: e.id, name: e.name, onDeviceCount }}
          open
          onOpenChange={(o) => !o && setPhotoOpen(null)}
          initialTab={photoOpen.tab}
          createFace={photoOpen.createFace}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && !delTemplate.isPending && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleting?.kind === 'face' ? 'face template' : deleting?.fingerIndex != null ? fingerName(deleting.fingerIndex).toLowerCase() : 'template'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? templateSummary(deleting.kind === 'face' ? 'Face' : fingerName(deleting.fingerIndex ?? 0), deleting) : ''}. {e.name} will need to enrol again to use it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 p-3">
            <div>
              <p className="text-[13px] font-medium" id="del-dev">Also remove it from devices</p>
              <p className="text-xs text-muted-foreground">{onDeviceCount > 0 ? `Sent to the ${onDeviceCount} ${onDeviceCount === 1 ? 'device' : 'devices'} holding ${e.name}.` : 'This employee is not on any device.'}</p>
            </div>
            <Switch checked={fromDevices} onCheckedChange={setFromDevices} aria-labelledby="del-dev" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delTemplate.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={delTemplate.isPending}
              onClick={(ev) => {
                ev.preventDefault();
                if (deleting) delTemplate.mutate(deleting);
              }}
            >
              {delTemplate.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={removePhoto} onOpenChange={(o) => !o && !delPhoto.isPending && setRemovePhoto(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the photo?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the copy kept in the app. Photos already stored on the terminals stay there, and face templates are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delPhoto.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={delPhoto.isPending}
              onClick={(ev) => {
                ev.preventDefault();
                delPhoto.mutate();
              }}
            >
              {delPhoto.isPending ? 'Removing…' : 'Remove photo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
