import * as React from 'react';
import { cn } from '../../../lib/utils';
import { clampCrop, cropRect, MAX_ZOOM, type Crop, type ImageSrc } from './photo-pipeline';

/** Oval face guide drawn inside a square frame; dims everything outside the oval. */
export function OvalGuide({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)} aria-hidden="true">
      <div
        className="absolute left-1/2 top-[46%] h-[74%] w-[56%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-white/80"
        style={{ boxShadow: '0 0 0 999px rgba(2, 6, 23, 0.5)' }}
      />
    </div>
  );
}

export interface PhotoCropperProps {
  src: ImageSrc;
  crop: Crop;
  onChange: (c: Crop) => void;
  className?: string;
}

const CANVAS = 560;

/** Square pan-and-zoom cropper. Drag to move, wheel / slider / +- to zoom, arrow keys nudge. */
export function PhotoCropper({ src, crop, onChange, className }: PhotoCropperProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drag = React.useRef<{ x: number; y: number; crop: Crop } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const r = cropRect(src, crop);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src.el, r.sx, r.sy, r.side, r.side, 0, 0, CANVAS, CANVAS);
  }, [src, crop]);

  const update = (c: Crop) => onChange(clampCrop(src, c));
  const sidePx = () => cropRect(src, crop).side;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const box = e.currentTarget.getBoundingClientRect();
    const k = cropRect(src, d.crop).side / box.width;
    update({ ...d.crop, cx: d.crop.cx - (e.clientX - d.x) * k, cy: d.crop.cy - (e.clientY - d.y) * k });
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    update({ ...crop, zoom: crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = sidePx() * 0.03;
    const map: Record<string, Crop> = {
      ArrowLeft: { ...crop, cx: crop.cx - step },
      ArrowRight: { ...crop, cx: crop.cx + step },
      ArrowUp: { ...crop, cy: crop.cy - step },
      ArrowDown: { ...crop, cy: crop.cy + step },
      '+': { ...crop, zoom: crop.zoom * 1.1 },
      '=': { ...crop, zoom: crop.zoom * 1.1 },
      '-': { ...crop, zoom: crop.zoom / 1.1 },
    };
    const next = map[e.key];
    if (next) {
      e.preventDefault();
      update(next);
    }
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label="Photo crop. Drag to move the picture, scroll or use the zoom slider to resize it. Arrow keys move, plus and minus zoom."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className={cn(
        'relative aspect-square w-full touch-none select-none overflow-hidden rounded-xl border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        className,
      )}
    >
      <canvas ref={canvasRef} width={CANVAS} height={CANVAS} className="size-full" />
      <OvalGuide />
    </div>
  );
}

export function ZoomSlider({ crop, onChange, src }: { crop: Crop; onChange: (c: Crop) => void; src: ImageSrc }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="photo-zoom" className="flex items-center justify-between text-[13px] font-medium">
        Zoom
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{crop.zoom.toFixed(1)}x</span>
      </label>
      <input
        id="photo-zoom"
        type="range"
        min={1}
        max={MAX_ZOOM}
        step={0.01}
        value={crop.zoom}
        onChange={(e) => onChange(clampCrop(src, { ...crop, zoom: Number(e.target.value) }))}
        className="h-2 w-full cursor-pointer accent-[rgb(var(--primary))]"
      />
    </div>
  );
}
