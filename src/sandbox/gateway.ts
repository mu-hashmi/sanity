import { Context, Duration, Effect, Option } from "effect"
import type {
  AppHandle,
  AppSpec,
  CaptureHandle,
  CommandExit,
  CommandSpec,
  DaytonaSandboxConfig,
  OutputSink,
  RunSurface,
  SandboxHandle,
  SandboxPath
} from "../domain.js"
import { RunFailure } from "../domain.js"

export type DaytonaGatewayShape = {
  readonly create: (config: DaytonaSandboxConfig) => Effect.Effect<SandboxHandle, RunFailure>
  readonly uploadCandidate: (sandbox: SandboxHandle, tarball: string) => Effect.Effect<void, RunFailure>
  readonly writeTextFile: (sandbox: SandboxHandle, remotePath: SandboxPath, content: string) => Effect.Effect<void, RunFailure>
  readonly runCommand: (
    sandbox: SandboxHandle,
    command: CommandSpec,
    timeout: Option.Option<Duration.Duration>
  ) => Effect.Effect<CommandExit, RunFailure>
  readonly startApp: (sandbox: SandboxHandle, app: AppSpec) => Effect.Effect<AppHandle, RunFailure>
  readonly startCapture: (sandbox: SandboxHandle, surface: RunSurface) => Effect.Effect<CaptureHandle, RunFailure>
  readonly stopCapture: (sandbox: SandboxHandle, capture: CaptureHandle, sink: OutputSink, recordingName: string) => Effect.Effect<void, RunFailure>
  readonly collectOutput: (
    sandbox: SandboxHandle,
    agentOutputDir: Option.Option<SandboxPath>,
    sink: OutputSink
  ) => Effect.Effect<void, RunFailure>
  readonly delete: (sandbox: SandboxHandle) => Effect.Effect<void, RunFailure>
  readonly stop: (sandbox: SandboxHandle) => Effect.Effect<void, RunFailure>
  readonly archive: (sandbox: SandboxHandle) => Effect.Effect<void, RunFailure>
}

export class DaytonaGateway extends Context.Service<DaytonaGateway, DaytonaGatewayShape>()("DaytonaGateway") {}
