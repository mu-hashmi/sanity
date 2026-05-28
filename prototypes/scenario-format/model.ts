import { Either, Schema, pipe } from 'effect'

export const runModeValues = ['single-check', 'all'] as const
export const driverValues = ['agent', 'command'] as const

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

export type RunMode = (typeof runModeValues)[number]
export type DriverKind = (typeof driverValues)[number]

const NonEmptyText = Schema.String.pipe(Schema.minLength(1))
const CheckName = Schema.String.pipe(Schema.pattern(/^[a-z][a-z0-9-]*$/))

const ArtifactConfigSchema = Schema.Struct({
  recording: Schema.Boolean,
  screenshots: Schema.Boolean,
  logs: Schema.Boolean,
})

const AgentCheckSchema = Schema.Struct({
  driver: Schema.Literal('agent'),
  instructions: NonEmptyText,
  max_minutes: Schema.optional(Schema.Number),
})

const CommandCheckSchema = Schema.Struct({
  driver: Schema.Literal('command'),
  command: NonEmptyText,
  max_minutes: Schema.optional(Schema.Number),
})

const CheckSchema = Schema.Union(AgentCheckSchema, CommandCheckSchema)

export const ProfileFileSchema = Schema.Struct({
  sandbox: Schema.Struct({
    snapshot: NonEmptyText,
  }),
  setup: Schema.Array(NonEmptyText),
  app: Schema.Struct({
    start: NonEmptyText,
    port: Schema.Number,
    healthcheck: Schema.optional(NonEmptyText),
  }),
  checks: Schema.Record({ key: CheckName, value: CheckSchema }),
  artifacts: ArtifactConfigSchema,
})

export type ArtifactConfig = Schema.Schema.Type<typeof ArtifactConfigSchema>
export type ProfileFile = Schema.Schema.Type<typeof ProfileFileSchema>
export type CheckEntry = ProfileFile['checks'][string]

export interface ProfileArtifact {
  readonly slug: string
  readonly path: string
  readonly profile: ProfileFile
}

export interface PrototypePack {
  readonly profiles: Readonly<Record<string, ProfileArtifact>>
  readonly instructionFiles: Readonly<Record<string, string>>
}

export interface PrototypeState {
  readonly pack: PrototypePack
  readonly runMode: RunMode
  readonly selectedProfile: string
  readonly selectedCheck: string
}

export type PrototypeAction =
  | { readonly type: 'cycle-run-mode' }
  | { readonly type: 'next-profile' }
  | { readonly type: 'next-check' }
  | { readonly type: 'toggle-recording' }
  | { readonly type: 'toggle-screenshots' }
  | { readonly type: 'toggle-logs' }
  | { readonly type: 'toggle-broken-instruction-path' }

export interface ResolvedCheck {
  readonly name: string
  readonly driver: DriverKind
  readonly source: string
  readonly maxMinutes?: number
  readonly preview: string
}

export interface RunPlan {
  readonly invocation: string
  readonly profilePath: string
  readonly runMode: RunMode
  readonly sandboxSnapshot: string
  readonly setup: ReadonlyArray<string>
  readonly app: {
    readonly start: string
    readonly port: number
    readonly healthcheck?: string
  }
  readonly artifacts: ArtifactConfig
  readonly checks: ReadonlyArray<ResolvedCheck>
}

export type ValidationResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly message: string }

export type RunPlanResult =
  | { readonly ok: true; readonly plan: RunPlan }
  | { readonly ok: false; readonly message: string }

const instructionFiles: Readonly<Record<string, string>> = {
  '.sanity/checks/team-invite.md': [
    '1. Open the app in the browser.',
    '2. Find the new team invite flow.',
    '3. Create an invite for test@example.com.',
    '4. Confirm the invite appears in the pending invites list.',
    '5. If anything fails, explain what failed and rely on the captured artifacts.',
  ].join('\n'),
  '.sanity/checks/coupon-checkout.md': [
    '1. Open the storefront checkout.',
    '2. Add the Studio Plan to the cart.',
    '3. Apply coupon SAVE20.',
    '4. Stop before submitting payment.',
    '5. Confirm the visible total reflects the discount.',
  ].join('\n'),
  '.sanity/checks/viewer-admin-billing-repro.md': [
    '1. Sign in as viewer@example.com.',
    '2. Navigate directly to /admin/billing.',
    '3. Record whether billing loads, redirects, or denies access.',
    '4. Classify the reviewer finding as real bug, not reproducible, or stale.',
  ].join('\n'),
}

