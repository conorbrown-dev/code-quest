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
})

test('serves the Python Web curriculum and its framework-choice lesson', async ({ request }) => {
  const course = await request.get(`${apiBaseUrl}/api/courses/python-web`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageVersion).toBe('Python 3.14')
  expect(body.frameworkVersion).toContain('FastAPI')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(33)
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['python-framework-choice', 'python-project-foundations', 'python-system-design', 'python-staff-architecture']))
  expect(lessons.sort((a: { order: number }, b: { order: number }) => a.order - b.order).at(-1)).toMatchObject({ slug: 'python-staff-architecture', order: 33 })

  const frameworkChoice = await request.get(`${apiBaseUrl}/api/lessons/python-framework-choice`)
  await expect(frameworkChoice).toBeOK()
  await expect(frameworkChoice.json()).resolves.toMatchObject({
    title: 'Choose a Python web framework',
    version: { language: 'Python 3.14' },
  })
})

test('loads the first lesson for a guest learner', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'How code works' })).toBeVisible()
  await expect(page.getByText('What does this line do?')).toBeVisible()
  await page.getByRole('button', { name: /Prints a message to the console/i }).click()
  await expect(page.getByRole('button', { name: /Check answer/i })).toBeVisible()
})
