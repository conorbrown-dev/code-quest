import { expect, test } from '@playwright/test'

const completeOnboarding = async (page: import('@playwright/test').Page, learnerId = `guest-${crypto.randomUUID()}`) => {
  await page.addInitScript(id => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-learner-id', id)
  }, learnerId)
}

test.describe('guest learning journeys', () => {
  test('requires an answer, handles a wrong answer, and keeps the next lesson locked', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/')

    await page.getByRole('button', { name: 'Check answer' }).click()
    await expect(page.getByText('Choose an answer first.')).toBeVisible()

    await page.getByRole('button', { name: /Long-term storage only/i }).click()
    await page.getByRole('button', { name: 'Check answer' }).click()
    await expect(page.getByRole('main').getByText('Try again', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Next lesson/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Bits, bytes, and text locked' })).toBeVisible()
  })

  test('supports keyboard submission and persists a completed guest lesson through reload', async ({ page }) => {
    const learnerId = `keyboard-${crypto.randomUUID()}`
    await completeOnboarding(page, learnerId)
    await page.goto('/')
    await page.getByRole('button', { name: /Memory \(RAM\)/i }).click()
    await page.keyboard.press('Control+Enter')
    await expect(page.getByRole('main').getByText('That’s right. You’ve got the idea.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'What a computer actually does' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bits, bytes, and text' })).toBeEnabled()
  })

  test('blocks direct access to a locked lesson and explains how to unlock it', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Data types carry meaning locked' }).click()
    await expect(page.getByText('Complete the previous lesson to unlock this one.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
  })

  test('changes tracks without leaking C# guest progress into Python', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/')
    await page.getByRole('button', { name: /Memory \(RAM\)/i }).click()
    await page.getByRole('button', { name: 'Check answer' }).click()
    await expect(page.getByRole('button', { name: 'Bits, bytes, and text' })).toBeEnabled()

    await page.getByRole('button', { name: /C# 14 \/ .NET 10/i }).click()
    await page.getByRole('menuitem', { name: /Python Web/i }).click()
    await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bits, bytes, and text locked' })).toBeVisible()
  })

  test('shows capstone evidence gates, competencies, and real-work simulations', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Progress' }).click()
    await expect(page.getByRole('heading', { name: 'Build a capability portfolio.' })).toBeVisible()
    await expect(page.getByText('Programming', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Foundation API/i }).last().click()
    await expect(page.getByRole('heading', { name: /Foundation API evidence gate/i })).toBeVisible()
    await expect(page.getByText('REAL-WORK SIMULATIONS')).toBeVisible()
    await expect(page.getByRole('button', { name: /INCIDENT Checkout timeouts after a dependency release/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ask for feedback that improves the work.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request peer and mentor review' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Measure readiness, not just activity.' })).toBeVisible()
  })

  test('runs an incident response scenario and returns evidence-based feedback', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Progress' }).click()
    await expect(page.getByText('SCENARIO LAB')).toBeVisible()
    await page.getByRole('button', { name: /Checkout timeouts after a dependency release/i }).click()
    await expect(page.getByText('EVIDENCE PACKET')).toBeVisible()
    await expect(page.getByText(/checkout p95 rose from 240 ms to 8.4 s/i)).toBeVisible()
    await page.getByRole('button', { name: 'Check practice response' }).click()
    await expect(page.getByText('0 / 4 deliverables complete')).toBeVisible()
    await expect(page.getByText(/Strengthen: Hypothesis and evidence/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start targeted review →' }).first()).toBeVisible()
  })
})
