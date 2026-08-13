# Python Web: zero to staff

This is the editorial contract for Pathway's Python Web track. It is a professional-development curriculum, not a playlist: every lesson has a job-relevant outcome, a short formative check, and a source that can be revisited when the ecosystem changes.

## Course outcomes

By the end, a learner can build, test, secure, deploy, and operate a Python web service; evaluate FastAPI, Flask, and Django against product constraints; and lead an evidence-backed system design decision. The through-line is a learning-service API that gains persistence, authentication, background work, deployment, telemetry, and a staff-level design review.

## Learning sequence

| Stage | Lessons | Outcome | Evidence of learning |
| --- | --- | --- | --- |
| Python foundations | 1–4 | Read and write small, typed, tested functions and model data deliberately. | Greeting function, data model, behavior test. |
| Web foundations | 5–6 | Reason about HTTP and choose a framework from real constraints. | API contract and framework decision record. |
| First API delivery | 7–9 | Build a typed FastAPI endpoint; understand Flask composition and Django product conventions. | Health endpoint and framework comparison. |
| Production basics | 10–12 | Make safe persistence, concurrency, security, and observability decisions. | Expand-contract migration and operational checklist. |
| Project studio | 13–14 | Create a reproducible Python project. | Package layout, `pyproject.toml`, isolated environment. |
| Core Python depth | 15–18 | Use collections, modules, protocols, exceptions, and context managers intentionally. | Refactored domain package with tested seams. |
| Quality and API design | 19–23 | Design stable APIs, test at the right level, and use async without blocking. | Contract tests and a thin FastAPI delivery layer. |
| Data, security, and framework practice | 24–27 | Handle transactions, authorization, Flask composition, and Django side effects safely. | Transactional enrollment flow and security review. |
| Operating services | 28–31 | Design jobs, caching, deployment, and SLO-driven operations. | Idempotent worker, production runbook, and dashboard/alert plan. |
| Staff capstone | 32–33 | Make a reversible, owned, measurable architecture decision. | Design review and ADR for a multi-tenant learning platform. |

## Framework decision guide

FastAPI is the default implementation path because its type-oriented request/response models, validation, and generated OpenAPI support API-first teams. Flask is taught as the intentionally minimal option: it is a good fit where the team wants to compose its own stack and owns the resulting conventions. Django is taught as the product framework: choose it when its ORM, migrations, authentication, admin, and mature conventions reduce delivery risk for a data-heavy product.

The course does not promise that one framework is universally faster or safer. Learners compare team familiarity, domain complexity, async needs, operational ownership, library maturity, and delivery speed, then record the tradeoff.

## Capstone standard

The staff capstone is not a coding puzzle. A passing submission contains:

- A stated problem, users, scale assumptions, non-functional requirements, and success measures.
- A context diagram with ownership and data boundaries.
- API, data, and asynchronous-work contracts, including idempotency and failure behavior.
- Security review covering authentication, authorization, secrets, input handling, and abuse controls.
- Delivery, rollback, observability, SLO, alerting, and on-call ownership plan.
- An ADR that documents alternatives, decision, consequences, rollout, and signals that would trigger reconsideration.

## Source and review policy

Curriculum claims should be reviewed against the sources below before a language or framework release is marked current. The course favors primary documentation and standards because they are durable, attributable, and suitable for a production-quality program. Videos and community explanations may be added as optional enrichment after editorial review, but they are never the sole authority for technical behavior.

- [Python 3.14 tutorial](https://docs.python.org/3.14/tutorial/) — language fundamentals, modules, exceptions, classes, standard library, environments, and packages.
- [Python typing reference](https://docs.python.org/3.14/library/typing.html) — annotations, aliases, protocols, generics, and the distinction between runtime behavior and static checking.
- [FastAPI documentation](https://fastapi.tiangolo.com/) — request validation, dependency patterns, async behavior, and deployment concepts.
- [Flask application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/) — application construction and testable configuration.
- [Django 6.0 database transactions](https://docs.djangoproject.com/en/6.0/topics/db/transactions/) — atomic operations and transaction lifecycle.
- [pytest good integration practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html) — project layout and test discipline.
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — web-application risk categories used in the security module.

Each source is recorded per in-app lesson through its version stamp. Review date: 2026-08-13.
