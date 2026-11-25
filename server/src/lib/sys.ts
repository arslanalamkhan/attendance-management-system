import os from 'node:os';
import { version } from '../../package.json';

export const appVersion: string = version;

/** Non-internal IPv4 addresses, for device setup instructions. */
export function serverIps(): string[] {
  const out: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      const v4 = a.family === 'IPv4' || (a.family as unknown) === 4;
      if (v4 && !a.internal) out.push(a.address);
    }
  }
  return out;
}
