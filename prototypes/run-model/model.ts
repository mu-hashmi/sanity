import { Schema } from 'effect'

export const runModelPrototypeVersion = 'prototype.run-model.v1'

const NonEmptyText = Schema.String.pipe(Schema.minLength(1))
const Timestamp = NonEmptyText

export const RunRequestSchema = Schema.Struct({
  profile: NonEmptyText,
  checks: Schema.NonEmptyArray(NonEmptyText),
})
export type RunRequest = Schema.Schema.Type<typeof RunRequestSchema>

export const ArtifactPolicySchema = Schema.Struct({
  recording: Schema.Boolean,
  screenshots: Schema.Boolean,
  logs: Schema.Boolean,
})
export type ArtifactPolicy = Schema.Schema.Type<typeof ArtifactPolicySchema>

export const AppPlanSchema = Schema.Struct({
  start: NonEmptyText,
  port: Schema.Number,
  healthcheck: Schema.optional(NonEmptyText),
})
export type AppPlan = Schema.Schema.Type<typeof AppPlanSchema>

export const PlannedAgentCheckSchema = Schema.Struct({
  name: NonEmptyText,
  driver: Schema.Literal('agent'),
  instructionsPath: NonEmptyText,
  maxMinutes: Schema.optional(Schema.Number),
})
export type PlannedAgentCheck = Schema.Schema.Type<typeof PlannedAgentCheckSchema>

export const PlannedCommandCheckSchema = Schema.Struct({
  name: NonEmptyText,
  driver: Schema.Literal('command'),
  command: NonEmptyText,
  maxMinutes: Schema.optional(Schema.Number),
})
export type PlannedCommandCheck = Schema.Schema.Type<typeof PlannedCommandCheckSchema>

export const PlannedCheckSchema = Schema.Union(PlannedAgentCheckSchema, PlannedCommandCheckSchema)
export type PlannedCheck = Schema.Schema.Type<typeof PlannedCheckSchema>

export const RunPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(runModelPrototypeVersion),
  runId: NonEmptyText,
  projectRoot: NonEmptyText,
  request: RunRequestSchema,
  profilePath: NonEmptyText,
  sandbox: Schema.Struct({
    snapshot: Schema.optional(NonEmptyText),
    public: Schema.Boolean,
  }),
  setup: Schema.Array(NonEmptyText),
  app: AppPlanSchema,
  artifacts: ArtifactPolicySchema,
  checks: Schema.Array(PlannedCheckSchema),
})
export type RunPlan = Schema.Schema.Type<typeof RunPlanSchema>

export const RunStatusSchema = Schema.Literal('running', 'passed', 'failed', 'error', 'cancelled')
export type RunStatus = Schema.Schema.Type<typeof RunStatusSchema>

export const PhaseStatusSchema = Schema.Literal('pending', 'running', 'passed', 'failed', 'error', 'skipped')
export type PhaseStatus = Schema.Schema.Type<typeof PhaseStatusSchema>

export const CheckStatusSchema = Schema.Literal('passed', 'failed', 'error', 'inconclusive', 'skipped')
export type CheckStatus = Schema.Schema.Type<typeof CheckStatusSchema>

export const ActiveCheckStatusSchema = Schema.Literal('passed', 'failed', 'error', 'inconclusive')
export type ActiveCheckStatus = Schema.Schema.Type<typeof ActiveCheckStatusSchema>

export const ArtifactRefSchema = Schema.Struct({
  kind: Schema.Literal('recording', 'screenshot', 'log', 'transcript', 'run-record'),
  label: NonEmptyText,
  path: NonEmptyText,
})
export type ArtifactRef = Schema.Schema.Type<typeof ArtifactRefSchema>

export const CommandExecutionSchema = Schema.Struct({
  command: NonEmptyText,
  exitCode: Schema.Number,
  stdoutPath: Schema.optional(NonEmptyText),
  stderrPath: Schema.optional(NonEmptyText),
  outputPath: Schema.optional(NonEmptyText),
  startedAt: Timestamp,
  completedAt: Timestamp,
})
export type CommandExecution = Schema.Schema.Type<typeof CommandExecutionSchema>

