/**
 * Browser-side photo pipeline: decode, square crop, quality hints and JPEG encoding.
 * Output matches what the SenseFace terminals store: baseline JPEG, exactly 600x600, at most 200 KB.
 */

export const OUT_SIZE = 600;
export const MAX_BYTES = 200 * 1024;
export const MAX_ZOOM = 4;

export interface ImageSrc {
  el: CanvasImageSource;
  w: number;
  h: number;
  /** Release decoded memory when the source is replaced. */
  dispose?: () => void;
}

/** Centre of the crop in source pixels and zoom (1 = the largest square that fits). */
export interface Crop {
  zoom: number;
  cx: number;
  cy: number;
}

export interface SquareRect {
  sx: number;
  sy: number;
  side: number;
}

export const initialCrop = (src: ImageSrc): Crop => ({ zoom: 1, cx: src.w / 2, cy: src.h / 2 });

export function clampCrop(src: ImageSrc, c: Crop): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
  const side = Math.min(src.w, src.h) / zoom;
  return {
    zoom,
    cx: Math.min(src.w - side / 2, Math.max(side / 2, c.cx)),
    cy: Math.min(src.h - side / 2, Math.max(side / 2, c.cy)),
  };
}

export function cropRect(src: ImageSrc, c: Crop): SquareRect {
  const k = clampCrop(src, c);
  const side = Math.min(src.w, src.h) / k.zoom;
  return { sx: k.cx - side / 2, sy: k.cy - side / 2, side };
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Draw the square crop into a fresh size x size canvas (white behind transparency). */
export function renderCrop(src: ImageSrc, rect: SquareRect, size: number): HTMLCanvasElement {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.el, rect.sx, rect.sy, rect.side, rect.side, 0, 0, size, size);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', quality));

/** Baseline JPEG (canvas.toBlob never writes progressive), quality stepped down until it fits. */
export async function encodePhoto(src: ImageSrc, crop: Crop): Promise<{ blob: Blob; quality: number }> {
  const canvas = renderCrop(src, cropRect(src, crop), OUT_SIZE);
  let last: { blob: Blob; quality: number } | null = null;
  for (const q of [0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.68, 0.64, 0.6, 0.5, 0.4]) {
    const blob = await toBlob(canvas, q);
    last = { blob, quality: q };
    if (blob.size <= MAX_BYTES) break;
  }
  return last!;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';
const MAX_FILE_BYTES = 30 * 1024 * 1024;

export async function decodeFile(file: File): Promise<ImageSrc> {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is larger than 30 MB. Choose a smaller picture.');
  if (file.type && !file.type.startsWith('image/')) throw new Error('That is not a picture. Choose a JPEG, PNG or WebP file.');
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { el: bmp, w: bmp.width, h: bmp.height, dispose: () => bmp.close() };
  } catch {
    // fall through to <img>
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { el: img, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    throw new Error(
      /hei[cf]/i.test(file.type + file.name)
        ? 'This browser cannot open HEIC pictures. Export the photo as JPEG and try again.'
        : 'This picture could not be read. Try a JPEG or PNG file.',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// Quality hints
// ---------------------------------------------------------------------------
export type CheckStatus = 'pass' | 'warn' | 'skip';
export interface QualityCheck {
  id: 'resolution' | 'light' | 'sharp' | 'face';
  label: string;
  status: CheckStatus;
  detail: string;
}

interface FaceDetectorLike {
  detect(image: CanvasImageSource): Promise<{ boundingBox: { x: number; y: number; width: number; height: number } }[]>;
}
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

export const faceDetectorAvailable = (): boolean => typeof window !== 'undefined' && 'FaceDetector' in window;

const A = 160;

export async function analyse(src: ImageSrc, crop: Crop): Promise<QualityCheck[]> {
  const rect = cropRect(src, crop);
  const canvas = renderCrop(src, rect, A);
  const { data } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, A, A);
  const gray = new Float32Array(A * A);
  let sum = 0;
  for (let i = 0; i < A * A; i++) {
    const g = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
  }
  const mean = sum / (A * A);

  // variance of the Laplacian on the downscaled grayscale picture
  let lSum = 0;
  let lSq = 0;
  let n = 0;
  for (let y = 1; y < A - 1; y++) {
    for (let x = 1; x < A - 1; x++) {
      const i = y * A + x;
      const l = gray[i - 1]! + gray[i + 1]! + gray[i - A]! + gray[i + A]! - 4 * gray[i]!;
      lSum += l;
      lSq += l * l;
      n++;
    }
  }
  const lap = lSq / n - (lSum / n) ** 2;

  const checks: QualityCheck[] = [];
  const px = Math.round(rect.side);
  checks.push(
    px >= OUT_SIZE
      ? { id: 'resolution', label: 'Resolution', status: 'pass', detail: `${px} px source, no upscaling` }
      : px >= 300
        ? { id: 'resolution', label: 'Resolution', status: 'pass', detail: `${px} px source, slightly enlarged to 600` }
        : { id: 'resolution', label: 'Resolution', status: 'warn', detail: `Only ${px} px here. Zoom out or use a larger picture.` },
  );
  checks.push(
    mean < 70
      ? { id: 'light', label: 'Lighting', status: 'warn', detail: 'Too dark. Face a window or turn on a light.' }
      : mean > 195
        ? { id: 'light', label: 'Lighting', status: 'warn', detail: 'Too bright. Avoid direct light or glare.' }
        : { id: 'light', label: 'Lighting', status: 'pass', detail: 'Well lit' },
  );
  checks.push(
    lap < 35
      ? { id: 'sharp', label: 'Sharpness', status: 'warn', detail: 'Looks blurry. Hold still and refocus.' }
      : { id: 'sharp', label: 'Sharpness', status: 'pass', detail: 'In focus' },
  );

  if (!faceDetectorAvailable()) {
    checks.push({ id: 'face', label: 'Face', status: 'skip', detail: 'Face check is not available in this browser. Centre the face in the oval yourself.' });
  } else {
    try {
      const Ctor = (window as unknown as { FaceDetector: FaceDetectorCtor }).FaceDetector;
      const det = new Ctor({ fastMode: true, maxDetectedFaces: 3 });
      const big = renderCrop(src, rect, 320);
      const faces = await det.detect(big);
      if (faces.length === 0) checks.push({ id: 'face', label: 'Face', status: 'warn', detail: 'No face found in the frame.' });
      else if (faces.length > 1) checks.push({ id: 'face', label: 'Face', status: 'warn', detail: 'More than one face in the frame.' });
      else {
        const b = faces[0]!.boundingBox;
        const fx = (b.x + b.width / 2) / 320;
        const fy = (b.y + b.height / 2) / 320;
        const fw = b.width / 320;
        if (fw < 0.25) checks.push({ id: 'face', label: 'Face', status: 'warn', detail: 'Face is small. Zoom in or move closer.' });
        else if (fw > 0.8) checks.push({ id: 'face', label: 'Face', status: 'warn', detail: 'Face fills the frame. Zoom out a little.' });
        else if (Math.abs(fx - 0.5) > 0.17 || fy < 0.28 || fy > 0.66) checks.push({ id: 'face', label: 'Face', status: 'warn', detail: 'Face is off-centre. Drag the picture to centre it.' });
        else checks.push({ id: 'face', label: 'Face', status: 'pass', detail: 'One face, centred' });
      }
    } catch {
      checks.push({ id: 'face', label: 'Face', status: 'skip', detail: 'Face check could not run.' });
    }
  }
  return checks;
}
