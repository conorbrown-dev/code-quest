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
  expect(lessons).toHaveLength(33)
  expect(lessons.map((lesson: { order: number }) => lesson.order)).toEqual([...Array(33)].map((_, index) => index + 1))
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['foundations-data-types', 'objects-purpose', 'modern-csharp-records', 'reliability-http-clients', 'staff-leadership-leverage']))
  expect(lessons[0]).toMatchObject({ slug: 'foundations-how-code-works', order: 1 })
  expect(lessons.at(-1)).toMatchObject({ slug: 'staff-leadership-leverage', order: 33 })
})

test('serves the Python Web curriculum and its framework-choice lesson', async ({ request }) => {
  const course = await request.get(`${apiBaseUrl}/api/courses/python-web`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageVersion).toBe('Python 3.14')
  expect(body.frameworkVersion).toContain('FastAPI')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(32)
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['python-framework-choice', 'python-project-foundations', 'python-system-design', 'python-staff-architecture']))
  expect(lessons.map((lesson: { order: number }) => lesson.order)).toEqual([...Array(32)].map((_, index) => index + 1))
  expect(lessons.map((lesson: { slug: string }) => lesson.slug)).toEqual(expect.arrayContaining(['python-testing-pytest', 'python-http-clients']))
  expect(lessons.findIndex((lesson: { slug: string }) => lesson.slug === 'python-http-clients')).toBe(lessons.findIndex((lesson: { slug: string }) => lesson.slug === 'python-testing-pytest') + 1)
  expect(lessons[0]).toMatchObject({ slug: 'python-values', order: 1 })
  expect(lessons.sort((a: { order: number }, b: { order: number }) => a.order - b.order).at(-1)).toMatchObject({ slug: 'python-staff-architecture', order: 32 })

  const frameworkChoice = await request.get(`${apiBaseUrl}/api/lessons/python-framework-choice`)
  await expect(frameworkChoice).toBeOK()
  await expect(frameworkChoice.json()).resolves.toMatchObject({
    title: 'Choose a Python web framework',
    version: { language: 'Python 3.14' },
  })
})

test('serves Computing Foundations separately from language tracks', async ({ request }) => {
  const course = await request.get(`${apiBaseUrl}/api/courses/computing-foundations`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageId).toBe('computing')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(4)
  expect(lessons[0]).toMatchObject({ slug: 'computing-machine-model', order: 1 })
  expect(lessons.at(-1)).toMatchObject({ slug: 'computing-os-shell', order: 4 })
})

test('serves the Claude Hooks presentation course without a quiz exercise', async ({ request }) => {
  const course = await request.get(`${apiBaseUrl}/api/courses/claude-engineering`)
  await expect(course).toBeOK()
  const body = await course.json()
  expect(body.languageId).toBe('claude')
  expect(body.languageVersion).toBe('Claude Code')
  const lessons = body.modules.flatMap((module: { lessons: { slug: string; order: number }[] }) => module.lessons)
  expect(lessons).toHaveLength(9)
  expect(lessons[0]).toMatchObject({ slug: 'claude-hooks-mental-model', order: 1 })
  expect(lessons.at(-1)).toMatchObject({ slug: 'claude-hooks-security', order: 9 })

  const firstLesson = await request.get(`${apiBaseUrl}/api/lessons/claude-hooks-mental-model`)
  await expect(firstLesson).toBeOK()
  await expect(firstLesson.json()).resolves.toMatchObject({
    title: 'Hooks are lifecycle middleware',
    exercise: { kind: 'Presentation' },
    version: { language: 'Claude Code', framework: 'Hooks' },
  })
})

