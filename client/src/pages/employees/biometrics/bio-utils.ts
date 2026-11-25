import { FINGERS } from '@nacta/shared';
import type { BiometricTemplate, EmployeeBiometrics } from '@nacta/shared';

export type Activity = EmployeeBiometrics['activity'][number];

export const fingerName = (index: number): string => FINGERS.find((f) => f.index === index)?.name ?? `Finger ${index}`;

/** Newest valid template per finger index. */
export function fingerMap(b: EmployeeBiometrics | undefined): Map<number, BiometricTemplate> {
  const m = new Map<number, BiometricTemplate>();
  for (const t of b?.fingers ?? []) {
    if (t.fingerIndex === null) continue;
    const cur = m.get(t.fingerIndex);
    if (!cur || t.updatedAt > cur.updatedAt) m.set(t.fingerIndex, t);
  }
  return m;
}

export function latestFace(b: EmployeeBiometrics | undefined): BiometricTemplate | null {
  let best: BiometricTemplate | null = null;
  for (const t of b?.faces ?? []) if (!best || t.updatedAt > best.updatedAt) best = t;
  return best;
}

/** "13.0" -> "v13" */
export const versionLabel = (v: string | null): string => (v ? `v${v.replace(/\.0+$/, '')}` : 'version unknown');

export const sourceLabel = (source: 'device' | 'app', deviceName: string | null): string =>
  source === 'device' ? `from ${deviceName ?? 'a device'}` : 'uploaded in app';

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const shortDay = (iso: string): string => shortDate.format(new Date(iso));
export const longDay = (iso: string): string => longDate.format(new Date(iso));

export function templateSummary(label: string, t: BiometricTemplate): string {
  return `${label} · ${versionLabel(t.version)} · ${sourceLabel(t.source, t.sourceDeviceName)} · ${shortDay(t.updatedAt)}`;
}

export const isInFlight = (a: Activity): boolean => a.status === 'pending' || a.status === 'sent';

const COMMAND_LABELS: [RegExp, string][] = [
  [/ENROLL_FP/i, 'Fingerprint enrolment'],
  [/ENROLL_BIO|ENROLL_FACE/i, 'Face enrolment'],
  [/BIOPHOTO/i, 'Face from photo'],
  [/USERPIC/i, 'Photo sent to device'],
  [/DELETE.*(BIODATA|FINGERTMP|FP)/i, 'Template removed from device'],
  [/BIODATA|FINGERTMP/i, 'Biometric data update'],
];
export function commandLabel(command: string): string {
  return COMMAND_LABELS.find(([re]) => re.test(command))?.[1] ?? command;
}

export function statusMeta(status: string): { label: string; tone: 'info' | 'success' | 'danger' | 'neutral'; live: boolean } {
  switch (status) {
    case 'pending':
      return { label: 'Queued', tone: 'info', live: true };
    case 'sent':
      return { label: 'Sent to device', tone: 'info', live: true };
    case 'success':
      return { label: 'Confirmed', tone: 'success', live: false };
    case 'failed':
      return { label: 'Failed', tone: 'danger', live: false };
    default:
      return { label: status, tone: 'neutral', live: false };
  }
}
