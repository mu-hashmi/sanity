import { Daytona, type Sandbox } from '@daytona/sdk'
import { Console, Effect, Ref, Schema } from 'effect'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const prototypeVersion = 'prototype.verifier-harness.v1'
const projectRoot = resolve('.')
const runRoot = join(projectRoot, '.sanity', 'prototype-runs', 'verifier-harness')
const remoteRoot = '/home/daytona/sanity-verifier-harness'
const remoteAppDir = '/home/daytona/sanity-app'
const appPort = 3000
const localAppUrl = `http://127.0.0.1:${appPort}`

const modes = [
  'harness',
  'agent-baseline',
  'agent-hinted-visible',
  'agent-preopened',
  'agent-preopened-hinted',
] as const
type Mode = (typeof modes)[number]
const agentModes = [
  'agent-baseline',
  'agent-hinted-visible',
  'agent-preopened',
  'agent-preopened-hinted',
] as const
type AgentMode = (typeof agentModes)[number]

const NonEmptyText = Schema.String.pipe(Schema.minLength(1))
const Timestamp = NonEmptyText

const PhaseStatusSchema = Schema.Literal('pending', 'running', 'completed', 'error', 'skipped')

const HarnessStatusSchema = Schema.Literal('running', 'completed', 'error', 'cancelled')

const VerifierProcessStatusSchema = Schema.Literal('completed', 'exited-nonzero', 'error')
type VerifierProcessStatus = Schema.Schema.Type<typeof VerifierProcessStatusSchema>

const ArtifactRefSchema = Schema.Struct({
  kind: Schema.Literal('recording', 'screenshot', 'verifier-output', 'app-log', 'agent-report', 'run-record', 'environment-log'),
  label: NonEmptyText,
  path: NonEmptyText,
})
type ArtifactRef = Schema.Schema.Type<typeof ArtifactRefSchema>

const PhaseRecordSchema = Schema.Struct({
  status: PhaseStatusSchema,
  startedAt: Schema.optional(Timestamp),
  completedAt: Schema.optional(Timestamp),
  summary: Schema.optional(NonEmptyText),
})
type PhaseRecord = Schema.Schema.Type<typeof PhaseRecordSchema>

const VerifierProcessSchema = Schema.Struct({
  command: NonEmptyText,
  status: VerifierProcessStatusSchema,
  exitCode: Schema.optional(Schema.Number),
  startedAt: Timestamp,
  completedAt: Timestamp,
  outputPath: Schema.optional(NonEmptyText),
  summary: NonEmptyText,
})
type VerifierProcess = Schema.Schema.Type<typeof VerifierProcessSchema>

const HarnessRunRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(prototypeVersion),
  runId: NonEmptyText,
  mode: Schema.Literal(
    'harness',
    'agent-baseline',
    'agent-hinted-visible',
    'agent-preopened',
    'agent-preopened-hinted',
  ),
  question: NonEmptyText,
  status: HarnessStatusSchema,
  startedAt: Timestamp,
  completedAt: Schema.optional(Timestamp),
  sandbox: Schema.optional(Schema.Struct({
    id: NonEmptyText,
    name: Schema.optional(NonEmptyText),
    snapshot: Schema.optional(NonEmptyText),
    previewUrl: Schema.optional(NonEmptyText),
    deleted: Schema.Boolean,
  })),
  app: Schema.Struct({
    localUrl: NonEmptyText,
    previewUrl: Schema.optional(NonEmptyText),
    port: Schema.Number,
    healthcheck: NonEmptyText,
  }),
  scenarioPath: NonEmptyText,
  phases: Schema.Struct({
    provision: PhaseRecordSchema,
    setup: PhaseRecordSchema,
    app: PhaseRecordSchema,
    artifactCapture: PhaseRecordSchema,
    verifier: PhaseRecordSchema,
    cleanup: PhaseRecordSchema,
  }),
  verifier: Schema.optional(VerifierProcessSchema),
  artifacts: Schema.Array(ArtifactRefSchema),
  observations: Schema.Array(NonEmptyText),
})
type HarnessRunRecord = Schema.Schema.Type<typeof HarnessRunRecordSchema>

class MissingDaytonaApiKey extends Schema.TaggedError<MissingDaytonaApiKey>()(
  'MissingDaytonaApiKey',
  {},
) {
  override get message(): string {
    return 'DAYTONA_API_KEY is required for the verifier harness prototype.'
  }
}

class MissingCodexAuth extends Schema.TaggedError<MissingCodexAuth>()(
  'MissingCodexAuth',
  { path: NonEmptyText },
) {
  override get message(): string {
    return `Codex auth file was not found at ${this.path}.`
  }
}

