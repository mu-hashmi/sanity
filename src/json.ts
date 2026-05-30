import { Duration, Option, Schema } from "effect"
import type {
  AppSpec,
  DaytonaSandboxConfig,
  OutputSink,
  RunRequest,
  RunResult,
  SandboxPath,
  ScenarioSelection,
  VerifierEntrypoint
} from "./domain.js"

export type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | { readonly [key: string]: JsonValue }

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)

export const OutputSinkJsonSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("NoOutput")
  }),
  Schema.Struct({
    _tag: Schema.Literal("LocalArtifactPath"),
    path: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal("ExternalSink"),
    uri: Schema.String
  })
])
export type OutputSinkJson = typeof OutputSinkJsonSchema.Type

const CandidateJsonSchema = Schema.Struct({
  _tag: Schema.Literal("LocalCandidate"),
  path: Schema.String
})

const DaytonaConfigJsonSchema = Schema.Struct({
  image: NullableString,
  snapshot: NullableString,
  target: NullableString,
  autoStopMinutes: NullableNumber,
  autoArchiveMinutes: NullableNumber,
  autoDeleteMinutes: NullableNumber
})

const SandboxRequestJsonSchema = Schema.Struct({
  provider: Schema.Literal("daytona"),
  config: DaytonaConfigJsonSchema,
  disposal: Schema.Literals(["delete", "retain", "archive"])
})

const CommandSpecJsonSchema = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: NullableString,
  env: Schema.Record(Schema.String, Schema.String)
})

const AppJsonSchema = Schema.Struct({
  start: CommandSpecJsonSchema,
  port: Schema.Number,
  healthcheckPath: Schema.String,
  readinessTimeoutSeconds: Schema.Number
})

const VerifierJsonSchema = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  stdin: Schema.Literals(["verifier-input", "none"]),
  timeoutSeconds: Schema.Number,
  agentOutputDir: NullableString
})

const ScenarioJsonSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  runSurface: Schema.Literals(["headless", "graphical"]),
  timeoutSeconds: NullableNumber
})

export const RunRequestJsonSchema = Schema.Struct({
  runId: Schema.String,
  profileName: Schema.String,
  candidate: CandidateJsonSchema,
  sandbox: SandboxRequestJsonSchema,
  setup: Schema.Array(CommandSpecJsonSchema),
  app: Schema.NullOr(AppJsonSchema),
  verifier: VerifierJsonSchema,
  scenarios: Schema.Array(ScenarioJsonSchema),
  outputSink: OutputSinkJsonSchema
})
export type RunRequestJson = typeof RunRequestJsonSchema.Type

const SandboxSummaryJsonSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  target: Schema.String
})

const DisposalOutcomeJsonSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Deleted")
  }),
  Schema.Struct({
    _tag: Schema.Literal("Retained")
  }),
  Schema.Struct({
    _tag: Schema.Literal("Archived")
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    message: Schema.String
  })
])

export const RunResultJsonSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    runId: Schema.String,
    verifier: Schema.Struct({
      exitCode: Schema.Number,
      timedOut: Schema.Boolean
    }),
    sandbox: SandboxSummaryJsonSchema,
    outputSink: OutputSinkJsonSchema,
    disposal: DisposalOutcomeJsonSchema
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    runId: Schema.String,
    phase: Schema.Literals(["config", "output", "candidate", "provider", "setup", "app", "capture", "verifier", "collect-output", "disposal"]),
    message: Schema.String,
    actionableFix: Schema.String,
    sandbox: Schema.NullOr(SandboxSummaryJsonSchema),
    disposal: Schema.NullOr(DisposalOutcomeJsonSchema)
  }),
  Schema.Struct({
    status: Schema.Literal("cancelled"),
    runId: Schema.String,
    sandbox: Schema.NullOr(SandboxSummaryJsonSchema),
    disposal: Schema.NullOr(DisposalOutcomeJsonSchema)
  })
])
export type RunResultJson = typeof RunResultJsonSchema.Type

