import type { z } from 'zod';
import type { AttendanceRecord, Page, WingScope, zAttendanceQuery } from '@nacta/shared';
import { isRealDate } from '../../lib/dates';
import { validationError } from '../../lib/errors';
import { toPage } from '../../lib/pagination';
import * as repo from './repo';

export { insertBatch } from './repo';

const MAX_INT = 2147483647;

export async function list(q: z.output<typeof zAttendanceQuery>, scope: WingScope): Promise<Page<AttendanceRecord>> {
  const details: Record<string, string> = {};
  for (const key of ['from', 'to'] as const) {
    const v = q[key];
    if (v !== undefined && !isRealDate(v)) details[key] = `${key} is not a valid date`;
  }
  for (const key of ['deviceId', 'employeeId', 'wingId', 'sectionId'] as const) {
    const v = q[key];
    if (v !== undefined && v > MAX_INT) details[key] = `${key} is out of range`;
  }
  if (Object.keys(details).length) throw validationError('Invalid query', details);

  const { items, total } = await repo.list(q, scope);
  return toPage(items, total, q);
}
