import { logger } from '../../lib/logger';
import * as devices from './repo';

const log = logger.child({ component: 'sweeper' });
const INTERVAL_MS = 15000;
const KEEP_REQUESTS = 5000;
let timer: NodeJS.Timeout | null = null;

/** Mark silent devices offline and trim the raw ADMS request log. Never throws. */
export async function sweep(): Promise<void> {
  try {
    await devices.sweepStatus();
    await devices.trimAdmsLog(KEEP_REQUESTS);
  } catch (err) {
    log.error({ err }, 'sweep failed');
  }
}

export function start(): void {
  if (timer) return;
  void sweep();
  timer = setInterval(() => void sweep(), INTERVAL_MS);
  timer.unref();
}

export function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
