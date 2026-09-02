import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium handles copying Cesium's Assets/Workers/Widgets
// and setting CESIUM_BASE_URL automatically — no manual config needed.
//
// There is deliberately no CelesTrak proxy here any more. CelesTrak serves
// `Access-Control-Allow-Origin: *`, so the browser fetches it directly (see
// CELESTRAK_GROUPS in src/lib/orbital.js). Proxying was actively harmful once
// deployed: CelesTrak rate-limits per IP by dropping packets, so routing every
// visitor through the one host IP pooled the whole user base onto a single
// budget and every fetch timed out on Render while working fine locally.
// Fetching client-side sends each request from the visitor's own IP, and leaves
// the build as pure static files.
export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    open: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['orbitwatch-gd3x.onrender.com'],
  },
});