function profile(slug: string, profileFile: ProfileFile): ProfileArtifact {
  return {
    slug,
    path: `.sanity/profiles/${slug}.yml`,
    profile: profileFile,
  }
}

export const prototypePack: PrototypePack = {
  instructionFiles,
  profiles: {
    local: profile('local', {
      sandbox: {
        snapshot: 'daytonaio/sandbox:0.6.0',
      },
      setup: ['npm install'],
      app: {
        start: 'npm run dev -- --host 0.0.0.0',
        port: 3000,
        healthcheck: '/',
      },
      checks: {
        'team-invite': {
          driver: 'agent',
          instructions: '.sanity/checks/team-invite.md',
          max_minutes: 10,
        },
      },
      artifacts: {
        recording: true,
        screenshots: true,
        logs: true,
      },
    }),
    pr: profile('pr', {
      sandbox: {
        snapshot: 'daytonaio/sandbox:0.6.0',
      },
      setup: ['npm install', 'npm run build'],
      app: {
        start: 'npm run dev -- --host 0.0.0.0',
        port: 3000,
        healthcheck: '/',
      },
      checks: {
        'team-invite': {
          driver: 'agent',
          instructions: '.sanity/checks/team-invite.md',
          max_minutes: 10,
        },
        'coupon-checkout': {
          driver: 'agent',
          instructions: '.sanity/checks/coupon-checkout.md',
          max_minutes: 12,
        },
        'migration-safety': {
          driver: 'command',
          command: 'npm run sanity:migration-refusal',
          max_minutes: 5,
        },
      },
      artifacts: {
        recording: true,
        screenshots: true,
        logs: true,
      },
    }),
    'reviewer-repro': profile('reviewer-repro', {
      sandbox: {
        snapshot: 'daytonaio/sandbox:0.6.0',
      },
      setup: ['npm install'],
      app: {
        start: 'npm run dev -- --host 0.0.0.0',
        port: 3000,
        healthcheck: '/',
      },
      checks: {
        'viewer-admin-billing-repro': {
          driver: 'agent',
          instructions: '.sanity/checks/viewer-admin-billing-repro.md',
          max_minutes: 10,
        },
      },
      artifacts: {
        recording: true,
        screenshots: true,
        logs: true,
      },
    }),
    'cli-only': profile('cli-only', {
      sandbox: {
        snapshot: 'daytonaio/sandbox:0.6.0',
      },
      setup: ['npm install', 'npm run build'],
      app: {
        start: 'echo "no app server required"',
        port: 3000,
      },
      checks: {
        'migration-safety': {
          driver: 'command',
          command: 'npm run sanity:migration-refusal',
          max_minutes: 5,
        },
      },
      artifacts: {
        recording: false,
        screenshots: false,
        logs: true,
      },
    }),
  },
}

export function initialState(): PrototypeState {
  return {
    pack: structuredClone(prototypePack),
    runMode: 'single-check',
    selectedProfile: 'local',
    selectedCheck: 'team-invite',
  }
}

