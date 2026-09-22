import { defineConfig } from '@playwright/test'

const PORT = 18080

// fake av devices so mic and camera toggles can be exercised headless
const fakeMediaArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
]

// firefox publishes synthetic streams and auto-accepts getUserMedia
const firefoxPrefs = {
  'media.navigator.streams.fake': true,
  'media.navigator.permission.disabled': true,
}

// live tests in e2e/live.test.ts only run when a livekit server is
// configured; the webserver below forwards the credentials to the app
const livekitEnv = process.env.LIVEKIT_URL
  ? {
      LIVEKIT_URL: process.env.LIVEKIT_URL,
      LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ?? '',
      LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ?? '',
    }
  : {}

// e2e runs against the real go binary so websockets, uploads, and the
// embedded spa are all exercised. Build first: make build at repo root.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: fakeMediaArgs },
        permissions: ['camera', 'microphone', 'notifications'],
      },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        launchOptions: { args: fakeMediaArgs },
        permissions: ['camera', 'microphone', 'notifications'],
      },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'firefox',
        viewport: { width: 1280, height: 800 },
        launchOptions: { firefoxUserPrefs: firefoxPrefs },
        // firefox rejects camera and microphone grants; the prefs above
        // auto-accept getUserMedia instead
        permissions: ['notifications'],
      },
    },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        viewport: { width: 1280, height: 800 },
        permissions: ['camera', 'microphone', 'notifications'],
      },
    },
  ],
  webServer: {
    command: `go run ../cmd/quickchat`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
    env: {
      QUICKCHAT_ADDR: `127.0.0.1:${PORT}`,
      QUICKCHAT_DATA: '.e2e-data',
      // the suite exercises create/join/chat many times from one ip
      QUICKCHAT_RATE_CREATE: '600',
      QUICKCHAT_RATE_ACTION: '600',
      QUICKCHAT_RATE_SOCKET: '600',
      // tiny cap so the oversize test can exercise the client check
      QUICKCHAT_MAX_FILE: '1024',
      ...livekitEnv,
    },
  },
})
