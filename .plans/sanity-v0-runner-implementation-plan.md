# Sanity V0 Runner Implementation Plan

## Summary

Implement the first real Sanity slice as an Effect TS CLI centered on `sanity run`.

This slice should do one thing well: create a Daytona sandbox for a local candidate, run a configured agent entrypoint inside it against one or more persisted scenarios, deterministically capture only the run output Sanity directly owns, write agent-created output into the configured sink, and return a small `RunResult` describing Sanity orchestration.

Out of scope for this slice: `sanity create`, `sanity delete`, non-Daytona providers, PR/branch candidate sources, external output sinks, canonical reports, command/non-agent drivers, and any `RunPlan` domain object.

## Public Interface And Types

CLI:

```bash
sanity run --profile pr --scenario resolve-buttons --candidate . --artifact-path .sanity/runs/{runId} --json --no-input
sanity run --profile pr --all --candidate .
sanity run --profile pr --scenario resolve-buttons --dry-run --json
```

CLI contract:

```ts
type RunCliInput = {
  readonly profile: ProfileName
  readonly scenario: ReadonlyArray<ScenarioName>
  readonly all: boolean
  readonly candidate: AbsolutePath
  readonly artifactPath: Option.Option<AbsolutePath>
  readonly noArtifacts: boolean
  readonly json: boolean
  readonly noInput: boolean
  readonly dryRun: boolean
}
```

Rules:

```ts
// Valid
--scenario foo
--scenario foo --scenario bar
--all

// Invalid, exit 2
missing --profile
missing --candidate
missing scenario selection
--all plus --scenario
--artifact-path plus --no-artifacts
```

Profile shape, using structured argv instead of shell strings:

```yaml
sandbox:
  provider: daytona
  disposal: delete
  config:
    image: node:22
    autoStopMinutes: 30
    autoArchiveMinutes: 120
    autoDeleteMinutes: 1440

setup:
  - command: npm
    args: ["install"]

app:
  start:
    command: npm
    args: ["run", "dev", "--", "--host", "0.0.0.0"]
  port: 3000
  healthcheckPath: /
  readinessTimeoutSeconds: 90

verifier:
  entrypoint:
    command: codex
    args: ["exec", "--cd", "/workspace"]
    stdin: verifier-input
  timeoutMinutes: 20
  agentOutputDir: .sanity/agent-output

runSurface: graphical
artifactPath: .sanity/runs/{runId}

scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
    runSurface: graphical
```

Core domain types:

```ts
type RunSurface = "headless" | "graphical"
type SandboxDisposal = "delete" | "retain" | "archive"
type RunStatus = "completed" | "failed" | "cancelled"

type Candidate =
  | { readonly _tag: "LocalCandidate"; readonly path: AbsolutePath }

type OutputSink =
  | { readonly _tag: "NoOutput" }
  | { readonly _tag: "LocalArtifactPath"; readonly path: AbsolutePath }
  | { readonly _tag: "ExternalSink"; readonly uri: string } // parsed, rejected in V0

type CommandSpec = {
  readonly command: NonEmptyString
  readonly args: ReadonlyArray<string>
  readonly cwd: Option.Option<SandboxPath>
  readonly env: Readonly<Record<string, string>>
}

type VerifierEntrypoint = {
  readonly command: NonEmptyString
  readonly args: ReadonlyArray<string>
  readonly stdin: "verifier-input" | "none"
  readonly timeout: Duration
  readonly agentOutputDir: Option.Option<SandboxPath>
}

type ScenarioSelection = {
  readonly name: ScenarioName
  readonly path: AbsolutePath
  readonly runSurface: RunSurface
  readonly timeout: Option.Option<Duration>
}

type RunRequest = {
  readonly runId: RunId
  readonly profileName: ProfileName
  readonly candidate: Candidate
  readonly sandbox: {
    readonly provider: "daytona"
    readonly config: DaytonaSandboxConfig
    readonly disposal: SandboxDisposal
  }
  readonly setup: ReadonlyArray<CommandSpec>
  readonly app: Option.Option<AppSpec>
  readonly verifier: VerifierEntrypoint
  readonly scenarios: NonEmptyReadonlyArray<ScenarioSelection>
  readonly outputSink: OutputSink
}
```

