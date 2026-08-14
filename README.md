# Pathway

A full-stack learning platform prototype for teaching C#/.NET from first principles through staff-level engineering.

## Stack

- **Frontend:** Vite, React 19, TypeScript, Tailwind CSS 4, and Lucide icons.
- **Backend:** ASP.NET Core on .NET 10, with an OpenAPI endpoint and a clean submission-validation contract.
- **Production evaluation:** a dedicated, sandboxed worker service. Never execute learner code in the web server process.

## Run locally

```sh
cd frontend && npm run dev
cd backend/Pathway.Api && dotnet run
```

The Vite dev server proxies `/api` to the API at `http://localhost:5100`.

## Browser smoke tests

Install the Playwright browser once, then run the same suite locally or against Railway:

```sh
cd frontend
npx playwright install chromium

# Local: start the API in another terminal first.
npm run test:e2e

# Production
PLAYWRIGHT_BASE_URL=https://code-quest-production.up.railway.app \
PLAYWRIGHT_API_BASE_URL=https://api-production-7d4e.up.railway.app \
npm run test:e2e
```

The suite verifies API health/current curriculum metadata and that a guest learner can load and interact with the first lesson. It intentionally does not create production accounts or execute code exercises.

## Deploy on Railway

See [Railway + GitHub setup](docs/railway-github-setup.md) for the one-time service configuration and push-to-deploy checklist.
Use the [production launch runbook](docs/launch-runbook.md) before opening the service to public learners.

Create the web, API, Keycloak, and private Modal broker services from this repository. The web, API, and broker use Railpack; only the Keycloak service uses a Dockerfile:

| Service | Root directory | Config-as-code path | Required variables |
| --- | --- | --- | --- |
| `pathway-web` | `/frontend` | `/frontend/railway.toml` | `VITE_API_BASE_URL=https://<your-api-domain>`, `VITE_KEYCLOAK_URL=https://<keycloak-domain>`, `VITE_KEYCLOAK_REALM=pathway`, `VITE_KEYCLOAK_CLIENT_ID=pathway-web` **at build time** |
| `pathway-api` | `/backend/Pathway.Api` | `/backend/Pathway.Api/railway.toml` | `CORS_ORIGINS=https://<your-web-domain>`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `KEYCLOAK_AUTHORITY=https://<keycloak-domain>/realms/pathway`, `KEYCLOAK_AUDIENCE=pathway-api` |
| `pathway-modal-broker` | `/modal-broker` | `/modal-broker/railway.toml` | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `RUNNER_SHARED_SECRET` — private only, no public domain |

Generate a public domain for both services. Set the API URL before deploying the web service, because Vite embeds `VITE_*` values in its static build. The API service binds to Railway’s injected `PORT` and exposes `/health` for the Railway deployment check.

## Keycloak authentication

Pathway uses Keycloak as the in-house identity provider. Create a **public OIDC client** named `pathway-web`, enable Standard Flow with PKCE (`S256`), and configure valid redirect URIs and web origins for both your local Vite URL and Railway web domain. Keycloak owns user registration, passwords, MFA, sessions, and logout; the SPA never sends a password to Pathway.

Copy [frontend/.env.example](frontend/.env.example) to `frontend/.env.local` for local configuration. The backend variables are shown in [appsettings.Development.json.example](backend/Pathway.Api/appsettings.Development.json.example); do not commit a populated local settings file.

### Run Keycloak locally

The repository includes a complete local Keycloak stack and an importable `pathway` realm. Docker is the only prerequisite.

```sh
cp .env.keycloak.example .env.keycloak
# Edit .env.keycloak and replace both passwords.
docker compose --env-file .env.keycloak -f docker-compose.keycloak.yml up -d
```

Open `http://localhost:8080/admin` and sign in with `KEYCLOAK_ADMIN_USERNAME` and `KEYCLOAK_ADMIN_PASSWORD`. The supplied realm import enables self-registration, contains the `pathway-web` public SPA client with PKCE S256, and adds `pathway-api` to its access-token audience.

Then create `frontend/.env.local` from the example and configure the API variables for the same local realm:

```sh
VITE_KEYCLOAK_URL=http://localhost:8080
VITE_KEYCLOAK_REALM=pathway
VITE_KEYCLOAK_CLIENT_ID=pathway-web

KEYCLOAK_AUTHORITY=http://localhost:8080/realms/pathway
KEYCLOAK_AUDIENCE=pathway-api
```

