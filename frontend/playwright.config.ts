import { defineConfig, devices } from '@playwright/test'

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL
const viteApiBaseUrl = process.env.PLAYWRIGHT_VITE_API_BASE_URL ?? 'http://localhost:5100'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        env: {
          ...process.env,
          VITE_API_BASE_URL: viteApiBaseUrl,
          VITE_KEYCLOAK_URL: '',
          VITE_KEYCLOAK_REALM: '',
          VITE_KEYCLOAK_CLIENT_ID: '',
        },
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
      },
})
