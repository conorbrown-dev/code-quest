# Rust Systems curriculum: zero to staff

The Rust Systems track has 42 sequential lessons. It starts before programming—how instructions, memory, files, processes, networks, HTTP, TLS, and trust boundaries work—then builds durable Rust and staff-engineering judgment.

1. Computing foundations — execution, bits, memory, storage, shells, processes, DNS, HTTP, and HTTPS.
2. Rust foundations — Cargo, functions, bindings, types, control flow, collections, `Option`, `Result`, panic boundaries, debugging, and tests.
3. Project workflow — crates, modules, package boundaries, formatting, linting, documentation, dependency locks, and CI quality gates.
4. Memory-safe Rust — ownership, borrowing, lifetimes, structs, enums, traits, generics, iterators, and smart pointers.
5. Concurrency and systems — threads, `Send`/`Sync`, channels, Tokio async I/O, structured concurrency, backpressure, `unsafe`, and FFI boundaries.
6. Service delivery — Axum, API contracts, input validation, error mapping, transactions, authentication, authorization, and secrets.
7. Quality and operations — integration tests, tracing, metrics, SLOs, profiling, idempotent queues, containers, readiness, and delivery.
8. Systems and staff practice — WebAssembly/embedded trade-offs, architecture decisions, incident learning, mentoring, organizational leverage, and a staff platform capstone.

The path teaches Axum and Tokio as the initial service stack because their types and composition make ownership and async boundaries visible. They are not presented as universal defaults: the learner evaluates Actix, frameworks, databases, queues, WebAssembly, embedded targets, or simpler synchronous designs against constraints, team experience, and operational evidence.

## Source policy

Rust lessons use the maintained [Rust Book](https://doc.rust-lang.org/stable/book/), [Rust Reference](https://doc.rust-lang.org/reference/), [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/), [Tokio tutorial](https://tokio.rs/tokio/tutorial), and [Axum documentation](https://docs.rs/axum/). The initial review stamp is Rust 1.97 / Edition 2024, reviewed 2026-08-18. Curriculum updates must keep lesson order contiguous, maintain explicit `NextSlug` links, and retain a maintained source/version stamp.