Verifier input is deliberately smaller than `RunContext`:

```ts
type VerifierInput = {
  readonly scenarioName: ScenarioName
  readonly scenarioMarkdown: string
  readonly workspacePath: SandboxPath
  readonly appUrl: Option.Option<string>
  readonly agentOutputDir: Option.Option<SandboxPath>
}

// No provider id.
// No disposal.
// No sandbox timers.
// No full RunContext.
// Anti-cheating guidance remains markdown in the scenario.
```

Run result describes Sanity orchestration, not scenario truth:

```ts
type RunResult =
  | {
      readonly status: "completed"
      readonly runId: RunId
      readonly verifier: {
        readonly exitCode: number
        readonly timedOut: boolean
      }
      readonly sandbox: SandboxSummary
      readonly outputSink: OutputSink
      readonly disposal: DisposalOutcome
    }
  | {
      readonly status: "failed"
      readonly runId: RunId
      readonly phase: RunFailurePhase
      readonly message: string
      readonly actionableFix: string
      readonly sandbox: Option.Option<SandboxSummary>
      readonly disposal: Option.Option<DisposalOutcome>
    }
  | {
      readonly status: "cancelled"
      readonly runId: RunId
      readonly sandbox: Option.Option<SandboxSummary>
      readonly disposal: Option.Option<DisposalOutcome>
    }

type DisposalOutcome =
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "Retained" }
  | { readonly _tag: "Archived" }
  | { readonly _tag: "Failed"; readonly message: string }
```

CLI exit codes:

```ts
0  Sanity completed and verifier exited 0
1  Sanity completed but verifier exited nonzero
2  usage/config/schema error
69 Daytona/setup/app/capture/disposal orchestration failure
130 cancelled
```

## Effect Boundaries And Call Graphs

Use Effect `Schema` for all config and output contracts, `Context.Service` plus `Layer` for side effects, and tagged errors for every failure phase.

```ts
class ProjectConfig extends Context.Service<ProjectConfig>()("ProjectConfig", {
  effect: Effect.gen(function* () {
    return {
      loadProfile: (name: ProfileName) => Effect<ProfileFile, ConfigError>,
      loadScenario: (selection: ScenarioSelection) => Effect<string, ConfigError>
    }
  })
}) {}

class DaytonaGateway extends Context.Service<DaytonaGateway>()("DaytonaGateway", {
  effect: Effect.gen(function* () {
    return {
      create: (request: DaytonaCreateRequest) => Effect<SandboxHandle, DaytonaError>,
      uploadCandidate: (sandbox: SandboxHandle, tarball: AbsolutePath) => Effect<void, DaytonaError>,
      runCommand: (sandbox: SandboxHandle, command: CommandSpec) => Effect<CommandExit, DaytonaError>,
      startApp: (sandbox: SandboxHandle, app: AppSpec) => Effect<AppHandle, DaytonaError>,
      startCapture: (sandbox: SandboxHandle, surface: RunSurface) => Effect<CaptureHandle, DaytonaError>,
      stopCapture: (capture: CaptureHandle, sink: OutputSink) => Effect<void, DaytonaError>,
      collectOutput: (sandbox: SandboxHandle, sink: OutputSink) => Effect<void, DaytonaError>,
      delete: (sandbox: SandboxHandle) => Effect<void, DaytonaError>,
      archive: (sandbox: SandboxHandle) => Effect<void, DaytonaError>,
      stop: (sandbox: SandboxHandle) => Effect<void, DaytonaError>
    }
  })
}) {}
```

No provider factory in V0. The only provider boundary is `DaytonaGateway`; adding another provider later means introducing a new explicit union branch, not string dispatch.

Production call graph:

```ts
CLI
  -> RunCommand.parse
  -> RunService.run
    -> ProjectConfig.loadProfile
    -> ScenarioCatalog.resolveSelection
    -> ResolveRunRequest
    -> DryRunPrinter.printRequest when --dry-run
    -> OutputSink.prepare
    -> CandidateArchive.createLocalTar
    -> DaytonaGateway.create
    -> DaytonaGateway.uploadCandidate
    -> SandboxSetup.run
    -> SandboxApp.startAndWait
    -> VerifierInput.renderAndUpload
    -> Capture.withDeterministicCapture
      -> VerifierRunner.invokeEntrypoint
    -> OutputCollector.collectAgentOutput
    -> SandboxDisposal.apply
    -> RunResultPrinter.print
```

