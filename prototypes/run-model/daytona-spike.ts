import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Daytona, type Sandbox } from '@daytona/sdk'
import { Console, Effect, Ref, Schema } from 'effect'
import {
  RunRecordSchema,
  buildInitialRunRecord,
  buildPrototypeRunPlan,
  skippedResultsFor,
  type ArtifactRef,
  type CheckResult,
  type CommandExecution,
  type PhaseRecord,
  type RunRecord,
} from './model.js'

type ExecuteResponse = Awaited<ReturnType<Sandbox['process']['executeCommand']>>
type SessionExecuteResponse = Awaited<ReturnType<Sandbox['process']['executeSessionCommand']>>

class MissingDaytonaApiKey extends Schema.TaggedError<MissingDaytonaApiKey>()(
  'MissingDaytonaApiKey',
  {},
) {
  override get message(): string {
    return 'DAYTONA_API_KEY is required for the Daytona execution spike.'
  }
}

class ExternalOperationError extends Schema.TaggedError<ExternalOperationError>()(
  'ExternalOperationError',
  {
    operation: Schema.String,
    error: Schema.Defect,
  },
) {
  override get message(): string {
    return `${this.operation} failed`
  }
}

class MissingScreenshotData extends Schema.TaggedError<MissingScreenshotData>()(
  'MissingScreenshotData',
  {
    label: Schema.String,
  },
) {
  override get message(): string {
    return `Daytona screenshot response did not include ${this.label} image data.`
  }
}

class PrototypeInvariantError extends Schema.TaggedError<PrototypeInvariantError>()(
  'PrototypeInvariantError',
  {
    message: Schema.String,
  },
) {}

interface PrototypeContext {
  readonly projectRoot: string
  readonly artifactDir: string
  readonly runRecordPath: string
  readonly plan: ReturnType<typeof buildPrototypeRunPlan>
  readonly recordRef: Ref.Ref<RunRecord>
  readonly recordingIdRef: Ref.Ref<string | undefined>
}

const projectRoot = process.cwd()
const runId = `prototype-${new Date().toISOString().replace(/[:.]/g, '-')}`
const artifactDir = join(projectRoot, '.sanity', 'prototype-runs', runId)
const runRecordPath = join(artifactDir, 'run-record.json')
const plan = buildPrototypeRunPlan(runId, projectRoot)

const main = Effect.gen(function* () {
  if (!process.env.DAYTONA_API_KEY) {
    return yield* new MissingDaytonaApiKey()
  }

  const recordRef = yield* Ref.make(buildInitialRunRecord(plan, new Date().toISOString()))
  const recordingIdRef = yield* Ref.make<string | undefined>(undefined)
  const context: PrototypeContext = {
    projectRoot,
    artifactDir,
    runRecordPath,
    plan,
    recordRef,
    recordingIdRef,
  }

  yield* makeDirectory(context.artifactDir)
  yield* writeRecord(context)
  yield* printState(context, 'created initial RunRecord')

  yield* Effect.acquireUseRelease(
    createSandbox(context),
    sandbox => runInSandbox(context, sandbox).pipe(
      Effect.catchAll(error => recordError(context, error).pipe(Effect.zipRight(Effect.fail(error)))),
    ),
    sandbox => releaseSandbox(context, sandbox).pipe(
      Effect.catchAll(error => Console.error(formatUnknownError(error))),
    ),
  )
}).pipe(
  Effect.catchAll(error =>
    Console.error(formatUnknownError(error)).pipe(
      Effect.zipRight(Effect.sync(() => {
        process.exitCode = 1
      })),
    ),
  ),
)

const createSandbox = Effect.fn('prototype.createSandbox')(function* (context: PrototypeContext) {
  yield* updateRecord(context, current => withPhase(current, 'provision', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Creating Daytona sandbox.',
  }))
  yield* writeRecord(context)
  yield* printState(context, 'provisioning sandbox')

  const daytona = new Daytona()
  const sandbox = yield* tryPromise('create Daytona sandbox', () =>
    daytona.create({
      language: 'typescript',
      public: true,
      ephemeral: true,
      labels: {
        project: 'sanity',
        prototype: 'run-model',
        runId: context.plan.runId,
      },
    }, { timeout: 180 }),
  )

  yield* updateRecord(context, current => ({
    ...current,
    sandbox: sandboxRecord(sandbox, false),
    phases: {
      ...current.phases,
      provision: {
        status: 'passed',
        startedAt: current.phases.provision.startedAt,
        completedAt: new Date().toISOString(),
        summary: `Sandbox ${sandbox.id} created.`,
      },
    },
  }))
  yield* writeRecord(context)
  yield* printState(context, 'sandbox created')

  return sandbox
})

