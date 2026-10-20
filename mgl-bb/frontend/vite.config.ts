import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { brandTokensPlugin } from './vite/brandTokensPlugin';
import path from 'path';

// `rollup-plugin-visualizer` is opt-in via `ANALYZE=1 npm run build`.
// Default builds skip it so CI artifacts don't pick up the report.
const analyze = process.env.ANALYZE === '1';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Статик файл дахь %VITE_ORG_*% орлуулагчийг бөглөнө (index.html,
    // manifest.webmanifest, offline.html, sw.js).  Дэлгэрэнгүйг plugin дотор.
    brandTokensPlugin(),
    ...(analyze
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: false,
          }),
        ]
      : []),
  ],
  // Mirror the production `_headers` so dev and prod share the same
  // cross-origin-isolation behaviour. The in-browser web-ifc QTO pipeline is
  // gone (quantities now arrive from the Revit add-in), but the headers STAY:
  // the email OAuth popup flow and the APS viewer rely on the current
  // COOP/COEP isolation semantics — do not remove them here or in
  // frontend/public/_headers.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
    // Large looping cover video — watching it on Windows EBUSY-kills Vite.
    watch: { ignored: ['**/cover-people.mp4'] },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Split heavy deps so no single asset is large enough to trip
          // Cloudflare Pages' upload endpoint, which intermittently 502s
          // on big files. Keep React itself in the main chunk so the
          // initial paint is fast.
          if (id.includes('node_modules')) {
            // Tiny shared classname helpers (clsx / tailwind-merge / cva).
            // These are pulled by the always-eager `cn()` in shared/lib/utils
            // (Layout, button, …). Rolldown otherwise dedupes `clsx` INTO the
            // recharts chunk, which drags the whole ~110KB-gzip recharts lib
            // onto first paint of EVERY page (login/landing included). Pinning
            // them to their own ~1KB chunk keeps recharts off the critical
            // path. MUST stay above the `recharts` rule below.
            if (
              id.includes('node_modules/clsx') ||
              id.includes('node_modules/tailwind-merge') ||
              id.includes('node_modules/class-variance-authority')
            )
              return 'classnames';
            if (id.includes('exceljs')) return 'exceljs';
            // The 3D viewer now uses the APS Viewer, loaded from Autodesk's CDN
            // (see ApsViewer.tsx) — it contributes ~0 to our bundle, so there's
            // no viewer chunk to split here anymore.
            // framer-motion / `motion` (+ its motion-dom/motion-utils deps).
            // Loaded via LazyMotion so keep it out of the main chunk.
            if (id.includes('node_modules/motion') || id.includes('framer-motion'))
              return 'motion';
            if (id.includes('recharts') || id.includes('d3-')) return 'recharts';
            if (id.includes('lightweight-charts') || id.includes('fancy-canvas'))
              return 'lightweight-charts';
            if (id.includes('maplibre')) return 'maplibre';
            if (id.includes('react-router')) return 'router';
            if (id.includes('lucide-react')) return 'icons';
            if (id.includes('@radix-ui') || id.includes('radix-ui')) return 'radix';
            if (id.includes('@tanstack')) return 'tanstack';
          }
        },
      },
    },
  },
});
