import { expect, test } from '@playwright/test'

const hasAuthenticatedProductionConfig = Boolean(process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_AUTH_STORAGE_STATE)

test.describe('authenticated production smoke', () => {
  test.skip(!hasAuthenticatedProductionConfig, 'Requires PLAYWRIGHT_BASE_URL and a short-lived PLAYWRIGHT_AUTH_STORAGE_STATE created for a dedicated Keycloak test learner.')

  test('loads the signed-in learner identity and protected progress experience', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Sign in/i })).toHaveCount(0)
    await page.getByRole('button', { name: 'Progress' }).click()
    await expect(page.getByRole('heading', { name: 'Make progress visible.' })).toBeVisible()
    await expect(page.getByText('Lessons complete')).toBeVisible()
  })

  test('opens the signed-in profile menu without exposing secrets', async ({ page }) => {
    await page.goto('/')
    const profile = page.locator('button[aria-haspopup="menu"]').last()
    await expect(profile).toBeVisible()
    await profile.click()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/access_token|refresh_token|client_secret/i)
  })
})
