import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/assets, found from src/modules/reports (dev, tests) or dist (the bundled build). */
function assetsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['../../../assets', '../assets', '../../assets']) {
    const dir = path.resolve(here, rel);
    if (fs.existsSync(path.join(dir, 'nacta-logo-180.png'))) return dir;
  }
  throw new Error('NACTA logo not found: expected server/assets/nacta-logo-180.png');
}

let logo: Buffer | null = null;
/** The NACTA logo (180x180 PNG: sharp at the size it is printed). */
export function logoPng(): Buffer {
  logo ??= fs.readFileSync(path.join(assetsDir(), 'nacta-logo-180.png'));
  return logo;
}
export const logoDataUri = (): string => `data:image/png;base64,${logoPng().toString('base64')}`;