export const PhaseRecordSchema = Schema.Struct({
  status: PhaseStatusSchema,
  startedAt: Schema.optional(Timestamp),
  completedAt: Schema.optional(Timestamp),
  summary: Schema.optional(NonEmptyText),
  commands: Schema.optional(Schema.Array(CommandExecutionSchema)),
})
export type PhaseRecord = Schema.Schema.Type<typeof PhaseRecordSchema>

export const SandboxRecordSchema = Schema.Struct({
  id: NonEmptyText,
  name: Schema.optional(NonEmptyText),
  snapshot: Schema.optional(NonEmptyText),
  previewUrl: Schema.optional(NonEmptyText),
  deleted: Schema.Boolean,
})
export type SandboxRecord = Schema.Schema.Type<typeof SandboxRecordSchema>

export const CommandCheckResultSchema = Schema.Struct({
  check: NonEmptyText,
  driver: Schema.Literal('command'),
  status: ActiveCheckStatusSchema,
  command: NonEmptyText,
  exitCode: Schema.Number,
  summary: NonEmptyText,
  artifacts: Schema.Array(ArtifactRefSchema),
})
export type CommandCheckResult = Schema.Schema.Type<typeof CommandCheckResultSchema>

export const AgentCheckResultSchema = Schema.Struct({
  check: NonEmptyText,
  driver: Schema.Literal('agent'),
  status: ActiveCheckStatusSchema,
  verdict: Schema.Literal('passed', 'failed', 'inconclusive'),
  summary: NonEmptyText,
  artifacts: Schema.Array(ArtifactRefSchema),
})
export type AgentCheckResult = Schema.Schema.Type<typeof AgentCheckResultSchema>

export const SkippedCheckResultSchema = Schema.Struct({
  check: NonEmptyText,
  driver: Schema.Literal('agent', 'command'),
  status: Schema.Literal('skipped'),
  reason: Schema.Literal('setup-failed', 'app-failed', 'artifact-capture-failed', 'cancelled'),
})
export type SkippedCheckResult = Schema.Schema.Type<typeof SkippedCheckResultSchema>

export const CheckResultSchema = Schema.Union(
  CommandCheckResultSchema,
  AgentCheckResultSchema,
  SkippedCheckResultSchema,
)
export type CheckResult = Schema.Schema.Type<typeof CheckResultSchema>

export const RunRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(runModelPrototypeVersion),
  runId: NonEmptyText,
  status: RunStatusSchema,
  startedAt: Timestamp,
  completedAt: Schema.optional(Timestamp),
  request: RunRequestSchema,
  plan: RunPlanSchema,
  sandbox: Schema.optional(SandboxRecordSchema),
  phases: Schema.Struct({
    provision: PhaseRecordSchema,
    setup: PhaseRecordSchema,
    app: PhaseRecordSchema,
    artifactCapture: PhaseRecordSchema,
    cleanup: PhaseRecordSchema,
  }),
  checks: Schema.Array(CheckResultSchema),
  artifacts: Schema.Array(ArtifactRefSchema),
})
export type RunRecord = Schema.Schema.Type<typeof RunRecordSchema>

export const RecordShapeScenarioSchema = Schema.Struct({
  name: NonEmptyText,
  question: NonEmptyText,
  request: RunRequestSchema,
  plan: RunPlanSchema,
  record: RunRecordSchema,
})
export type RecordShapeScenario = Schema.Schema.Type<typeof RecordShapeScenarioSchema>

export function buildPrototypeRunPlan(runId: string, projectRoot: string): RunPlan {
  return {
    schemaVersion: runModelPrototypeVersion,
    runId,
    projectRoot,
    request: {
      profile: 'prototype-daytona',
      checks: ['healthcheck-command'],
    },
    profilePath: '.sanity/profiles/prototype-daytona.yml',
    sandbox: {
      public: true,
    },
    setup: ['node --version'],
    app: {
      start: [
        'node -e "',
        "require('node:http').createServer((req,res)=>{",
        "if(req.url==='/health'){res.end('ok');return}",
        "res.end('sanity prototype app')",
        "}).listen(3000,'0.0.0.0')",
        '"',
      ].join(''),
      port: 3000,
      healthcheck: '/health',
    },
    artifacts: {
      recording: true,
      screenshots: true,
      logs: true,
    },
    checks: [
      {
        name: 'healthcheck-command',
        driver: 'command',
        command: [
          'node -e "',
          "fetch('http://127.0.0.1:3000/health')",
          ".then(async r=>{const body=await r.text();",
          "if(!r.ok||body.trim()!=='ok'){throw new Error('unexpected healthcheck '+r.status+' '+body)}",
          "console.log('healthcheck-command passed')",
          '})',
          ".catch(err=>{console.error(err.message);process.exit(1)})",
          '"',
        ].join(''),
        maxMinutes: 2,
      },
    ],
  }
}

