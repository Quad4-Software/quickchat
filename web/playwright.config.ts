import { defineConfig } from '@playwright/test'

const PORT = 18080

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
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
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
    },
    timeout: 60_000,
  },
})
