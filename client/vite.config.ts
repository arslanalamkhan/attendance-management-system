import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Listen on every network interface so other PCs on the LAN can open the app.
    host: true,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // Pass the browser's real IP (X-Forwarded-For) so sign-in limits and the audit log see the client, not the proxy.
        xfwd: true,
      },
    },
  },
});
