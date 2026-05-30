import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Daytona, type Sandbox } from "@daytona/sdk"
import { Duration, Effect, Layer, Option, Result } from "effect"
import {
  NonEmptyString,
  RunFailure,
  SandboxPath,
  type AppHandle,
  type AppSpec,
  type CaptureHandle,
  type CommandExit,
  type CommandSpec,
  type DaytonaSandboxConfig,
  type OutputSink,
  type SandboxHandle
} from "../domain.js"
import { basename, commandToShell, dirname, shellQuote } from "./shell.js"
import { DaytonaGateway, type DaytonaGatewayShape } from "./gateway.js"

const workspacePath = SandboxPath.make("/workspace")
const candidateArchivePath = SandboxPath.make("/tmp/sanity-candidate.tgz")
const agentOutputArchivePath = SandboxPath.make("/tmp/sanity-agent-output.tgz")

const seconds = (duration: Duration.Duration): number => Math.max(1, Math.ceil(Duration.toSeconds(duration)))
const timeoutExitCode = 124

const causeMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

const providerFailure = (message: string, cause: unknown): RunFailure =>
  new RunFailure({
    phase: "provider",
    message: `${message}: ${causeMessage(cause)}`,
    actionableFix: "Check Daytona credentials, target availability, and network connectivity."
  })

const commandFailure = (phase: RunFailure["phase"], message: string, cause: unknown): RunFailure =>
  new RunFailure({
    phase,
    message: `${message}: ${causeMessage(cause)}`,
    actionableFix: "Inspect the sandbox command, project setup, and generated artifacts for details."
  })

const handleFor = (sandbox: Sandbox): SandboxHandle => ({
  id: sandbox.id,
  name: sandbox.name,
  target: sandbox.target
})

const configNumber = (value: Option.Option<number>): number | undefined =>
  Option.match(value, {
    onNone: () => undefined,
    onSome: (number) => number
  })

const createParams = (config: DaytonaSandboxConfig): Record<string, string | number | boolean> => {
  const base: Record<string, string | number | boolean> = {
    public: true
  }

  const autoStopInterval = configNumber(config.autoStopMinutes)
  if (autoStopInterval !== undefined) {
    base["autoStopInterval"] = autoStopInterval
  }
  const autoArchiveInterval = configNumber(config.autoArchiveMinutes)
  if (autoArchiveInterval !== undefined) {
    base["autoArchiveInterval"] = autoArchiveInterval
  }
  const autoDeleteInterval = configNumber(config.autoDeleteMinutes)
  if (autoDeleteInterval !== undefined) {
    base["autoDeleteInterval"] = autoDeleteInterval
  }

  if (Option.isSome(config.image)) {
    return { ...base, image: config.image.value }
  }
  if (Option.isSome(config.snapshot)) {
    return { ...base, snapshot: config.snapshot.value }
  }
  return { ...base, language: "typescript" }
}

export const recordingPathFor = (sink: OutputSink, recordingName: string): string | undefined => {
  if (sink._tag !== "LocalArtifactPath") {
    return undefined
  }
  return path.join(sink.path, `${recordingName}.mp4`)
}

const envPrefix = (env: Readonly<Record<string, string>>): string => {
  const entries = Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
  return entries.length === 0 ? "" : `env ${entries.join(" ")} `
}

export const appSessionCommand = (app: AppSpec): string => {
  const cwd = Option.getOrElse(app.start.cwd, () => workspacePath)
  return `cd ${shellQuote(cwd)} && ${envPrefix(app.start.env)}${commandToShell(app.start)}`
}

const captureAttempt = <A>(effect: Effect.Effect<A, RunFailure>): Effect.Effect<Option.Option<RunFailure>> =>
  effect.pipe(
    Effect.result,
    Effect.map(
      Result.match({
        onFailure: Option.some,
        onSuccess: () => Option.none()
      })
    )
  )

