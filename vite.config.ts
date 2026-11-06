import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // One service worker (src/sw.ts): precache + FCM background messages. Registration is ours (src/pwa/register.ts)
      // so a new version can wait while a camera capture or a form is open; `autoUpdate` is the policy it follows.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'ConvoyPass',
        short_name: 'ConvoyPass',
        description: 'Contractor vehicle gate passes',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#A81D27',
        background_color: '#f8fafc',
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // The logo sits inside the central 80% of the canvas, so the same artwork is safe for a maskable crop.
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        rollupFormat: 'iife', // a classic worker: registers everywhere without type: module
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Reports and charts are admin/officer only and heavy; they load on demand instead of being precached on every phone.
        globIgnores: ['**/exceljs*.js', '**/recharts*.js', '**/ReportsPage*.js', '**/DashboardPage*.js', '**/ChartPanel*.js'],
      },
    }),
  ],
  // dist/.vite/manifest.json feeds scripts/bundle-report.ts (initial JS per route).
  build: { manifest: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Pipeline-only regex engine inside the Firestore SDK; see the stub for why it is safe to drop.
      re2js: fileURLToPath(new URL('./src/lib/stubs/re2js.ts', import.meta.url)),
    },
  },
})
