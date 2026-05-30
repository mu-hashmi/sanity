# Use profile files plus markdown scenario instructions

Sanity scenarios should be represented as `.sanity/profiles/<profile>.yml` files plus `.sanity/scenarios/*.md` instruction files. A profile is the runnable unit: it owns sandbox, setup, app boot, verifier entrypoint, run surface, a thin scenario catalog, and output sink defaults; each scenario catalog entry points at exactly one markdown instruction file.

**Considered Options**

- One large scenario YAML file: rejected because it mixed behavioral claim, setup, app boot, output policy, and process metadata.
- A three-schema split across scenario, agent output, and target: rejected because it made simple scenarios feel over-modeled.
- Command scenarios: rejected because Sanity is for sandboxed agent verification; commands and scripts remain tools the verifier can run inside the sandbox.
- One root `.sanity/sanity.yml` with inline profiles: rejected because profile files are clearer runnable boundaries.
- Inline `instructions` plus `instructionsPath`: rejected because it duplicates the natural-language source of truth.
- Scenario metadata fields like `author`, `process`, `trustStrength`, `reviewerRead`, and `stakes`: rejected because they made the runnable format explain itself instead of staying small.
- Required/optional output lists and fine-grained output booleans: rejected in favor of an output sink.

**Consequences**

Persisted scenario instructions live under `.sanity/scenarios/*.md`; `.sanity/checks` is not used. Profiles use a thin scenario catalog rather than a bare list so each scenario can carry run-shape settings such as an explicit instruction path, timeout, and run surface override. Run surface is deterministic config, not prose: Sanity starts graphical desktop/browser capture only when the effective run surface is graphical. Profiles may provide output sink defaults, but Sanity does not model fine-grained output toggles or mandatory baseline run output envelopes in the core scenario/profile format; users can instruct the verifier or external agent harness to generate, store, embed, or omit output as needed. `RunRequest.scenarios` is a non-empty list of requested scenario names. `--all` is CLI sugar that expands to the profile's scenario names before execution. Trust/provenance, non-agent command scenarios, and merge-policy concepts are not part of the current profile/scenario schema.

Source sessions: `019e6f46-fe76-7830-ac5b-b8c91ff5986b` and `019e6fe3-96d8-7c63-be0f-4f3c0fb9d1e6`.