class PrototypeExternalError extends Schema.TaggedError<PrototypeExternalError>()(
  'PrototypeExternalError',
  {
    operation: NonEmptyText,
    error: Schema.Defect,
  },
) {
  override get message(): string {
    return `${this.operation} failed.`
  }
}

class MissingScreenshotData extends Schema.TaggedError<MissingScreenshotData>()(
  'MissingScreenshotData',
  { label: NonEmptyText },
) {
  override get message(): string {
    return `Daytona screenshot response did not include ${this.label} image data.`
  }
}

interface PrototypeContext {
  readonly mode: Mode
  readonly runId: string
  readonly artifactDir: string
  readonly runRecordPath: string
  readonly scenarioPath: string
  readonly remoteScenarioPath: string
  readonly remoteAgentPromptPath: string
  readonly recordRef: Ref.Ref<HarnessRunRecord>
  readonly recordingIdRef: Ref.Ref<string | undefined>
}

const question = [
  'Can Sanity run an arbitrary verifier command inside the Daytona sandbox,',
  'record the evidence window, and avoid requiring the verifier to write',
  'Sanity-specific result or artifact files?',
].join(' ')

const scenarioText = [
  '# Scenario: Invite Button',
  '',
  'Open the running app in the graphical browser.',
  'Click the "Send Invite" button.',
  'Verify that test@example.com appears in the Pending invites list.',
  'Report what happened in normal language.',
].join('\n')

function agentPromptText(mode: AgentMode): string {
  switch (mode) {
    case 'agent-baseline':
      return [
        'You are verifying a user-facing scenario in a Daytona sandbox.',
        '',
        `The app is already running on this machine at ${localAppUrl}.`,
        'Use the graphical browser on the desktop as much as possible; avoid API-only checks unless you need them to debug.',
        '',
        scenarioText,
        '',
        'Finish with a concise report of what you observed. Do not write any special result file.',
      ].join('\n')

    case 'agent-hinted-visible':
      return [
        'You are verifying a user-facing scenario in a Daytona sandbox.',
        '',
        `The app is already running on this machine at ${localAppUrl}.`,
        'For reviewable video evidence, open the app in the visible desktop browser before interacting with it.',
        'If no browser is already open, run this exact visible-browser command and then use that window:',
        '',
        '```bash',
        visibleBrowserCommand,
        '```',
        '',
        'After the app is visible, click the blue "Send Invite" button near the upper-left area of the page, under the "Team invites" heading.',
        'Verify that test@example.com appears in the Pending invites list.',
        '',
        'Finish with a concise report of what you observed. Do not write any special result file.',
      ].join('\n')

    case 'agent-preopened':
      return [
        'You are verifying a user-facing scenario in a Daytona sandbox.',
        '',
        `The app is already running on this machine at ${localAppUrl}.`,
        'A visible Chromium window is already open on the recorded desktop with the app loaded.',
        'Use that visible browser window to perform the scenario. Avoid launching a separate headless browser unless visible interaction is impossible.',
        '',
        scenarioText,
        '',
        'Finish with a concise report of what you observed. Do not write any special result file.',
      ].join('\n')

    case 'agent-preopened-hinted':
      return [
        'You are verifying a user-facing scenario in a Daytona sandbox.',
        '',
        `The app is already running on this machine at ${localAppUrl}.`,
        'A visible Chromium window is already open on the recorded desktop with the app loaded.',
        'The window was opened with remote debugging on 127.0.0.1:9222, so you may attach to that visible browser if shell/browser tooling needs a control path.',
        'In the visible app, click the blue "Send Invite" button near the upper-left area of the page, under the "Team invites" heading.',
        'Verify that test@example.com appears in the Pending invites list.',
        '',
        'Finish with a concise report of what you observed. Do not write any special result file.',
      ].join('\n')

    default:
      return assertNever(mode)
  }
}

const visibleBrowserCommand = [
  'export DISPLAY=:0',
  'nohup chromium --no-sandbox --disable-dev-shm-usage --window-size=1200,900 ' +
    '--user-data-dir=/tmp/sanity-visible-chromium ' +
    '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 ' +
    `${localAppUrl} >/tmp/sanity-visible-chromium.log 2>&1 &`,
].join('\n')

