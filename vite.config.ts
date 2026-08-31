import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// The web app is a static SPA built by Vite. The Worker serves it via Workers
// Static Assets (see wrangler.jsonc `assets`), so this build only ever needs
// to produce a normal `dist/` folder — no server bundle here.
export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ratanmoti Maintenance',
        short_name: 'Maintenance',
        description: 'Loom maintenance logging for Ratanmoti Texfab',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#F2A81D',
        background_color: '#F4F5F3',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png' },
          { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Offline shell: the app must open and reach the capture screen with
        // no network (CLAUDE.md section 6/7). Precache the built assets and
        // let the app's own IndexedDB outbox handle data, not Workbox.
        globPatterns: ['**/*.{js,css,html,woff2,png,ico,svg}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Never let Workbox cache API responses; the outbox/dexie layer
            // owns offline data. Caching auth or log responses here would
            // silently serve stale state.
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
});
