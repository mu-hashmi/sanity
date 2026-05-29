# Use profile files plus markdown check instructions

Sanity scenarios should be represented as `.sanity/profiles/<profile>.yml` files plus `.sanity/checks/*.md` instruction files. A profile is the runnable unit: it owns sandbox, setup, app boot, checks, and artifact policy; each agent check points at exactly one markdown instruction file.

**Considered Options**

- One large scenario YAML file: rejected because it mixed behavioral claim, setup, app boot, artifact policy, and process metadata.
- A three-schema split across scenario, check, and target: rejected because it made simple checks feel over-modeled.
- One root `.sanity/sanity.yml` with inline profiles: rejected because profile files are clearer runnable boundaries.
- Inline `instructions` plus `instructionsPath`: rejected because it duplicates the natural-language source of truth.
- Scenario metadata fields like `author`, `process`, `trustStrength`, `reviewerRead`, and `stakes`: rejected because they made the runnable format explain itself instead of staying small.
- `evidence.required` / `evidence.optional`: rejected in favor of simple profile-level artifact booleans for now.

**Consequences**

`RunRequest.checks` is a non-empty list of requested check names. `--all` is CLI sugar that expands to the profile's check names before planning. `RunPlan` contains executable facts and paths, not duplicated markdown instruction bodies. Trust/provenance and merge-policy concepts are not part of the current profile/check schema.

Source sessions: `019e6f46-fe76-7830-ac5b-b8c91ff5986b` and `019e6fe3-96d8-7c63-be0f-4f3c0fb9d1e6`.
