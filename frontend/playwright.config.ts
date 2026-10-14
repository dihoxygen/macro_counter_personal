import { defineConfig, devices } from '@playwright/test';

// Every spec except offline.spec.ts mocks /api/** with page.route(); the real backend is never reached.

// A synthetic test-pattern camera (feature 002). It needs the full Chromium build (channel
// 'chromium'): the default headless shell rejects getUserMedia with NotSupportedError. Permission is
// NOT auto-granted: camera tests call context.grantPermissions(['camera']) so the denied case stays testable.
const fakeCamera = ['--use-fake-device-for-media-stream'];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /offline\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        viewport: { width: 1280, height: 800 },
        channel: 'chromium',
        launchOptions: { args: fakeCamera },
      },
    },
    {
      name: 'mobile',
      testIgnore: /offline\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        viewport: { width: 360, height: 740 },
        hasTouch: true,
        isMobile: true,
        channel: 'chromium',
        launchOptions: { args: fakeCamera },
      },
    },
    {
      // The service worker only exists in the production build, served by `vite preview`.
      name: 'offline',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
