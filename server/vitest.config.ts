import { defineConfig } from 'vitest/config';
import { testDatabaseUrl } from './test/testDb.ts';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // All files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl(),
      ADMS_AUTO_REGISTER: 'true',
      ADMS_LOG_RAW: 'true',
      ADMS_TIMEZONE: '5',
      DEVICE_ONLINE_WINDOW_MS: '90000',
      CORS_ORIGIN: 'http://localhost:5173',
      SEED_ADMIN_EMAIL: 'admin@test.nacta',
      SEED_ADMIN_NAME: 'Test Admin',
      SEED_ADMIN_PASSWORD: 'Seed-Admin-Pw-1!',
      SESSION_IDLE_MINUTES: '30',
      SESSION_MAX_HOURS: '12',
      COOKIE_SECURE: 'false',
    },
  },
});
