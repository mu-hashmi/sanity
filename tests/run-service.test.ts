import { Duration, Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { makeProjectConfig, ProjectConfig } from "../src/config/project-config.js"
import {
  AbsolutePath,
  ProfileName,
  RunFailure,
  RunId,
  ScenarioName,
  type CommandExit,
  type RunCliInput
} from "../src/domain.js"
import { CandidateArchive, makeCandidateArchiveFake } from "../src/run/candidate-archive.js"
import { run } from "../src/run/run-service.js"
import { DaytonaGateway } from "../src/sandbox/gateway.js"
import { makeFakeGateway, makeFakeGatewayState } from "../src/sandbox/fake-gateway.js"
import { makeFixtureProject, minimalProfile } from "./helpers/project.js"

const fakeArchive = AbsolutePath.make("/tmp/fake-candidate.tgz")

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

const runWithFakeGateway = async (
  projectRoot: AbsolutePath,
  runInput: RunCliInput,
  state = makeFakeGatewayState()
) =>
  Effect.runPromise(
    run(runInput, {
      projectRoot,
      nextRunId: () => RunId.make("run-test")
    }).pipe(
      Effect.provideService(ProjectConfig, makeProjectConfig(projectRoot)),
      Effect.provideService(DaytonaGateway, makeFakeGateway(state)),
      Effect.provideService(CandidateArchive, makeCandidateArchiveFake(fakeArchive))
    )
  ).then((outcome) => ({ outcome, state }))

const exit = (exitCode: number): CommandExit => ({
  exitCode,
  stdout: "",
  stderr: "",
  timedOut: false
})

const timedOutExit: CommandExit = {
  exitCode: 124,
  stdout: "",
  stderr: "timed out",
  timedOut: true
}

const tags = (state: { readonly events: ReadonlyArray<{ readonly _tag: string }> }): ReadonlyArray<string> =>
  state.events.map((event) => event._tag)

const executedResult = (outcome: Awaited<ReturnType<typeof runWithFakeGateway>>["outcome"]) => {
  expect(outcome._tag).toBe("Executed")
  if (outcome._tag !== "Executed") {
    throw new Error("Expected executed outcome")
  }
  return outcome.result
}

describe("run service", () => {
  it("dry-run resolves RunRequest without creating a sandbox", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome, state } = await runWithFakeGateway(projectRoot, input(projectRoot, { dryRun: true }))

    expect(outcome._tag).toBe("DryRun")
    expect(state.events).toEqual([])
  })

  it("dry-run does not require scenario markdown to exist", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile().replace(".sanity/scenarios/resolve-buttons.md", ".sanity/scenarios/missing.md")
    )
    const { outcome, state } = await runWithFakeGateway(projectRoot, input(projectRoot, { dryRun: true }))

    expect(outcome._tag).toBe("DryRun")
    expect(state.events).toEqual([])
  })

  it("headless run never starts Computer Use", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome, state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    expect(outcome._tag).toBe("Executed")
    expect(state.events.map((event) => event._tag)).not.toContain("StartedComputerUse")
  })

  it("graphical run starts capture and downloads recording for local artifact sinks", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
`)
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    expect(tags(state)).toEqual(
      expect.arrayContaining(["StartedComputerUse", "StartedRecording", "StoppedRecording", "DownloadedRecording", "StoppedComputerUse"])
    )
  })

  it("graphical capture wraps verifier execution and stops before output collection", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
`)
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))
    const eventTags = tags(state)
    const verifierCommandIndex = eventTags.indexOf("InvokedVerifier")

    expect(eventTags.indexOf("StartedRecording")).toBeLessThan(verifierCommandIndex)
    expect(verifierCommandIndex).toBeLessThan(eventTags.indexOf("StoppedRecording"))
    expect(eventTags.indexOf("StoppedComputerUse")).toBeLessThan(eventTags.indexOf("CollectedOutput"))
  })

  it("runs all selected scenarios even when an earlier verifier exits nonzero", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
  second-scenario:
    path: .sanity/scenarios/resolve-buttons.md
    runSurface: graphical
`)
    )
    const { outcome, state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot, { scenario: [ScenarioName.make("resolve-buttons"), ScenarioName.make("second-scenario")] }),
      makeFakeGatewayState({ commandExits: [exit(0), exit(1), exit(0)] })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.verifier.exitCode).toBe(1)
    }
    expect(state.events.filter((event) => event._tag === "WroteTextFile")).toHaveLength(2)
  })

  it("runs all scenarios selected by --all", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
  second-scenario:
    path: .sanity/scenarios/resolve-buttons.md
`)
    )
    const { state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot, {
        all: true,
        scenario: []
      })
    )

    expect(state.events.filter((event) => event._tag === "WroteTextFile")).toHaveLength(2)
  })

  it("writes distinct verifier input content for multiple scenarios", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
  second-scenario:
    path: .sanity/scenarios/resolve-buttons.md
`)
    )
    const { state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot, { scenario: [ScenarioName.make("resolve-buttons"), ScenarioName.make("second-scenario")] })
    )
    const writes = state.events.filter((event) => event._tag === "WroteTextFile")

    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({
      _tag: "WroteTextFile",
      path: "/workspace/.sanity/run/resolve-buttons-verifier-input.md"
    })
    expect(writes[0]?._tag === "WroteTextFile" ? writes[0].content : "").toContain("Scenario: resolve-buttons")
    expect(writes[1]).toMatchObject({
      _tag: "WroteTextFile",
      path: "/workspace/.sanity/run/second-scenario-verifier-input.md"
    })
    expect(writes[1]?._tag === "WroteTextFile" ? writes[1].content : "").toContain("Scenario: second-scenario")
  })

  it("uses the canonical verifier input path for single-scenario runs", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    expect(state.events.find((event) => event._tag === "WroteTextFile")).toMatchObject({
      _tag: "WroteTextFile",
      path: "/workspace/.sanity/run/verifier-input.md"
    })
  })

  it("uses distinct recording names for multiple graphical scenarios", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
  second-scenario:
    path: .sanity/scenarios/resolve-buttons.md
    runSurface: graphical
`)
    )
    const { state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot, { scenario: [ScenarioName.make("resolve-buttons"), ScenarioName.make("second-scenario")] })
    )

    expect(
      state.events
        .filter((event) => event._tag === "DownloadedRecording")
        .map((event) => (event._tag === "DownloadedRecording" ? event.recordingName : ""))
    ).toEqual(["recording-resolve-buttons", "recording-second-scenario"])
  })

  it("uses scenario timeout over verifier timeout", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    timeoutMinutes: 2
`)
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))
    const verifierCommand = state.events.find((event) => event._tag === "InvokedVerifier")

    expect(verifierCommand).toMatchObject({
      _tag: "InvokedVerifier",
      timeout: Option.some(Duration.minutes(2))
    })
  })

  it("passes sandbox-local verifier environment", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))
    const verifierCommand = state.events.find((event) => event._tag === "InvokedVerifier")

    expect(verifierCommand).toMatchObject({
      _tag: "InvokedVerifier",
      command: {
        env: {
          SANITY_AGENT_OUTPUT_DIR: "/workspace/.sanity/agent-output",
          SANITY_APP_URL: "http://localhost:3000",
          SANITY_WORKSPACE: "/workspace"
        }
      }
    })
  })

  it("verifier exit 1 is completed orchestration with verifier exit 1", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome } = await runWithFakeGateway(projectRoot, input(projectRoot), makeFakeGatewayState({ commandExits: [exit(0), exit(1)] }))

    expect(outcome._tag).toBe("Executed")
    if (outcome._tag === "Executed") {
      expect(outcome.result.status).toBe("completed")
      if (outcome.result.status === "completed") {
        expect(outcome.result.verifier.exitCode).toBe(1)
      }
    }
  })

  it("aggregates timedOut across multiple verifier scenarios", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
  second-scenario:
    path: .sanity/scenarios/resolve-buttons.md
`)
    )
    const { outcome } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot, { scenario: [ScenarioName.make("resolve-buttons"), ScenarioName.make("second-scenario")] }),
      makeFakeGatewayState({ commandExits: [exit(0), exit(1), timedOutExit] })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("completed")
    if (result.status === "completed") {
      expect(result.verifier.exitCode).toBe(1)
      expect(result.verifier.timedOut).toBe(true)
    }
  })

  it("setup command failure returns failed RunResult with setup phase", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome } = await runWithFakeGateway(projectRoot, input(projectRoot), makeFakeGatewayState({ commandExits: [exit(1)] }))

    expect(outcome._tag).toBe("Executed")
    if (outcome._tag === "Executed") {
      expect(outcome.result.status).toBe("failed")
      if (outcome.result.status === "failed") {
        expect(outcome.result.phase).toBe("setup")
      }
    }
  })

  it("external sinks parse but V0 run rejects them before creating a sandbox", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())

    await expect(
      runWithFakeGateway(projectRoot, input(projectRoot, { artifactPath: Option.some(AbsolutePath.make("s3://bucket/{runId}")) }))
    ).rejects.toMatchObject({
      _tag: "ConfigError",
      actionableFix: "Use a local --artifact-path or --no-artifacts for now."
    })
  })

  it("missing scenario files remain config errors before sandbox creation", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile().replace(".sanity/scenarios/resolve-buttons.md", ".sanity/scenarios/missing.md")
    )

    await expect(runWithFakeGateway(projectRoot, input(projectRoot))).rejects.toMatchObject({
      _tag: "ConfigError"
    })
  })

  it.each([
    ["provider", "provider"],
    ["app", "app"],
    ["capture", "capture"],
    ["collect-output", "collect-output"]
  ] as const)("returns failed RunResult with %s phase and actionable fix", async (_name, phase) => {
    const projectRoot = await makeFixtureProject(
      phase === "capture"
        ? minimalProfile(`
    runSurface: graphical
`)
        : minimalProfile()
    )
    const { outcome, state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot),
      makeFakeGatewayState({
        failPhase: new RunFailure({
          phase,
          message: `${phase} failed`,
          actionableFix: `fix ${phase}`
        })
      })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.phase).toBe(phase)
      expect(result.actionableFix).toBe(`fix ${phase}`)
    }
    if (phase !== "provider") {
      expect(tags(state)).toContain("DeletedSandbox")
    }
  })

  it("returns cancelled and still disposes when verifier execution is interrupted", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome, state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot),
      makeFakeGatewayState({ interruptPhase: "verifier" })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("cancelled")
    expect(tags(state)).toContain("DeletedSandbox")
  })

  it("stops graphical capture when verifier execution is interrupted", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
`)
    )
    const { outcome, state } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot),
      makeFakeGatewayState({ interruptPhase: "verifier" })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("cancelled")
    const eventTags = tags(state)
    expect(eventTags.indexOf("StartedRecording")).toBeLessThan(eventTags.indexOf("InvokedVerifier"))
    expect(eventTags.indexOf("InvokedVerifier")).toBeLessThan(eventTags.indexOf("StoppedRecording"))
    expect(eventTags.indexOf("StoppedRecording")).toBeLessThan(eventTags.indexOf("DownloadedRecording"))
    expect(eventTags.indexOf("DownloadedRecording")).toBeLessThan(eventTags.indexOf("StoppedComputerUse"))
    expect(eventTags.indexOf("StoppedComputerUse")).toBeLessThan(eventTags.indexOf("DeletedSandbox"))
  })

  it("NoOutput suppresses recording download and agent output collection", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile(`
    runSurface: graphical
`)
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot, { noArtifacts: true }))

    expect(tags(state)).toContain("StoppedComputerUse")
    expect(tags(state)).not.toContain("DownloadedRecording")
    expect(tags(state)).not.toContain("CollectedOutput")
  })

  it("disposal failure dominates body failure as disposal phase", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot),
      makeFakeGatewayState({
        commandExits: [exit(1)],
        failPhase: new RunFailure({
          phase: "disposal",
          message: "delete denied",
          actionableFix: "retry cleanup"
        })
      })
    )
    const result = executedResult(outcome)

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.phase).toBe("disposal")
      expect(Option.isSome(result.disposal)).toBe(true)
      if (Option.isSome(result.disposal)) {
        expect(result.disposal.value).toEqual({ _tag: "Failed", message: "delete denied" })
      }
    }
  })

  it("delete disposal deletes once", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    expect(state.events.filter((event) => event._tag === "DeletedSandbox")).toHaveLength(1)
  })

  it("retain disposal does not delete or archive", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile().replace("disposal: delete", "disposal: retain")
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    expect(tags(state)).not.toContain("DeletedSandbox")
    expect(tags(state)).not.toContain("ArchivedSandbox")
  })

  it("archive disposal stops before archive", async () => {
    const projectRoot = await makeFixtureProject(
      minimalProfile().replace("disposal: delete", "disposal: archive")
    )
    const { state } = await runWithFakeGateway(projectRoot, input(projectRoot))

    const events = state.events.map((event) => event._tag)
    expect(events.indexOf("StoppedSandbox")).toBeLessThan(events.indexOf("ArchivedSandbox"))
  })

  it("disposal failure is explicit and never unknown", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const { outcome } = await runWithFakeGateway(
      projectRoot,
      input(projectRoot),
      makeFakeGatewayState({
        failPhase: new RunFailure({
          phase: "disposal",
          message: "delete denied",
          actionableFix: "retry cleanup"
        })
      })
    )

    expect(outcome._tag).toBe("Executed")
    if (outcome._tag === "Executed") {
      expect(outcome.result.status).toBe("failed")
      if (outcome.result.status === "failed") {
        expect(outcome.result.phase).toBe("disposal")
        expect(Option.isSome(outcome.result.disposal)).toBe(true)
        if (Option.isSome(outcome.result.disposal)) {
          expect(outcome.result.disposal.value._tag).toBe("Failed")
        }
      }
    }
  })
})
