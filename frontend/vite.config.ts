import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Offline app shell (Principle III). /api is never cached: AI lookups always go to the network.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg'],
      workbox: {
        // woff2: the splash intro's fonts, so it plays offline too (005 FR-015).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        skipWaiting: true,
      },
      manifest: {
        name: 'Macro Counter',
        short_name: 'Macros',
        description: 'Protein-focused macro logging with AI estimates.',
        start_url: '/',
        display: 'standalone',
        background_color: '#f7f7f5',
        theme_color: '#1f6f50',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // MACRO_API_PORT lets end-to-end runs use another backend port (playwright.config.ts).
      '/api': `http://localhost:${process.env.MACRO_API_PORT ?? '5080'}`,
    },
  },
  build: {
    outDir: '../backend/MacroCounter.Api/wwwroot',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/components/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Principle II: nutrition math (and the domain logic around it) stays at 100%.
      thresholds: {
        'src/domain/**': {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
      },
    },
  },
});
