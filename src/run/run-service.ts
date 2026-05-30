import { Cause, Effect, Exit, Option, Result } from "effect"
import { resolveRunRequest, workspacePath } from "../config/resolve.js"
import {
  type ConfigError,
  RunFailure,
  type CommandExit,
  type DisposalOutcome,
  type OutputSink,
  type RunCliInput,
  type RunOutcome,
  type RunId,
  type RunRequest,
  type RunResult,
  type SandboxHandle,
  sandboxSummary,
  SandboxPath,
  type ScenarioSelection,
  type AbsolutePath
} from "../domain.js"
import { prepareOutputSink } from "../output/output-sink.js"
import { DaytonaGateway } from "../sandbox/gateway.js"
import { ProjectConfig } from "../config/project-config.js"
import { renderVerifierInput } from "../verifier/verifier-input.js"
import { verifierCommand } from "../verifier/verifier-runner.js"
import { CandidateArchive } from "./candidate-archive.js"
import { applyDisposal } from "./disposal.js"

export type RunEnvironment = {
  readonly projectRoot: AbsolutePath
  readonly nextRunId: () => RunId
}

const verifierInputPath = (request: RunRequest, scenario: ScenarioSelection): SandboxPath =>
  SandboxPath.make(
    request.scenarios.length === 1 ? "/workspace/.sanity/run/verifier-input.md" : `/workspace/.sanity/run/${scenario.name}-verifier-input.md`
  )

const recordingName = (request: RunRequest, scenario: ScenarioSelection): string =>
  request.scenarios.length === 1 ? "recording" : `recording-${scenario.name}`

const setupCommands = (request: RunRequest, sandbox: SandboxHandle): Effect.Effect<void, RunFailure, DaytonaGateway> =>
  Effect.gen(function* () {
    const gateway = yield* DaytonaGateway
    for (const command of request.setup) {
      const exit = yield* gateway.runCommand(sandbox, command, Option.none())
      if (exit.exitCode !== 0) {
        return yield* new RunFailure({
          phase: "setup",
          message: `Setup command failed with exit code ${exit.exitCode}: ${exit.stdout}${exit.stderr}`,
          actionableFix: "Fix the setup command in the selected Sanity profile."
        })
      }
    }
  })

const finalVerifierExit = (exits: ReadonlyArray<CommandExit>): CommandExit => {
  const nonZero = exits.find((exit) => exit.exitCode !== 0)
  const timedOut = exits.some((exit) => exit.timedOut)
  return nonZero === undefined
    ? {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut
    }
    : { ...nonZero, timedOut }
}

const runFailureFromCause = (cause: Cause.Cause<RunFailure>): Option.Option<RunFailure> =>
  Result.match(Cause.findError(cause), {
    onFailure: () => Option.none(),
    onSuccess: Option.some
  })

const cancelledResult = (
  request: RunRequest,
  sandbox: Option.Option<SandboxHandle>,
  disposal: Option.Option<DisposalOutcome>
): RunResult => ({
  status: "cancelled",
  runId: request.runId,
  sandbox: Option.map(sandbox, sandboxSummary),
  disposal
})

const disposalFailedResult = (request: RunRequest, sandbox: SandboxHandle, disposal: DisposalOutcome): RunResult =>
  failedResult(
    request,
    new RunFailure({
      phase: "disposal",
      message: disposal._tag === "Failed" ? disposal.message : "Sandbox disposal failed.",
      actionableFix: "Check sandbox lifecycle permissions or retry cleanup manually."
    }),
    Option.some(sandbox),
    Option.some(disposal)
  )