const runInSandbox = Effect.fn('prototype.runInSandbox')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const setup = yield* runSetup(context, sandbox)
  yield* updateRecord(context, current => withPhase(current, 'setup', setup))
  yield* writeRecord(context)
  yield* printState(context, 'setup complete')

  if (setup.status !== 'passed') {
    yield* finishBeforeChecks(context, 'error', 'setup-failed')
    yield* printState(context, 'setup failed; checks skipped')
    return
  }

  const app = yield* startAppAndWaitForHealth(context, sandbox)
  yield* updateRecord(context, current => {
    const next = withPhase(current, 'app', app.phase)

    if (app.previewUrl === undefined || next.sandbox === undefined) {
      return next
    }

    return {
      ...next,
      sandbox: {
        ...next.sandbox,
        previewUrl: app.previewUrl,
      },
    }
  })
  yield* writeRecord(context)
  yield* printState(context, 'app phase complete')

  if (app.phase.status !== 'passed') {
    yield* finishBeforeChecks(context, 'error', 'app-failed')
    yield* printState(context, 'app failed; checks skipped')
    return
  }

  const artifacts = yield* startArtifacts(context, sandbox)
  yield* Ref.set(context.recordingIdRef, artifacts.recordingId)
  yield* updateRecord(context, current => ({
    ...current,
    phases: {
      ...current.phases,
      artifactCapture: artifacts.phase,
    },
    artifacts: [...current.artifacts, ...artifacts.refs],
  }))
  yield* writeRecord(context)
  yield* printState(context, 'artifact capture started')

  const checkResults = yield* runChecks(context, sandbox)
  yield* updateRecord(context, current => ({
    ...current,
    status: checkResults.every(result => result.status === 'passed') ? 'passed' : 'failed',
    checks: checkResults,
  }))
  yield* writeRecord(context)
  yield* printState(context, 'checks complete')

  const stoppedArtifacts = yield* stopArtifacts(context, sandbox, artifacts.recordingId)
  yield* Ref.set(context.recordingIdRef, undefined)
  yield* updateRecord(context, current => ({
    ...current,
    phases: {
      ...current.phases,
      artifactCapture: {
        status: 'passed',
        startedAt: current.phases.artifactCapture.startedAt,
        completedAt: new Date().toISOString(),
        summary: 'Screenshots and recording captured.',
      },
    },
    artifacts: [
      ...current.artifacts,
      ...stoppedArtifacts,
      {
        kind: 'run-record',
        label: 'run record',
        path: relativeArtifactPath(context, context.runRecordPath),
      },
    ],
  }))
  yield* writeRecord(context)
  yield* printState(context, 'artifacts complete')
})

const runSetup = Effect.fn('prototype.runSetup')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const startedAt = new Date().toISOString()
  const commands: CommandExecution[] = []

  for (const command of context.plan.setup) {
    const executed = yield* executeAndPersist(context, sandbox, 'setup', command, 60)
    commands.push(executed.execution)

    if (executed.response.exitCode !== 0) {
      return {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        summary: `Setup command exited ${executed.response.exitCode}.`,
        commands,
      } satisfies PhaseRecord
    }
  }

  return {
    status: 'passed',
    startedAt,
    completedAt: new Date().toISOString(),
    summary: 'Setup commands completed.',
    commands,
  } satisfies PhaseRecord
})

