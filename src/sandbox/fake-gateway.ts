import { Duration, Effect, Layer, Option } from "effect"
import {
  type AppHandle,
  type AppSpec,
  type CaptureHandle,
  type CommandExit,
  type CommandSpec,
  type DaytonaSandboxConfig,
  RunFailure,
  type SandboxHandle,
  type SandboxPath
} from "../domain.js"
import { DaytonaGateway, type DaytonaGatewayShape } from "./gateway.js"

export type FakeGatewayEvent =
  | { readonly _tag: "CreatedSandbox" }
  | { readonly _tag: "UploadedCandidate"; readonly tarball: string }
  | { readonly _tag: "WroteTextFile"; readonly path: SandboxPath; readonly content: string }
  | { readonly _tag: "RanSetupCommand"; readonly command: CommandSpec; readonly timeout: Option.Option<Duration.Duration> }
  | { readonly _tag: "InvokedVerifier"; readonly command: CommandSpec; readonly timeout: Option.Option<Duration.Duration> }
  | { readonly _tag: "StartedApp"; readonly app: AppSpec }
  | { readonly _tag: "StartedComputerUse" }
  | { readonly _tag: "StartedRecording" }
  | { readonly _tag: "StoppedRecording" }
  | { readonly _tag: "DownloadedRecording"; readonly recordingName: string }
  | { readonly _tag: "StoppedComputerUse" }
  | { readonly _tag: "CollectedOutput" }
  | { readonly _tag: "DeletedSandbox" }
  | { readonly _tag: "StoppedSandbox" }
  | { readonly _tag: "ArchivedSandbox" }

export type FakeGatewayState = {
  readonly events: Array<FakeGatewayEvent>
  readonly commandExits: Array<CommandExit>
  readonly failPhase: Option.Option<RunFailure>
  readonly interruptPhase: Option.Option<"verifier">
}

const defaultExit: CommandExit = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  timedOut: false
}

const sandbox: SandboxHandle = {
  id: "fake-sandbox",
  name: "fake-sandbox",
  target: "local"
}

const push = (state: FakeGatewayState, event: FakeGatewayEvent): void => {
  state.events.push(event)
}

const failIfConfigured = (state: FakeGatewayState, phase: string): Effect.Effect<void, RunFailure> =>
  Option.match(state.failPhase, {
    onNone: () => Effect.void,
    onSome: (failure) => (failure.phase === phase ? Effect.fail(failure) : Effect.void)
  })

const nextExit = (state: FakeGatewayState): CommandExit => state.commandExits.shift() ?? defaultExit

const isVerifierCommand = (command: CommandSpec): boolean => "SANITY_VERIFIER_INPUT" in command.env

export const makeFakeGateway = (state: FakeGatewayState): DaytonaGatewayShape => ({
  create: (_config: DaytonaSandboxConfig) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "provider")
      push(state, { _tag: "CreatedSandbox" })
      return sandbox
    }),
  uploadCandidate: (_sandbox, tarball) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "provider")
      push(state, { _tag: "UploadedCandidate", tarball })
    }),
  writeTextFile: (_sandbox, remotePath, content) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "provider")
      push(state, { _tag: "WroteTextFile", path: remotePath, content })
    }),
  runCommand: (_sandbox, command, timeout) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "provider")
      push(state, isVerifierCommand(command) ? { _tag: "InvokedVerifier", command, timeout } : { _tag: "RanSetupCommand", command, timeout })
      if (Option.isSome(state.interruptPhase) && state.interruptPhase.value === "verifier" && isVerifierCommand(command)) {
        yield* Effect.interrupt
      }
      return nextExit(state)
    }),
  startApp: (_sandbox, app) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "app")
      push(state, { _tag: "StartedApp", app })
      const handle: AppHandle = { appUrl: Option.some(`http://localhost:${app.port}`) }
      return handle
    }),
  startCapture: (_sandbox, surface) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "capture")
      if (surface === "headless") {
        const handle: CaptureHandle = { _tag: "NoCapture" }
        return handle
      }
      push(state, { _tag: "StartedComputerUse" })
      push(state, { _tag: "StartedRecording" })
      const handle: CaptureHandle = { _tag: "RecordingCapture", recordingId: "fake-recording" }
      return handle
    }),
  stopCapture: (_sandbox, capture, sink, recordingName) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "capture")
      if (capture._tag === "NoCapture") {
        return
      }
      push(state, { _tag: "StoppedRecording" })
      if (sink._tag === "LocalArtifactPath") {
        push(state, { _tag: "DownloadedRecording", recordingName })
      }
      push(state, { _tag: "StoppedComputerUse" })
    }),
  collectOutput: (_sandbox, agentOutputDir, sink) =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "collect-output")
      if (Option.isSome(agentOutputDir) && sink._tag === "LocalArtifactPath") {
        push(state, { _tag: "CollectedOutput" })
      }
    }),
  delete: () =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "disposal")
      push(state, { _tag: "DeletedSandbox" })
    }),
  stop: () =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "disposal")
      push(state, { _tag: "StoppedSandbox" })
    }),
  archive: () =>
    Effect.gen(function* () {
      yield* failIfConfigured(state, "disposal")
      push(state, { _tag: "ArchivedSandbox" })
    })
})

export const FakeGatewayLayer = (state: FakeGatewayState) => Layer.succeed(DaytonaGateway, makeFakeGateway(state))

export const makeFakeGatewayState = (options?: {
  readonly commandExits?: ReadonlyArray<CommandExit>
  readonly failPhase?: RunFailure
  readonly interruptPhase?: "verifier"
}): FakeGatewayState => ({
  events: [],
  commandExits: [...(options?.commandExits ?? [])],
  failPhase: options?.failPhase === undefined ? Option.none() : Option.some(options.failPhase),
  interruptPhase: options?.interruptPhase === undefined ? Option.none() : Option.some(options.interruptPhase)
})
