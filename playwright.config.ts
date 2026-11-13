import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3210);

/**
 * Smoke tests run against the app in demo mode with a fresh database, so no
 * key and no network are needed. The tests run in order: onboarding creates
 * the data the inbox tests use.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: [
      'rm -rf .tmp/e2e',
      'export DATABASE_PATH=.tmp/e2e/demo.sqlite DEMO_MODE=1 PORT=' + String(port),
      'pnpm db:migrate',
      'concurrently -k -n web,worker "pnpm:dev:web" "pnpm:dev:worker"',
    ].join(' && '),
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
