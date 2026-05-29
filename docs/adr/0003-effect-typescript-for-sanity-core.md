# Use Effect TypeScript for the Sanity core

Sanity should be built in TypeScript with Effect as the core programming model. The project is mostly orchestration of unsafe real-world work: sandbox lifecycle, process execution, timeouts, recording, cleanup, artifact writes, and structured records; Effect gives typed errors, scoped cleanup, Schema-backed data models, and diagnostics that match that problem shape.

**Considered Options**

- Plain TypeScript with `async` and ad hoc `try` / `catch`: rejected because cleanup and failure classification will spread across the runner.
- Zod and Commander as the old CLI surface: removed because the project reset around Effect Schema prototypes.
- `@effect/schema`: rejected because Schema is part of `effect` in current Effect versions.

**Consequences**

Effect Schema is the source of truth for run-model shapes. External calls should be wrapped in typed errors, sandbox cleanup should use scoped acquire/use/release patterns, and agents should consult `effect-solutions` before writing Effect code.

Source session: `019e6fe3-96d8-7c63-be0f-4f3c0fb9d1e6`.
