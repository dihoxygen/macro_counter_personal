import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

// Most specs mock /api/** with page.route() and never reach a backend. offline.spec.ts runs against the
// production build. The "auth" projects (tests/e2e/auth) run against the real backend and a local
// throwaway PostgreSQL database (macro_e2e), reset once per run by scripts/e2e-db.ps1.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const e2eDbFile = join(here, 'tests/e2e/auth/.e2e-db.json');

/** Resets macro_e2e once, in the main process (workers inherit MACRO_E2E_DB_READY and skip it). */
function prepareAuthDatabase(): string | undefined {
  if (!process.env.MACRO_E2E_DB_READY && !process.env.E2E_SKIP_DB) {
    const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
    try {
      execFileSync(
        shell,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/e2e-db.ps1')],
        {
          stdio: 'inherit',
        },
      );
      execFileSync(
        'dotnet',
        ['build', join(root, 'backend/MacroCounter.Api'), '-nologo', '-v', 'q'],
        {
          stdio: 'inherit',
        },
      );
    } catch {
      console.warn(
        '[e2e] Could not reset macro_e2e or build the backend (is MACROCOUNTER_TEST_PG set?). The auth projects are skipped.',
      );
      return undefined;
    }
    process.env.MACRO_E2E_DB_READY = '1';
  }
  if (!existsSync(e2eDbFile)) return undefined;
  return (JSON.parse(readFileSync(e2eDbFile, 'utf8')) as { connectionString: string })
    .connectionString;
}

const authConnection = prepareAuthDatabase();
/** Backend port for the auth projects; override if 5080 is busy (e.g. another checkout's backend). */
const apiPort = process.env.E2E_API_PORT ?? '5080';
/** A second backend with tiny AI limits for the quota spec, behind its own dev server on 5174. */
const quotaApiPort = String(Number(apiPort) + 1);

const authProjects: PlaywrightTestConfig['projects'] = authConnection
  ? [
      {
        name: 'auth-desktop',
        testDir: './tests/e2e/auth',
        use: {
          ...devices['Desktop Chrome'],
          baseURL: 'http://localhost:5173',
          viewport: { width: 1280, height: 800 },
        },
      },
      {
        name: 'auth-mobile',
        testDir: './tests/e2e/auth',
        // One database is shared by every auth spec: run them one project after the other.
        dependencies: ['auth-desktop'],
        use: {
          ...devices['Desktop Chrome'],
          baseURL: 'http://localhost:5173',
          viewport: { width: 360, height: 740 },
          hasTouch: true,
          isMobile: true,
        },
      },
      {
        // Its own backend (Limits__Ai__PerUserDaily=2) and dev server, so the limit cannot affect other specs.
        name: 'auth-quota',
        testDir: './tests/e2e/auth-quota',
        dependencies: ['auth-mobile'],
        use: {
          ...devices['Desktop Chrome'],
          baseURL: 'http://localhost:5174',
          viewport: { width: 1280, height: 800 },
        },
      },
    ]
  : [];

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
      testIgnore: [/offline\.spec\.ts/, /[\\/]auth(-quota)?[\\/]/],
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
      testIgnore: [/offline\.spec\.ts/, /[\\/]auth(-quota)?[\\/]/],
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
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
        serviceWorkers: 'allow',
      },
    },
    ...authProjects,
  ],
  webServer: [
    {
      // The dev server proxies /api to the backend on apiPort (vite.config.ts).
      command: 'npm run dev',
      url: 'http://localhost:5173',
      env: { ...process.env, MACRO_API_PORT: apiPort } as Record<string, string>,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build && npm run preview -- --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    ...(authConnection
      ? [
          {
            command: 'npm run dev -- --port 5174 --strictPort',
            url: 'http://localhost:5174',
            reuseExistingServer: false,
            env: { ...process.env, MACRO_API_PORT: quotaApiPort } as Record<string, string>,
          },
          backend(apiPort, authConnection),
          backend(quotaApiPort, authConnection, { Limits__Ai__PerUserDaily: '2' }),
        ]
      : []),
  ],
});

/**
 * The real backend for the auth projects: never reused (it must use this run's database), with the
 * Testing-only switches, so no Claude and no HIBP. The placeholder key only makes /api/status report AI as
 * available; the fake estimator answers. Every test signs in from 127.0.0.1, so the per-IP sign-in limit is
 * raised (it has its own backend test, SignInLimitTests).
 */
function backend(port: string, connection: string, extra: Record<string, string> = {}) {
  return {
    // Built once in prepareAuthDatabase(): two backends building the same project at once would collide.
    command: 'dotnet run --no-build --project ../backend/MacroCounter.Api --no-launch-profile',
    url: `http://localhost:${port}/api/auth/session`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: 'Testing',
      ASPNETCORE_URLS: `http://localhost:${port}`,
      ConnectionStrings__Identity: connection,
      Testing__FakeEstimator: 'true',
      Testing__BreachedPasswords__0: 'password1234',
      Security__SignIn__PerIpLimit: '10000',
      Anthropic__ApiKey: 'e2e-placeholder-not-a-key',
      ...extra,
    } as Record<string, string>,
  };
}