export const makeDaytonaGateway = (): DaytonaGatewayShape => {
  const sandboxes = new Map<string, Sandbox>()

  const getSandbox = (handle: SandboxHandle): Effect.Effect<Sandbox, RunFailure> => {
    const sandbox = sandboxes.get(handle.id)
    return sandbox === undefined
      ? Effect.fail(
          new RunFailure({
            phase: "provider",
            message: `Sandbox handle ${handle.id} is not known to this Daytona gateway.`,
            actionableFix: "Run the operation with the same Sanity process that created the sandbox."
          })
        )
      : Effect.succeed(sandbox)
  }

  const runShell = (
    sandbox: Sandbox,
    command: string,
    cwd: Option.Option<SandboxPath>,
    env: Readonly<Record<string, string>>,
    timeout: Option.Option<Duration.Duration>
  ): Effect.Effect<CommandExit, RunFailure> =>
    Effect.tryPromise({
      try: async () => {
        const timeoutSeconds = Option.match(timeout, { onNone: () => undefined, onSome: seconds })
        const commandWithTimeout =
          timeoutSeconds === undefined ? command : `timeout --kill-after=5s ${timeoutSeconds}s ${command}`
        const response = await sandbox.process.executeCommand(
          commandWithTimeout,
          Option.getOrUndefined(cwd),
          env,
          undefined
        )
        const timedOut = timeoutSeconds !== undefined && response.exitCode === timeoutExitCode
        return {
          exitCode: response.exitCode,
          stdout: response.result,
          stderr: timedOut ? `Command timed out after ${timeoutSeconds}s` : "",
          timedOut
        }
      },
      catch: (cause) => commandFailure("provider", `Could not run sandbox command ${command}`, cause)
    })

  return {
    create: (config) =>
      Effect.tryPromise({
        try: async () => {
          const daytona = new Daytona(
            Option.match(config.target, {
              onNone: () => ({}),
              onSome: (target) => ({ target })
            })
          )
          const sandbox = await daytona.create(createParams(config))
          sandboxes.set(sandbox.id, sandbox)
          return handleFor(sandbox)
        },
        catch: (cause) => providerFailure("Could not create Daytona sandbox", cause)
      }),
    uploadCandidate: (handle, tarball) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: () => sandbox.fs.uploadFile(tarball, candidateArchivePath),
          catch: (cause) => providerFailure("Could not upload candidate archive", cause)
        })
        const extractCommand: CommandSpec = {
          command: NonEmptyString.make("sh"),
          args: ["-lc", `mkdir -p ${shellQuote(workspacePath)} && tar -xzf ${shellQuote(candidateArchivePath)} -C ${shellQuote(workspacePath)}`],
          cwd: Option.none(),
          env: {}
        }
        const exit = yield* runShell(sandbox, commandToShell(extractCommand), Option.none(), {}, Option.none())
        if (exit.exitCode !== 0) {
          yield* new RunFailure({
            phase: "candidate",
            message: `Could not extract candidate archive in sandbox: ${exit.stdout}`,
            actionableFix: "Check that the candidate archive is a valid tarball and the sandbox has tar installed."
          })
        }
      }),
    writeTextFile: (handle, remotePath, content) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: async () => {
            await sandbox.process.executeCommand(`mkdir -p ${shellQuote(dirname(remotePath))}`)
            await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), remotePath)
          },
          catch: (cause) => providerFailure(`Could not write ${remotePath} in sandbox`, cause)
        })
      }),
    runCommand: (handle, command, timeout) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        return yield* runShell(sandbox, commandToShell(command), command.cwd, command.env, timeout)
      }),
    startApp: (handle, app) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: async () => {
            const sessionId = "sanity-app"
            await sandbox.process.createSession(sessionId)
            await sandbox.process.executeSessionCommand(
              sessionId,
              {
                command: appSessionCommand(app),
                runAsync: true,
                suppressInputEcho: true
              },
              1
            )
          },
          catch: (cause) => commandFailure("app", "Could not start app process", cause)
        })

        const healthcheckUrl = `http://127.0.0.1:${app.port}${app.healthcheckPath}`
        const healthcheckCommand: CommandSpec = {
          command: NonEmptyString.make("node"),
          args: [
            "-e",
            `fetch(${JSON.stringify(healthcheckUrl)}).then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`
          ],
          cwd: Option.some(workspacePath),
          env: {}
        }
        const deadline = Date.now() + Duration.toMillis(app.readinessTimeout)
        let healthy = false
        while (!healthy && Date.now() < deadline) {
          healthy = yield* runShell(
            sandbox,
            commandToShell(healthcheckCommand),
            healthcheckCommand.cwd,
            healthcheckCommand.env,
            Option.some(Duration.seconds(5))
          ).pipe(
            Effect.match({
              onFailure: () => false,
              onSuccess: (exit) => exit.exitCode === 0
            })
          )
          if (!healthy) {
            yield* Effect.sleep(Duration.seconds(2))
          }
        }
        if (!healthy) {
          yield* new RunFailure({
            phase: "app",
            message: `App did not become healthy at ${healthcheckUrl}.`,
            actionableFix: "Check the app start command, port, and healthcheckPath in the profile."
          })
        }
        const appHandle: AppHandle = { appUrl: Option.some(`http://localhost:${app.port}`) }
        return appHandle
      }),
    startCapture: (handle, surface) =>
      Effect.gen(function* () {
        if (surface === "headless") {
          const capture: CaptureHandle = { _tag: "NoCapture" }
          return capture
        }
        const sandbox = yield* getSandbox(handle)
        return yield* Effect.tryPromise({
          try: async () => {
            await sandbox.computerUse.start()
            let recordingId: string
            try {
              const recording = await sandbox.computerUse.recording.start("sanity-run")
              recordingId = recording.id
            } catch (error) {
              await sandbox.computerUse.stop().catch(() => undefined)
              throw error
            }
            const capture: CaptureHandle = { _tag: "RecordingCapture", recordingId }
            return capture
          },
          catch: (cause) => commandFailure("capture", "Could not start Daytona Computer Use capture", cause)
        })
      }),
    stopCapture: (handle, capture, sink, recordingName) =>
      Effect.gen(function* () {
        if (capture._tag === "NoCapture") {
          return
        }
        const sandbox = yield* getSandbox(handle)
        const stopRecordingFailure = yield* captureAttempt(
          Effect.tryPromise({
            try: () => sandbox.computerUse.recording.stop(capture.recordingId),
            catch: (cause) => commandFailure("capture", "Could not stop Daytona Computer Use recording", cause)
          })
        )
        const recordingPath = recordingPathFor(sink, recordingName)
        const downloadFailure =
          recordingPath === undefined
            ? Option.none<RunFailure>()
            : yield* captureAttempt(
                Effect.tryPromise({
                  try: async () => {
                    await mkdir(path.dirname(recordingPath), { recursive: true })
                    await sandbox.computerUse.recording.download(capture.recordingId, recordingPath)
                  },
                  catch: (cause) => commandFailure("capture", "Could not download Daytona Computer Use recording", cause)
                })
              )
        const stopComputerUseFailure = yield* captureAttempt(
          Effect.tryPromise({
            try: () => sandbox.computerUse.stop(),
            catch: (cause) => commandFailure("capture", "Could not stop Daytona Computer Use", cause)
          })
        )
        const failure = [stopRecordingFailure, downloadFailure, stopComputerUseFailure].find(Option.isSome)
        if (failure !== undefined) {
          yield* failure.value
        }
      }),
    collectOutput: (handle, agentOutputDir, sink) =>
      Effect.gen(function* () {
        if (Option.isNone(agentOutputDir) || sink._tag !== "LocalArtifactPath") {
          return
        }
        const sandbox = yield* getSandbox(handle)
        const remoteDir = agentOutputDir.value
        const packCommand: CommandSpec = {
          command: NonEmptyString.make("sh"),
          args: [
            "-lc",
            [
              `if [ -d ${shellQuote(remoteDir)} ]; then`,
              `tar -czf ${shellQuote(agentOutputArchivePath)} -C ${shellQuote(dirname(remoteDir))} ${shellQuote(basename(remoteDir))};`,
              "fi"
            ].join(" ")
          ],
          cwd: Option.some(workspacePath),
          env: {}
        }
        const packExit = yield* runShell(sandbox, commandToShell(packCommand), packCommand.cwd, packCommand.env, Option.some(Duration.minutes(5)))
        if (packExit.exitCode !== 0) {
          yield* new RunFailure({
            phase: "collect-output",
            message: `Could not package agent output: ${packExit.stdout}`,
            actionableFix: "Check verifier agent output permissions and path."
          })
        }
        const existsCommand: CommandSpec = {
          command: NonEmptyString.make("test"),
          args: ["-f", agentOutputArchivePath],
          cwd: Option.some(workspacePath),
          env: {}
        }
        const exists = yield* runShell(sandbox, commandToShell(existsCommand), existsCommand.cwd, existsCommand.env, Option.some(Duration.seconds(10)))
        if (exists.exitCode === 0) {
          yield* Effect.tryPromise({
            try: () => sandbox.fs.downloadFile(agentOutputArchivePath, path.join(sink.path, "agent-output.tgz")),
            catch: (cause) => commandFailure("collect-output", "Could not download agent output", cause)
          })
        }
      }),
    delete: (handle) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: () => sandbox.delete(),
          catch: (cause) => commandFailure("disposal", "Could not delete sandbox", cause)
        })
        sandboxes.delete(handle.id)
      }),
    stop: (handle) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: () => sandbox.stop(),
          catch: (cause) => commandFailure("disposal", "Could not stop sandbox", cause)
        })
      }),
    archive: (handle) =>
      Effect.gen(function* () {
        const sandbox = yield* getSandbox(handle)
        yield* Effect.tryPromise({
          try: () => sandbox.archive(),
          catch: (cause) => commandFailure("disposal", "Could not archive sandbox", cause)
        })
        sandboxes.delete(handle.id)
      })
  }
}

export const DaytonaGatewayLive = Layer.succeed(DaytonaGateway, makeDaytonaGateway())