Test call graph:

```ts
RunService.run
  -> InMemoryProjectConfig
  -> TempScenarioCatalog
  -> FakeDaytonaGateway
  -> TempOutputSink
  -> TestClockAndIds
```

Run orchestration shape:

```ts
const run = (input: RunCliInput) =>
  Effect.gen(function* () {
    const request = yield* resolveRunRequest(input)

    if (input.dryRun) {
      return yield* DryRunPrinter.print(request)
    }

    const sink = yield* OutputSink.prepare(request.outputSink)
    const candidate = yield* CandidateArchive.createLocalTar(request.candidate)

    return yield* Effect.acquireUseRelease(
      DaytonaGateway.create(request.sandbox.config),
      (sandbox) =>
        Effect.gen(function* () {
          yield* DaytonaGateway.uploadCandidate(sandbox, candidate)

          yield* SandboxSetup.run(sandbox, request.setup)

          const app = yield* SandboxApp.startAndWait(sandbox, request.app)

          const verifierInput = yield* VerifierInputWriter.write({
            request,
            app,
            scenarioMarkdown: yield* ProjectConfig.loadScenario(request.scenarios[0])
          })

          const verifierExit = yield* Capture.withDeterministicCapture(
            sandbox,
            request.scenarios[0].runSurface,
            sink,
            VerifierRunner.invokeEntrypoint(sandbox, request.verifier, verifierInput)
          )

          yield* OutputCollector.collectAgentOutput(sandbox, request.verifier.agentOutputDir, sink)

          return RunResult.completed(request, sandbox, verifierExit, sink)
        }),
      (sandbox, exit) => SandboxDisposal.apply(request.sandbox.disposal, sandbox, exit)
    )
  })
```

Maintainability guardrails:

```ts
// Allowed shape
RunService = orchestration only
Resolver = pure config normalization
DaytonaGateway = Daytona SDK calls only
VerifierRunner = entrypoint invocation only
Capture = computer-use lifecycle only
OutputSink = local/no-output handling only

// Disallowed shape
RunService knows YAML details
DaytonaGateway parses scenario markdown
VerifierRunner deletes sandboxes
OutputSink invents report format
any module grows into a 1k-line coordinator
```

## Implementation Changes

Add `src/` and update `tsconfig.json` to include `src/**/*.ts` and `tests/**/*.ts`.

Use these module boundaries:

```ts
src/domain        branded ids, schemas, tagged errors
src/config        profile/scenario loading and RunRequest resolution
src/cli           @effect/cli command definitions and printers
src/run           RunService orchestration
src/sandbox       DaytonaGateway and sandbox lifecycle helpers
src/verifier      VerifierInput writer and entrypoint runner
src/output        OutputSink preparation and local collection
```

Candidate materialization:

```ts
LocalCandidate(".")
  -> create tarball in temp dir
  -> exclude .git, node_modules, dist, coverage, .sanity/runs
  -> upload to sandbox workspace
```

Verifier invocation:

```ts
env:
  SANITY_VERIFIER_INPUT=/workspace/.sanity/run/verifier-input.md
  SANITY_AGENT_OUTPUT_DIR=/workspace/.sanity/agent-output
  SANITY_WORKSPACE=/workspace
  SANITY_APP_URL=http://localhost:<port> when app exists

stdin:
  verifier-input markdown when entrypoint.stdin === "verifier-input"
```

Graphical capture:

```ts
runSurface === "headless"
  -> never start Computer Use

runSurface === "graphical"
  -> start Computer Use
  -> start recording
  -> invoke verifier
  -> stop recording
  -> download recording into local artifact path when sink is local
  -> stop Computer Use
```

Disposal:

```ts
delete
  -> sandbox.delete()
  -> Deleted

retain
  -> no delete/archive
  -> Retained

archive
  -> sandbox.stop()
  -> sandbox.archive()
  -> Archived
```

No `unknown` disposal state. If Sanity cannot complete the chosen disposal, return `DisposalOutcome.Failed` and mark the orchestration phase as `disposal`.

## Test Strategy And Acceptance