const runVerifierScenarios = (
  request: RunRequest,
  sandbox: SandboxHandle,
  appUrl: Option.Option<string>,
  scenarios: ReadonlyArray<ScenarioMarkdown>
): Effect.Effect<CommandExit, RunFailure, DaytonaGateway> =>
  Effect.gen(function* () {
    const gateway = yield* DaytonaGateway
    const exits: Array<CommandExit> = []
    for (const { scenario, markdown } of scenarios) {
      const inputPath = verifierInputPath(request, scenario)
      const renderedInput = renderVerifierInput({
        scenarioName: scenario.name,
        scenarioMarkdown: markdown,
        workspacePath,
        appUrl,
        agentOutputDir: request.verifier.agentOutputDir
      })
      yield* gateway.writeTextFile(sandbox, inputPath, renderedInput)
      const command = verifierCommand(request.verifier, inputPath, workspacePath, appUrl)
      const timeout = Option.getOrElse(scenario.timeout, () => request.verifier.timeout)
      const commandOutcome = yield* Effect.acquireUseRelease(
        gateway.startCapture(sandbox, scenario.runSurface),
        () =>
          gateway.runCommand(sandbox, command, Option.some(timeout)).pipe(
            Effect.match({
              onFailure: (failure) => ({ _tag: "Failed" as const, failure }),
              onSuccess: (exit) => ({ _tag: "Succeeded" as const, exit })
            })
          ),
        (capture) => gateway.stopCapture(sandbox, capture, request.outputSink, recordingName(request, scenario))
      )
      if (commandOutcome._tag === "Failed") {
        return yield* commandOutcome.failure
      } else {
        exits.push(commandOutcome.exit)
      }
    }
    return finalVerifierExit(exits)
  })

const runInsideSandbox = (
  request: RunRequest,
  sandbox: SandboxHandle,
  archivePath: string,
  scenarios: ReadonlyArray<ScenarioMarkdown>
): Effect.Effect<Extract<RunResult, { readonly status: "completed" }>, RunFailure, DaytonaGateway> =>
  Effect.gen(function* () {
    const gateway = yield* DaytonaGateway
    yield* gateway.uploadCandidate(sandbox, archivePath)
    yield* setupCommands(request, sandbox)
    const app = yield* Option.match(request.app, {
      onNone: () => Effect.succeed({ appUrl: Option.none<string>() }),
      onSome: (appSpec) => gateway.startApp(sandbox, appSpec)
    })
    const verifierExit = yield* runVerifierScenarios(request, sandbox, app.appUrl, scenarios)
    yield* gateway.collectOutput(sandbox, request.verifier.agentOutputDir, request.outputSink)
    return {
      status: "completed",
      runId: request.runId,
      verifier: {
        exitCode: verifierExit.exitCode,
        timedOut: verifierExit.timedOut
      },
      sandbox: sandboxSummary(sandbox),
      outputSink: request.outputSink,
      disposal: { _tag: "Retained" }
    }
  })

const failedResult = (
  request: RunRequest,
  failure: RunFailure,
  sandbox: Option.Option<SandboxHandle>,
  disposal: Option.Option<DisposalOutcome>
): RunResult => ({
  status: "failed",
  runId: request.runId,
  phase: failure.phase,
  message: failure.message,
  actionableFix: failure.actionableFix,
  sandbox: Option.map(sandbox, sandboxSummary),
  disposal
})

const executedOutcome = (result: RunResult): RunOutcome => ({ _tag: "Executed", result })

type ArchiveOutcome =
  | { readonly _tag: "ArchiveCreated"; readonly path: AbsolutePath }
  | { readonly _tag: "ArchiveFailed"; readonly failure: RunFailure }

type ScenarioMarkdown = {
  readonly scenario: ScenarioSelection
  readonly markdown: string
}

type PreparedSinkOutcome =
  | { readonly _tag: "Prepared"; readonly sink: OutputSink }
  | { readonly _tag: "ConfigFailed"; readonly failure: ConfigError }
  | { readonly _tag: "OutputFailed"; readonly failure: RunFailure }