export function reduce(state: PrototypeState, action: PrototypeAction): PrototypeState {
  switch (action.type) {
    case 'cycle-run-mode':
      return {
        ...state,
        runMode: nextValue(runModeValues, state.runMode),
      }
    case 'next-profile': {
      const selectedProfile = nextValue(toNonEmpty(profileSlugs(state.pack)), state.selectedProfile)
      return {
        ...state,
        selectedProfile,
        selectedCheck: firstCheckName(state.pack.profiles[selectedProfile].profile),
      }
    }
    case 'next-check':
      return {
        ...state,
        selectedCheck: nextValue(toNonEmpty(checkNames(currentProfile(state).profile)), state.selectedCheck),
      }
    case 'toggle-recording':
      return updateArtifacts(state, {
        recording: !currentProfile(state).profile.artifacts.recording,
      })
    case 'toggle-screenshots':
      return updateArtifacts(state, {
        screenshots: !currentProfile(state).profile.artifacts.screenshots,
      })
    case 'toggle-logs':
      return updateArtifacts(state, {
        logs: !currentProfile(state).profile.artifacts.logs,
      })
    case 'toggle-broken-instruction-path':
      return toggleBrokenInstructionPath(state)
  }
}

export function validatePack(pack: PrototypePack): ValidationResult {
  for (const profileArtifact of Object.values(pack.profiles)) {
    const decoded = Schema.decodeUnknownEither(ProfileFileSchema)(profileArtifact.profile)

    const schemaResult = pipe(
      decoded,
      Either.match({
        onLeft: error => ({
          ok: false,
          message: `${profileArtifact.path}: ${error.message}`,
        }),
        onRight: () => ({
          ok: true,
          message: `${profileArtifact.path}: valid profile file`,
        }),
      }),
    )

    if (!schemaResult.ok) {
      return schemaResult
    }

    const referenceResult = validateReferences(profileArtifact, pack.instructionFiles)

    if (!referenceResult.ok) {
      return referenceResult
    }
  }

  return {
    ok: true,
    message: 'valid profile files and instruction references',
  }
}

export function resolveRunPlan(state: PrototypeState): RunPlanResult {
  const validation = validatePack(state.pack)

  if (!validation.ok) {
    return validation
  }

  const selectedProfileArtifact = currentProfile(state)
  const selectedChecks = resolveSelectedCheckNames(state)
  const checks: ResolvedCheck[] = []

  for (const name of selectedChecks) {
    const check = resolveCheck(name, selectedProfileArtifact.profile.checks[name], state.pack.instructionFiles)

    if (check === undefined) {
      return {
        ok: false,
        message: `Selected check "${name}" could not be resolved from ${selectedProfileArtifact.path}.`,
      }
    }

    checks.push(check)
  }

  return {
    ok: true,
    plan: {
      invocation: formatInvocation(state),
      profilePath: selectedProfileArtifact.path,
      runMode: state.runMode,
      sandboxSnapshot: selectedProfileArtifact.profile.sandbox.snapshot,
      setup: selectedProfileArtifact.profile.setup,
      app: resolvedApp(selectedProfileArtifact.profile.app),
      artifacts: selectedProfileArtifact.profile.artifacts,
      checks,
    },
  }
}

export function selectedInstructionFiles(state: PrototypeState): Readonly<Record<string, string>> {
  const plan = resolveRunPlan(state)

  if (!plan.ok) {
    return {}
  }

  const selectedFiles: Record<string, string> = {}

  for (const check of plan.plan.checks) {
    if (check.driver === 'agent') {
      const content = state.pack.instructionFiles[check.source]

      if (content !== undefined) {
        selectedFiles[check.source] = content
      }
    }
  }

  return selectedFiles
}

export function currentProfile(state: PrototypeState): ProfileArtifact {
  return state.pack.profiles[state.selectedProfile]
}

function updateArtifacts(state: PrototypeState, patch: Partial<ArtifactConfig>): PrototypeState {
  const selected = currentProfile(state)

  return {
    ...state,
    pack: {
      ...state.pack,
      profiles: {
        ...state.pack.profiles,
        [selected.slug]: {
          ...selected,
          profile: {
            ...selected.profile,
            artifacts: {
              ...selected.profile.artifacts,
              ...patch,
            },
          },
        },
      },
    },
  }
}

