import { expect, test } from '@playwright/test'

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:5100'

type LessonSummary = { slug: string; order: number }
type Course = { id: string; modules: { lessons: LessonSummary[] }[] }
type Lesson = LessonSummary & { nextSlug?: string; exercise: { kind: string; prompt: string; correctAnswer?: string; choices: { id: string }[] } }

const orderedLessons = (course: Course) => course.modules.flatMap(module => module.lessons).sort((left, right) => left.order - right.order)

test.describe('public API contract', () => {
  test('publishes health, readiness, OpenAPI metadata, and exactly the available tracks', async ({ request }) => {
    const [health, ready, openApi, catalog] = await Promise.all([
      request.get(`${apiBaseUrl}/health`), request.get(`${apiBaseUrl}/ready`), request.get(`${apiBaseUrl}/openapi/v1.json`), request.get(`${apiBaseUrl}/api/courses`),
    ])

    await expect(health).toBeOK()
    await expect(health.json()).resolves.toMatchObject({ status: 'ok', courseVersion: 'C# 14 / .NET 10' })
    // Local curriculum tests run without Postgres, while a deployed ready instance must have it.
    expect([200, 503]).toContain(ready.status())
    if (ready.status() === 503) await expect(ready.json()).resolves.toMatchObject({ detail: 'The progress database is not configured.' })
    await expect(openApi).toBeOK()
    await expect(openApi.json()).resolves.toMatchObject({ openapi: '3.0.3', info: { title: 'Pathway API' } })
    await expect(catalog).toBeOK()
    await expect(catalog.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'computing-foundations', available: true }),
      expect.objectContaining({ id: 'electrical-engineering-foundations', available: true }),
      expect.objectContaining({ id: 'git-cli', available: true }),
      expect.objectContaining({ id: 'web-development-basics', available: true }),
      expect.objectContaining({ id: 'react-lite', available: true }),
      expect.objectContaining({ id: 'react-enterprise', available: true }),
      expect.objectContaining({ id: 'csharp-dotnet', available: true }),
      expect.objectContaining({ id: 'python-web', available: true }),
      expect.objectContaining({ id: 'rust-systems', available: true }),
      expect.objectContaining({ id: 'networking-fundamentals', available: false }),
      expect.objectContaining({ id: 'dns', available: false }),
      expect.objectContaining({ id: 'http-apis', available: false }),
      expect.objectContaining({ id: 'digital-electronics', available: false }),
      expect.objectContaining({ id: 'analog-electronics', available: false }),
      expect.objectContaining({ id: 'ac-circuit-analysis', available: false }),
      expect.objectContaining({ id: 'embedded-systems', available: false }),
      expect.objectContaining({ id: 'microcontrollers', available: false }),
      expect.objectContaining({ id: 'pcb-design', available: false }),
      expect.objectContaining({ id: 'signals-systems', available: false }),
      expect.objectContaining({ id: 'control-systems', available: false }),
      expect.objectContaining({ id: 'electromagnetics', available: false }),
      expect.objectContaining({ id: 'power-electronics', available: false }),
    ]))
  })

  test('returns 404 for unknown curriculum resources', async ({ request }) => {
    expect((await request.get(`${apiBaseUrl}/api/courses/not-a-course`)).status()).toBe(404)
    expect((await request.get(`${apiBaseUrl}/api/lessons/not-a-lesson`)).status()).toBe(404)
    expect((await request.post(`${apiBaseUrl}/api/submissions/validate`, { data: { lessonSlug: 'not-a-lesson', answer: 'anything' } })).status()).toBe(404)
  })

  for (const courseId of ['computing-foundations', 'electrical-engineering-foundations', 'git-cli', 'web-development-basics', 'react-lite', 'react-enterprise', 'csharp-dotnet', 'python-web', 'rust-systems']) {
    test(`${courseId} has contiguous lessons and representative next-lesson links`, async ({ request }) => {
      const courseResponse = await request.get(`${apiBaseUrl}/api/courses/${courseId}`)
      await expect(courseResponse).toBeOK()
      const summaries = orderedLessons(await courseResponse.json() as Course)
      expect(summaries.map(lesson => lesson.order)).toEqual([...Array(summaries.length)].map((_, index) => index + 1))

      // Avoid spending the public-read rate-limit budget on every detail endpoint; ordering is
      // asserted for the full course and boundary/midpoint links exercise the navigation contract.
      const inspectedIndexes = [...new Set([0, 1, Math.floor(summaries.length / 2), summaries.length - 1])]
      const lessons = await Promise.all(inspectedIndexes.map(async index => {
        const summary = summaries[index]
        const response = await request.get(`${apiBaseUrl}/api/lessons/${summary.slug}`)
        await expect(response).toBeOK()
        return { index, lesson: await response.json() as Lesson }
      }))

      for (const { index, lesson } of lessons) {
        expect(lesson.slug).toBe(summaries[index].slug)
        expect(lesson.order).toBe(index + 1)
        expect(lesson.nextSlug ?? null).toBe(index === summaries.length - 1 ? null : summaries[index + 1].slug)
      }
    })
  }

  test('serves Web Development Basics as a separate foundations course', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/web-development-basics`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as Course
    const summaries = orderedLessons(course)
    expect(summaries).toHaveLength(12)
    expect(summaries[0]).toMatchObject({ slug: 'web-basics-browser-server', order: 1 })
    expect(summaries.at(-1)).toMatchObject({ slug: 'web-basics-capstone', order: 12 })

    const assessment = await request.get(`${apiBaseUrl}/api/experience/assessments/web-development-basics/web-basics-checkpoint`)
    await expect(assessment).toBeOK()
    const checkpoint = await assessment.json() as { title: string; questions: { correctAnswer?: string }[] }
    expect(checkpoint.title).toBe('Web development basics checkpoint')
    expect(checkpoint.questions).toHaveLength(8)
    expect(checkpoint.questions.every(question => question.correctAnswer == null)).toBe(true)
  })

  test('serves React Lite without duplicating Web Basics', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/react-lite`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as Course
    const summaries = orderedLessons(course)
    expect(summaries).toHaveLength(27)
    expect(summaries[0]).toMatchObject({ slug: 'react-lite-vite-bootstrap', order: 1 })
    expect(summaries.at(-1)).toMatchObject({ slug: 'react-lite-capstone', order: 27 })
    expect(summaries.some(lesson => lesson.slug.startsWith('web-basics-'))).toBe(false)

    const lessonResponse = await request.get(`${apiBaseUrl}/api/lessons/react-lite-dummy-api-read`)
    await expect(lessonResponse).toBeOK()
    await expect(lessonResponse.json()).resolves.toMatchObject({
      exercise: { kind: 'Code', prompt: expect.stringContaining('usersApi') },
    })

    const assessment = await request.get(`${apiBaseUrl}/api/experience/assessments/react-lite/react-lite-foundations`)
    await expect(assessment).toBeOK()
    const checkpoint = await assessment.json() as { title: string; questions: { correctAnswer?: string }[] }
    expect(checkpoint.title).toBe('React Lite foundations checkpoint')
    expect(checkpoint.questions).toHaveLength(8)

    const capstones = await request.get(`${apiBaseUrl}/api/experience/career/react-lite/capstones`)
    await expect(capstones).toBeOK()
    await expect(capstones.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'react-lite-admin-dashboard' }),
    ]))
  })

  test('serves the React 2026 enterprise course and rendering checkpoint', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/react-enterprise`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as Course
    const summaries = orderedLessons(course)
    expect(summaries).toHaveLength(47)
    expect(summaries[0]).toMatchObject({ slug: 'react-vite-bootstrap', order: 1 })
    expect(summaries.at(-1)).toMatchObject({ slug: 'react-enterprise-capstone', order: 47 })

    const lessonResponse = await request.get(`${apiBaseUrl}/api/lessons/react-use-state`)
    await expect(lessonResponse).toBeOK()
    await expect(lessonResponse.json()).resolves.toMatchObject({
      exercise: {
        kind: 'Code',
        prompt: expect.stringContaining('OrderDetails'),
        starterCode: expect.stringContaining('useState'),
      },
      version: { language: 'React 19.3', framework: 'Hooks' },
    })

    const assessment = await request.get(`${apiBaseUrl}/api/experience/assessments/react-enterprise/react-rendering-model`)
    await expect(assessment).toBeOK()
    const checkpoint = await assessment.json() as { title: string; questions: { correctAnswer?: string }[] }
    expect(checkpoint.title).toBe('React rendering and hooks checkpoint')
    expect(checkpoint.questions).toHaveLength(8)
    expect(checkpoint.questions.every(question => question.correctAnswer == null)).toBe(true)

    const [capstones, scenarios] = await Promise.all([
      request.get(`${apiBaseUrl}/api/experience/career/react-enterprise/capstones`),
      request.get(`${apiBaseUrl}/api/experience/career/react-enterprise/scenarios`),
    ])
    await expect(capstones).toBeOK()
    await expect(scenarios).toBeOK()
    await expect(capstones.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'react-foundation-app' }),
      expect.objectContaining({ id: 'react-production-workflow' }),
      expect.objectContaining({ id: 'react-frontend-platform' }),
    ]))
    await expect(scenarios.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'incident-react-render-storm' }),
      expect.objectContaining({ id: 'pr-react-boundaries' }),
    ]))
  })

  test('serves the Git CLI course and its checkpoint quiz', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/git-cli`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as Course
    const summaries = orderedLessons(course)
    expect(summaries).toHaveLength(13)
    expect(summaries[0]).toMatchObject({ slug: 'git-init-status', order: 1 })
    expect(summaries.at(-1)).toMatchObject({ slug: 'git-revert-push', order: 13 })

    const exerciseResponse = await request.get(`${apiBaseUrl}/api/lessons/git-stage-files`)
    await expect(exerciseResponse).toBeOK()
    await expect(exerciseResponse.json()).resolves.toMatchObject({
      exercise: {
        kind: 'Code',
        prompt: expect.stringContaining('Stage README.md'),
        starterCode: expect.stringContaining('Stage only README.md'),
      },
      version: { language: 'Git', framework: 'CLI' },
    })

    const assessment = await request.get(`${apiBaseUrl}/api/experience/assessments/git-cli/git-foundations-1`)
    await expect(assessment).toBeOK()
    const checkpoint = await assessment.json() as { title: string; questions: { correctAnswer?: string }[] }
    expect(checkpoint.title).toBe('Git CLI checkpoint')
    expect(checkpoint.questions).toHaveLength(6)
    expect(checkpoint.questions.every(question => question.correctAnswer == null)).toBe(true)
  })

  test('serves Electrical Engineering Foundations and validates numeric answers with tolerance and units', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/electrical-engineering-foundations`)
    await expect(courseResponse).toBeOK()
    const course = await courseResponse.json() as Course
    const summaries = orderedLessons(course)
    expect(summaries[0]).toMatchObject({ slug: 'ee-charge-voltage-current', order: 1 })
    expect(summaries.at(-1)).toMatchObject({ slug: 'ee-engineering-habits', order: 16 })

    const lessonResponse = await request.get(`${apiBaseUrl}/api/lessons/ee-ohms-law`)
    await expect(lessonResponse).toBeOK()
    await expect(lessonResponse.json()).resolves.toMatchObject({
      exercise: {
        kind: 'Numeric',
        expectedNumeric: 36.36,
        tolerance: 0.1,
        unit: 'mA',
        workedSolution: expect.stringContaining('I = V / R'),
      },
    })

    const learnerId = `ee-numeric-${crypto.randomUUID()}`
    const headers = { 'X-Learner-Id': learnerId }
    const exact = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'ee-ohms-law', answer: '36.36', unit: 'mA' } })
    await expect(exact).toBeOK()
    await expect(exact.json()).resolves.toMatchObject({ passed: true, nextLessonSlug: 'ee-unit-conversion', workedSolution: expect.stringContaining('36.36 mA') })

    const withinTolerance = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'ee-ohms-law', answer: '36.4', unit: 'mA' } })
    await expect(withinTolerance).toBeOK()
    await expect(withinTolerance.json()).resolves.toMatchObject({ passed: true })

    const alternateUnit = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'ee-ohms-law', answer: '0.03636', unit: 'A' } })
    await expect(alternateUnit).toBeOK()
    await expect(alternateUnit.json()).resolves.toMatchObject({ passed: true })

    const outsideTolerance = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'ee-ohms-law', answer: '40', unit: 'mA' } })
    await expect(outsideTolerance).toBeOK()
    await expect(outsideTolerance.json()).resolves.toMatchObject({ passed: false, nextLessonSlug: null })
  })

  test('serves reusable circuit labs without exposing validator answers and validates measurements', async ({ request }) => {
    const dividerResponse = await request.get(`${apiBaseUrl}/api/lessons/ee-voltage-divider`)
    await expect(dividerResponse).toBeOK()
    const divider = await dividerResponse.json() as {
      nextSlug?: string
      exercise: {
        kind: string
        circuit: {
          meterModes: string[]
          nodes: { id: string }[]
          measurements: { meterMode: string; redNode: string; blackNode: string; display: string }[]
          task: Record<string, unknown> & { instruction: string; diagnosisChoices: unknown[] }
        }
      }
    }
    expect(divider.exercise.kind).toBe('Circuit')
    expect(divider.exercise.circuit.meterModes).toEqual(expect.arrayContaining(['V DC', 'Ω']))
    expect(divider.exercise.circuit.nodes.map(node => node.id)).toEqual(expect.arrayContaining(['vin', 'mid', 'gnd']))
    expect(divider.exercise.circuit.measurements).toEqual(expect.arrayContaining([
      expect.objectContaining({ meterMode: 'V DC', redNode: 'mid', blackNode: 'gnd', display: '5.000 V' }),
    ]))
    expect(divider.exercise.circuit.task.instruction).toContain('midpoint voltage')
    expect(divider.exercise.circuit.task).not.toHaveProperty('expectedMeterMode')
    expect(divider.exercise.circuit.task).not.toHaveProperty('expectedRedNode')
    expect(divider.exercise.circuit.task).not.toHaveProperty('expectedBlackNode')
    expect(divider.exercise.circuit.task).not.toHaveProperty('correctDiagnosis')

    const learnerId = `circuit-lab-${crypto.randomUUID()}`
    const headers = { 'X-Learner-Id': learnerId }
    const wrongMode = await request.post(`${apiBaseUrl}/api/submissions/validate`, {
      headers,
      data: { lessonSlug: 'ee-voltage-divider', meterMode: 'Ω', redProbe: 'mid', blackProbe: 'gnd' },
    })
    await expect(wrongMode).toBeOK()
    await expect(wrongMode.json()).resolves.toMatchObject({
      passed: false,
      feedback: expect.stringContaining('meter mode'),
    })

    const correct = await request.post(`${apiBaseUrl}/api/submissions/validate`, {
      headers,
      data: { lessonSlug: 'ee-voltage-divider', meterMode: 'V DC', redProbe: 'mid', blackProbe: 'gnd' },
    })
    await expect(correct).toBeOK()
    await expect(correct.json()).resolves.toMatchObject({
      passed: true,
      nextLessonSlug: 'ee-power-energy',
      circuitReading: { value: 5, unit: 'V', display: '5.000 V' },
      workedSolution: expect.stringContaining('midpoint is half'),
    })
  })

  test('validates the EE troubleshooting capstone measurement and diagnosis together', async ({ request }) => {
    const lessonResponse = await request.get(`${apiBaseUrl}/api/lessons/ee-engineering-habits`)
    await expect(lessonResponse).toBeOK()
    const lesson = await lessonResponse.json() as {
      exercise: {
        kind: string
        circuit: {
          task: { diagnosisChoices: { id: string; text: string }[] }
        }
      }
    }
    expect(lesson.exercise.kind).toBe('Circuit')
    expect(lesson.exercise.circuit.task.diagnosisChoices.map(choice => choice.id)).toEqual(
      expect.arrayContaining(['open-led', 'dead-supply', 'short-r1']),
    )

    const learnerId = `circuit-capstone-${crypto.randomUUID()}`
    const headers = { 'X-Learner-Id': learnerId }
    const wrongDiagnosis = await request.post(`${apiBaseUrl}/api/submissions/validate`, {
      headers,
      data: {
        lessonSlug: 'ee-engineering-habits',
        meterMode: 'V DC',
        redProbe: 'led-anode',
        blackProbe: 'gnd',
        diagnosis: 'dead-supply',
      },
    })
    await expect(wrongDiagnosis).toBeOK()
    await expect(wrongDiagnosis.json()).resolves.toMatchObject({
      passed: false,
      circuitReading: { value: 5, unit: 'V', display: '5.000 V' },
      feedback: expect.stringContaining('diagnosis'),
    })

    const correct = await request.post(`${apiBaseUrl}/api/submissions/validate`, {
      headers,
      data: {
        lessonSlug: 'ee-engineering-habits',
        meterMode: 'V DC',
        redProbe: 'led-anode',
        blackProbe: 'gnd',
        diagnosis: 'open-led',
      },
    })
    await expect(correct).toBeOK()
    await expect(correct.json()).resolves.toMatchObject({
      passed: true,
      nextLessonSlug: null,
      workedSolution: expect.stringContaining('open D1'),
    })
  })

  test('Rust multiple-choice exercises are direct questions with selectable answers', async ({ request }) => {
    const courseResponse = await request.get(`${apiBaseUrl}/api/courses/rust-systems`)
    await expect(courseResponse).toBeOK()
    const summaries = orderedLessons(await courseResponse.json() as Course)
    const lessons = await Promise.all(summaries.map(async summary => {
      const response = await request.get(`${apiBaseUrl}/api/lessons/${summary.slug}`)
      await expect(response).toBeOK()
      return await response.json() as Lesson
    }))

    const questions = lessons.filter(lesson => lesson.exercise.kind === 'MultipleChoice')
    expect(questions.length).toBeGreaterThan(30)
    for (const lesson of questions) {
      expect(lesson.exercise.prompt).toMatch(/\?$/)
      expect(lesson.exercise.correctAnswer).toBeTruthy()
      expect(lesson.exercise.choices.map(choice => choice.id)).toContain(lesson.exercise.correctAnswer)
    }
  })

  test('validates both failed and successful multiple-choice submissions for an isolated guest', async ({ request }) => {
    const learnerId = `playwright-contract-${crypto.randomUUID()}`
    const headers = { 'X-Learner-Id': learnerId }
    const wrong = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'computing-machine-model', answer: 'display' } })
    await expect(wrong).toBeOK()
    await expect(wrong.json()).resolves.toMatchObject({ passed: false, passingTests: 0, totalTests: 1 })

    const correct = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'computing-machine-model', answer: 'memory' } })
    await expect(correct).toBeOK()
    await expect(correct.json()).resolves.toMatchObject({ passed: true, passingTests: 1, totalTests: 1, nextLessonSlug: 'computing-bits-bytes' })
  })

  test('exposes career evidence, capstones, simulations, and enforces the capstone review gate', async ({ request }) => {
    const [competencies, capstones, scenarios] = await Promise.all([
      request.get(`${apiBaseUrl}/api/experience/career/csharp-dotnet/competencies`),
      request.get(`${apiBaseUrl}/api/experience/career/csharp-dotnet/capstones`),
      request.get(`${apiBaseUrl}/api/experience/career/csharp-dotnet/scenarios`),
    ])
    await expect(competencies).toBeOK()
    await expect(capstones).toBeOK()
    await expect(scenarios).toBeOK()
    await expect(competencies.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'programming' }), expect.objectContaining({ id: 'architecture' })]))
    const allCapstones = await capstones.json() as { id: string; rubric: { id: string }[] }[]
    expect(allCapstones).toHaveLength(3)
    await expect(scenarios.json()).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'Incident', evidence: expect.arrayContaining([expect.stringContaining('Dashboard')]) }), expect.objectContaining({ type: 'Code review' }), expect.objectContaining({ title: 'Handle a difficult review conversation' })]))

    const capstone = allCapstones[0]
    const incomplete = await request.post(`${apiBaseUrl}/api/experience/career/csharp-dotnet/capstones/${capstone.id}/review`, { data: {} })
    await expect(incomplete).toBeOK()
    await expect(incomplete.json()).resolves.toMatchObject({ readyForReview: false, missingCriteria: expect.arrayContaining(['A public HTTPS demo link', 'Requirements']), recommendedReviewLessonSlugs: expect.any(Array) })

    const evidence = Object.fromEntries(capstone.rubric.map(item => [item.id, 'Implemented this deliberately, documented the tradeoff, and linked the proof in the repository.']))
    const complete = await request.post(`${apiBaseUrl}/api/experience/career/csharp-dotnet/capstones/${capstone.id}/review`, { data: { demoUrl: 'https://demo.example.com', architectureUrl: 'https://example.com/diagram', repositoryUrl: 'https://github.com/example/project', evidence } })
    await expect(complete).toBeOK()
    await expect(complete.json()).resolves.toMatchObject({ readyForReview: true, missingCriteria: [] })

    const reviewRequest = await request.post(`${apiBaseUrl}/api/experience/career/csharp-dotnet/capstones/${capstone.id}/review-request`, { data: { demoUrl: 'https://demo.example.com', architectureUrl: 'https://example.com/diagram', repositoryUrl: 'https://github.com/example/project', evidence, reviewFocus: 'Please review whether the authorization boundary and its tests make the intended access policy clear.' } })
    // The local API suite intentionally runs without Postgres; a configured deployment creates the community post.
    expect([201, 503]).toContain(reviewRequest.status())
    if (reviewRequest.status() === 201) await expect(reviewRequest.json()).resolves.toMatchObject({ title: expect.stringContaining('Review request'), needsMentor: true })

    const scenarioResponse = await request.get(`${apiBaseUrl}/api/experience/career/csharp-dotnet/scenarios`)
    const scenario = (await scenarioResponse.json() as { id: string; deliverables: string[] }[]).find(item => item.id === 'incident-timeout')!
    const scenarioIncomplete = await request.post(`${apiBaseUrl}/api/experience/career/csharp-dotnet/scenarios/${scenario.id}/review`, { data: { responses: {} } })
    await expect(scenarioIncomplete).toBeOK()
    await expect(scenarioIncomplete.json()).resolves.toMatchObject({ readyForFeedback: false, missingDeliverables: expect.arrayContaining(['Hypothesis and evidence']), recommendedReviewLessonSlugs: expect.any(Array) })
    const scenarioComplete = await request.post(`${apiBaseUrl}/api/experience/career/csharp-dotnet/scenarios/${scenario.id}/review`, { data: { responses: Object.fromEntries(scenario.deliverables.map(item => [item, 'The trace and logs show this hypothesis, so I will mitigate the immediate risk, communicate impact, and verify the preventative follow-up.'])) } })
    await expect(scenarioComplete).toBeOK()
    await expect(scenarioComplete.json()).resolves.toMatchObject({ readyForFeedback: true, missingDeliverables: [] })

    const outcomes = await request.get(`${apiBaseUrl}/api/experience/career/csharp-dotnet/outcomes`, { headers: { 'X-Learner-Id': `outcome-${crypto.randomUUID()}` } })
    await expect(outcomes).toBeOK()
    await expect(outcomes.json()).resolves.toMatchObject({ courseId: 'csharp-dotnet', exerciseAttempts: 0, interviewReadiness: 0, mentorReadiness: 0 })
  })
})
