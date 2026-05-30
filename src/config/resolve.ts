import path from "node:path"
import { Duration, Effect, Option } from "effect"
import {
  AbsolutePath,
  ConfigError,
  NonEmptyString,
  ProfileName,
  RunId,
  SandboxPath,
  ScenarioName,
  type AppSpec,
  type CommandSpec,
  type DaytonaSandboxConfig,
  type OutputSink,
  type RawCommandSpec,
  type RawProfileFile,
  type RunCliInput,
  type RunRequest,
  type RunSurface,
  type ScenarioSelection,
  type VerifierEntrypoint,
  isSafeName,
  safeNameDescription
} from "../domain.js"
import { ProjectConfig } from "./project-config.js"

const defaultWorkspacePath = SandboxPath.make("/workspace")
const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

const optional = <A>(value: A | undefined): Option.Option<A> =>
  value === undefined ? Option.none() : Option.some(value)

const requiredNonEmpty = (value: string, field: string): Effect.Effect<NonEmptyString, ConfigError> =>
  value.trim().length === 0
    ? Effect.fail(
        new ConfigError({
          message: `${field} cannot be empty.`,
          actionableFix: `Set ${field} to a non-empty string.`
        })
      )
    : Effect.succeed(NonEmptyString.make(value))

const positiveInt = (value: number, field: string): Effect.Effect<number, ConfigError> =>
  Number.isInteger(value) && value > 0
    ? Effect.succeed(value)
    : Effect.fail(
        new ConfigError({
          message: `${field} must be a positive integer.`,
          actionableFix: `Set ${field} to a positive integer.`
        })
      )

const safeName = (value: string, field: string): Effect.Effect<string, ConfigError> =>
  isSafeName(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new ConfigError({
          message: `${field} contains an unsafe name: ${value}.`,
          actionableFix: safeNameDescription
        })
      )

const validateEnv = (env: Readonly<Record<string, string>>, field: string): Effect.Effect<Readonly<Record<string, string>>, ConfigError> =>
  Effect.gen(function* () {
    for (const name of Object.keys(env)) {
      if (!envNamePattern.test(name)) {
        yield* new ConfigError({
          message: `${field} contains invalid environment variable name: ${name}.`,
          actionableFix: "Use POSIX-style environment variable names: letters, numbers, and underscores, not starting with a number."
        })
      }
    }
    return env
  })

const resolveProjectPath = (projectRoot: AbsolutePath, filePath: string): AbsolutePath =>
  AbsolutePath.make(path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath))

const resolveSandboxPath = (sandboxPath: string): SandboxPath =>
  SandboxPath.make(sandboxPath.startsWith("/") ? sandboxPath : path.posix.join(defaultWorkspacePath, sandboxPath))

const replaceRunId = (value: string, runId: RunId): string => value.replaceAll("{runId}", runId)

const toCommandSpec = (raw: RawCommandSpec): Effect.Effect<CommandSpec, ConfigError> =>
  Effect.gen(function* () {
    const env = yield* validateEnv(raw.env ?? {}, "command.env")
    return {
      command: yield* requiredNonEmpty(raw.command, "command"),
      args: raw.args ?? [],
      cwd: raw.cwd === undefined ? Option.some(defaultWorkspacePath) : Option.some(resolveSandboxPath(raw.cwd)),
      env
    }
  })

const toDaytonaConfig = (raw: RawProfileFile["sandbox"]["config"]): Effect.Effect<DaytonaSandboxConfig, ConfigError> => {
  if (raw?.image !== undefined && raw.snapshot !== undefined) {
    return Effect.fail(
      new ConfigError({
        message: "sandbox.config.image and sandbox.config.snapshot cannot both be set.",
        actionableFix: "Choose either sandbox.config.image or sandbox.config.snapshot, not both."
      })
    )
  }

  return Effect.succeed({
    image: optional(raw?.image),
    snapshot: optional(raw?.snapshot),
    target: optional(raw?.target),
    autoStopMinutes: optional(raw?.autoStopMinutes),
    autoArchiveMinutes: optional(raw?.autoArchiveMinutes),
    autoDeleteMinutes: optional(raw?.autoDeleteMinutes)
  })
}

const toAppSpec = (raw: RawProfileFile["app"]): Effect.Effect<Option.Option<AppSpec>, ConfigError> => {
  if (raw === undefined) {
    return Effect.succeed(Option.none())
  }

  return Effect.gen(function* () {
    const port = yield* positiveInt(raw.port, "app.port")
    const start = yield* toCommandSpec(raw.start)
    return Option.some({
      start,
      port,
      healthcheckPath: raw.healthcheckPath ?? "/",
      readinessTimeout: Duration.seconds(raw.readinessTimeoutSeconds ?? 90)
    })
  })
}

const toVerifier = (raw: RawProfileFile["verifier"]): Effect.Effect<VerifierEntrypoint, ConfigError> =>
  Effect.gen(function* () {
    const timeoutMinutes = yield* positiveInt(raw.timeoutMinutes ?? 20, "verifier.timeoutMinutes")
    return {
      command: yield* requiredNonEmpty(raw.entrypoint.command, "verifier.entrypoint.command"),
      args: raw.entrypoint.args ?? [],
      stdin: raw.entrypoint.stdin ?? "verifier-input",
      timeout: Duration.minutes(timeoutMinutes),
      agentOutputDir: Option.map(optional(raw.agentOutputDir), resolveSandboxPath)
    }
  })

