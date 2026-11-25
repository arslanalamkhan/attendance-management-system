import { ErrorCode, type EmployeeStatus } from '@nacta/shared';
import type { Queryable } from '../../db/pool';
import { AppError } from '../../lib/errors';
import * as devSync from './deviceSync';
import * as repo from './repo';

export interface StatusOutcome {
  changed: boolean;
  from: EmployeeStatus;
  to: EmployeeStatus;
  /** What happened on devices: removal (fetch + delete), restore, or nothing. */
  device: 'remove' | 'restore' | 'none';
  queued: number;
  devices: { id: number; name: string }[];
  /** Set when a removal went ahead with biometrics that may be missing from the backup (force / import). */
  backupWarnings: string[];
}

/**
 * Move an employee to a new status inside the caller's transaction.
 *
 * active -> disabled/left : queue a biometric refresh from each holding device, then DATA DELETE USERINFO (held back
 *                           until the refresh is done), record the holds. 409 NO_BIOMETRIC_BACKUP unless `force`.
 * disabled/left -> active : queue USERINFO, templates and photo to the devices recorded in the holds (or all active
 *                           devices), clear the holds.
 * disabled <-> left       : no device effect (the person is already off the devices).
 */
export async function applyStatus(
  db: Queryable,
  cur: { id: number; empCode: string; status: EmployeeStatus },
  to: EmployeeStatus,
  opts: { reason: string | null; leftDate: string | null; force: boolean },
): Promise<StatusOutcome> {
  const base: StatusOutcome = { changed: false, from: cur.status, to, device: 'none', queued: 0, devices: [], backupWarnings: [] };
  if (cur.status === to) return base;

  const removal = cur.status === 'active' && to !== 'active';
  const restore = cur.status !== 'active' && to === 'active';
  const out: StatusOutcome = { ...base, changed: true };

  if (removal) {
    const devices = await devSync.holdingDevices(db, cur.empCode);
    if (devices.length) {
      const risk = await devSync.backupRisk(db, cur.empCode);
      if (risk.risk) {
        if (!opts.force) {
          throw new AppError(
            409,
            ErrorCode.NO_BIOMETRIC_BACKUP,
            'Their fingerprints or face may exist on a device but are not stored in the application. Re-send with force to continue; they would need to re-enrol if the device cannot supply them.',
            { reasons: risk.reasons, devices: devices.map((d) => d.name) },
          );
        }
        out.backupWarnings = risk.reasons;
      }
      out.queued = await devSync.queueRemoval(db, { id: cur.id, emp_code: cur.empCode }, devices, opts.reason);
      out.device = 'remove';
      out.devices = devices;
    }
  }

  await repo.setStatus(db, cur.id, { status: to, reason: opts.reason, leftDate: to === 'left' ? opts.leftDate : null });

  if (restore) {
    const [profile] = await devSync.profilesByIds(db, [cur.id]);
    if (profile) {
      const r = await devSync.queueRestore(db, profile);
      out.queued = r.queued;
      out.devices = r.devices;
      out.device = r.devices.length ? 'restore' : 'none';
    }
  }
  return out;
}