const startAppAndWaitForHealth = Effect.fn('prototype.startAppAndWaitForHealth')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const startedAt = new Date().toISOString()
  const sessionId = 'sanity-prototype-app'
  yield* tryPromise('create app session', () => sandbox.process.createSession(sessionId))
  const appCommand = yield* tryPromise('start app command', () =>
    sandbox.process.executeSessionCommand(sessionId, {
      command: context.plan.app.start,
      runAsync: true,
    }),
  )

  const healthcheck = yield* waitForHealth(context, sandbox)
  const appLogPath = join(context.artifactDir, 'app.log')
  yield* persistSessionLogs(context, sandbox, sessionId, appCommand, appLogPath)

  if (healthcheck.exitCode !== 0) {
    return {
      phase: {
        status: 'error',
        startedAt,
        completedAt: new Date().toISOString(),
        summary: 'App healthcheck failed before checks could run.',
        commands: [
          {
            command: context.plan.app.start,
            exitCode: healthcheck.exitCode,
            outputPath: relativeArtifactPath(context, appLogPath),
            startedAt,
            completedAt: new Date().toISOString(),
          },
        ],
      } satisfies PhaseRecord,
    }
  }

  const preview = yield* tryPromise('get preview link', () => sandbox.getPreviewLink(context.plan.app.port))

  return {
    phase: {
      status: 'passed',
      startedAt,
      completedAt: new Date().toISOString(),
      summary: 'App started and healthcheck passed.',
      commands: [
        {
          command: context.plan.app.start,
          exitCode: 0,
          outputPath: relativeArtifactPath(context, appLogPath),
          startedAt,
          completedAt: new Date().toISOString(),
        },
      ],
    } satisfies PhaseRecord,
    previewUrl: preview.url,
  }
})

const waitForHealth = Effect.fn('prototype.waitForHealth')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const path = context.plan.app.healthcheck ?? '/'
  const command = [
    'node -e "',
    `fetch('http://127.0.0.1:${context.plan.app.port}${path}')`,
    ".then(async r=>{const body=await r.text();",
    "if(!r.ok){console.error(body);process.exit(1)}",
    "console.log(body)",
    '})',
    ".catch(err=>{console.error(err.message);process.exit(1)})",
    '"',
  ].join('')

  let lastResponse: ExecuteResponse | undefined

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    lastResponse = yield* tryPromise('run app healthcheck', () =>
      sandbox.process.executeCommand(command, undefined, undefined, 10),
    )

    if (lastResponse.exitCode === 0) {
      return lastResponse
    }

    yield* Effect.sleep('1 second')
  }

  if (lastResponse === undefined) {
    return yield* new PrototypeInvariantError({ message: 'Healthcheck loop produced no command response.' })
  }

  return lastResponse
})

const startArtifacts = Effect.fn('prototype.startArtifacts')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const startedAt = new Date().toISOString()
  const refs: ArtifactRef[] = []

  yield* tryPromise('start Computer Use', () => sandbox.computerUse.start())

  if (context.plan.artifacts.screenshots) {
    const screenshot = yield* tryPromise('take initial screenshot', () =>
      sandbox.computerUse.screenshot.takeFullScreen(true),
    )
    const screenshotPath = join(context.artifactDir, 'initial-screenshot.png')

    if (screenshot.screenshot === undefined) {
      return yield* new MissingScreenshotData({ label: 'initial screenshot' })
    }

    yield* writeBinaryFile(screenshotPath, Buffer.from(screenshot.screenshot, 'base64'))
    refs.push({
      kind: 'screenshot',
      label: 'initial screenshot',
      path: relativeArtifactPath(context, screenshotPath),
    })
  }

  if (!context.plan.artifacts.recording) {
    return {
      phase: {
        status: 'running',
        startedAt,
        summary: 'Computer Use started; recording disabled by artifact policy.',
      } satisfies PhaseRecord,
      refs,
    }
  }

  const recording = yield* tryPromise('start recording', () => sandbox.computerUse.recording.start(context.plan.runId))

  return {
    phase: {
      status: 'running',
      startedAt,
      summary: `Recording ${recording.id} started.`,
    } satisfies PhaseRecord,
    recordingId: recording.id,
    refs,
  }
})

const runChecks = Effect.fn('prototype.runChecks')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const results: CheckResult[] = []

  for (const check of context.plan.checks) {
    switch (check.driver) {
      case 'command': {
        const executed = yield* executeAndPersist(
          context,
          sandbox,
          `check-${check.name}`,
          check.command,
          (check.maxMinutes ?? 1) * 60,
        )
        const passed = executed.response.exitCode === 0
        const outputPath = executed.execution.outputPath

        if (outputPath === undefined) {
          return yield* new PrototypeInvariantError({ message: 'Command execution did not produce an output path.' })
        }

        results.push({
          check: check.name,
          driver: 'command',
          status: passed ? 'passed' : 'failed',
          command: check.command,
          exitCode: executed.response.exitCode,
          summary: passed
            ? `Command exited ${executed.response.exitCode}.`
            : `Command failed with exit ${executed.response.exitCode}.`,
          artifacts: [
            {
              kind: 'log',
              label: `${check.name} output`,
              path: outputPath,
            },
          ],
        })
        break
      }
      case 'agent':
        results.push({
          check: check.name,
          driver: 'agent',
          status: 'inconclusive',
          verdict: 'inconclusive',
          summary: 'Agent checks are intentionally out of scope for this Daytona execution spike.',
          artifacts: [],
        })
        break
    }
  }

  return results
})

