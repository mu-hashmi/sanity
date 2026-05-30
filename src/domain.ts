import { Data, Duration, Option, Schema } from "effect"

type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type AbsolutePath = Brand<string, "AbsolutePath">
export type SandboxPath = Brand<string, "SandboxPath">
export type ProfileName = Brand<string, "ProfileName">
export type ScenarioName = Brand<string, "ScenarioName">
export type RunId = Brand<string, "RunId">
export type NonEmptyString = Brand<string, "NonEmptyString">

export const AbsolutePath = {
  make: (value: string): AbsolutePath => value as AbsolutePath
}

export const SandboxPath = {
  make: (value: string): SandboxPath => value as SandboxPath
}

export const ProfileName = {
  make: (value: string): ProfileName => value as ProfileName
}

export const ScenarioName = {
  make: (value: string): ScenarioName => value as ScenarioName
}

export const RunId = {
  make: (value: string): RunId => value as RunId
}

export const NonEmptyString = {
  make: (value: string): NonEmptyString => value as NonEmptyString
}

const safeNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const isSafeName = (value: string): boolean => safeNamePattern.test(value)

export const safeNameDescription = "Use letters, numbers, dots, underscores, or dashes, and do not include path separators."

export type RunSurface = "headless" | "graphical"
export const RunSurface = Schema.Literals(["headless", "graphical"])

export type SandboxDisposal = "delete" | "retain" | "archive"
export const SandboxDisposal = Schema.Literals(["delete", "retain", "archive"])

export type RunFailurePhase =
  | "config"
  | "output"
  | "candidate"
  | "provider"
  | "setup"
  | "app"
  | "capture"
  | "verifier"
  | "collect-output"
  | "disposal"

export type Candidate = {
  readonly _tag: "LocalCandidate"
  readonly path: AbsolutePath
}

export type OutputSink =
  | { readonly _tag: "NoOutput" }
  | { readonly _tag: "LocalArtifactPath"; readonly path: AbsolutePath }
  | { readonly _tag: "ExternalSink"; readonly uri: string }

export type CommandSpec = {
  readonly command: NonEmptyString
  readonly args: ReadonlyArray<string>
  readonly cwd: Option.Option<SandboxPath>
  readonly env: Readonly<Record<string, string>>
}

export type VerifierEntrypoint = {
  readonly command: NonEmptyString
  readonly args: ReadonlyArray<string>
  readonly stdin: "verifier-input" | "none"
  readonly timeout: Duration.Duration
  readonly agentOutputDir: Option.Option<SandboxPath>
}

export type AppSpec = {
  readonly start: CommandSpec
  readonly port: number
  readonly healthcheckPath: string
  readonly readinessTimeout: Duration.Duration
}

export type DaytonaSandboxConfig = {
  readonly image: Option.Option<string>
  readonly snapshot: Option.Option<string>
  readonly target: Option.Option<string>
  readonly autoStopMinutes: Option.Option<number>
  readonly autoArchiveMinutes: Option.Option<number>
  readonly autoDeleteMinutes: Option.Option<number>
}

export type ScenarioSelection = {
  readonly name: ScenarioName
  readonly path: AbsolutePath
  readonly runSurface: RunSurface
  readonly timeout: Option.Option<Duration.Duration>
}

export type RunRequest = {
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
  readonly scenarios: readonly [ScenarioSelection, ...Array<ScenarioSelection>]
  readonly outputSink: OutputSink
}

export type VerifierInput = {
  readonly scenarioName: ScenarioName
  readonly scenarioMarkdown: string
  readonly workspacePath: SandboxPath
  readonly appUrl: Option.Option<string>
  readonly agentOutputDir: Option.Option<SandboxPath>
}

export type CommandExit = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export type SandboxHandle = {
  readonly id: string
  readonly name: string
  readonly target: string
}

export type SandboxSummary = {
  readonly id: string
  readonly name: string
  readonly target: string
}

export type AppHandle = {
  readonly appUrl: Option.Option<string>
}

export type CaptureHandle =
  | { readonly _tag: "NoCapture" }
  | { readonly _tag: "RecordingCapture"; readonly recordingId: string }

export type DisposalOutcome =
  | { readonly _tag: "Deleted" }
  | { readonly _tag: "Retained" }
  | { readonly _tag: "Archived" }
  | { readonly _tag: "Failed"; readonly message: string }

export type RunResult =
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

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly actionableFix: string
}> {}

export class RunFailure extends Data.TaggedError("RunFailure")<{
  readonly phase: RunFailurePhase
  readonly message: string
  readonly actionableFix: string
}> {}

export const RawCommandSpecSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.String))
})
export type RawCommandSpec = typeof RawCommandSpecSchema.Type

export const RawVerifierEntrypointSchema = Schema.Struct({
  command: Schema.NonEmptyString,
  args: Schema.optional(Schema.Array(Schema.String)),
  stdin: Schema.optional(Schema.Literals(["verifier-input", "none"]))
})

export const RawProfileFileSchema = Schema.Struct({
  sandbox: Schema.Struct({
    provider: Schema.Literal("daytona"),
    disposal: Schema.optional(SandboxDisposal),
    config: Schema.optional(
      Schema.Struct({
        image: Schema.optional(Schema.String),
        snapshot: Schema.optional(Schema.String),
        target: Schema.optional(Schema.String),
        autoStopMinutes: Schema.optional(Schema.Int),
        autoArchiveMinutes: Schema.optional(Schema.Int),
        autoDeleteMinutes: Schema.optional(Schema.Int)
      })
    )
  }),
  setup: Schema.optional(Schema.Array(RawCommandSpecSchema)),
  app: Schema.optional(
    Schema.Struct({
      start: RawCommandSpecSchema,
      port: Schema.Int,
      healthcheckPath: Schema.optional(Schema.String),
      readinessTimeoutSeconds: Schema.optional(Schema.Int)
    })
  ),
  verifier: Schema.Struct({
    entrypoint: RawVerifierEntrypointSchema,
    timeoutMinutes: Schema.optional(Schema.Int),
    agentOutputDir: Schema.optional(Schema.String)
  }),
  runSurface: Schema.optional(RunSurface),
  artifactPath: Schema.optional(Schema.String),
  scenarios: Schema.Record(
    Schema.String,
    Schema.Struct({
      path: Schema.String,
      runSurface: Schema.optional(RunSurface),
      timeoutMinutes: Schema.optional(Schema.Int)
    })
  )
})

export type RawProfileFile = typeof RawProfileFileSchema.Type

export type RunCliInput = {
  readonly profile: ProfileName
  readonly scenario: ReadonlyArray<ScenarioName>
  readonly all: boolean
  readonly candidate: AbsolutePath
  readonly artifactPath: Option.Option<AbsolutePath>
  readonly noArtifacts: boolean
  readonly json: boolean
  readonly noInput: boolean
  readonly dryRun: boolean
  readonly debug: boolean
}

export type RunOutcome =
  | { readonly _tag: "DryRun"; readonly request: RunRequest }
  | { readonly _tag: "Executed"; readonly result: RunResult }

export const sandboxSummary = (sandbox: SandboxHandle): SandboxSummary => ({
  id: sandbox.id,
  name: sandbox.name,
  target: sandbox.target
})
