import { expect, test } from '@playwright/test'

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:5100'

test('serves the current C#/.NET curriculum API', async ({ request }) => {
  const health = await request.get(`${apiBaseUrl}/health`)
  await expect(health).toBeOK()
  await expect(health.json()).resolves.toMatchObject({ status: 'ok', courseVersion: 'C# 14 / .NET 10' })

  const course = await request.get(`${apiBaseUrl}/api/courses/csharp-dotnet`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageVersion).toBe('C# 14')
  expect(body.frameworkVersion).toBe('.NET 10')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(42)
  expect(lessons.map((lesson: { order: number }) => lesson.order)).toEqual([...Array(42)].map((_, index) => index + 1))
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['internet-dns', 'internet-https', 'foundations-data-types', 'objects-purpose', 'modern-csharp-records', 'reliability-http-clients', 'staff-leadership-leverage']))
  expect(lessons[0]).toMatchObject({ slug: 'internet-devices', order: 1 })
  expect(lessons.at(-1)).toMatchObject({ slug: 'staff-leadership-leverage', order: 42 })
})

test('serves the Python Web curriculum and its framework-choice lesson', async ({ request }) => {
  const course = await request.get(`${apiBaseUrl}/api/courses/python-web`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageVersion).toBe('Python 3.14')
  expect(body.frameworkVersion).toContain('FastAPI')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(42)
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['python-internet-dns', 'python-internet-https', 'python-framework-choice', 'python-project-foundations', 'python-system-design', 'python-staff-architecture']))
  expect(lessons.map((lesson: { order: number }) => lesson.order)).toEqual([...Array(42)].map((_, index) => index + 1))
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['python-testing-pytest', 'python-http-clients']))
  expect(lessons.findIndex((lesson: { slug: string }) => lesson.slug === 'python-http-clients')).toBe(lessons.findIndex((lesson: { slug: string }) => lesson.slug === 'python-testing-pytest') + 1)
  expect(lessons[0]).toMatchObject({ slug: 'python-internet-devices', order: 1 })
  expect(lessons.sort((a: { order: number }, b: { order: number }) => a.order - b.order).at(-1)).toMatchObject({ slug: 'python-staff-architecture', order: 42 })

  const frameworkChoice = await request.get(`${apiBaseUrl}/api/lessons/python-framework-choice`)
  await expect(frameworkChoice).toBeOK()
  await expect(frameworkChoice.json()).resolves.toMatchObject({
    title: 'Choose a Python web framework',
    version: { language: 'Python 3.14' },
  })
})

test('serves learning-experience templates, checkpoints, and guarded coaching', async ({ request }) => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'Experience endpoints require a production Keycloak test identity.')
  const templates = await request.get(`${apiBaseUrl}/api/experience/projects/templates`)
  await expect(templates).toBeOK()
  await expect(templates.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'python-learning-api', files: expect.any(Array) })]))

  const assessment = await request.get(`${apiBaseUrl}/api/experience/assessments/python-web/python-foundations`)
  await expect(assessment).toBeOK()
  const assessmentBody = await assessment.json()
  expect(assessmentBody.questions).toHaveLength(3)
  expect(assessmentBody.questions.every((question: { correctAnswer: unknown }) => question.correctAnswer === null)).toBe(true)
  const assessmentResult = await request.post(`${apiBaseUrl}/api/experience/assessments/python-web/python-foundations`, { data: { answers: { values: 'list', contract: 'Printed output only', boundary: 'Never' } } })
  await expect(assessmentResult).toBeOK()
  await expect(assessmentResult.json()).resolves.toMatchObject({ passed: false, recommendedReviewLessonSlugs: expect.arrayContaining(['python-control-flow-collections']) })

  const coach = await request.post(`${apiBaseUrl}/api/experience/coach`, { data: { lessonSlug: 'python-functions', message: 'Give me the answer' } })
  await expect(coach).toBeOK()
  await expect(coach.json()).resolves.toMatchObject({ guidance: expect.stringContaining('won’t provide a copy-paste solution'), guardrails: expect.any(Array) })
})

test('loads the first lesson for a guest learner', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
  await expect(page.getByText("Which component holds a program's active working data?")).toBeVisible()
  await page.getByRole('button', { name: /Memory \(RAM\)/i }).click()
  await expect(page.getByRole('button', { name: /Check answer/i })).toBeVisible()
})

test('onboarding selects a track and enters the guest learning experience', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('CHOOSE YOUR FIRST TRACK')).toBeVisible()
  await page.getByRole('button', { name: /Python Web: zero to staff/i }).click()
  await expect(page.getByText('Selected: Python Web: zero to staff')).toBeVisible()
  await page.getByRole('button', { name: 'Explore as a guest' }).click()
  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('python-web')
})

