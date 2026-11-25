import * as React from 'react';
import { Camera, Check, ImageUp, LoaderCircle, RotateCcw, TriangleAlert, Upload } from 'lucide-react';
import type { EmployeeBiometrics } from '@nacta/shared';
import { useApiMutation } from '../../../lib/api';
import { uploadEmployeePhoto } from '../../../lib/endpoints/biometrics';
import { bumpPhotoVersion } from '../../../lib/photo-src';
import { qk } from '../../../lib/query-keys';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Switch } from '../../../components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { CameraStage } from './CameraStage';
import { PhotoCropper, ZoomSlider } from './PhotoCropper';
import {
  ACCEPT,
  OUT_SIZE,
  analyse,
  clampCrop,
  decodeFile,
  encodePhoto,
  initialCrop,
  type Crop,
  type ImageSrc,
  type QualityCheck,
} from './photo-pipeline';

export interface PhotoDialogProps {
  employee: { id: number; name: string; onDeviceCount: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: 'upload' | 'camera';
  /** Turn on "create face recognition" (used by "Create face from photo"). */
  createFace?: boolean;
}

export function PhotoDialog(props: PhotoDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <PhotoBody {...props} />}
    </Dialog>
  );
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function PhotoBody({ employee, onOpenChange, initialTab = 'upload', createFace: forceFace }: PhotoDialogProps) {
  const [tab, setTab] = React.useState<'upload' | 'camera'>(initialTab);
  const [src, setSrc] = React.useState<ImageSrc | null>(null);
  const [crop, setCrop] = React.useState<Crop>({ zoom: 1, cx: 0, cy: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [decoding, setDecoding] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [checks, setChecks] = React.useState<QualityCheck[] | null>(null);
  const [estimate, setEstimate] = React.useState<number | null>(null);
  const onDevices = employee.onDeviceCount > 0;
  const [send, setSend] = React.useState(onDevices);
  const [face, setFace] = React.useState(forceFace ?? onDevices);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const adopt = React.useCallback((next: ImageSrc) => {
    setSrc((prev) => {
      prev?.dispose?.();
      return next;
    });
    setCrop(initialCrop(next));
    setChecks(null);
    setEstimate(null);
    setError(null);
  }, []);
  const clear = React.useCallback(() => {
    setSrc((prev) => {
      prev?.dispose?.();
      return null;
    });
    setChecks(null);
    setEstimate(null);
  }, []);
  React.useEffect(() => () => src?.dispose?.(), [src]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setDecoding(true);
    try {
      adopt(await decodeFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That picture could not be read.');
    } finally {
      setDecoding(false);
    }
  };

  // quality hints and size estimate, debounced while the crop changes
  React.useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const [c, enc] = await Promise.all([analyse(src, crop), encodePhoto(src, crop)]);
          if (!cancelled) {
            setChecks(c);
            setEstimate(enc.blob.size);
          }
        } catch {
          if (!cancelled) setChecks([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [src, crop]);

  const upload = useApiMutation<EmployeeBiometrics>({
    mutationFn: async () => {
      if (!src) throw new Error('Choose a photo first');
      const { blob } = await encodePhoto(src, crop);
      return uploadEmployeePhoto(employee.id, blob, { syncToDevices: send, createFace: send && face });
    },
    invalidate: [qk.employees.all, qk.overview()],
    successMessage: send ? (face ? 'Photo saved. Sent to the devices to build the face template.' : 'Photo saved and sent to the devices.') : 'Photo saved',
    errorMessage: 'Could not upload the photo',
    onSuccess: () => {
      bumpPhotoVersion(employee.id);
      onOpenChange(false);
    },
  });

  const warnings = checks?.filter((c) => c.status === 'warn') ?? [];
  const busy = upload.isPending;

  return (
    <DialogContent size="xl" onInteractOutside={(e) => busy && e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Photo for {employee.name}</DialogTitle>
        <DialogDescription>Upload a picture or take one with the webcam. It is cropped to a square and saved in the format the terminals use.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="grid gap-6 md:grid-cols-[minmax(0,26rem)_1fr]">
          <div className="space-y-3">
            <Tabs
              value={tab}
              onValueChange={(v) => {
                setTab(v as 'upload' | 'camera');
                clear();
                setError(null);
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="upload">
                  <Upload className="size-4" aria-hidden="true" />
                  Upload
                </TabsTrigger>
                <TabsTrigger value="camera">
                  <Camera className="size-4" aria-hidden="true" />
                  Camera
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {src ? (
              <>
                <PhotoCropper src={src} crop={crop} onChange={setCrop} />
                <ZoomSlider src={src} crop={crop} onChange={(c) => setCrop(clampCrop(src, c))} />
                <Button variant="secondary" size="sm" onClick={clear} disabled={busy}>
                  <RotateCcw aria-hidden="true" />
                  {tab === 'camera' ? 'Retake' : 'Choose another picture'}
                </Button>
              </>
            ) : tab === 'camera' ? (
              <CameraStage
                active
                onCapture={(s) => {
                  adopt(s);
                }}
              />
            ) : (
              <>
                <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose a picture" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                  }}
                  onDragLeave={() => setOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOver(false);
                    void take(e.dataTransfer.files[0]);
                  }}
                  className={cn(
                    'flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 text-center transition-colors',
                    over ? 'border-primary bg-primary-subtle' : 'border-border-strong bg-muted/40',
                  )}
                >
                  <span className="grid size-12 place-content-center rounded-xl border bg-card text-muted-foreground shadow-xs">
                    {decoding ? <LoaderCircle className="size-6 motion-safe:animate-spin" aria-hidden="true" /> : <ImageUp className="size-6" aria-hidden="true" />}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{decoding ? 'Reading picture…' : 'Drop a picture here'}</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">JPEG, PNG or WebP of any size. It is always re-encoded.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={decoding}>
                    Browse files…
                  </Button>
                </div>
              </>
            )}
            {error && (
              <p role="alert" className="flex items-start gap-2 text-[13px] text-danger-text">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>

          <div className="space-y-5">
            <section aria-label="Photo checks">
              <h3 className="text-sm font-semibold tracking-tight">Photo checks</h3>
              {!src ? (
                <p className="mt-2 text-[13px] text-muted-foreground">Choose or take a picture to check the lighting, sharpness and face position. Look straight at the camera, neutral expression, plain background.</p>
              ) : !checks ? (
                <p className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
                  <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                  Checking…
                </p>
              ) : (
                <ul className="mt-2 divide-y rounded-lg border" aria-live="polite">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-content-center rounded-full',
                          c.status === 'pass' && 'bg-success-subtle text-success-text',
                          c.status === 'warn' && 'bg-warning-subtle text-warning-text',
                          c.status === 'skip' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {c.status === 'pass' ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : c.status === 'warn' ? <TriangleAlert className="size-3" aria-hidden="true" /> : <span className="text-[10px]" aria-hidden="true">-</span>}
                        <span className="sr-only">{c.status === 'pass' ? 'Passed' : c.status === 'warn' ? 'Warning' : 'Skipped'}</span>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{c.label}</p>
                        <p className="text-xs text-muted-foreground">{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Send options" className="space-y-3">
              <h3 className="text-sm font-semibold tracking-tight">After saving</h3>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium" id="sw-send">Send photo to devices</p>
                  <p className="text-xs text-muted-foreground">{onDevices ? `${employee.onDeviceCount} ${employee.onDeviceCount === 1 ? 'device holds' : 'devices hold'} this employee.` : 'This employee is not on any device yet.'}</p>
                </div>
                <Switch checked={send && onDevices} onCheckedChange={(v) => { setSend(v); if (!v) setFace(false); }} disabled={!onDevices} aria-labelledby="sw-send" />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium" id="sw-face">Also create face recognition from this photo</p>
                  <p className="text-xs text-muted-foreground">The terminal builds a face template from the picture, so no one has to stand at it.</p>
                </div>
                <Switch checked={face && send && onDevices} onCheckedChange={setFace} disabled={!send || !onDevices} aria-labelledby="sw-face" />
              </div>
            </section>

            <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Saved as {OUT_SIZE} × {OUT_SIZE} JPEG — the format the terminal uses</p>
              <p className="mt-0.5">Square crop, baseline JPEG, under 200 KB{estimate !== null ? ` · this one is about ${kb(estimate)}` : ''}.</p>
            </div>

            {warnings.length > 0 && (
              <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2.5 text-[13px] text-warning-text">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {warnings.length === 1 ? 'One check needs attention.' : `${warnings.length} checks need attention.`} You can still use this photo, but face recognition may be less reliable.
              </p>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => upload.mutate()} disabled={!src || !checks} loading={busy}>
          {busy ? 'Uploading…' : warnings.length > 0 ? 'Use anyway and upload' : 'Save photo'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
