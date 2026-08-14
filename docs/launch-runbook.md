# Production launch runbook

## Release gates

- Confirm Railway deployments for Web, Api, KeyCloak, ModalBroker, and both Postgres services are successful.
- Open `https://<api-domain>/ready`; it must return `200` and `{"status":"ready"}`.
- Create a disposable learner account and verify registration, sign-in, sign-out, persisted progress, a passing code submission, saved project work, and community posting.
- Confirm the API uses the Modal broker private URL and that the broker has the current `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, and `RUNNER_SHARED_SECRET`.
- Confirm Keycloak redirect URIs and web origins list only the production web origin. Remove localhost entries from the production realm.

## Monitoring and response

- Railway health checks cover `/` (Web), `/health` (Api and ModalBroker), and `/realms/master` (Keycloak). Monitor `GET /ready` separately because it verifies the application database.
- Create uptime checks for the web root, API `/health`, API `/ready`, and the Keycloak realm endpoint. Alert the operator on two consecutive failures.
- Enable Railway log retention and configure an error-tracking provider before broad public traffic. Never send learner code, bearer tokens, authorization headers, or Modal credentials to telemetry.
- Configure a Modal spend alert and a monthly budget ceiling. Review sandbox usage daily during the first launch week.

## Data protection and recovery

- Keep the application Postgres and Keycloak Postgres databases separate.
- Enable or schedule provider backups, retain at least seven daily restore points, and perform one documented restore rehearsal before launch.
- Limit Railway project access to named operators, use MFA for Railway, GitHub, Modal, and Keycloak admins, and rotate service credentials after any suspected exposure.
- The site has draft privacy, terms, and support pages. Replace the operator, legal entity, jurisdiction, retention, and security-contact placeholders after legal review.

## Operational controls

- API rate limits: public reads 180/minute, learner traffic 90/minute, submissions 10/minute, coaching 20/minute, and community writes 15/minute. Limits partition by signed-in user, otherwise source IP.
- Code execution fails closed when the broker is unavailable. Never bypass the Modal broker by executing learner code in API, Web, or Railway processes.
- Keep the legacy Railway `Evaluator` service until a signed production learner completes a Modal-backed code exercise. Then remove it from Railway; it is no longer on the API route.
- Set a real support mailbox and a private security-reporting channel before public launch. GitHub Issues is only an interim support route.