const stopArtifacts = Effect.fn('prototype.stopArtifacts')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
  recordingId: string | undefined,
) {
  const refs: ArtifactRef[] = []

  if (context.plan.artifacts.screenshots) {
    const screenshot = yield* tryPromise('take final screenshot', () =>
      sandbox.computerUse.screenshot.takeFullScreen(true),
    )
    const screenshotPath = join(context.artifactDir, 'final-screenshot.png')

    if (screenshot.screenshot === undefined) {
      return yield* new MissingScreenshotData({ label: 'final screenshot' })
    }

    yield* writeBinaryFile(screenshotPath, Buffer.from(screenshot.screenshot, 'base64'))
    refs.push({
      kind: 'screenshot',
      label: 'final screenshot',
      path: relativeArtifactPath(context, screenshotPath),
    })
  }

  if (recordingId !== undefined) {
    yield* tryPromise('stop recording', () => sandbox.computerUse.recording.stop(recordingId))
    const recordingPath = join(context.artifactDir, 'recording.mp4')
    yield* tryPromise('download recording', () => sandbox.computerUse.recording.download(recordingId, recordingPath))
    refs.push({
      kind: 'recording',
      label: 'screen recording',
      path: relativeArtifactPath(context, recordingPath),
    })
  }

  yield* tryPromise('stop Computer Use', () => sandbox.computerUse.stop())

  return refs
})

const releaseSandbox = Effect.fn('prototype.releaseSandbox')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const recordingId = yield* Ref.get(context.recordingIdRef)

  if (recordingId !== undefined) {
    yield* tryPromise('stop recording during cleanup', () => sandbox.computerUse.recording.stop(recordingId)).pipe(
      Effect.catchAll(error => writeTextArtifact(context, 'recording-stop-error.log', formatUnknownError(error))),
    )
  }

  const startedAt = new Date().toISOString()
  yield* tryPromise('delete sandbox', () => sandbox.delete(120)).pipe(
    Effect.catchAll(error => writeTextArtifact(context, 'sandbox-delete-error.log', formatUnknownError(error))),
  )

  yield* updateRecord(context, current => ({
    ...current,
    completedAt: new Date().toISOString(),
    sandbox: current.sandbox === undefined ? undefined : {
      ...current.sandbox,
      deleted: true,
    },
    phases: {
      ...current.phases,
      cleanup: {
        status: 'passed',
        startedAt,
        completedAt: new Date().toISOString(),
        summary: `Sandbox ${sandbox.id} deleted.`,
      },
    },
  }))
  yield* writeRecord(context)
  yield* printState(context, 'sandbox cleaned up')
})

const executeAndPersist = Effect.fn('prototype.executeAndPersist')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
  label: string,
  command: string,
  timeoutSeconds: number,
) {
  const startedAt = new Date().toISOString()
  const response = yield* tryPromise(`execute ${label}`, () =>
    sandbox.process.executeCommand(command, undefined, undefined, timeoutSeconds),
  )
  const completedAt = new Date().toISOString()
  const outputPath = join(context.artifactDir, `${label}.log`)
  yield* writeTextFile(outputPath, response.result)

  return {
    response,
    execution: {
      command,
      exitCode: response.exitCode,
      outputPath: relativeArtifactPath(context, outputPath),
      startedAt,
      completedAt,
    } satisfies CommandExecution,
  }
})

const persistSessionLogs = Effect.fn('prototype.persistSessionLogs')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
  sessionId: string,
  command: SessionExecuteResponse,
  outputPath: string,
) {
  const logs = yield* tryPromise('read session command logs', () =>
    sandbox.process.getSessionCommandLogs(sessionId, command.cmdId),
  )
  const output = [
    logs.stdout === undefined ? '' : logs.stdout,
    logs.stderr === undefined ? '' : logs.stderr,
    logs.output === undefined ? '' : logs.output,
  ].filter(part => part.length > 0).join('\n')

  yield* writeTextFile(outputPath, output)
})

