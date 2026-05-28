# Prototype Notes

PROTOTYPE - delete or absorb once the run model becomes production code.

Question answered:

- `RunRequest` reads clearly as user intent, while `RunPlan` reads as executable facts. Keeping both is worth it.
- `RunRequest.checks` should be a non-empty list of requested check names, not a `single` / `all` union. One check is a one-item list, and `--all` can be CLI sugar that expands to the profile's check names before planning.
- Planned agent checks should keep only `instructionsPath`; the markdown file remains the single source of natural-language check instructions.
- `RunRecord` is the right name for the durable artifact. It should snapshot the plan, sandbox, phases, check results, and artifact paths.
- `CheckResult` is cleaner than `CheckRunResult`; reserve "run" for the top-level Sanity invocation.
- One planned check mapping to one `CheckResult` feels inspectable. For setup/app/artifact failures before checks run, explicit skipped check results are easier to read than an empty check list.
- The real Daytona spike confirmed that provision, setup, app, artifact capture, checks, and cleanup are meaningfully separate phases.

Live Daytona spike result:

- Created an ephemeral public Daytona sandbox.
- Started a tiny Node app on port 3000.
- Waited for `/health`.
- Started Computer Use, captured screenshots, started/stopped a recording, downloaded the MP4, ran one command check, and deleted the sandbox.
- Produced `.sanity/prototype-runs/<run-id>/run-record.json`, logs, screenshots, and `recording.mp4`.
- Rewritten in Effect: static scenarios are schema-validated before rendering, the Daytona spike uses `Effect.gen` / `Effect.fn`, wraps external promises in tagged errors, validates `RunRecord` with `Schema.decodeUnknown` before writing, and scopes sandbox cleanup with `Effect.acquireUseRelease`.

Design notes to carry into production:

- Top-level `completedAt` should be after cleanup, not after checks.
- `artifactCapture` should span the whole evidence window, from screenshot/recording start through final screenshot/recording download.
- The actual sandbox snapshot returned by Daytona should be recorded separately from the requested snapshot because the default can resolve to a concrete version.
- Command check logs belong both in the per-check `artifacts` list and the top-level artifact index.
- `RunRecord` probably wants a compact terminal summary separate from the full JSON record.
- Effect's language-service diagnostics are useful here; it caught a nested runtime call in the TUI prototype and pushed the code toward using the surrounding runtime.
