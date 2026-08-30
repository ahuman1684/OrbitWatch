import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium handles copying Cesium's Assets/Workers/Widgets
// and setting CESIUM_BASE_URL automatically — no manual config needed.
//
// CelesTrak doesn't send CORS headers, so a direct browser fetch fails
// silently — /celestrak-proxy rewrites to celestrak.org server-side during
// dev so the app can fetch it directly (see CELESTRAK_GROUPS in
// src/lib/orbital.js).
const celestrakProxy = {
  '/celestrak-proxy': {
    target: 'https://celestrak.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/celestrak-proxy/, '/NORAD/elements'),
  },
};

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    open: true,
    proxy: celestrakProxy,
  },
  // `server.proxy` only applies to `vite dev` — `npm run preview` (what the
  // README recommends for the actual demo run) needs its own proxy config
  // or the live-data fetch will silently fail there even though dev works.
  preview: {
    proxy: celestrakProxy,
  },
});