const finishBeforeChecks = Effect.fn('prototype.finishBeforeChecks')(function* (
  context: PrototypeContext,
  status: RunRecord['status'],
  reason: Parameters<typeof skippedResultsFor>[1],
) {
  yield* updateRecord(context, current => ({
    ...current,
    status,
    completedAt: new Date().toISOString(),
    checks: skippedResultsFor(context.plan.checks, reason),
  }))
  yield* writeRecord(context)
})

const recordError = Effect.fn('prototype.recordError')(function* (
  context: PrototypeContext,
  error: unknown,
) {
  yield* updateRecord(context, current => ({
    ...current,
    status: 'error',
    completedAt: new Date().toISOString(),
    checks: current.checks.length === 0 ? skippedResultsFor(context.plan.checks, 'cancelled') : current.checks,
  }))
  yield* writeTextArtifact(context, 'prototype-error.log', formatUnknownError(error))
  yield* updateRecord(context, current => ({
    ...current,
    artifacts: [
      ...current.artifacts,
      {
        kind: 'log',
        label: 'prototype error',
        path: relativeArtifactPath(context, join(context.artifactDir, 'prototype-error.log')),
      },
    ],
  }))
  yield* writeRecord(context)
  yield* printState(context, 'prototype errored')
})

const updateRecord = Effect.fn('prototype.updateRecord')(function* (
  context: PrototypeContext,
  update: (current: RunRecord) => RunRecord,
) {
  const current = yield* Ref.get(context.recordRef)
  const next = update(current)
  const decoded = yield* Schema.decodeUnknown(RunRecordSchema)(next)
  yield* Ref.set(context.recordRef, decoded)
  return decoded
})

const writeRecord = Effect.fn('prototype.writeRecord')(function* (context: PrototypeContext) {
  const current = yield* Ref.get(context.recordRef)
  const decoded = yield* Schema.decodeUnknown(RunRecordSchema)(current)
  yield* writeTextFile(context.runRecordPath, `${JSON.stringify(decoded, null, 2)}\n`)
})

const writeTextArtifact = Effect.fn('prototype.writeTextArtifact')(function* (
  context: PrototypeContext,
  fileName: string,
  content: string,
) {
  yield* makeDirectory(context.artifactDir)
  yield* writeTextFile(join(context.artifactDir, fileName), content)
})

function withPhase(
  current: RunRecord,
  phase: keyof RunRecord['phases'],
  phaseRecord: PhaseRecord,
): RunRecord {
  return {
    ...current,
    phases: {
      ...current.phases,
      [phase]: phaseRecord,
    },
  }
}

function sandboxRecord(sandbox: Sandbox, deleted: boolean): NonNullable<RunRecord['sandbox']> {
  const base = {
    id: sandbox.id,
    deleted,
  }

  return {
    ...base,
    ...(sandbox.name === undefined ? {} : { name: sandbox.name }),
    ...(sandbox.snapshot === undefined ? {} : { snapshot: sandbox.snapshot }),
  }
}

function relativeArtifactPath(context: PrototypeContext, path: string): string {
  return path.startsWith(context.projectRoot)
    ? path.slice(context.projectRoot.length + 1)
    : path
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return JSON.stringify(error, null, 2) ?? String(error)
}

const printState = Effect.fn('prototype.printState')(function* (context: PrototypeContext, label: string) {
  const current = yield* Ref.get(context.recordRef)
  yield* Console.log(`[${new Date().toISOString()}] ${label}`)
  yield* Console.log(
    `runId=${current.runId} status=${current.status} record=${relativeArtifactPath(context, context.runRecordPath)}`,
  )
})

function tryPromise<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, ExternalOperationError> {
  return Effect.tryPromise({
    try: run,
    catch: error => new ExternalOperationError({ operation, error }),
  })
}

function makeDirectory(path: string): Effect.Effect<void, ExternalOperationError> {
  return tryPromise(`create directory ${path}`, () => mkdir(path, { recursive: true })).pipe(Effect.asVoid)
}

function writeTextFile(path: string, content: string): Effect.Effect<void, ExternalOperationError> {
  return tryPromise(`write file ${path}`, () => writeFile(path, content)).pipe(Effect.asVoid)
}

function writeBinaryFile(path: string, content: Buffer): Effect.Effect<void, ExternalOperationError> {
  return tryPromise(`write file ${path}`, () => writeFile(path, content)).pipe(Effect.asVoid)
}

Effect.runPromise(main)