const toOutputSink = (
  profile: RawProfileFile,
  input: RunCliInput,
  projectRoot: AbsolutePath,
  runId: RunId
): OutputSink => {
  if (input.noArtifacts) {
    return { _tag: "NoOutput" }
  }

  const selectedPath = Option.match(input.artifactPath, {
    onNone: () => profile.artifactPath ?? ".sanity/runs/{runId}",
    onSome: (value) => value
  })
  const withRunId = replaceRunId(selectedPath, runId)

  if (withRunId.includes("://")) {
    return { _tag: "ExternalSink", uri: withRunId }
  }

  return { _tag: "LocalArtifactPath", path: resolveProjectPath(projectRoot, withRunId) }
}

const selectScenarioNames = (profile: RawProfileFile, input: RunCliInput): Effect.Effect<ReadonlyArray<ScenarioName>, ConfigError> => {
  const available = Object.keys(profile.scenarios)
  if (input.all) {
    return available.length === 0
      ? Effect.fail(
          new ConfigError({
            message: "Profile does not define any scenarios.",
            actionableFix: "Add at least one entry under `scenarios` or pass a different --profile."
          })
        )
      : Effect.all(available.map((name) => safeName(name, "scenario name").pipe(Effect.map(ScenarioName.make))))
  }

  return Effect.all(input.scenario.map((name) => safeName(name, "--scenario").pipe(Effect.map(ScenarioName.make))))
}

const scenarioByName = (
  profile: RawProfileFile,
  projectRoot: AbsolutePath,
  profileRunSurface: RunSurface,
  name: ScenarioName
): Effect.Effect<ScenarioSelection, ConfigError> => {
  const raw = profile.scenarios[name]
  if (raw === undefined) {
    return Effect.fail(
      new ConfigError({
        message: `Unknown scenario ${name}.`,
        actionableFix: "Run with --all or choose a scenario declared in the selected profile."
      })
    )
  }

  return Effect.gen(function* () {
    const timeout = raw.timeoutMinutes === undefined ? Option.none<Duration.Duration>() : Option.some(Duration.minutes(yield* positiveInt(raw.timeoutMinutes, `scenarios.${name}.timeoutMinutes`)))
    return {
      name,
      path: resolveProjectPath(projectRoot, raw.path),
      runSurface: raw.runSurface ?? profileRunSurface,
      timeout
    }
  })
}

const nonEmptyScenarios = (
  scenarios: ReadonlyArray<ScenarioSelection>
): Effect.Effect<readonly [ScenarioSelection, ...Array<ScenarioSelection>], ConfigError> =>
  scenarios.length === 0
    ? Effect.fail(
        new ConfigError({
          message: "No scenario was selected.",
          actionableFix: "Pass --scenario <name> or --all."
        })
      )
    : Effect.succeed(scenarios as readonly [ScenarioSelection, ...Array<ScenarioSelection>])

export const resolveRunRequest = (
  input: RunCliInput,
  projectRoot: AbsolutePath,
  runId: RunId
): Effect.Effect<RunRequest, ConfigError, ProjectConfig> =>
  Effect.gen(function* () {
    const config = yield* ProjectConfig
    const profileName = ProfileName.make(yield* safeName(input.profile, "--profile"))
    const profile = yield* config.loadProfile(profileName)
    const profileRunSurface = profile.runSurface ?? "headless"
    const names = yield* selectScenarioNames(profile, input)
    const scenarios = yield* Effect.all(names.map((name) => scenarioByName(profile, projectRoot, profileRunSurface, name)))

    return {
      runId,
      profileName,
      candidate: { _tag: "LocalCandidate", path: input.candidate },
      sandbox: {
        provider: "daytona",
        config: yield* toDaytonaConfig(profile.sandbox.config),
        disposal: profile.sandbox.disposal ?? "delete"
      },
      setup: yield* Effect.all((profile.setup ?? []).map(toCommandSpec)),
      app: yield* toAppSpec(profile.app),
      verifier: yield* toVerifier(profile.verifier),
      scenarios: yield* nonEmptyScenarios(scenarios),
      outputSink: toOutputSink(profile, input, projectRoot, runId)
    }
  })

export const makeRunCliInput = (input: {
  readonly profile: string
  readonly scenario: ReadonlyArray<string>
  readonly all: boolean
  readonly candidate: string
  readonly artifactPath: Option.Option<string>
  readonly noArtifacts: boolean
  readonly json: boolean
  readonly noInput: boolean
  readonly dryRun: boolean
  readonly debug: boolean
}): RunCliInput => ({
  profile: ProfileName.make(input.profile),
  scenario: input.scenario.map(ScenarioName.make),
  all: input.all,
  candidate: AbsolutePath.make(input.candidate),
  artifactPath: Option.map(input.artifactPath, AbsolutePath.make),
  noArtifacts: input.noArtifacts,
  json: input.json,
  noInput: input.noInput,
  dryRun: input.dryRun,
  debug: input.debug
})

export const workspacePath = defaultWorkspacePath
