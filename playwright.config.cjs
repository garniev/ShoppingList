const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run serve:test',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: '**/pwa.spec.cjs' },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: '**/pwa.spec.cjs' },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testIgnore: '**/pwa.spec.cjs' },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] }, testIgnore: '**/pwa.spec.cjs' },
    {
      name: 'pwa-chromium',
      testMatch: '**/pwa.spec.cjs',
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' }
    }
  ]
});