export function buildInitialRunRecord(plan: RunPlan, startedAt: string): RunRecord {
  return {
    schemaVersion: runModelPrototypeVersion,
    runId: plan.runId,
    status: 'running',
    startedAt,
    request: plan.request,
    plan,
    phases: {
      provision: { status: 'pending' },
      setup: { status: 'pending' },
      app: { status: 'pending' },
      artifactCapture: { status: 'pending' },
      cleanup: { status: 'pending' },
    },
    checks: [],
    artifacts: [],
  }
}

export function skippedResultsFor(
  checks: ReadonlyArray<PlannedCheck>,
  reason: SkippedCheckResult['reason'],
): ReadonlyArray<SkippedCheckResult> {
  return checks.map(check => ({
    check: check.name,
    driver: check.driver,
    status: 'skipped',
    reason,
  }))
}

export function recordShapeScenarios(): ReadonlyArray<RecordShapeScenario> {
  const passedPlan = samplePlan('proto-pass-001', {
    profile: 'pr',
    checks: ['migration-safety'],
  }, [
    {
      name: 'migration-safety',
      driver: 'command',
      command: 'npm run sanity:migration-refusal',
      maxMinutes: 5,
    },
  ])

  const appFailurePlan = samplePlan('proto-app-fail-001', {
    profile: 'local',
    checks: ['team-invite', 'migration-safety'],
  }, [
    {
      name: 'team-invite',
      driver: 'agent',
      instructionsPath: '.sanity/checks/team-invite.md',
      maxMinutes: 10,
    },
    {
      name: 'migration-safety',
      driver: 'command',
      command: 'npm run sanity:migration-refusal',
      maxMinutes: 5,
    },
  ])

  const agentFailurePlan = samplePlan('proto-agent-fail-001', {
    profile: 'reviewer-repro',
    checks: ['viewer-admin-billing-repro'],
  }, [
    {
      name: 'viewer-admin-billing-repro',
      driver: 'agent',
      instructionsPath: '.sanity/checks/viewer-admin-billing-repro.md',
      maxMinutes: 10,
    },
  ])

  return [
    {
      name: 'dry-run request resolved to plan',
      question: 'Does RunRequest with a checks list feel clearly smaller than RunPlan?',
      request: passedPlan.request,
      plan: passedPlan,
      record: {
        ...buildInitialRunRecord(passedPlan, '2026-05-28T10:00:00.000Z'),
        status: 'cancelled',
        completedAt: '2026-05-28T10:00:01.000Z',
        phases: {
          provision: { status: 'skipped', summary: 'Dry run prints the plan without creating a sandbox.' },
          setup: { status: 'skipped' },
          app: { status: 'skipped' },
          artifactCapture: { status: 'skipped' },
          cleanup: { status: 'skipped' },
        },
      },
    },
    {
      name: 'command check passed',
      question: 'Does one planned command check map cleanly to one CheckResult?',
      request: passedPlan.request,
      plan: passedPlan,
      record: {
        ...buildInitialRunRecord(passedPlan, '2026-05-28T10:05:00.000Z'),
        status: 'passed',
        completedAt: '2026-05-28T10:05:27.000Z',
        sandbox: {
          id: 'sandbox_proto_123',
          name: 'sanity-proto-pass',
          snapshot: passedPlan.sandbox.snapshot,
          previewUrl: 'https://3000-sandbox.example.daytona.work',
          deleted: true,
        },
        phases: {
          provision: { status: 'passed', summary: 'Sandbox created from profile snapshot.' },
          setup: { status: 'passed', summary: 'Setup commands completed.' },
          app: { status: 'passed', summary: 'App served a healthy /health response.' },
          artifactCapture: { status: 'passed', summary: 'Logs, screenshot, and recording captured.' },
          cleanup: { status: 'passed', summary: 'Sandbox deleted.' },
        },
        checks: [
          {
            check: 'migration-safety',
            driver: 'command',
            status: 'passed',
            command: 'npm run sanity:migration-refusal',
            exitCode: 0,
            summary: 'Command exited 0.',
            artifacts: [
              { kind: 'log', label: 'command output', path: '.sanity/runs/proto-pass-001/check.log' },
            ],
          },
        ],
        artifacts: [
          { kind: 'recording', label: 'screen recording', path: '.sanity/runs/proto-pass-001/recording.mp4' },
          { kind: 'screenshot', label: 'final screenshot', path: '.sanity/runs/proto-pass-001/final.png' },
          { kind: 'run-record', label: 'run record', path: '.sanity/runs/proto-pass-001/run-record.json' },
        ],
      },
    },
    {
      name: 'multi-check app failure before checks',
      question: 'Do skipped CheckResults make pre-check failures easier to inspect?',
      request: appFailurePlan.request,
      plan: appFailurePlan,
      record: {
        ...buildInitialRunRecord(appFailurePlan, '2026-05-28T10:10:00.000Z'),
        status: 'error',
        completedAt: '2026-05-28T10:10:19.000Z',
        phases: {
          provision: { status: 'passed', summary: 'Sandbox created.' },
          setup: { status: 'passed', summary: 'Setup completed.' },
          app: { status: 'error', summary: 'Healthcheck never returned 200.' },
          artifactCapture: { status: 'skipped', summary: 'Checks did not start.' },
          cleanup: { status: 'passed', summary: 'Sandbox deleted.' },
        },
        checks: skippedResultsFor(appFailurePlan.checks, 'app-failed'),
        artifacts: [
          { kind: 'log', label: 'app startup log', path: '.sanity/runs/proto-app-fail-001/app.log' },
        ],
      },
    },
    {
      name: 'agent check failed',
      question: 'Can an agent-specific CheckResult hold verdict/transcript without owning the whole run?',
      request: agentFailurePlan.request,
      plan: agentFailurePlan,
      record: {
        ...buildInitialRunRecord(agentFailurePlan, '2026-05-28T10:15:00.000Z'),
        status: 'failed',
        completedAt: '2026-05-28T10:17:42.000Z',
        phases: {
          provision: { status: 'passed' },
          setup: { status: 'passed' },
          app: { status: 'passed' },
          artifactCapture: { status: 'passed' },
          cleanup: { status: 'passed' },
        },
        checks: [
          {
            check: 'viewer-admin-billing-repro',
            driver: 'agent',
            status: 'failed',
            verdict: 'failed',
            summary: 'Viewer reached admin billing instead of being denied.',
            artifacts: [
              { kind: 'recording', label: 'screen recording', path: '.sanity/runs/proto-agent-fail-001/recording.mp4' },
              { kind: 'transcript', label: 'agent transcript', path: '.sanity/runs/proto-agent-fail-001/transcript.md' },
            ],
          },
        ],
        artifacts: [
          { kind: 'recording', label: 'screen recording', path: '.sanity/runs/proto-agent-fail-001/recording.mp4' },
          { kind: 'run-record', label: 'run record', path: '.sanity/runs/proto-agent-fail-001/run-record.json' },
        ],
      },
    },
  ]
}

function samplePlan(runId: string, request: RunRequest, checks: ReadonlyArray<PlannedCheck>): RunPlan {
  return {
    schemaVersion: runModelPrototypeVersion,
    runId,
    projectRoot: '/repo',
    request,
    profilePath: `.sanity/profiles/${request.profile}.yml`,
    sandbox: {
      snapshot: 'daytonaio/sandbox:0.6.0',
      public: true,
    },
    setup: ['npm install', 'npm run build'],
    app: {
      start: 'npm run dev -- --host 0.0.0.0',
      port: 3000,
      healthcheck: '/',
    },
    artifacts: {
      recording: true,
      screenshots: true,
      logs: true,
    },
    checks,
  }
}
