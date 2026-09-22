import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// VITE_DEMO=1 builds the static client-only bundle for gh pages: hash
// routing, demo room as the index, no service worker. VITE_BASE sets the
// deploy subpath (for example /quickchat/ on github pages).
const DEMO = process.env.VITE_DEMO === '1'

// pwa.ts imports the virtual register module; stub it as a no-op when the
// plugin is disabled so the demo bundle stays self contained
const pwaStub = {
  name: 'demo-pwa-stub',
  resolveId(id: string) {
    return id === 'virtual:pwa-register' ? '\0demo-pwa-stub' : null
  },
  load(id: string) {
    if (id === '\0demo-pwa-stub')
      return 'export function registerSW() { return () => {} }'
    return null
  },
}

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    ...(DEMO
      ? [pwaStub]
      : [
          VitePWA({
            registerType: 'prompt',
            includeAssets: ['quad4-mark.svg', 'robots.txt', 'icon-*.png'],
            manifest: {
              name: 'quickchat',
              short_name: 'quickchat',
              description:
                'ephemeral rooms with peer to peer chat and live voice and video',
              theme_color: '#0a0a0b',
              background_color: '#0a0a0b',
              display: 'standalone',
              start_url: '/',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: 'icon-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              // precache the app shell by whitelist: entry, stage, fonts and
              // icons. lazy docs chunks are excluded since the reference needs
              // the live spec anyway. api, ws and p2p payloads are never cached
              navigateFallback: '/index.html',
              navigateFallbackDenylist: [
                /^\/api\//,
                /^\/ws\//,
                /^\/healthz/,
                /^\/readyz/,
              ],
              globPatterns: [
                'index.html',
                'assets/app-*.js',
                'assets/rolldown-runtime-*.js',
                'assets/Stage-*.js',
                'assets/livekit-client.e2ee.worker-*.js',
                'assets/workbox-window*.js',
                'assets/*.{css,woff,woff2}',
                '*.{svg,png,txt,webmanifest}',
              ],
              maximumFileSizeToCacheInBytes: 8 << 20,
            },
            devOptions: { enabled: false },
          }),
        ]),
  ],
  test: {
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  build: {
    // keep committed placeholders like dist/.gitkeep so the Go embed
    // directive always resolves, even before the first web build
    emptyOutDir: false,
    rolldownOptions: {
      output: {
        // stable entry name so the precache whitelist can not collide
        // with lazy chunks that share the index- prefix
        entryFileNames: 'assets/app-[hash].js',
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
})