test('checks an answer, persists progress, unlocks the next lesson, and supports review', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')

  await page.getByRole('button', { name: /Memory \(RAM\)/i }).click()
  await page.getByRole('button', { name: /Check answer/i }).click()
  await expect(page.getByRole('main').getByText('That’s right. You’ve got the idea.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Next lesson/i })).toBeVisible()
  await page.getByRole('button', { name: /Next lesson/i }).click()
  await expect(page.getByRole('heading', { name: 'Bits, bytes, and text' })).toBeVisible()

  await page.getByRole('button', { name: 'Practice' }).click()
  await expect(page.getByText('What a computer actually does')).toBeVisible()
  await page.getByRole('button', { name: /Practice again/i }).click()
  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
})

test('validates a code exercise and supports reset and worked-example review', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.route('**/api/submissions/validate', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ passed: true, passingTests: 2, totalTests: 2, feedback: 'All tests passed. Your solution meets this lesson’s checks.', nextLessonSlug: 'modern-csharp-records', codeReview: { summary: '1 focused suggestion found. These are advisory and do not change your test result.', suggestions: ['Prefer interpolated strings (`$"..."`) to `string.Format` when formatting a small, readable message.'] } }),
  }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-learner-id', 'code-exercise-guest')
    localStorage.setItem('pathway-completed-lessons:guest:code-exercise-guest', JSON.stringify(['internet-devices', 'internet-bits-bytes', 'internet-processes', 'internet-network-addresses', 'internet-dns', 'internet-http', 'internet-https', 'internet-web-apps', 'internet-latency-reliability', 'foundations-how-code-works', 'foundations-values', 'foundations-data-types', 'foundations-operators']))
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Making decisions' }).click()
  const editor = page.locator('.monaco-editor .view-lines')
  const editorInput = page.locator('.monaco-editor textarea')
  await editor.scrollIntoViewIfNeeded()
  await editorInput.click({ force: true })
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText('int age = 16;\nif (age >= 13)\n{\n    Console.WriteLine("You can watch!");\n}')
  await expect(editor).toContainText('You can watch!')
  await page.getByRole('button', { name: /Run tests/i }).click()
  await expect(page.getByRole('main').getByText('All tests passed. Your solution meets this lesson’s checks.')).toBeVisible()
  await page.getByText('Code review suggestions').click()
  await expect(page.getByText('Prefer interpolated strings')).toBeVisible()
  await page.getByText('Review the worked example').click()
  await expect(page.getByText('This example demonstrates the same concept.')).toBeVisible()
  await page.getByTitle('Reset').click()
  await expect(editor).toContainText('int age = 16;')
})

test('loads the selected Python track for a guest learner', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'python-web')
  })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
  await expect(page.getByText("Which component holds a running program's active working data?")).toBeVisible()
})

test('unlocks resilient HTTP clients after the preceding Python lesson passes', async ({ page }) => {
  const completed = [
    'python-internet-devices', 'python-internet-bits', 'python-internet-processes', 'python-internet-networking', 'python-internet-dns',
    'python-internet-http', 'python-internet-https', 'python-internet-web-apps', 'python-internet-reliability',
    'python-values', 'python-functions', 'python-data-models', 'python-tests-errors', 'python-http', 'python-framework-choice',
    'python-fastapi-endpoint', 'python-flask-composition', 'python-django-product', 'python-persistence', 'python-concurrency',
    'python-security-observability', 'python-project-foundations', 'python-environments-packaging', 'python-control-flow-collections',
    'python-modules-imports', 'python-objects-protocols', 'python-errors-resources'
  ]
  await page.addInitScript((progress) => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'python-web')
    localStorage.setItem('pathway-learner-id', 'python-unlock-guest')
    localStorage.setItem('pathway-completed-lessons:guest:python-unlock-guest', JSON.stringify(progress))
  }, completed)
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.goto('/')

  await page.getByRole('button', { name: 'Test with pytest and a deliberate pyramid' }).click()
  await page.getByRole('button', { name: /The observable status and response contract/i }).click()
  await page.getByRole('button', { name: /Check answer/i }).click()
  await expect(page.getByRole('button', { name: 'Call HTTP services resiliently' })).toBeEnabled()
})

test('does not show legacy browser progress after the owner logs out', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-learner-id', 'new-guest')
    localStorage.setItem('pathway-completed-lessons', JSON.stringify(['foundations-how-code-works']))
  })
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Bits, bytes, and text locked' })).toBeVisible()
})

test('navigates workspaces and switches tracks from the sidebar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByText('No new notifications.')).toBeVisible()

  await page.getByRole('button', { name: 'Practice' }).click()
  await expect(page.getByRole('heading', { name: 'Strengthen the signal.' })).toBeVisible()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Build work worth showing.' })).toBeVisible()
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()

  await page.getByRole('button', { name: /C# 14 \/ .NET 10/i }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /Python Web/i }).click()
  await expect(page.getByRole('heading', { name: 'What a computer actually does' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('python-web')
})

test('exposes the learning-experience workspaces for a guest learner', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Explore as a guest' }).click()
  await page.getByRole('button', { name: 'Progress' }).click()
  await expect(page.getByRole('heading', { name: 'Make progress visible.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /checkpoint/i })).toBeVisible()
  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('button', { name: 'Open workspace →' }).first().click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Workspace saved in this browser. Sign in to sync it across devices.')).toBeVisible()
  await page.getByRole('button', { name: 'Coach' }).click()
  await expect(page.getByRole('button', { name: 'Ask for a next step' })).toBeVisible()
  await page.getByRole('button', { name: 'Community' }).click()
  await expect(page.getByText('PEER REVIEW & OFFICE HOURS')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save collaboration preferences' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Post to community' })).toBeVisible()
})
