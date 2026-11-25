import os from 'node:os';
import { version } from '../../package.json';

export const appVersion: string = version;

/** Non-internal IPv4 addresses, for device setup instructions. */
export function serverIps(): string[] {
  const out: string[] = [];
  // Informational only: never let a sandbox that blocks interface listing (netlink) take the server down.
  let ifaces: ReturnType<typeof os.networkInterfaces>;
  try {
    ifaces = os.networkInterfaces();
  } catch {
    return out;
  }
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      const v4 = a.family === 'IPv4' || (a.family as unknown) === 4;
      if (v4 && !a.internal) out.push(a.address);
    }
  }
  return out;
}