const optionToJson = <A>(option: Option.Option<A>, encode: (value: A) => JsonValue): JsonValue =>
  Option.match(option, {
    onNone: () => null,
    onSome: encode
  })

const durationToSeconds = (duration: Duration.Duration): number => Duration.toSeconds(duration)

const sandboxPathToJson = (path: SandboxPath): string => path

const daytonaConfigToJson = (config: DaytonaSandboxConfig): JsonValue => ({
  image: optionToJson(config.image, (value) => value),
  snapshot: optionToJson(config.snapshot, (value) => value),
  target: optionToJson(config.target, (value) => value),
  autoStopMinutes: optionToJson(config.autoStopMinutes, (value) => value),
  autoArchiveMinutes: optionToJson(config.autoArchiveMinutes, (value) => value),
  autoDeleteMinutes: optionToJson(config.autoDeleteMinutes, (value) => value)
})

const verifierToJson = (verifier: VerifierEntrypoint): JsonValue => ({
  command: verifier.command,
  args: verifier.args,
  stdin: verifier.stdin,
  timeoutSeconds: durationToSeconds(verifier.timeout),
  agentOutputDir: optionToJson(verifier.agentOutputDir, sandboxPathToJson)
})

const appToJson = (app: AppSpec): JsonValue => ({
  start: {
    command: app.start.command,
    args: app.start.args,
    cwd: optionToJson(app.start.cwd, sandboxPathToJson),
    env: app.start.env
  },
  port: app.port,
  healthcheckPath: app.healthcheckPath,
  readinessTimeoutSeconds: durationToSeconds(app.readinessTimeout)
})

const scenarioToJson = (scenario: ScenarioSelection): JsonValue => ({
  name: scenario.name,
  path: scenario.path,
  runSurface: scenario.runSurface,
  timeoutSeconds: optionToJson(scenario.timeout, durationToSeconds)
})

export const outputSinkToJson = (sink: OutputSink): OutputSinkJson => {
  switch (sink._tag) {
    case "NoOutput":
      return { _tag: "NoOutput" }
    case "LocalArtifactPath":
      return { _tag: "LocalArtifactPath", path: sink.path }
    case "ExternalSink":
      return { _tag: "ExternalSink", uri: sink.uri }
  }
}

export const runRequestToJson = (request: RunRequest): RunRequestJson =>
  Schema.decodeUnknownSync(RunRequestJsonSchema)({
    runId: request.runId,
    profileName: request.profileName,
    candidate: request.candidate,
    sandbox: {
      provider: request.sandbox.provider,
      config: daytonaConfigToJson(request.sandbox.config),
      disposal: request.sandbox.disposal
    },
    setup: request.setup.map((command) => ({
      command: command.command,
      args: command.args,
      cwd: optionToJson(command.cwd, sandboxPathToJson),
      env: command.env
    })),
    app: optionToJson(request.app, appToJson),
    verifier: verifierToJson(request.verifier),
    scenarios: request.scenarios.map(scenarioToJson),
    outputSink: outputSinkToJson(request.outputSink)
  })

export const runResultToJson = (result: RunResult): RunResultJson => {
  switch (result.status) {
    case "completed":
      return Schema.decodeUnknownSync(RunResultJsonSchema)({
        status: result.status,
        runId: result.runId,
        verifier: result.verifier,
        sandbox: result.sandbox,
        outputSink: outputSinkToJson(result.outputSink),
        disposal: result.disposal
      })
    case "failed":
      return Schema.decodeUnknownSync(RunResultJsonSchema)({
        status: result.status,
        runId: result.runId,
        phase: result.phase,
        message: result.message,
        actionableFix: result.actionableFix,
        sandbox: optionToJson(result.sandbox, (value) => value),
        disposal: optionToJson(result.disposal, (value) => value)
      })
    case "cancelled":
      return Schema.decodeUnknownSync(RunResultJsonSchema)({
        status: result.status,
        runId: result.runId,
        sandbox: optionToJson(result.sandbox, (value) => value),
        disposal: optionToJson(result.disposal, (value) => value)
      })
  }
}
