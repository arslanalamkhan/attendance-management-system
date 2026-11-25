import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const intVar = (def: number, min: number, max: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(def));

const TRUE = ['true', '1', 'yes', 'on'];
const FALSE = ['false', '0', 'no', 'off'];
const boolVar = (def: boolean) =>
  z.preprocess(
    (v) => {
      const s = emptyToUndefined(v);
      return typeof s === 'string' ? s.trim().toLowerCase() : s;
    },
    z
      .union([z.enum(['true', '1', 'yes', 'on', 'false', '0', 'no', 'off']), z.undefined()], {
        errorMap: () => ({ message: `must be one of: ${[...TRUE, ...FALSE].join(', ')}` }),
      })
      .transform((v) => (v === undefined ? def : TRUE.includes(v))),
  );

const textVar = (def: string) => z.preprocess(emptyToUndefined, z.string().trim().min(1).default(def));

const envSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  PORT: intVar(4000, 1, 65535),
  /** Interface the API binds to. Empty = all interfaces; 127.0.0.1 when a reverse proxy (nginx) sits in front. */
  HOST: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  /** Folder with the built web app (client/dist). Empty = auto-detect next to the server; "off" = API only. */
  CLIENT_DIST: z.preprocess(emptyToUndefined, z.string().trim().optional()),
  ADMS_PORT: intVar(8081, 1, 65535),
  DATABASE_URL: textVar('postgres://postgres:postgres@localhost:5432/attendance').pipe(
    z.string().refine((s) => /^postgres(ql)?:\/\//i.test(s), 'must be a postgres:// connection URL'),
  ),
  CORS_ORIGIN: textVar('http://localhost:5173'),
  DEVICE_ONLINE_WINDOW_MS: intVar(90000, 1000, 86_400_000),
  /** Hours east of UTC, sent to the device in the handshake (Pakistan = 5). */
  ADMS_TIMEZONE: intVar(5, -12, 14),
  ADMS_AUTO_REGISTER: boolVar(true),
  ADMS_LOG_RAW: boolVar(true),
  SEED_ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().email().default('admin@nacta.gov.pk')),
  SEED_ADMIN_NAME: textVar('Super Admin'),
  /** Initial password of the Super Admin; only used when no Super Admin exists. Never logged. */
  SEED_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SESSION_IDLE_MINUTES: intVar(30, 1, 10_080),
  SESSION_MAX_HOURS: intVar(12, 1, 720),
  COOKIE_SECURE: boolVar(false),
  /** Express "trust proxy" for the API app: loopback (default), true/false, a hop count, or a comma list of IPs/CIDRs. */
  TRUST_PROXY: textVar('loopback'),
  /** Documentation only: the audit log is append-only; a set value just logs a warning (archiving is Phase H). */
  AUDIT_RETENTION_DAYS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(36500).optional()),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),
  /** Force pretty (true) or JSON (false) logs; default is pretty unless NODE_ENV=production. */
  LOG_PRETTY: z.preprocess(emptyToUndefined, z.enum(['true', 'false', '1', '0']).optional()),
});

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  host: string | undefined;
  clientDist: string | undefined;
  admsPort: number;
  databaseUrl: string;
  corsOrigins: string[];
  deviceOnlineWindowMs: number;
  admsTimezone: number;
  admsAutoRegister: boolean;
  admsLogRaw: boolean;
  seedAdminEmail: string;
  seedAdminName: string;
  seedAdminPassword: string | undefined;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
  cookieSecure: boolean;
  trustProxy: boolean | number | string;
  auditRetentionDays: number | undefined;
  logLevel: string;
  logPretty: boolean;
}

/** Express accepts boolean, hop count, or a string (preset name or comma separated addresses). */
export function parseTrustProxy(v: string): boolean | number | string {
  const s = v.trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(s)) return true;
  if (['false', 'no', 'off', '0'].includes(s)) return false;
  if (/^\d+$/.test(s)) return Number(s);
  return v.trim();
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Validate environment variables. Throws ConfigError listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`),
    );
  }
  const e = parsed.data;
  const corsOrigins = e.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const isProduction = e.NODE_ENV === 'production';
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    host: e.HOST,
    clientDist: e.CLIENT_DIST,
    admsPort: e.ADMS_PORT,
    databaseUrl: e.DATABASE_URL,
    corsOrigins,
    deviceOnlineWindowMs: e.DEVICE_ONLINE_WINDOW_MS,
    admsTimezone: e.ADMS_TIMEZONE,
    admsAutoRegister: e.ADMS_AUTO_REGISTER,
    admsLogRaw: e.ADMS_LOG_RAW,
    seedAdminEmail: e.SEED_ADMIN_EMAIL,
    seedAdminName: e.SEED_ADMIN_NAME,
    seedAdminPassword: e.SEED_ADMIN_PASSWORD,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
    sessionMaxHours: e.SESSION_MAX_HOURS,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    auditRetentionDays: e.AUDIT_RETENTION_DAYS,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
    logPretty: e.LOG_PRETTY ? e.LOG_PRETTY === 'true' || e.LOG_PRETTY === '1' : e.NODE_ENV === 'development',
  };
}

function load(): Config {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      // The logger is not available yet; this is a startup failure, print plainly.
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Process-wide config. Plain object so tests can flip a flag (e.g. admsAutoRegister). */
export const config: Config = load();