To stop local Keycloak without deleting identities, use `docker compose -f docker-compose.keycloak.yml down`. Add `-v` only when you intentionally want to erase the local Keycloak database.

### Deploy Keycloak on Railway

Create a third Railway service named `pathway-keycloak` from this repository:

| Setting | Value |
| --- | --- |
| Root directory | `/infra/keycloak` |
| Config-as-code path | `/infra/keycloak/railway.toml` |
| Public domain | Generate one; this becomes `https://<keycloak-domain>` |

Attach a **dedicated** Railway Postgres database to this service (do not use the Pathway application database). In the Keycloak service Variables tab, set:

```sh
KC_BOOTSTRAP_ADMIN_USERNAME=your-admin-username
KC_BOOTSTRAP_ADMIN_PASSWORD=<long unique secret>
KC_DB=postgres
KC_DB_URL=jdbc:postgresql://${{KeycloakPostgres.PGHOST}}:${{KeycloakPostgres.PGPORT}}/${{KeycloakPostgres.PGDATABASE}}
KC_DB_USERNAME=${{KeycloakPostgres.PGUSER}}
KC_DB_PASSWORD=${{KeycloakPostgres.PGPASSWORD}}
```

After the first Keycloak deployment, open its admin console, select realm `pathway`, and add the Railway frontend URL to **Valid redirect URIs** (`https://<web-domain>/*`) and **Web origins** (`https://<web-domain>`). The realm import deliberately ignores existing realms on later restarts, so make production realm changes in the Keycloak admin console or manage them with a separate Keycloak configuration workflow.

Create an API audience/client named `pathway-api` and add it to the access-token audience for `pathway-web`. The API validates issuer, signature, audience, expiration, and subject through Keycloak’s OIDC metadata. It stores progress and submissions under `keycloak:<sub>` in Postgres. In production the progress and submission endpoints require an authenticated Keycloak bearer token; guest mode is retained only when Keycloak is not configured for local exploration.

Add a Railway Postgres service and reference its `DATABASE_URL` from `pathway-api`. The API creates the progress and submission tables on startup.

For production code exercises, create a fourth private Railway service named `pathway-modal-broker`, with root directory `/modal-broker` and config path `/modal-broker/railway.toml`. Do not assign it a public domain. Create a Modal API token in the Modal dashboard and set `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` only on this private broker. Generate one long random `RUNNER_SHARED_SECRET`, set it on the broker, and set the identical value as `EVALUATOR_SHARED_SECRET` on `pathway-api`. Finally set `EVALUATOR_URL=http://pathway-modal-broker.railway.internal:8080` on `pathway-api` (use the private hostname Railway displays for the broker if it differs). The broker creates a fresh Modal gVisor sandbox for each submission with no outbound network, no Railway credentials, 0.5 CPU, 512 MiB memory, a 12-second execution limit, and bounded output.

The public API forwards only code exercises to `POST /evaluate` with `{ "lessonSlug", "code" }` and an internal shared-secret header; the broker returns the `ValidationResult` shape from the API. When `ASPNETCORE_ENVIRONMENT=Production`, code exercises deliberately fail closed unless the evaluator URL and secret are configured. The in-process deterministic validator exists only for local content development.

## Included experience

- A data-driven C# 14/.NET 10 course API with a review date and official source attached to every lesson.
- A lesson engine that supports multiple-choice and code-writing exercises, deterministic answer feedback, gating, next-lesson navigation, and browser-persisted completion state.
- A curriculum starter path spanning program basics, variables, `if`, records, sealed concrete API types, cancellation, and switch expressions.
- An embedded editor with reset, copy, tab indentation, and `Cmd/Ctrl + Enter` test execution.

## Content architecture

Course content is authored in `backend/Pathway.Api/Program.cs` as typed, versioned lesson records. Each lesson has concept copy, an example, requirements, a supported exercise type, tests or choices, hint, progression link, and a `C# 14` / `.NET 10` review stamp. This is intentionally structured so it can next move to a database-backed content-management workflow without changing the learner API shape.

`GET /api/courses` returns the language-track catalog and `GET /api/courses/{courseId}` returns a course’s modules. The first catalog item is C#/.NET; adding another language means authoring another course with its own version stamp and lesson set, not changing the lesson engine.

The local API first parses submitted C# with Roslyn and returns syntax diagnostics, then applies deterministic lesson checks. This makes authoring feedback useful without executing untrusted code. Replace the lesson checks with the isolated evaluator worker before accepting arbitrary production submissions.
