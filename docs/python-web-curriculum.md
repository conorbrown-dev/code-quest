# Python Web curriculum: zero to staff

The Python Web track now has 42 sequential lessons. It follows the same durable learning arc as the C#/.NET track, while keeping its Python and framework-specific depth:

1. Computing & internet foundations — computer execution, bytes/text, processes, networks, DNS, HTTP, HTTPS/TLS, trust boundaries, and safe retries.
2. Python foundations — values, functions, data models, tests, errors, and HTTP semantics.
3. Project and core Python — package layout, virtual environments, typing, control flow, collections, imports, objects, protocols, composition, exceptions, and resource safety.
4. Framework and API delivery — FastAPI, Flask, and Django trade-offs; API contracts; async correctness; persistence; authentication and authorization.
5. Production systems — queues, idempotency, caching, containers, health checks, observability, SLOs, and system design.
6. Staff practice — constraints, trade-offs, durable architecture decisions, ownership, and organizational leverage.

The framework choice remains intentional rather than prescriptive: FastAPI is strong for typed async APIs and generated OpenAPI, Flask for explicit lightweight composition, and Django when its integrated ORM, migrations, auth, admin, and conventions accelerate the product.

Lesson version stamps link to the maintained [Python documentation](https://docs.python.org/3.14/), [FastAPI documentation](https://fastapi.tiangolo.com/), [Flask documentation](https://flask.palletsprojects.com/en/stable/), [Django documentation](https://docs.djangoproject.com/en/6.0/), and [MDN web foundations](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works).
