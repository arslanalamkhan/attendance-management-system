import { z } from 'zod';

/** GET /health */
export const zHealth = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  version: z.string(),
  uptimeSec: z.number(),
  admsPort: z.number().int(),
  /** Non-internal IPv4 addresses of the server, for device setup instructions. */
  serverIps: z.array(z.string()),
});
export type Health = z.infer<typeof zHealth>;

/** GET /overview — headline numbers for the dashboard. */
export const zOverview = z.object({
  devices: z.object({ total: z.number().int(), online: z.number().int() }),
  employees: z.object({ total: z.number().int(), active: z.number().int() }),
  today: z.object({
    /** Device-local date "YYYY-MM-DD". */
    date: z.string(),
    punches: z.number().int(),
    /** Distinct employees with at least one punch today. */
    present: z.number().int(),
  }),
  /** Last 14 days, oldest first. */
  dailyPresence: z.array(z.object({ date: z.string(), present: z.number().int() })),
  /** Phase F: today's employees per computed day status (keys are DayStatus values). */
  todayStatus: z.record(z.string(), z.number().int()).optional(),
});
export type Overview = z.infer<typeof zOverview>;