const appServerSource = `
import http from 'node:http'

const invites = []

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

const page = \`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sanity Invite Prototype</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 48px; background: #f6f7fb; color: #172033; }
    main { max-width: 680px; background: white; border: 1px solid #dde2ee; border-radius: 8px; padding: 28px; }
    button { font: inherit; padding: 10px 14px; border: 0; border-radius: 6px; background: #146ef5; color: white; cursor: pointer; }
    li { margin: 8px 0; }
    .muted { color: #607089; }
  </style>
</head>
<body>
  <main>
    <h1>Team invites</h1>
    <p class="muted">This tiny app exists only for the verifier-harness prototype.</p>
    <button id="invite">Send Invite</button>
    <h2>Pending invites</h2>
    <ul id="pending"><li class="muted">No pending invites</li></ul>
  </main>
  <script>
    async function refresh() {
      const response = await fetch('/api/invites')
      const data = await response.json()
      const pending = document.querySelector('#pending')
      pending.innerHTML = ''
      if (data.invites.length === 0) {
        const item = document.createElement('li')
        item.className = 'muted'
        item.textContent = 'No pending invites'
        pending.appendChild(item)
        return
      }
      for (const invite of data.invites) {
        const item = document.createElement('li')
        item.textContent = invite.email
        pending.appendChild(item)
      }
    }

    document.querySelector('#invite').addEventListener('click', async () => {
      await fetch('/api/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      })
      await refresh()
    })

    setInterval(refresh, 1000)
    refresh()
  </script>
</body>
</html>\`

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.end('ok')
    return
  }

  if (req.url === '/api/invites' && req.method === 'GET') {
    sendJson(res, 200, { invites })
    return
  }

  if (req.url === '/api/invite' && req.method === 'POST') {
    const body = await readBody(req)
    const parsed = body.trim() === '' ? { email: 'test@example.com' } : JSON.parse(body)
    invites.push({ email: parsed.email, createdAt: new Date().toISOString() })
    sendJson(res, 200, { ok: true, invites })
    return
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(page)
    return
  }

  sendJson(res, 404, { error: 'not found' })
})

server.listen(3000, '0.0.0.0', () => {
  console.log('sanity verifier harness app listening on 3000')
})
`

const main = Effect.fn('prototype.verifierHarness.main')(function* () {
  if (process.env.DAYTONA_API_KEY === undefined || process.env.DAYTONA_API_KEY.length === 0) {
    return yield* new MissingDaytonaApiKey()
  }

  const selectedModes = parseModes(process.argv.slice(2))
  for (const mode of selectedModes) {
    yield* runMode(mode)
  }
})