function toggleBrokenInstructionPath(state: PrototypeState): PrototypeState {
  const selected = currentProfile(state)
  const firstAgentCheckName = Object.entries(selected.profile.checks).find(([, check]) => check.driver === 'agent')?.[0]

  if (firstAgentCheckName === undefined) {
    return state
  }

  const check = selected.profile.checks[firstAgentCheckName]

  if (check.driver !== 'agent') {
    return state
  }

  const originalCheck = prototypePack.profiles[selected.slug].profile.checks[firstAgentCheckName]

  if (originalCheck.driver !== 'agent') {
    return state
  }

  const instructions = check.instructions === '.sanity/checks/missing.md'
    ? originalCheck.instructions
    : '.sanity/checks/missing.md'

  return {
    ...state,
    pack: {
      ...state.pack,
      profiles: {
        ...state.pack.profiles,
        [selected.slug]: {
          ...selected,
          profile: {
            ...selected.profile,
            checks: {
              ...selected.profile.checks,
              [firstAgentCheckName]: {
                ...check,
                instructions,
              },
            },
          },
        },
      },
    },
  }
}

function validateReferences(
  profileArtifact: ProfileArtifact,
  files: Readonly<Record<string, string>>,
): ValidationResult {
  for (const [checkName, check] of Object.entries(profileArtifact.profile.checks)) {
    if (check.driver === 'agent' && files[check.instructions] === undefined) {
      return {
        ok: false,
        message: `${profileArtifact.path}: check "${checkName}" points to missing instruction file "${check.instructions}".`,
      }
    }
  }

  return {
    ok: true,
    message: `${profileArtifact.path}: valid references`,
  }
}

function resolveSelectedCheckNames(state: PrototypeState): ReadonlyArray<string> {
  switch (state.runMode) {
    case 'single-check':
      return [state.selectedCheck]
    case 'all':
      return checkNames(currentProfile(state).profile)
  }
}

function resolveCheck(
  name: string,
  check: CheckEntry | undefined,
  files: Readonly<Record<string, string>>,
): ResolvedCheck | undefined {
  if (check === undefined) {
    return undefined
  }

  switch (check.driver) {
    case 'agent': {
      const content = files[check.instructions] ?? ''
      return {
        name,
        driver: check.driver,
        source: check.instructions,
        preview: firstLine(content),
        ...optionalMaxMinutes(check.max_minutes),
      }
    }
    case 'command':
      return {
        name,
        driver: check.driver,
        source: check.command,
        preview: check.command,
        ...optionalMaxMinutes(check.max_minutes),
      }
  }
}

function resolvedApp(app: ProfileFile['app']): RunPlan['app'] {
  if (app.healthcheck === undefined) {
    return {
      start: app.start,
      port: app.port,
    }
  }

  return {
    start: app.start,
    port: app.port,
    healthcheck: app.healthcheck,
  }
}

function optionalMaxMinutes(maxMinutes: number | undefined): Pick<ResolvedCheck, 'maxMinutes'> | {} {
  return maxMinutes === undefined ? {} : { maxMinutes }
}

function formatInvocation(state: PrototypeState): string {
  switch (state.runMode) {
    case 'single-check':
      return `sanity run --profile ${state.selectedProfile} ${state.selectedCheck}`
    case 'all':
      return `sanity run --profile ${state.selectedProfile} --all`
  }
}

function profileSlugs(pack: PrototypePack): ReadonlyArray<string> {
  return Object.keys(pack.profiles)
}

function checkNames(profileFile: ProfileFile): ReadonlyArray<string> {
  return Object.keys(profileFile.checks)
}

function firstCheckName(profileFile: ProfileFile): string {
  const first = checkNames(profileFile)[0]

  if (first === undefined) {
    throw new Error('Profile contains no checks.')
  }

  return first
}

function nextValue<T extends string>(values: NonEmptyReadonlyArray<T>, current: T): T {
  const next = values[(values.indexOf(current) + 1) % values.length]

  if (next === undefined) {
    throw new Error('Non-empty value list produced no next value.')
  }

  return next
}

function toNonEmpty<T>(values: ReadonlyArray<T>): NonEmptyReadonlyArray<T> {
  const first = values[0]

  if (first === undefined) {
    throw new Error('Expected at least one value in prototype state.')
  }

  return [first, ...values.slice(1)]
}

function firstLine(content: string): string {
  return content.split('\n')[0] ?? ''
}