test('accepts anonymous activity events and protects aggregate analytics', async ({ request }) => {
  const activity = await request.post(`${apiBaseUrl}/api/activity`, {
    headers: { 'X-Learner-Id': 'test-analytics-guest' },
    data: {
      eventType: 'lesson_view',
      sessionId: 'test-session',
      courseId: 'claude-engineering',
      lessonSlug: 'claude-hooks-pretooluse',
      workspace: 'learn',
      detail: null,
    },
  })
  expect([204, 503]).toContain(activity.status())

  const summary = await request.get(`${apiBaseUrl}/api/admin/analytics`)
  expect(summary.status()).toBe(401)
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

test('deep-links every published course and representative lessons', async ({ page, request }) => {
  const catalogResponse = await request.get(`${apiBaseUrl}/api/courses`)
  await expect(catalogResponse).toBeOK()
  const catalog = await catalogResponse.json() as { id: string; available: boolean }[]
  const courseIds = catalog.filter(course => course.available).map(course => course.id)

  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))

  for (const courseId of courseIds) {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/${courseId}`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as { modules: { lessons: { slug: string; title: string; order: number }[] }[] }
    const lessons = course.modules.flatMap(module => module.lessons).sort((a, b) => a.order - b.order)
    expect(lessons.length).toBeGreaterThan(0)

    const representative = [...new Map([
      lessons[0],
      lessons[Math.floor(lessons.length / 2)],
      lessons.at(-1)!,
    ].map(lesson => [lesson.slug, lesson])).values()]

    for (const lesson of representative) {
      const expectedPath = `/courses/${courseId}/lessons/${lesson.slug}`
      await page.goto(expectedPath)
      await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath)
      await expect(page.getByRole('heading', { name: lesson.title, level: 1 })).toBeVisible()
      await page.reload()
      await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath)
      await expect(page.getByRole('heading', { name: lesson.title, level: 1 })).toBeVisible()
    }
  }
})

test('course-only deep links resolve to the next incomplete lesson', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-learner-id', 'deep-link-next-guest')
    localStorage.setItem('pathway-completed-lessons:guest:deep-link-next-guest', JSON.stringify([
      'react-lite-vite-bootstrap',
      'react-lite-router-tailwind',
    ]))
  })

  await page.goto('/courses/react-lite')
  await expect.poll(() => new URL(page.url()).pathname).toBe('/courses/react-lite/lessons/react-lite-devtools-project-files')
  await expect(page.getByRole('heading', { name: 'Use browser DevTools and read the project', level: 1 })).toBeVisible()
})

test('lesson navigation updates history and browser back/forward restores lessons', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-learner-id', 'history-deep-link-guest')
    localStorage.setItem('pathway-completed-lessons:guest:history-deep-link-guest', JSON.stringify([
      'foundations-how-code-works',
    ]))
  })

  await page.goto('/courses/csharp-dotnet/lessons/foundations-how-code-works')
  await expect(page.getByRole('heading', { name: 'How code works', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Values and variables' }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/courses/csharp-dotnet/lessons/foundations-values')
  await expect(page.getByRole('heading', { name: 'Values and variables', level: 1 })).toBeVisible()

  await page.goBack()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/courses/csharp-dotnet/lessons/foundations-how-code-works')
  await expect(page.getByRole('heading', { name: 'How code works', level: 1 })).toBeVisible()

  await page.goForward()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/courses/csharp-dotnet/lessons/foundations-values')
  await expect(page.getByRole('heading', { name: 'Values and variables', level: 1 })).toBeVisible()
})

test('syntax-highlights displayed code and CLI examples across every course family', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
  })

  const highlightedCases = [
    ['git-cli', 'git-init-status', 'shell'],
    ['sqlite', 'sqlite-select-filter-sort', 'sql'],
    ['sqlite', 'sqlite-cli-db-browser', 'shell'],
    ['react-lite', 'react-lite-vite-bootstrap', 'shell'],
    ['react-lite', 'react-lite-jsx-rendering', 'typescript'],
    ['react-enterprise', 'react-use-state', 'typescript'],
    ['web-development-basics', 'web-basics-html', 'html'],
    ['web-development-basics', 'web-basics-css-box-layout', 'css'],
    ['web-development-basics', 'web-basics-javascript', 'javascript'],
    ['web-development-basics', 'web-basics-typescript', 'typescript'],
    ['csharp-dotnet', 'foundations-methods', 'csharp'],
    ['python-web', 'python-data-models', 'python'],
    ['rust-systems', 'rust-hello-functions', 'rust'],
    ['claude-engineering', 'claude-hooks-anatomy', 'json'],
  ] as const

  for (const [courseId, lessonSlug, language] of highlightedCases) {
    await page.goto(`/courses/${courseId}/lessons/${lessonSlug}`)
    const snippet = page.locator(`pre[data-syntax-language="${language}"]`).first()
    await expect(snippet).toBeVisible()
    await expect(snippet).toHaveAttribute('data-syntax-highlighted', 'true', { timeout: 15_000 })
    await expect(snippet.locator('span[class*="mtk"]').first()).toBeVisible()
  }

  for (const [courseId, lessonSlug] of [
    ['computing-foundations', 'computing-machine-model'],
    ['electrical-engineering-foundations', 'ee-ohms-law'],
  ] as const) {
    await page.goto(`/courses/${courseId}/lessons/${lessonSlug}`)
    const snippet = page.locator('pre[data-syntax-language="plaintext"]').first()
    await expect(snippet).toBeVisible()
    await expect(snippet).toHaveAttribute('data-syntax-highlighted', 'plain')
  }
})

test('loads the first lesson for a guest learner', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')
  await expect(page).toHaveTitle('Pathway — Learn C#')

  await expect(page.getByRole('heading', { name: 'How code works' })).toBeVisible()
  await expect(page.getByText('What does this line do?')).toBeVisible()
  await page.getByRole('button', { name: /Prints a message to the console/i }).click()
  await expect(page.getByRole('button', { name: /Check answer/i })).toBeVisible()
})

test('onboarding selects a track and enters the guest learning experience', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText('CHOOSE YOUR FIRST TRACK')).toBeVisible()
  await page.getByRole('button', { name: /Python Web: zero to staff/i }).click()
  await expect(page.getByText('Selected: Python Web: zero to staff')).toBeVisible()
  await page.getByRole('button', { name: 'Continue as guest' }).click()
  await expect(page.getByRole('heading', { name: 'Values and variables' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('python-web')
})

test('onboarding selects Electrical Engineering Foundations for a guest', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /Electrical Engineering Foundations/i }).click()
  await expect(page.getByText('Selected: Electrical Engineering Foundations')).toBeVisible()
  await page.getByRole('button', { name: 'Continue as guest' }).click()
  await expect(page).toHaveTitle('Pathway — Electrical Engineering')
  await expect(page.getByRole('heading', { name: 'Charge, voltage, and current', level: 1 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('electrical-engineering-foundations')
})

test('renders numeric EE exercises, accepts tolerance, unlocks the next lesson, and adds review', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'electrical-engineering-foundations')
    localStorage.setItem('pathway-learner-id', 'ee-numeric-ui-guest')
    localStorage.setItem('pathway-completed-lessons:guest:ee-numeric-ui-guest', JSON.stringify([
      'ee-charge-voltage-current',
      'ee-resistance-circuits',
    ]))
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Ohm\'s law: V = IR' }).click()
  await expect(page.getByText('A 12 V source is connected across a 330 Ω resistor. What current flows?')).toBeVisible()
  await page.getByLabel('Numeric answer').fill('36.4')
  await expect(page.getByLabel('Unit', { exact: true })).toHaveValue('mA')
  await page.getByRole('button', { name: /Check answer/i }).click()

  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByText('Correct. Your calculation is within the accepted engineering tolerance.')).toBeVisible()
  await expect(page.getByText('Worked solution')).toBeVisible()
  await expect(page.getByText('I = 12 V / 330 Ω')).toBeVisible()
  await expect(page.getByRole('button', { name: /Next lesson/i })).toBeVisible()

  await page.getByRole('button', { name: 'Practice' }).click()
  await expect(page.getByText("Ohm's law: V = IR")).toBeVisible()
})

test('runs an interactive EE circuit measurement lab and unlocks progression', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'electrical-engineering-foundations')
    localStorage.setItem('pathway-learner-id', 'ee-circuit-ui-guest')
    localStorage.setItem('pathway-completed-lessons:guest:ee-circuit-ui-guest', JSON.stringify([
      'ee-charge-voltage-current',
      'ee-resistance-circuits',
      'ee-ohms-law',
      'ee-unit-conversion',
      'ee-series-parallel',
    ]))
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Voltage and current division' }).click()
  await expect(page.getByText('VIRTUAL MULTIMETER')).toBeVisible()
  await page.getByRole('button', { name: 'V DC', exact: true }).click()
  await page.getByLabel('Circuit node MID').click()
  await page.getByLabel('Circuit node 0 V').click()
  await expect(page.getByLabel('Meter reading')).toHaveText('5.000 V')

  await page.getByRole('button', { name: /Check answer/i }).click()
  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await expect(page.getByRole('main').getByText('Correct. Your meter setup and interpretation match the circuit.')).toBeVisible()
  await expect(page.getByText('With equal series resistors, the midpoint is half the source voltage')).toBeVisible()
  await expect(page.getByRole('button', { name: /Next lesson/i })).toBeVisible()
})

test('completes the EE troubleshooting capstone with a measurement and diagnosis', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'electrical-engineering-foundations')
    localStorage.setItem('pathway-learner-id', 'ee-capstone-ui-guest')
    localStorage.setItem('pathway-completed-lessons:guest:ee-capstone-ui-guest', JSON.stringify([
      'ee-charge-voltage-current',
      'ee-resistance-circuits',
      'ee-ohms-law',
      'ee-unit-conversion',
      'ee-series-parallel',
      'ee-voltage-divider',
      'ee-power-energy',
      'ee-kirchhoff',
      'ee-schematics',
      'ee-multimeter',
      'ee-capacitors-rc',
      'ee-inductors',
      'ee-ac-fundamentals',
      'ee-semiconductors',
      'ee-digital-electrical',
    ]))
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Datasheets, tolerances, and systematic debugging' }).click()
  await expect(page.getByText('Troubleshooting capstone')).toBeVisible()
  await page.getByRole('button', { name: 'V DC', exact: true }).click()
  await page.getByLabel('Circuit node LED A').click()
  await page.getByLabel('Circuit node 0 V').click()
  await expect(page.getByLabel('Meter reading')).toHaveText('5.000 V')
  await page.getByRole('button', { name: /D1 is open/i }).click()
  await page.getByRole('button', { name: /Check answer/i }).click()

  await expect(page.getByText('Correct', { exact: true })).toBeVisible()
  await expect(page.getByText('A healthy supply is present and the LED anode remains at 5 V')).toBeVisible()
  await expect(page.getByRole('button', { name: /Next lesson/i })).toHaveCount(0)
})

test('onboarding selects the Rust systems track', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /Rust Systems: zero to staff/i }).click()
  await expect(page.getByText('Selected: Rust Systems: zero to staff')).toBeVisible()
  await page.getByRole('button', { name: 'Continue as guest' }).click()
  await expect(page).toHaveTitle('Pathway — Learn Rust')
  await expect(page.getByRole('heading', { name: 'Install Rust and use Cargo', level: 1 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('rust-systems')
})

test('checks an answer, persists progress, unlocks the next lesson, and supports review', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')

  await page.getByRole('button', { name: /Prints a message to the console/i }).click()
  await page.getByRole('button', { name: /Check answer/i }).click()
  await expect(page.getByRole('main').getByText('That’s right. You’ve got the idea.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Next lesson/i })).toBeVisible()
  await page.getByRole('button', { name: /Next lesson/i }).click()
  await expect(page.getByRole('heading', { name: 'Values and variables' })).toBeVisible()

  await page.getByRole('button', { name: 'Practice' }).click()
  await expect(page.getByText('How code works')).toBeVisible()
  await page.getByRole('button', { name: /Practice again/i }).click()
  await expect(page.getByRole('heading', { name: 'How code works' })).toBeVisible()
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
    localStorage.setItem('pathway-completed-lessons:guest:code-exercise-guest', JSON.stringify(['foundations-how-code-works', 'foundations-values', 'foundations-data-types', 'foundations-operators']))
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

  await expect(page.getByRole('heading', { name: 'Values and variables' })).toBeVisible()
  await expect(page.getByText('What is `completed_lessons` in this example?')).toBeVisible()
})

test('loads the Claude Hooks course as presentation-only content', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'claude-engineering')
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — Claude Engineering')
  await expect(page.getByRole('heading', { name: 'Hooks are lifecycle middleware' })).toBeVisible()
  await expect(page.getByText('LESSON NOTES')).toBeVisible()
  await expect(page.getByRole('button', { name: /Check answer|Run tests/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Back' })).toBeDisabled()
  await page.getByRole('button', { name: /Continue/i }).click()
  await expect(page.getByRole('heading', { name: 'Map the agent lifecycle' })).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('heading', { name: 'Hooks are lifecycle middleware' })).toBeVisible()
  await page.getByRole('button', { name: /Continue/i }).click()
  await page.getByRole('button', { name: 'Treat hooks as executable infrastructure' }).click()
  await expect(page.getByRole('button', { name: 'Back' })).toBeEnabled()
  await expect(page.getByText('Course complete.')).toBeVisible()
})

test('runs the Claude PreToolUse Hook Playground against simulated Bash commands', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'claude-engineering')
  })
  await page.route('**/api/claude-hooks/evaluate', async route => {
    const body = route.request().postDataJSON() as { command: string }
    const blocked = body.command.includes('rm -rf')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        matcherMatched: true,
        executed: true,
        exitCode: 0,
        outcome: blocked ? 'denied' : 'no_decision',
        summary: blocked
          ? 'Claude Code would deny the Bash tool call and show Claude the hook reason.'
          : 'The hook succeeded silently. Claude Code would continue through its normal permission flow.',
        reason: blocked ? 'Destructive command blocked by hook' : null,
        stdout: blocked ? '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Destructive command blocked by hook"}}' : '',
        stderr: '',
        inputJson: JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: body.command },
        }),
      }),
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Guard actions before they run' }).click()
  await expect(page.getByRole('heading', { name: 'Run a real PreToolUse hook' })).toBeVisible()
  await page.getByRole('button', { name: 'Run hook' }).click()
  await expect(page.getByText('BLOCKED', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('Destructive command blocked by hook', { exact: true }).last()).toBeVisible()

  await page.getByRole('button', { name: 'Run tests' }).click()
  await page.getByRole('button', { name: 'Run hook' }).click()
  await expect(page.getByText('NO DECISION', { exact: true }).last()).toBeVisible()
  await expect(page.getByText(/normal permission flow/i)).toBeVisible()
})

test('loads Web Development Basics as its own course', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'web-development-basics')
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — Web Development Basics')
  await expect(page.getByRole('heading', { name: 'How a web application fits together', level: 1 })).toBeVisible()
  await expect(page.getByText('Place the responsibility')).toBeVisible()
})

test('loads SQLite with SQL syntax highlighting and an editable SQL exercise', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'sqlite')
    localStorage.setItem('pathway-learner-id', 'sqlite-ui-guest')
    localStorage.setItem('pathway-completed-lessons:guest:sqlite-ui-guest', JSON.stringify([
      'sqlite-what-it-is',
      'sqlite-cli-db-browser',
      'sqlite-db-browser',
    ]))
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — SQLite')
  await expect(page.getByRole('heading', { name: 'Understand what SQLite is', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Create a database and inspect its schema' }).click()
  await expect(page.getByText('exercise.sql')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await expect(page.getByRole('button', { name: /Run tests/i })).toBeVisible()
  await expect(page.locator('pre[data-syntax-language="sql"]').first()).toBeVisible()
})

test('onboarding exposes SQLite and the future database family tracks', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Select SQLite course' }).click()
  await expect(page.getByText('Selected: SQLite')).toBeVisible()
  await expect(page.getByText('SQL Server')).toBeVisible()
  await expect(page.getByText('MySQL')).toBeVisible()
  await expect(page.getByText('PostgreSQL')).toBeVisible()
  await page.getByRole('button', { name: 'Continue as guest' }).click()
  await expect(page).toHaveTitle('Pathway — SQLite')
  await expect(page.getByRole('heading', { name: 'Understand what SQLite is', level: 1 })).toBeVisible()
})

test('loads React Lite and reaches a TypeScript exercise without Web Basics lessons', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'react-lite')
    localStorage.setItem('pathway-learner-id', 'react-lite-ui-guest')
    localStorage.setItem('pathway-completed-lessons:guest:react-lite-ui-guest', JSON.stringify([
      'react-lite-vite-bootstrap',
      'react-lite-router-tailwind',
      'react-lite-devtools-project-files',
      'react-lite-folder-structure',
    ]))
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — React Lite 2026')
  await expect(page.getByRole('heading', { name: 'Bootstrap a modern React application', level: 1 })).toBeVisible()
  await expect(page.getByText("Understand TypeScript's role")).toBeVisible()
  await page.getByRole('button', { name: 'Understand JSX and rendering' }).click()
  await expect(page.getByText('App.tsx')).toBeVisible()
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await expect(page.getByRole('button', { name: /Run tests/i })).toBeVisible()
})

test('loads the selected React enterprise track with a TypeScript exercise editor', async ({ page }) => {
  await page.route('**/api/progress', route => route.fulfill({ status: 401 }))
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'react-enterprise')
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — React 2026')
  await expect(page.getByRole('heading', { name: 'Bootstrap React with Vite and TypeScript', level: 1 })).toBeVisible()
  await expect(page.getByText('Pick the bootstrap boundary')).toBeVisible()

  const completed = [
    'react-vite-bootstrap',
    'react-router-tailwind-baseline',
    'react-typescript-strict',
    'react-enterprise-folders',
  ]
  await page.evaluate((progress) => {
    const learnerId = localStorage.getItem('pathway-learner-id')
    localStorage.setItem(`pathway-completed-lessons:guest:${learnerId}`, JSON.stringify(progress))
  }, completed)
  await page.reload()
  await page.getByRole('button', { name: 'Build a thin application composition root' }).click()
  await expect(page.getByRole('button', { name: /Run tests/i })).toBeVisible()
  await expect(page.locator('.monaco-editor')).toBeVisible()
  await expect(page.getByText('App.tsx')).toBeVisible()
})

test('loads the selected Git CLI track with a shell exercise editor', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'git-cli')
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — Git CLI')
  await expect(page.getByRole('heading', { name: 'Create a repository and read its state', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Initialize the repository', level: 2 })).toBeVisible()
  await expect(page.getByRole('button', { name: /Run tests/i })).toBeVisible()
  await expect(page.locator('.monaco-editor')).toBeVisible()
})

test('loads the selected Rust track for a guest learner', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pathway-onboarding-complete', 'true')
    localStorage.setItem('pathway-course-id', 'rust-systems')
  })
  await page.goto('/')

  await expect(page).toHaveTitle('Pathway — Learn Rust')
  await expect(page.getByRole('heading', { name: 'Install Rust and use Cargo', level: 1 })).toBeVisible()
})

test('unlocks resilient HTTP clients after the preceding Python lesson passes', async ({ page }) => {
  const completed = [
    'python-values', 'python-functions', 'python-data-models', 'python-tests-errors', 'python-framework-choice',
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

  await expect(page.getByRole('button', { name: 'Values and variables locked' })).toBeVisible()
})

test('navigates workspaces and switches tracks from the sidebar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')
  await expect(page).toHaveTitle('Pathway — Learn C#')

  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Practice' })).toBeVisible()
  await expect(page.getByText('YOUR TRACK')).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.getByText('YOUR TRACK')).toBeVisible()
  await page.getByRole('button', { name: 'Notifications' }).click()
  await expect(page.getByText('No new notifications.')).toBeVisible()

  await page.getByRole('button', { name: 'Practice' }).click()
  await expect(page.getByRole('heading', { name: 'Strengthen the signal.' })).toBeVisible()
  await page.getByRole('button', { name: 'Projects' }).click()
  await expect(page.getByRole('heading', { name: 'Build work worth showing.' })).toBeVisible()
  await page.getByRole('button', { name: 'Learn', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'How code works' })).toBeVisible()

  await page.getByRole('button', { name: /C# 14 \/ .NET 10/i }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /Python Web/i }).click()
  await expect(page.getByRole('heading', { name: 'Values and variables' })).toBeVisible()
  await expect(page).toHaveTitle('Pathway — Learn Python')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pathway-course-id'))).toBe('python-web')
})

test('persists the selected neon accent after a reload', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pathway-onboarding-complete', 'true'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Pink theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'pink')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'pink')
})

test('exposes the learning-experience workspaces for a guest learner', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue as guest' }).click()
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
