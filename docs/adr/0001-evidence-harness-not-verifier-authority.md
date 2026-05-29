# Sanity is an evidence harness, not a verifier authority

Sanity's core should boot candidate code in a Daytona sandbox, run arbitrary verifier commands, capture requested evidence, and write a RunRecord. The verifier owns any scenario conclusion it states; Sanity records process status, artifacts, phases, and enough context for a human or agent to inspect the evidence.

**Considered Options**

- CI-style gate first: rejected because formal merge policy is a later layer, not the first product spine.
- Contributor evidence packet only: rejected because replaying a self-authored scenario checks determinism more than meaning.
- Typed action API: rejected because it would restrict agents, scripts, desktop apps, terminal flows, libraries, and future verifier runtimes.

**Consequences**

Optional helpers such as opening a visible browser, exposing a debugging port, or giving scenario mechanics are affordances. They must not become the core contract. The core contract is arbitrary verifier command plus evidence capture plus RunRecord.

Source sessions: `019e6f46-fe76-7830-ac5b-b8c91ff5986b`, `019e6fe3-96d8-7c63-be0f-4f3c0fb9d1e6`, and the verifier-harness session on 2026-05-29.
