import * as React from 'react';
import { Camera, CameraOff, LoaderCircle, ShieldAlert } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { OvalGuide } from './PhotoCropper';
import type { ImageSrc } from './photo-pipeline';

type CamState = 'starting' | 'live' | 'denied' | 'nocamera' | 'insecure' | 'error';

function stop(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface CameraStageProps {
  /** Camera runs only while true; every stream is stopped when it turns false or the stage unmounts. */
  active: boolean;
  onCapture: (src: ImageSrc) => void;
}

export function CameraStage({ active, onCapture }: CameraStageProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [state, setState] = React.useState<CamState>('starting');
  const [message, setMessage] = React.useState('');
  const [cameras, setCameras] = React.useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = React.useState<string | undefined>(undefined);
  const [attempt, setAttempt] = React.useState(0);
  const [currentId, setCurrentId] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('insecure');
      return;
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 960 } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stop(stream);
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        setState('live');
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (!cancelled) {
          setCameras(list);
          const cur = stream.getVideoTracks()[0]?.getSettings().deviceId;
          if (cur) setCurrentId(cur);
        }
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('nocamera');
        else {
          setMessage(e instanceof Error ? e.message : 'The camera could not be started.');
          setState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      stop(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, deviceId, attempt]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    stop(streamRef.current);
    streamRef.current = null;
    onCapture({ el: c, w: c.width, h: c.height });
  };

  const problem =
    state === 'denied'
      ? {
          icon: <ShieldAlert />,
          title: 'Camera access is blocked',
          body: 'Allow the camera for this site (the camera icon in the address bar, or the browser\'s site settings), then try again. You can also use the Upload tab instead.',
        }
      : state === 'nocamera'
        ? { icon: <CameraOff />, title: 'No camera found', body: 'Connect a webcam, or use the Upload tab to choose a picture from this computer.' }
        : state === 'insecure'
          ? { icon: <ShieldAlert />, title: 'Camera needs a secure connection', body: 'Browsers only allow the camera on HTTPS or localhost. Use the Upload tab, or open the app over HTTPS.' }
          : state === 'error'
            ? { icon: <CameraOff />, title: 'The camera could not start', body: message || 'Another application may be using it. Close it and try again.' }
            : null;

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border bg-slate-950">
        <video ref={videoRef} muted playsInline aria-label="Live camera preview" className="size-full object-cover" />
        {state === 'live' && <OvalGuide />}
        {state === 'starting' && (
          <div className="absolute inset-0 grid place-content-center gap-2 text-center text-sm text-white/80">
            <LoaderCircle className="mx-auto size-6 motion-safe:animate-spin" aria-hidden="true" />
            Starting the cameraâ€¦ allow access if your browser asks.
          </div>
        )}
        {problem && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card px-6 text-center">
            <span className="grid size-11 place-content-center rounded-xl border bg-muted text-muted-foreground [&_svg]:size-5" aria-hidden="true">
              {problem.icon}
            </span>
            <p className="text-sm font-semibold">{problem.title}</p>
            <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{problem.body}</p>
            {state !== 'insecure' && (
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {cameras.length > 1 && (
          <Select value={deviceId ?? currentId} onValueChange={setDeviceId}>
            <SelectTrigger aria-label="Choose camera" className="min-w-0 flex-1">
              <SelectValue placeholder="Camera" />
            </SelectTrigger>
            <SelectContent>
              {cameras.map((c, i) => (
                <SelectItem key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button className="flex-1" onClick={capture} disabled={state !== 'live'}>
          <Camera aria-hidden="true" />
          Take photo
        </Button>
      </div>
    </div>
  );
}

