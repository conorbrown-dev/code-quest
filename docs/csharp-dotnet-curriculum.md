# C# / .NET curriculum: zero to staff

The C#/.NET track is intentionally sequential. It starts with the machinery a newcomer needs to reason about a web application, then adds programming, modeling, backend delivery, operations, and technical leadership. The application currently contains 42 lessons in these sections:

1. Computing & internet foundations — CPU, memory, storage, processes, packets, IP/ports, DNS, HTTP, HTTPS/TLS, browser/server trust boundaries, latency, and retries.
2. Programming foundations — source and runtime behavior, variables, data types, expressions, branching, iteration, methods, nullability, parsing, collections, debugging.
3. Objects & modeling — why objects exist, reference semantics, encapsulation, constructors and invariants, records, interfaces, composition, and deliberately sealed concrete types.
4. Modern C# — switch expressions, primary constructors, ranges, LINQ, and async I/O.
5. Web APIs — endpoint style, contract-first HTTP design, validation, authentication, and authorization.
6. Data, testing & delivery — transactions/outbox, test layers, cancellation, resilient `HttpClient` use, SLOs, deployment, security, and performance investigation.
7. Staff practice — architecture decisions, rollout and ownership, mentoring, incident learning, and organizational leverage.

Each lesson is small enough to teach and assess one idea. The path deliberately favors an evidence-backed tradeoff over a universal rule: for example, `sealed` is the default for a concrete service not designed for extension, while frameworks and intentionally extensible libraries may need an open type.

## Source policy

Version stamps in the lesson API link directly to their current source. The curriculum uses primary or maintained technical documentation, including:

- [MDN: How the web works](https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Web_standards/How_the_web_works) and [HTTP overview](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [Microsoft: C# type system](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/), [classes](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/types/classes), and [C# 14](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14)
- [Microsoft: ASP.NET Core HTTP requests](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/http-requests?view=aspnetcore-10.0) and [HttpClient guidelines](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/http/httpclient-guidelines)

Curriculum changes should preserve a contiguous lesson order, explicit `NextSlug` links, and a source/version stamp. The API and Playwright tests assert those properties so a content edit cannot silently break the learning flow.
