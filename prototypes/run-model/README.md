# Run Model Prototype

PROTOTYPE - delete or absorb once the run model is understood.

Question: does `RunRequest -> RunPlan -> RunRecord` with one `CheckResult` per planned check feel like the right vocabulary before the real implementation starts?

This prototype has two pieces:

- `npm run prototype:run-model` renders static sample records for dry-run, passed command check, app-before-check failure, and agent-check failure cases.
- `npm run prototype:daytona-spike` creates a real Daytona sandbox, starts a tiny app, waits for a healthcheck, captures logs/screenshots/recording, runs one command check, and writes a prototype `RunRecord`.

The Daytona spike requires `DAYTONA_API_KEY` in the environment. Do not commit API keys or generated `.sanity/prototype-runs/*` artifacts.
