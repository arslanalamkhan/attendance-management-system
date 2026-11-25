// Minimal JPEG inspection without native dependencies: magic bytes, frame type and dimensions from the SOF marker.

export const isJpeg = (b: Buffer): boolean => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export interface JpegInfo {
  width: number;
  height: number;
  /** true for SOF2 (and the other non-baseline-sequential huffman/arithmetic progressive frames). */
  progressive: boolean;
  /** SOF marker byte, e.g. 0xc0 baseline, 0xc1 extended sequential, 0xc2 progressive. */
  sof: number;
}

/** Walks the marker segments up to the first SOF. Returns null when the data is not a parseable JPEG. */
export function readJpegInfo(b: Buffer): JpegInfo | null {
  if (!isJpeg(b)) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff && i < b.length) i++; // fill bytes
    const marker = b[i] as number;
    i++;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any SOF
    if (i + 1 >= b.length) return null;
    const len = b.readUInt16BE(i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 7 > b.length) return null;
      const height = b.readUInt16BE(i + 3);
      const width = b.readUInt16BE(i + 5);
      if (!width || !height) return null;
      return { width, height, progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce, sof: marker };
    }
    i += len;
  }
  return null;
}

/** Content type from the first bytes; used when a stored "photo" is not really a JPEG. */
export function sniffImageType(b: Buffer): string {
  if (isJpeg(b) || (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8)) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (b.length >= 6 && b.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return 'application/octet-stream';
}
