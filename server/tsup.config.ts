import { defineConfig } from 'tsup';

export default defineConfig({
  // The server plus the admin scripts, so a production install needs only `node dist/<name>.js` (no tsx).
  entry: {
    index: 'src/index.ts',
    migrate: 'src/db/migrate.ts',
    createDb: 'src/db/createDb.ts',
    resetAdminPassword: 'src/scripts/resetAdminPassword.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared contract is TypeScript source in the workspace, so it must be bundled in.
  noExternal: ['@nacta/shared'],
  // Defaults to production when started with `node dist/index.js` (explicit NODE_ENV still wins).
  banner: { js: "process.env.NODE_ENV ??= 'production';" },
});