export const run = (
  input: RunCliInput,
  environment: RunEnvironment
): Effect.Effect<RunOutcome, ConfigError, ProjectConfig | DaytonaGateway | CandidateArchive> =>
  Effect.gen(function* () {
    const request = yield* resolveRunRequest(input, environment.projectRoot, environment.nextRunId())

    if (input.dryRun) {
      return { _tag: "DryRun", request }
    }

    const projectConfig = yield* ProjectConfig
    const scenarios = yield* Effect.all(
      request.scenarios.map((scenario) =>
        projectConfig.loadScenario(scenario).pipe(Effect.map((markdown): ScenarioMarkdown => ({ scenario, markdown })))
      )
    )

    const preparedSinkOutcome = yield* prepareOutputSink(request.outputSink).pipe(
      Effect.match({
        onFailure: (failure): PreparedSinkOutcome =>
          failure._tag === "ConfigError" ? { _tag: "ConfigFailed", failure } : { _tag: "OutputFailed", failure },
        onSuccess: (sink): PreparedSinkOutcome => ({ _tag: "Prepared", sink })
      })
    )
    let preparedSink: OutputSink
    switch (preparedSinkOutcome._tag) {
      case "Prepared":
        preparedSink = preparedSinkOutcome.sink
        break
      case "ConfigFailed":
        return yield* preparedSinkOutcome.failure
      case "OutputFailed":
        return executedOutcome(failedResult(request, preparedSinkOutcome.failure, Option.none(), Option.none()))
    }
    const archiveService = yield* CandidateArchive
    const archiveOutcome = yield* archiveService.createLocalTar(request.candidate).pipe(
      Effect.match({
        onFailure: (failure): ArchiveOutcome => ({ _tag: "ArchiveFailed", failure }),
        onSuccess: (archivePath): ArchiveOutcome => ({ _tag: "ArchiveCreated", path: archivePath })
      })
    )
    if (archiveOutcome._tag === "ArchiveFailed") {
      return executedOutcome(failedResult(request, archiveOutcome.failure, Option.none(), Option.none()))
    }

    return yield* Effect.acquireUseRelease(
      Effect.succeed(archiveOutcome.path),
      (archivePath) =>
        Effect.gen(function* () {
          const gateway = yield* DaytonaGateway
          let sandboxForResult = Option.none<SandboxHandle>()
          let disposalForResult = Option.none<DisposalOutcome>()
          const executionExit = yield* Effect.acquireUseRelease(
            gateway.create(request.sandbox.config),
            (sandbox) =>
              Effect.gen(function* () {
                sandboxForResult = Option.some(sandbox)
                return yield* runInsideSandbox({ ...request, outputSink: preparedSink }, sandbox, archivePath, scenarios).pipe(Effect.exit)
              }),
            (sandbox) =>
              applyDisposal(request.sandbox.disposal, sandbox).pipe(
                Effect.tap((disposal) =>
                  Effect.sync(() => {
                    disposalForResult = Option.some(disposal)
                  })
                ),
                Effect.asVoid
              )
          ).pipe(Effect.exit)

          if (Exit.isFailure(executionExit)) {
            if (Cause.hasInterrupts(executionExit.cause)) {
              return executedOutcome(cancelledResult(request, sandboxForResult, disposalForResult))
            }
            const failure = runFailureFromCause(executionExit.cause)
            if (Option.isSome(failure)) {
              return executedOutcome(failedResult(request, failure.value, sandboxForResult, disposalForResult))
            }
            return yield* Effect.die(executionExit.cause)
          }

          const bodyExit = executionExit.value
          const sandbox = Option.getOrThrow(sandboxForResult)
          const disposal = Option.getOrThrow(disposalForResult)
          if (disposal._tag === "Failed") {
            return executedOutcome(disposalFailedResult(request, sandbox, disposal))
          }

          if (Exit.isFailure(bodyExit)) {
            if (Cause.hasInterrupts(bodyExit.cause)) {
              return executedOutcome(cancelledResult(request, sandboxForResult, disposalForResult))
            }
            const failure = runFailureFromCause(bodyExit.cause)
            if (Option.isSome(failure)) {
              return executedOutcome(failedResult(request, failure.value, Option.some(sandbox), Option.some(disposal)))
            }
            return yield* Effect.die(bodyExit.cause)
          }

          return executedOutcome({
            ...bodyExit.value,
            disposal
          })
        }),
      (archivePath) => archiveService.cleanupLocalTar(archivePath).pipe(Effect.catch(() => Effect.void))
    )
  })
