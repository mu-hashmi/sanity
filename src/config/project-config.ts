import { readFile } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Schema } from "effect"
import YAML from "yaml"
import {
  AbsolutePath,
  ConfigError,
  type RawProfileFile,
  RawProfileFileSchema,
  type ScenarioSelection,
  type ProfileName
} from "../domain.js"

export type ProjectConfigShape = {
  readonly loadProfile: (name: ProfileName) => Effect.Effect<RawProfileFile, ConfigError>
  readonly loadScenario: (selection: ScenarioSelection) => Effect.Effect<string, ConfigError>
}

export class ProjectConfig extends Context.Service<ProjectConfig, ProjectConfigShape>()("ProjectConfig") {}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const rejectStaleProfileShape = (value: unknown): Effect.Effect<void, ConfigError> => {
  if (!isRecord(value)) {
    return Effect.void
  }

  if ("checks" in value) {
    return Effect.fail(
      new ConfigError({
        message: "Profile uses stale `checks`; Sanity V0 expects `scenarios`.",
        actionableFix: "Rename `.sanity/checks` references to `scenarios` in the profile."
      })
    )
  }

  if ("driver" in value) {
    return Effect.fail(
      new ConfigError({
        message: "Profile uses stale `driver`; Sanity V0 only runs agent verifier entrypoints.",
        actionableFix: "Move the agent command under `verifier.entrypoint` with structured `command` and `args`."
      })
    )
  }

  if ("command-check" in value) {
    return Effect.fail(
      new ConfigError({
        message: "Profile uses stale `command-check`; Sanity V0 only runs agent verifier entrypoints.",
        actionableFix: "Move agent execution under `verifier.entrypoint` and behavior instructions under `scenarios`."
      })
    )
  }

  const scenarios = value["scenarios"]
  if (!isRecord(scenarios)) {
    return Effect.void
  }

  for (const scenario of Object.values(scenarios)) {
    if (!isRecord(scenario)) {
      continue
    }
    if ("driver" in scenario || "command" in scenario || "command-check" in scenario) {
      return Effect.fail(
        new ConfigError({
          message: "Scenario config uses stale driver/command fields.",
          actionableFix: "Keep scenario config to path, runSurface, and timeoutMinutes; verifier execution belongs to the profile."
        })
      )
    }
  }

  return Effect.void
}

const parseProfile = (source: string, filePath: string): Effect.Effect<RawProfileFile, ConfigError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => YAML.parse(source) as unknown,
      catch: (cause) =>
        new ConfigError({
          message: `Could not parse profile YAML at ${filePath}: ${String(cause)}`,
          actionableFix: "Fix the YAML syntax and run Sanity again."
        })
    })

    yield* rejectStaleProfileShape(parsed)

    return yield* Schema.decodeUnknownEffect(RawProfileFileSchema)(parsed).pipe(
      Effect.mapError((cause) =>
        new ConfigError({
          message: `Invalid profile schema at ${filePath}: ${cause.message}`,
          actionableFix: "Update the profile to use structured sandbox, verifier, and scenarios fields."
        })
      )
    )
  })

export const makeProjectConfig = (projectRoot: AbsolutePath): ProjectConfigShape => ({
  loadProfile: (name) => {
    const filePath = path.join(projectRoot, ".sanity", "profiles", `${name}.yml`)
    return Effect.gen(function* () {
      const source = yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf8"),
        catch: (cause) =>
          new ConfigError({
            message: `Could not read profile ${name}: ${String(cause)}`,
            actionableFix: `Create ${path.relative(projectRoot, filePath)} or pass an existing --profile.`
          })
      })
      return yield* parseProfile(source, filePath)
    })
  },
  loadScenario: (selection) =>
    Effect.tryPromise({
      try: () => readFile(selection.path, "utf8"),
      catch: (cause) =>
        new ConfigError({
          message: `Could not read scenario ${selection.name}: ${String(cause)}`,
          actionableFix: `Create ${selection.path} or update the scenario path in the profile.`
        })
    })
})
