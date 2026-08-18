import { expect, test } from '@playwright/test'

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://127.0.0.1:5100'

type LessonSummary = { slug: string; order: number }
type Course = { id: string; modules: { lessons: LessonSummary[] }[] }
type Lesson = LessonSummary & { nextSlug?: string; exercise: { kind: string; correctAnswer?: string; choices: { id: string }[] } }

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
      expect.objectContaining({ id: 'csharp-dotnet', available: true }),
      expect.objectContaining({ id: 'python-web', available: true }),
      expect.objectContaining({ id: 'rust-systems', available: true }),
    ]))
  })

  test('returns 404 for unknown curriculum resources', async ({ request }) => {
    expect((await request.get(`${apiBaseUrl}/api/courses/not-a-course`)).status()).toBe(404)
    expect((await request.get(`${apiBaseUrl}/api/lessons/not-a-lesson`)).status()).toBe(404)
    expect((await request.post(`${apiBaseUrl}/api/submissions/validate`, { data: { lessonSlug: 'not-a-lesson', answer: 'anything' } })).status()).toBe(404)
  })

  for (const courseId of ['csharp-dotnet', 'python-web', 'rust-systems']) {
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

  test('validates both failed and successful multiple-choice submissions for an isolated guest', async ({ request }) => {
    const learnerId = `playwright-contract-${crypto.randomUUID()}`
    const headers = { 'X-Learner-Id': learnerId }
    const wrong = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'internet-devices', answer: 'screen' } })
    await expect(wrong).toBeOK()
    await expect(wrong.json()).resolves.toMatchObject({ passed: false, passingTests: 0, totalTests: 1 })

    const correct = await request.post(`${apiBaseUrl}/api/submissions/validate`, { headers, data: { lessonSlug: 'internet-devices', answer: 'memory' } })
    await expect(correct).toBeOK()
    await expect(correct.json()).resolves.toMatchObject({ passed: true, passingTests: 1, totalTests: 1, nextLessonSlug: 'internet-bits-bytes' })
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
