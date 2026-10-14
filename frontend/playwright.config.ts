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
      execFileSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/e2e-db.ps1')], {
        stdio: 'inherit',
      });
    } catch {
      console.warn('[e2e] Could not reset macro_e2e (is MACROCOUNTER_TEST_PG set?). The auth projects are skipped.');
      return undefined;
    }
    process.env.MACRO_E2E_DB_READY = '1';
  }
  if (!existsSync(e2eDbFile)) return undefined;
  return (JSON.parse(readFileSync(e2eDbFile, 'utf8')) as { connectionString: string }).connectionString;
}

const authConnection = prepareAuthDatabase();

const authProjects: PlaywrightTestConfig['projects'] = authConnection
  ? [
      {
        name: 'auth-desktop',
        testDir: './tests/e2e/auth',
        use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 } },
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
    ]
  : [];

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
      testIgnore: [/offline\.spec\.ts/, /[\\/]auth[\\/]/],
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:5173', viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testIgnore: [/offline\.spec\.ts/, /[\\/]auth[\\/]/],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        viewport: { width: 360, height: 740 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      // The service worker only exists in the production build, served by `vite preview`.
      name: 'offline',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173', serviceWorkers: 'allow' },
    },
    ...authProjects,
  ],
  webServer: [
    {
      // The dev server proxies /api to the backend on 5080 (vite.config.ts).
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
    ...(authConnection
      ? [
          {
            // Never reused: it must use this run's database and the Testing-only switches (no Claude, no HIBP).
            command: 'dotnet run --project ../backend/MacroCounter.Api --no-launch-profile',
            url: 'http://localhost:5080/api/auth/session',
            reuseExistingServer: false,
            timeout: 180_000,
            env: {
              ...process.env,
              ASPNETCORE_ENVIRONMENT: 'Testing',
              ASPNETCORE_URLS: 'http://localhost:5080',
              ConnectionStrings__Identity: authConnection,
              Testing__FakeEstimator: 'true',
              Testing__BreachedPasswords__0: 'password1234',
            } as Record<string, string>,
          },
        ]
      : []),
  ],
});
