# Railway + GitHub setup

Railway deploys this monorepo through its GitHub integration. GitHub Actions verifies builds first; Railway then deploys the changed service when a verified commit is pushed to `main`.

## One-time Railway project setup

1. Push this repository to GitHub and connect it to a new Railway project.
2. Add three services from the same GitHub repository: `pathway-web`, `pathway-api`, and `pathway-keycloak`.
3. In each service’s **Source** settings, select branch `main`, then set the root directory and config-as-code path below.

| Service | Root directory | Config-as-code path | Public domain |
| --- | --- | --- | --- |
| `pathway-web` | `/frontend` | `/frontend/railway.toml` | Yes |
| `pathway-api` | `/backend/Pathway.Api` | `/backend/Pathway.Api/railway.toml` | Yes |
| `pathway-keycloak` | `/infra/keycloak` | `/infra/keycloak/railway.toml` | Yes |

4. Add two Railway Postgres services: one for `pathway-api`, and a **separate** one for `pathway-keycloak`.
5. Set the variables in the main [README](../README.md#deploy-keycloak-on-railway) for every service. Generate public domains before setting the cross-service URLs.
6. In Keycloak, add the Railway web URL as a redirect URI and web origin for `pathway-web`.

## Push behavior

- Pull requests and pushes to `main` run `.github/workflows/verify.yml`.
- Railway’s GitHub integration deploys on pushes to `main`.
- `watchPatterns` in each `railway.toml` limit deploys to changes under that service’s directory.
- Do **not** add a Railway API token to GitHub Actions: Railway already has the GitHub deployment integration and remains the deploy authority.

## First production deploy order

1. Deploy Keycloak and its Postgres database; generate its public domain.
2. Deploy Pathway API and its Postgres database with `KEYCLOAK_AUTHORITY` and `KEYCLOAK_AUDIENCE` configured.
3. Deploy Pathway web last, because `VITE_*` values are baked into the static build.

After that, pushes to `main` deploy the affected service automatically.
