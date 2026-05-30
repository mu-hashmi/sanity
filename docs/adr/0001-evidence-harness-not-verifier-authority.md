# Sanity is an output harness, not a verifier authority

Sanity's core should boot the candidate in a Daytona sandbox, make the sandboxed candidate available to an agent verifier or verifier harness, and return a RunResult describing the orchestration outcome. The verifier may run inside the sandbox, outside the sandbox, or inside an external harness; it owns any scenario conclusion it states, while output storage and presentation belong to the configured output sink or external verifier harness.

**Considered Options**

- CI-style gate first: rejected because formal merge policy is a later layer, not the first product spine.
- Contributor output packet only: rejected because replaying a self-authored scenario checks determinism more than meaning.
- Typed action API: rejected because it would restrict agents, scripts, desktop apps, terminal flows, libraries, and future verifier runtimes.
- Non-agent command scenarios: rejected because CI and test suites already cover command-oriented verification; Sanity is for agent verification from a user's seat.

**Consequences**

Optional helpers such as opening a visible browser, exposing a debugging port, or giving scenario mechanics are affordances. They must not become the core contract. The core contract is sandboxed candidate execution, verifier access, and RunResult.

Source sessions: `019e6f46-fe76-7830-ac5b-b8c91ff5986b`, `019e6fe3-96d8-7c63-be0f-4f3c0fb9d1e6`, and the verifier-harness session on 2026-05-29.
