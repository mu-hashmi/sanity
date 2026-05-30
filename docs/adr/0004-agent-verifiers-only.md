# Sanity scenarios are agent verifier scenarios only

Sanity should not include a command scenario or other non-agent scenario type. Commands, scripts, Playwright tests, and setup helpers can still run inside the sandbox, but they are tools used by the verifier rather than first-class Sanity scenarios; CI and unit/integration test suites already own command-oriented verification.

**Consequences**

Every scenario is agent-shaped. Sanity stays focused on producing reviewable run output of an agent exercising the candidate from a user's seat, not becoming another test runner. The verifier may run inside the sandbox, outside the sandbox, or inside an external harness; plans, annotations, and other agent output are optional output owned by the verifier or harness.