const runMode = Effect.fn('prototype.verifierHarness.runMode')(function* (mode: Mode) {
  const runId = `vh-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const artifactDir = join(runRoot, runId)
  const runRecordPath = join(artifactDir, 'run-record.json')
  const scenarioPath = join(artifactDir, 'scenario.md')
  yield* tryPromise('create local artifact directory', () => mkdir(artifactDir, { recursive: true }))
  yield* tryPromise('write scenario file', () => writeFile(scenarioPath, scenarioText))

  const recordRef = yield* Ref.make(initialRecord(mode, runId, scenarioPath))
  const recordingIdRef = yield* Ref.make<string | undefined>(undefined)
  const context: PrototypeContext = {
    mode,
    runId,
    artifactDir,
    runRecordPath,
    scenarioPath,
    remoteScenarioPath: `${remoteRoot}/scenario.md`,
    remoteAgentPromptPath: `${remoteRoot}/agent-prompt.md`,
    recordRef,
    recordingIdRef,
  }

  yield* writeRecord(context)
  yield* Console.log(`\n[${mode}] starting run ${runId}`)

  const result = yield* Effect.acquireUseRelease(
    createSandbox(context),
    sandbox => runInSandbox(context, sandbox),
    sandbox => releaseSandbox(context, sandbox).pipe(Effect.catchAll(() => Effect.void)),
  ).pipe(Effect.either)

  if (result._tag === 'Left') {
    yield* updateRecord(context, current => ({
      ...current,
      status: 'error',
      completedAt: new Date().toISOString(),
      observations: [...current.observations, formatUnknownError(result.left)],
    }))
    yield* writeRecord(context)
    yield* Console.log(`[${mode}] harness error recorded: ${relativeArtifactPath(context, runRecordPath)}`)
    return
  }

  yield* Console.log(`[${mode}] completed: ${relativeArtifactPath(context, runRecordPath)}`)
})

const createSandbox = Effect.fn('prototype.verifierHarness.createSandbox')(function* (context: PrototypeContext) {
  yield* updatePhase(context, 'provision', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Creating Daytona sandbox.',
  })
  yield* writeRecord(context)

  const daytona = new Daytona()
  const sandbox = yield* tryPromise('create Daytona sandbox', () =>
    daytona.create({
      language: 'typescript',
      public: true,
      ephemeral: true,
      envVars: {
        DAYTONA_SANDBOX_OTEL_EXTRA_LABELS: `project=sanity,prototype=verifier-harness,run_id=${context.runId},mode=${context.mode}`,
      },
      labels: {
        project: 'sanity',
        prototype: 'verifier-harness',
        runId: context.runId,
        mode: context.mode,
      },
    }, { timeout: 180 }),
  )

  yield* updateRecord(context, current => ({
    ...current,
    sandbox: sandboxRecord(sandbox, false),
    phases: withPhase(current.phases, 'provision', {
      ...current.phases.provision,
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary: `Sandbox ${sandbox.id} created.`,
    }),
  }))
  yield* writeRecord(context)
  return sandbox
})

const runInSandbox = Effect.fn('prototype.verifierHarness.runInSandbox')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* setupFiles(context, sandbox)
  const previewUrl = yield* startAppAndWait(context, sandbox)
  yield* startArtifacts(context, sandbox)
  const verifier = yield* runVerifier(context, sandbox)
  yield* stopArtifacts(context, sandbox)
  yield* downloadAppLog(context, sandbox)

  yield* updateRecord(context, current => ({
    ...current,
    status: 'completed',
    completedAt: new Date().toISOString(),
    app: {
      ...current.app,
      previewUrl,
    },
    verifier,
    artifacts: [
      ...current.artifacts,
      {
        kind: 'run-record',
        label: 'run record',
        path: relativeArtifactPath(context, context.runRecordPath),
      },
    ],
    observations: [
      ...current.observations,
      observationFor(context.mode, verifier),
    ],
  }))
  yield* writeRecord(context)
})

const setupFiles = Effect.fn('prototype.verifierHarness.setupFiles')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* updatePhase(context, 'setup', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Uploading prototype app and scenario.',
  })
  yield* writeRecord(context)

  yield* execute(sandbox, 'mkdir -p /home/daytona/sanity-app /home/daytona/sanity-verifier-harness')
  yield* tryPromise('upload prototype app server', () =>
    sandbox.fs.uploadFile(Buffer.from(appServerSource), `${remoteAppDir}/server.mjs`),
  )
  yield* tryPromise('upload scenario', () =>
    sandbox.fs.uploadFile(Buffer.from(scenarioText), context.remoteScenarioPath),
  )

  if (isAgentMode(context.mode)) {
    const agentMode = context.mode
    yield* tryPromise('upload agent prompt', () =>
      sandbox.fs.uploadFile(Buffer.from(agentPromptText(agentMode)), context.remoteAgentPromptPath),
    )
    yield* uploadCodexAuth(context, sandbox)
  }

  yield* updatePhase(context, 'setup', {
    status: 'completed',
    startedAt: currentStartedAt(yield* Ref.get(context.recordRef), 'setup'),
    completedAt: new Date().toISOString(),
    summary: isAgentMode(context.mode)
      ? 'Prototype files uploaded; Codex auth copied into the sandbox.'
      : 'Prototype files uploaded.',
  })
  yield* writeRecord(context)
})

const uploadCodexAuth = Effect.fn('prototype.verifierHarness.uploadCodexAuth')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const authPath = join(homedir(), '.codex', 'auth.json')
  const authStat = yield* Effect.tryPromise({
    try: () => stat(authPath),
    catch: () => new MissingCodexAuth({ path: authPath }),
  })

  if (!authStat.isFile()) {
    return yield* new MissingCodexAuth({ path: authPath })
  }

  yield* execute(sandbox, 'mkdir -p /home/daytona/.codex && chmod 700 /home/daytona/.codex')
  yield* tryPromise('upload Codex auth', () => sandbox.fs.uploadFile(authPath, '/home/daytona/.codex/auth.json'))
  yield* execute(sandbox, 'chmod 600 /home/daytona/.codex/auth.json')
})

const startAppAndWait = Effect.fn('prototype.verifierHarness.startAppAndWait')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* updatePhase(context, 'app', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Starting tiny prototype app.',
  })
  yield* writeRecord(context)

  const sessionId = 'sanity-app'
  yield* tryPromise('create app session', () => sandbox.process.createSession(sessionId))
  yield* tryPromise('start app session command', () =>
    sandbox.process.executeSessionCommand(sessionId, {
      command: 'bash -lc "source /usr/local/share/nvm/nvm.sh >/dev/null 2>&1 || true; nvm use default >/dev/null 2>&1 || true; node /home/daytona/sanity-app/server.mjs"',
      runAsync: true,
    }, 5),
  )

  yield* waitForHealth(context, sandbox)
  const preview = yield* tryPromise('get preview link', () => sandbox.getPreviewLink(appPort))
  const previewUrl = preview.url

  yield* updateRecord(context, current => ({
    ...current,
    app: {
      ...current.app,
      previewUrl,
    },
    sandbox: current.sandbox === undefined ? undefined : {
      ...current.sandbox,
      previewUrl,
    },
    phases: withPhase(current.phases, 'app', {
      ...current.phases.app,
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary: `App healthy at ${localAppUrl}.`,
    }),
  }))
  yield* writeRecord(context)

  return previewUrl
})

const waitForHealth = Effect.fn('prototype.verifierHarness.waitForHealth')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = yield* execute(sandbox, `node -e "fetch('${localAppUrl}/health').then(async r => { const body = await r.text(); if (!r.ok || body.trim() !== 'ok') process.exit(1); console.log(body.trim()) }).catch(() => process.exit(1))"`, 5)
    if (response.exitCode === 0) {
      return
    }
    yield* Effect.sleep('1 second')
  }

  return yield* new PrototypeExternalError({
    operation: 'wait for app healthcheck',
    error: new Error('healthcheck did not pass within 30 seconds'),
  })
})

const startArtifacts = Effect.fn('prototype.verifierHarness.startArtifacts')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* updatePhase(context, 'artifactCapture', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Starting Computer Use and screen recording.',
  })
  yield* writeRecord(context)

  yield* tryPromise('start Computer Use', () => sandbox.computerUse.start())
  yield* takeScreenshot(context, sandbox, 'initial screenshot', 'initial-screenshot.png')
  const recording = yield* tryPromise('start recording', () => sandbox.computerUse.recording.start(context.runId))
  yield* Ref.set(context.recordingIdRef, recording.id)
  if (shouldPreopenBrowser(context.mode)) {
    yield* preopenVisibleBrowser(context, sandbox)
  }
  yield* writeRecord(context)
})

const preopenVisibleBrowser = Effect.fn('prototype.verifierHarness.preopenVisibleBrowser')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* execute(sandbox, preopenVisibleBrowserCommand(), 15)
  yield* Effect.sleep('4 seconds')
  yield* takeScreenshot(context, sandbox, 'preopened browser screenshot', 'preopened-browser-screenshot.png')

  const logPath = join(context.artifactDir, 'visible-browser.log')
  yield* tryPromise('download visible browser log', () =>
    sandbox.fs.downloadFile('/tmp/sanity-visible-chromium.log', logPath, 30),
  ).pipe(Effect.catchAll(() => tryPromise('write missing visible browser log', () => writeFile(logPath, 'visible browser log unavailable\n'))))
  yield* addArtifact(context, {
    kind: 'environment-log',
    label: 'visible browser launch log',
    path: relativeArtifactPath(context, logPath),
  })
})

const runVerifier = Effect.fn('prototype.verifierHarness.runVerifier')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const startedAt = new Date().toISOString()
  yield* updatePhase(context, 'verifier', {
    status: 'running',
    startedAt,
    summary: `Running ${context.mode} verifier command.`,
  })
  yield* writeRecord(context)

  const command = context.mode === 'harness'
    ? harnessVerifierCommand(context.remoteScenarioPath)
    : codexVerifierCommand(context.remoteAgentPromptPath)

  const response = yield* execute(sandbox, command, isAgentMode(context.mode) ? 900 : 90)
  const completedAt = new Date().toISOString()
  const outputPath = join(context.artifactDir, 'verifier-output.txt')
  yield* tryPromise('write verifier output', () => writeFile(outputPath, response.result))
  const outputRef: ArtifactRef = {
    kind: 'verifier-output',
    label: `${context.mode} verifier output`,
    path: relativeArtifactPath(context, outputPath),
  }
  const agentReportRef = yield* maybeDownloadAgentReport(context, sandbox)

  const status: VerifierProcessStatus = response.exitCode === 0 ? 'completed' : 'exited-nonzero'
  const verifier: VerifierProcess = {
    command: context.mode === 'harness' ? 'dumb shell verifier' : `codex exec verifier (${context.mode})`,
    status,
    exitCode: response.exitCode,
    startedAt,
    completedAt,
    outputPath: outputRef.path,
    summary: response.exitCode === 0
      ? 'Verifier process exited 0. This is process completion, not a Sanity-owned scenario verdict.'
      : `Verifier process exited ${response.exitCode}. This is process completion, not a Sanity-owned scenario verdict.`,
  }

  yield* updateRecord(context, current => ({
    ...current,
    phases: withPhase(current.phases, 'verifier', {
      status: 'completed',
      startedAt,
      completedAt,
      summary: verifier.summary,
    }),
    artifacts: agentReportRef === undefined
      ? [...current.artifacts, outputRef]
      : [...current.artifacts, outputRef, agentReportRef],
  }))
  yield* writeRecord(context)
  return verifier
})

function harnessVerifierCommand(remoteScenarioPath: string): string {
  return [
    'bash -lc ' + shellQuote([
      'set -u',
      'echo "=== scenario ==="',
      `cat ${shellWord(remoteScenarioPath)}`,
      'echo "=== dumb verifier ==="',
      `echo "App URL: ${localAppUrl}"`,
      'export DISPLAY=:0',
      'chromium --no-sandbox --disable-dev-shm-usage --user-data-dir=/tmp/sanity-harness-chromium ' +
        `${shellWord(localAppUrl)} >/tmp/sanity-harness-chromium.log 2>&1 &`,
      'sleep 4',
      `curl -fsS -X POST -H 'content-type: application/json' --data '{"email":"test@example.com"}' ${shellWord(`${localAppUrl}/api/invite`)}`,
      'echo',
      'sleep 3',
      `curl -fsS ${shellWord(`${localAppUrl}/api/invites`)}`,
      'echo',
      'echo "Dumb verifier only exercised the envelope; it did not write Sanity-specific artifacts."',
    ].join('\n')),
  ].join('')
}

function codexVerifierCommand(remotePromptPath: string): string {
  return [
    'bash -lc ' + shellQuote([
      'set -u',
      'source /usr/local/share/nvm/nvm.sh >/dev/null 2>&1 || true',
      'nvm use default >/dev/null 2>&1 || true',
      'export CODEX_HOME=/home/daytona/.codex',
      'export DISPLAY=:0',
      'echo "=== codex version ==="',
      'codex --version',
      'echo "=== codex verifier ==="',
      'codex exec --json --ignore-user-config --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox ' +
        `-C ${shellWord(remoteAppDir)} -o ${shellWord(`${remoteRoot}/codex-final.md`)} "$(cat ${shellWord(remotePromptPath)})"`,
    ].join('\n')),
  ].join('')
}

const maybeDownloadAgentReport = Effect.fn('prototype.verifierHarness.maybeDownloadAgentReport')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  if (!isAgentMode(context.mode)) {
    return undefined
  }

  const localPath = join(context.artifactDir, 'codex-final.md')
  const downloaded = yield* Effect.tryPromise({
    try: () => sandbox.fs.downloadFile(`${remoteRoot}/codex-final.md`, localPath, 60).then(() => true),
    catch: () => false,
  })

  if (!downloaded) {
    return undefined
  }

  return {
    kind: 'agent-report',
    label: 'Codex final report',
    path: relativeArtifactPath(context, localPath),
  } satisfies ArtifactRef
})

const stopArtifacts = Effect.fn('prototype.verifierHarness.stopArtifacts')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  yield* takeScreenshot(context, sandbox, 'final screenshot', 'final-screenshot.png')
  const recordingId = yield* Ref.get(context.recordingIdRef)
  if (recordingId !== undefined) {
    yield* tryPromise('stop recording', () => sandbox.computerUse.recording.stop(recordingId))
    yield* Ref.set(context.recordingIdRef, undefined)
    const recordingPath = join(context.artifactDir, 'recording.mp4')
    yield* tryPromise('download recording', () => sandbox.computerUse.recording.download(recordingId, recordingPath))
    yield* addArtifact(context, {
      kind: 'recording',
      label: 'screen recording',
      path: relativeArtifactPath(context, recordingPath),
    })
  }
  yield* tryPromise('stop Computer Use', () => sandbox.computerUse.stop())
  yield* updatePhase(context, 'artifactCapture', {
    status: 'completed',
    startedAt: currentStartedAt(yield* Ref.get(context.recordRef), 'artifactCapture'),
    completedAt: new Date().toISOString(),
    summary: 'Recording and screenshots captured.',
  })
  yield* writeRecord(context)
})

const takeScreenshot = Effect.fn('prototype.verifierHarness.takeScreenshot')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
  label: string,
  fileName: string,
) {
  const screenshot = yield* tryPromise(`take ${label}`, () => sandbox.computerUse.screenshot.takeFullScreen(true))
  if (screenshot.screenshot === undefined) {
    return yield* new MissingScreenshotData({ label })
  }
  const screenshotData = screenshot.screenshot
  const screenshotPath = join(context.artifactDir, fileName)
  yield* tryPromise(`write ${label}`, () => writeFile(screenshotPath, Buffer.from(screenshotData, 'base64')))
  yield* addArtifact(context, {
    kind: 'screenshot',
    label,
    path: relativeArtifactPath(context, screenshotPath),
  })
})

const downloadAppLog = Effect.fn('prototype.verifierHarness.downloadAppLog')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const logs = yield* tryPromise('get app logs', () => sandbox.process.getSessionCommandLogs('sanity-app', 'cmd-1')).pipe(
    Effect.catchAll(() => Effect.succeed({ output: 'app logs unavailable' })),
  )
  const logPath = join(context.artifactDir, 'app.log')
  yield* tryPromise('write app log', () => writeFile(logPath, logs.output ?? ''))
  yield* addArtifact(context, {
    kind: 'app-log',
    label: 'app startup log',
    path: relativeArtifactPath(context, logPath),
  })
})

const releaseSandbox = Effect.fn('prototype.verifierHarness.releaseSandbox')(function* (
  context: PrototypeContext,
  sandbox: Sandbox,
) {
  const recordingId = yield* Ref.get(context.recordingIdRef)
  if (recordingId !== undefined) {
    yield* tryPromise('stop recording during cleanup', () => sandbox.computerUse.recording.stop(recordingId)).pipe(
      Effect.catchAll(() => Effect.void),
    )
    yield* Ref.set(context.recordingIdRef, undefined)
  }
  yield* tryPromise('stop Computer Use during cleanup', () => sandbox.computerUse.stop()).pipe(
    Effect.catchAll(() => Effect.void),
  )
  yield* updatePhase(context, 'cleanup', {
    status: 'running',
    startedAt: new Date().toISOString(),
    summary: 'Deleting Daytona sandbox.',
  }).pipe(Effect.catchAll(() => Effect.void))
  yield* writeRecord(context).pipe(Effect.catchAll(() => Effect.void))

  yield* tryPromise('delete Daytona sandbox', () => sandbox.delete(120)).pipe(
    Effect.catchAll(error => addObservation(context, formatUnknownError(error))),
  )
  yield* updateRecord(context, current => ({
    ...current,
    sandbox: current.sandbox === undefined ? undefined : {
      ...current.sandbox,
      deleted: true,
    },
    phases: withPhase(current.phases, 'cleanup', {
      ...current.phases.cleanup,
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary: `Sandbox ${sandbox.id} deleted.`,
    }),
  })).pipe(Effect.catchAll(() => Effect.void))
  yield* writeRecord(context).pipe(Effect.catchAll(() => Effect.void))
})

function initialRecord(mode: Mode, runId: string, scenarioPath: string): HarnessRunRecord {
  return {
    schemaVersion: prototypeVersion,
    runId,
    mode,
    question,
    status: 'running',
    startedAt: new Date().toISOString(),
    app: {
      localUrl: localAppUrl,
      port: appPort,
      healthcheck: '/health',
    },
    scenarioPath: relativePath(scenarioPath),
    phases: {
      provision: { status: 'pending' },
      setup: { status: 'pending' },
      app: { status: 'pending' },
      artifactCapture: { status: 'pending' },
      verifier: { status: 'pending' },
      cleanup: { status: 'pending' },
    },
    artifacts: [],
    observations: [],
  }
}

function observationFor(mode: Mode, verifier: VerifierProcess): string {
  switch (mode) {
    case 'harness':
      return 'The dumb verifier produced reviewable process output and video without writing any Sanity-specific result file.'
    case 'agent-baseline':
      return verifier.exitCode === 0
        ? 'Codex completed as an ordinary verifier process with only baseline visible-browser guidance; inspect whether it naturally used the recorded desktop.'
        : 'Codex baseline ran as an ordinary verifier process but exited nonzero; inspect output to learn whether auth, runtime, or scenario instructions blocked it.'
    case 'agent-hinted-visible':
      return verifier.exitCode === 0
        ? 'Codex completed with an explicit visible-browser launch hint; inspect whether prompt steering alone produced reviewable video.'
        : 'Codex with visible-browser hint exited nonzero; inspect output to learn whether the launch instruction blocked it.'
    case 'agent-preopened':
      return verifier.exitCode === 0
        ? 'Codex completed with the app preopened in the recorded desktop; inspect whether an environment affordance made the video reviewable.'
        : 'Codex with preopened app exited nonzero; inspect output to learn whether the environment affordance blocked it.'
    case 'agent-preopened-hinted':
      return verifier.exitCode === 0
        ? 'Codex completed with a preopened visible browser plus a remote-debugging hint; inspect whether that is the most reliable low-API path.'
        : 'Codex with preopened browser and control hint exited nonzero; inspect output to learn whether the hint blocked it.'
    default:
      return assertNever(mode)
  }
}

function isAgentMode(mode: Mode): mode is AgentMode {
  switch (mode) {
    case 'harness':
      return false
    case 'agent-baseline':
    case 'agent-hinted-visible':
    case 'agent-preopened':
    case 'agent-preopened-hinted':
      return true
    default:
      return assertNever(mode)
  }
}

function shouldPreopenBrowser(mode: Mode): boolean {
  switch (mode) {
    case 'harness':
    case 'agent-baseline':
    case 'agent-hinted-visible':
      return false
    case 'agent-preopened':
    case 'agent-preopened-hinted':
      return true
    default:
      return assertNever(mode)
  }
}

function preopenVisibleBrowserCommand(): string {
  return 'bash -lc ' + shellQuote([
    visibleBrowserCommand,
    'sleep 1',
    'pgrep -af chromium | head -5 || true',
  ].join('\n'))
}

const execute = Effect.fn('prototype.verifierHarness.execute')(function* (
  sandbox: Sandbox,
  command: string,
  timeoutSeconds = 60,
) {
  const response = yield* tryPromise(`execute ${command.slice(0, 60)}`, () =>
    sandbox.process.executeCommand(command, undefined, undefined, timeoutSeconds),
  )
  return response
})

const writeRecord = Effect.fn('prototype.verifierHarness.writeRecord')(function* (context: PrototypeContext) {
  const current = yield* Ref.get(context.recordRef)
  const encoded = yield* Schema.encode(HarnessRunRecordSchema)(current)
  yield* tryPromise('write run record', () =>
    writeFile(context.runRecordPath, `${JSON.stringify(encoded, null, 2)}\n`),
  )
})

const updateRecord = Effect.fn('prototype.verifierHarness.updateRecord')(function* (
  context: PrototypeContext,
  update: (record: HarnessRunRecord) => HarnessRunRecord,
) {
  const current = yield* Ref.get(context.recordRef)
  const next = update(current)
  const decoded = yield* Schema.decodeUnknown(HarnessRunRecordSchema)(next)
  yield* Ref.set(context.recordRef, decoded)
})

const updatePhase = Effect.fn('prototype.verifierHarness.updatePhase')(function* (
  context: PrototypeContext,
  phase: keyof HarnessRunRecord['phases'],
  record: PhaseRecord,
) {
  yield* updateRecord(context, current => ({
    ...current,
    phases: withPhase(current.phases, phase, record),
  }))
})

const addArtifact = Effect.fn('prototype.verifierHarness.addArtifact')(function* (
  context: PrototypeContext,
  artifact: ArtifactRef,
) {
  yield* updateRecord(context, current => ({
    ...current,
    artifacts: [...current.artifacts, artifact],
  }))
  yield* writeRecord(context)
})

const addObservation = Effect.fn('prototype.verifierHarness.addObservation')(function* (
  context: PrototypeContext,
  observation: string,
) {
  yield* updateRecord(context, current => ({
    ...current,
    observations: [...current.observations, observation],
  }))
  yield* writeRecord(context)
})

function withPhase(
  phases: HarnessRunRecord['phases'],
  phase: keyof HarnessRunRecord['phases'],
  record: PhaseRecord,
): HarnessRunRecord['phases'] {
  return {
    ...phases,
    [phase]: record,
  }
}

function currentStartedAt(record: HarnessRunRecord, phase: keyof HarnessRunRecord['phases']): string | undefined {
  return record.phases[phase].startedAt
}

function sandboxRecord(sandbox: Sandbox, deleted: boolean): NonNullable<HarnessRunRecord['sandbox']> {
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

function parseModes(args: ReadonlyArray<string>): ReadonlyArray<Mode> {
  const modeIndex = args.indexOf('--mode')
  const mode = modeIndex === -1 ? 'all' : args[modeIndex + 1]
  switch (mode) {
    case 'all':
    case undefined:
      return modes
    case 'harness':
      return ['harness']
    case 'agent':
    case 'agent-baseline':
      return ['agent-baseline']
    case 'agent-hinted-visible':
      return ['agent-hinted-visible']
    case 'agent-preopened':
      return ['agent-preopened']
    case 'agent-preopened-hinted':
      return ['agent-preopened-hinted']
    case 'agent-matrix':
    case 'matrix':
      return agentModes
    default:
      throw new Error(`Unknown --mode value: ${mode}`)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`)
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

function shellWord(value: string): string {
  return shellQuote(value)
}

function relativePath(path: string): string {
  return path.startsWith(projectRoot)
    ? path.slice(projectRoot.length + 1)
    : path
}

function relativeArtifactPath(context: PrototypeContext, path: string): string {
  return path.startsWith(projectRoot)
    ? path.slice(projectRoot.length + 1)
    : path
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}

function tryPromise<T>(operation: string, promise: () => Promise<T>): Effect.Effect<T, PrototypeExternalError> {
  return Effect.tryPromise({
    try: promise,
    catch: error => new PrototypeExternalError({ operation, error }),
  })
}

Effect.runPromise(main()).catch(error => {
  console.error(error)
  process.exitCode = 1
})
