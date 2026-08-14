# End-to-end testing

The Playwright suite protects the user journeys that are easiest to regress: onboarding, course selection, locked and unlocked lessons, answer and code submission feedback, guest progress isolation, workspaces, project saving, coaching, community entry points, and the curriculum API contract.

## Local and CI suite

From `frontend`:

```sh
npm run test:e2e
```

The suite starts Vite and expects the API at `http://127.0.0.1:5100`. Start the API in another terminal when running locally:

```sh
cd backend/Pathway.Api
ASPNETCORE_URLS=http://127.0.0.1:5100 dotnet run --no-launch-profile
```

GitHub Actions runs the complete local browser suite on every pull request and `main` push. It uses isolated guest learner identifiers and only local services; it does not use production credentials or mutate production data.

## Authenticated production smoke

Protected Keycloak behavior needs a dedicated non-human test learner and a short-lived Playwright storage-state file. Never place the test learner password, a token, or the generated storage-state file in the repository.

Run only after provisioning those secrets in the CI secret store:

```sh
PLAYWRIGHT_BASE_URL=https://your-web-service.up.railway.app \
PLAYWRIGHT_AUTH_STORAGE_STATE=/secure/path/playwright-auth.json \
npx playwright test e2e/production-auth.spec.ts
```

These tests are deliberately skipped unless both variables are present. They check that a signed-in learner can reach protected progress UI and open their profile menu; they do not sign out, submit lessons, or create community content against production.

## Coverage expectations for new work

Every new learner-facing flow needs at least one passing path and one user-visible failure or guardrail path. Every course change must preserve contiguous ordering and an exact `nextSlug` chain; the API suite checks full ordering plus first, second, midpoint, and final navigation links without exhausting the public read rate limit.
