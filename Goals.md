# Rust learning path

## Objective

Add Rust as a first-class learning path alongside C#/.NET and Python Web. The path must take a learner from no computer background through Rust programming, production service delivery, systems knowledge, and Staff Engineer judgment.

## Current bearings (2026-08-18)

- Curriculum is authored as typed lesson records in `backend/Pathway.Api/Program.cs`.
- C# and Python each expose a course definition, ordered lessons, modules, version/source stamps, and catalog entries through the course API.
- `backend/Pathway.Api/CareerReadinessCatalog.cs` separately scopes capstones, scenarios, competencies, and recommendations by course ID; Rust needs equivalent career content, not only lessons.
- `frontend/src/App.tsx` has hard-coded C#/Python onboarding buttons, track-menu items, language badges, page-title logic, and project-stage copy. These need a data-driven or Rust-aware extension.
- API and Playwright contracts in `frontend/e2e` currently enumerate only `csharp-dotnet` and `python-web`; Rust needs catalog, course-shape, navigation, and track-switching coverage.
- Learner code execution is fail-closed through the Modal broker. The current evaluator allowlist/fixtures cover C# and Python only (`modal-broker/src/evaluator.mjs`, `modal-broker/src/server.mjs`, and `evaluator/Pathway.Evaluator`). Rust code lessons require an isolated Rust toolchain image and deterministic fixtures before code exercises can pass.
- Existing curriculum docs establish the expected zero-to-staff arc, contiguous lesson ordering, explicit next links, and maintained source/version stamps.

## Planned work

### 1. Curriculum design

- [x] Define a 42-lesson Rust sequence with the same progression shape: computer and internet foundations; Rust foundations; Cargo/project workflow; ownership, borrowing, lifetimes, traits, generics, and error handling; testing and async; HTTP/API and persistence; security, performance, observability, deployment; staff architecture, incidents, mentoring, and organizational leverage.
- [x] Use Rust-specific production choices deliberately (Cargo/clippy/rustfmt, Tokio, Axum or Actix trade-offs, SQLx/Diesel trade-offs, structured concurrency, `Result`/`Option`, Send/Sync, unsafe boundaries, WebAssembly/embedded/systems considerations).
- [x] Add a curriculum document with primary source links and a Rust version/toolchain review stamp.

### 2. Backend/API

- [x] Add Rust lesson records, ordered aggregation, `RustCourse`, `Courses`, catalog item, and slug lookup entries.
- [x] Add Rust career-readiness capstones, scenarios, recommendations, and course-specific assessment/checkpoint content.
- [x] Keep all lesson orders contiguous and `NextSlug` links valid; ensure module levels still classify beginner/professional/staff correctly.

### 3. Safe evaluation

- [x] Add a Rust execution profile to the evaluator broker with a pinned, minimal Rust image/toolchain and network disabled.
- [x] Add bounded deterministic fixtures for representative Rust code lessons; never execute arbitrary learner code in the API process.
- [x] Add broker/evaluator tests for valid Rust submissions, rejection/limits, and fail-closed behavior when the toolchain is unavailable.

### 4. Frontend and learner experience

- [x] Add Rust to onboarding and the authenticated track switcher without leaking progress between courses.
- [x] Render Rust badge/title/version/framework text and Rust project-studio stage descriptions.
- [ ] Prefer catalog-driven track presentation so future paths do not require another hard-coded branch.

### 5. Verification and rollout

- [x] Extend API contract tests to require the Rust catalog item, course shape, lesson ordering, representative next links, and source stamps.
- [ ] Extend browser tests for onboarding selection, authenticated/guest switching, Rust page title, and progress isolation.
- [x] Run backend build/tests, frontend typecheck/build, and evaluator tests; document any environment-dependent Rust toolchain requirement.

## Acceptance criteria

1. `GET /api/courses` lists C#, Python, and Rust; `GET /api/courses/rust-systems` returns a complete, contiguous zero-to-staff curriculum.
2. Rust has the same career-readiness surfaces as the existing paths and recommendations resolve to Rust lessons.
3. A learner can select Rust on first-run onboarding and switch to/from it later with isolated progress.
4. Rust code exercises run only in the isolated evaluator and have deterministic pass/fail tests; unavailable evaluation never unlocks a lesson.
5. Automated API, UI, backend, and evaluator checks pass, and Rust source/version links are visible in lesson responses.

## Risks / decisions to resolve during implementation

- Rust toolchain image size and build time may require a small fixture set initially; keep the execution profile pinned and reproducible.
- Framework choice should teach trade-offs rather than imply one universal Rust web stack; initial default can be Axum with explicit alternatives.
- The existing frontend is branch-heavy; refactoring track metadata to catalog-driven rendering may reduce regression risk while adding Rust.
