import path from "node:path"
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { makeProjectConfig, ProjectConfig } from "../src/config/project-config.js"
import { resolveRunRequest } from "../src/config/resolve.js"
import { AbsolutePath, ProfileName, RunId, ScenarioName, type RunCliInput } from "../src/domain.js"
import { makeFixtureProject, minimalProfile } from "./helpers/project.js"

const input = (projectRoot: AbsolutePath, overrides?: Partial<RunCliInput>): RunCliInput => ({
  profile: ProfileName.make("pr"),
  scenario: [ScenarioName.make("resolve-buttons")],
  all: false,
  candidate: projectRoot,
  artifactPath: Option.none(),
  noArtifacts: false,
  json: false,
  noInput: true,
  dryRun: false,
  debug: false,
  ...overrides
})

const resolve = (projectRoot: AbsolutePath, runInput: RunCliInput) =>
  Effect.runPromise(
    resolveRunRequest(runInput, projectRoot, RunId.make("run-test")).pipe(
      Effect.provideService(ProjectConfig, makeProjectConfig(projectRoot))
    )
  )

describe("resolveRunRequest", () => {
  it("applies profile runSurface by default", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const request = await resolve(projectRoot, input(projectRoot))

    expect(request.scenarios[0].runSurface).toBe("headless")
  })

  it("lets scenario runSurface override the profile runSurface", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
`)
    )
    const request = await resolve(projectRoot, input(projectRoot))

    expect(request.scenarios[0].runSurface).toBe("graphical")
  })

  it("lets CLI artifact path override profile artifactPath", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const request = await resolve(
      projectRoot,
      input(projectRoot, { artifactPath: Option.some(AbsolutePath.make("custom/{runId}")) })
    )

    expect(request.outputSink).toEqual({
      _tag: "LocalArtifactPath",
      path: path.join(projectRoot, "custom/run-test")
    })
  })

  it("uses NoOutput when --no-artifacts is selected", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const request = await resolve(projectRoot, input(projectRoot, { noArtifacts: true }))

    expect(request.outputSink).toEqual({ _tag: "NoOutput" })
  })

  it("parses external artifact paths so V0 run can reject them", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const request = await resolve(
      projectRoot,
      input(projectRoot, { artifactPath: Option.some(AbsolutePath.make("s3://bucket/{runId}")) })
    )

    expect(request.outputSink).toEqual({ _tag: "ExternalSink", uri: "s3://bucket/run-test" })
  })

  it("rejects stale checks profile shape", async () => {
    const projectRoot = await makeFixtureProject(`
checks: {}
sandbox:
  provider: daytona
verifier:
  entrypoint:
    command: codex
scenarios: {}
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Rename `.sanity/checks` references to `scenarios` in the profile."
    })
  })

  it("rejects stale command-check profile shape", async () => {
    const projectRoot = await makeFixtureProject(`
command-check: {}
sandbox:
  provider: daytona
verifier:
  entrypoint:
    command: codex
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Move agent execution under `verifier.entrypoint` and behavior instructions under `scenarios`."
    })
  })

  it("rejects stale driver profile shape", async () => {
    const projectRoot = await makeFixtureProject(`
driver: codex
sandbox:
  provider: daytona
verifier:
  entrypoint:
    command: codex
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Move the agent command under `verifier.entrypoint` with structured `command` and `args`."
    })
  })

  it("rejects stale scenario command fields", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
verifier:
  entrypoint:
    command: codex
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
    command: npm test
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Keep scenario config to path, runSurface, and timeoutMinutes; verifier execution belongs to the profile."
    })
  })

  it("rejects scenario names that are unsafe sandbox path segments", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())

    await expect(resolve(projectRoot, input(projectRoot, { scenario: [ScenarioName.make("../escape")] }))).rejects.toMatchObject({
      _tag: "ConfigError"
    })
  })

  it("rejects invalid disposal and runSurface values", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
  disposal: unknown
verifier:
  entrypoint:
    command: codex
runSurface: console
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError"
    })
  })

  it("rejects mutually exclusive image and snapshot sandbox config", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
  config:
    image: node:22
    snapshot: snap-123
verifier:
  entrypoint:
    command: codex
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Choose either sandbox.config.image or sandbox.config.snapshot, not both."
    })
  })

  it("rejects invalid command env var names", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
setup:
  - command: npm
    args: ["install"]
    env:
      "BAD-NAME; echo nope": nope
verifier:
  entrypoint:
    command: codex
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Use POSIX-style environment variable names: letters, numbers, and underscores, not starting with a number."
    })
  })

  it("rejects shell-string verifier entrypoints", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
verifier:
  entrypoint: codex exec
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError"
    })
  })

  it("rejects non-positive verifier and scenario timeouts", async () => {
    const projectRoot = await makeFixtureProject(`
sandbox:
  provider: daytona
verifier:
  entrypoint:
    command: codex
  timeoutMinutes: 0
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
    timeoutMinutes: -1
`)

    await expect(resolve(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError"
    })
  })
})