Current test inventory: this repo has prototypes and docs, but no real `src/` test harness. Add Vitest plus `@effect/vitest`, with the default suite optimized for confidence per minute and no Daytona network calls.

Suite shape:

```ts
npm run test        // fast local: pure contracts + fake-provider integration
npm run test:live   // explicit Daytona smoke, skipped unless DAYTONA_API_KEY is set
npm run typecheck
npm run build
```

Critical behaviors the default suite must protect:

```ts
Contract/schema tests
  -> reject stale check/driver/command-check profile shapes
  -> reject shell-string entrypoints; accept structured command/args
  -> reject invalid disposal, runSurface, scenario selection, and artifact-path combinations
  -> prove ExternalSink parses but V0 run rejects it with an actionable error

Pure resolver tests
  -> profile default runSurface applies to scenarios
  -> scenario runSurface overrides profile runSurface
  -> CLI artifact path overrides profile artifactPath
  -> --no-artifacts produces NoOutput
  -> RunRequest contains effective sandbox choice directly
  -> no RunPlan object is produced anywhere

Verifier boundary tests
  -> VerifierInput includes scenario markdown, workspace path, app URL, and agent output dir
  -> VerifierInput does not include provider id, disposal, timers, or full RunContext
  -> anti-cheating text is preserved as ordinary scenario markdown, not parsed as schema

Run orchestration tests with FakeDaytonaGateway
  -> dry-run resolves and prints RunRequest without creating a sandbox
  -> headless run never starts Computer Use
  -> graphical run starts/stops Computer Use and downloads recording when sink is local
  -> verifier exit 1 returns RunResult.status = "completed" and CLI exit code 1
  -> setup/app/provider/capture failures return RunResult.status = "failed" with phase and actionableFix
  -> delete disposal calls delete once
  -> retain disposal does not call delete/archive
  -> archive disposal calls stop before archive
  -> disposal failure is represented as Failed, never unknown
```

Fake provider policy:

```ts
FakeDaytonaGateway records typed events:
  CreatedSandbox
  UploadedCandidate
  RanSetupCommand
  StartedApp
  StartedComputerUse
  StartedRecording
  InvokedVerifier
  StoppedRecording
  DownloadedRecording
  StoppedComputerUse
  DeletedSandbox
  StoppedSandbox
  ArchivedSandbox

Tests assert event order for lifecycle-sensitive behavior.
Tests do not snapshot entire RunResult blobs.
Tests assert only stable fields and typed events.
```

Fixture policy:

```ts
tests/fixtures/minimal-project
  .sanity/profiles/pr.yml
  .sanity/scenarios/resolve-buttons.md
  package.json

tests use temp dirs for artifact paths.
tests use deterministic RunId, Clock, and fake process exits.
no test depends on local user config, global Codex state, or real Daytona unless under test:live.
```

Live smoke test, explicit only:

```ts
DAYTONA_API_KEY=... npm run test:live
  -> create tiny Node fixture sandbox
  -> run a dummy verifier entrypoint
  -> exercise setup, app readiness, verifier invocation, and delete disposal
  -> graphical capture remains optional unless Daytona Computer Use credentials are available
```

This suite should catch the bugs that matter for V0: accidentally reintroducing command drivers, leaking sandbox internals into verifier prompts, deleting retained sandboxes, archiving without stopping, treating verifier findings as Sanity failures, silently ignoring invalid config, and making normal local tests flaky by depending on Daytona.

Acceptance commands before calling implementation complete:

```bash
npm run typecheck
npm run build
npm run test
```

Optional release confidence command:

```bash
DAYTONA_API_KEY=... npm run test:live
```

## Assumptions And References

Defaults:

```ts
runSurface = "headless"
sandbox.disposal = "delete"
verifier.timeoutMinutes = 20
artifactPath = ".sanity/runs/{runId}"
candidate source = local path only
output sinks = local/no-output only in V0
```

References used for implementation grounding:

- [Daytona TypeScript Process SDK](https://www.daytona.io/docs/en/typescript-sdk/process/)
- [Daytona TypeScript Computer Use SDK](https://www.daytona.io/docs/en/typescript-sdk/computer-use/)
- Effect local guidance from `effect-solutions`: `cli`, `testing`, `services-and-layers`, `data-modeling`, and `error-handling`.
