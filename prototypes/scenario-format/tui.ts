import { emitKeypressEvents } from 'node:readline'
import YAML from 'yaml'
import {
  currentProfile,
  initialState,
  reduce,
  resolveRunPlan,
  selectedInstructionFiles,
  validatePack,
  type PrototypeAction,
  type PrototypeState,
  type RunPlanResult,
  type ValidationResult,
} from './model.js'

const dim = '\x1b[2m'
const bold = '\x1b[1m'
const reset = '\x1b[0m'

let state = initialState()

function renderFrame(current: PrototypeState): string {
  const validation = validatePack(current.pack)
  const plan = resolveRunPlan(current)
  const selectedFiles = selectedInstructionFiles(current)
  const profile = currentProfile(current)

  return [
    `${bold}Sanity profile-file prototype${reset} ${dim}(throwaway)${reset}`,
    `${dim}Question: does .sanity/profiles/<profile>.yml plus markdown checks express runnable verification cleanly?${reset}`,
    '',
    `${bold}Active invocation${reset}`,
    formatPlanHeader(plan),
    '',
    `${bold}Selection knobs${reset}`,
    `profile: ${current.selectedProfile}`,
    `check: ${current.runMode === 'all' ? 'all' : current.selectedCheck}`,
    '',
    `${bold}${profile.path}${reset}`,
    trimTrailingNewline(YAML.stringify(profile.profile)),
    '',
    `${bold}Selected instruction files${reset}`,
    formatInstructionFiles(selectedFiles),
    '',
    `${bold}Validation${reset}`,
    formatValidation(validation),
    '',
    `${bold}Effective run plan${reset}`,
    formatRunPlan(plan),
    '',
    `${bold}Actions${reset}`,
    `${bold}p${reset} profile  ${bold}m${reset} all/single  ${bold}c${reset} check  ${bold}r${reset} recording  ${bold}s${reset} screenshots  ${bold}l${reset} logs`,
    `${bold}b${reset} broken instruction path  ${bold}q${reset} quit`,
  ].join('\n')
}

function render(): void {
  console.clear()
  console.log(renderFrame(state))
}

function dispatch(action: PrototypeAction): void {
  state = reduce(state, action)
  render()
}

function formatPlanHeader(result: RunPlanResult): string {
  if (!result.ok) {
    return 'no runnable plan'
  }

  return result.plan.invocation
}

function formatValidation(result: ValidationResult): string {
  switch (result.ok) {
    case true:
      return result.message
    case false:
      return `invalid: ${result.message}`
  }
}

function formatInstructionFiles(files: Readonly<Record<string, string>>): string {
  const entries = Object.entries(files)

  if (entries.length === 0) {
    return '(none selected)'
  }

  return entries
    .map(([path, content]) => [`${bold}${path}${reset}`, content].join('\n'))
    .join('\n\n')
}

function formatRunPlan(result: RunPlanResult): string {
  if (!result.ok) {
    return `invalid: ${result.message}`
  }

  const { plan } = result

  return trimTrailingNewline(YAML.stringify({
    invocation: plan.invocation,
    profile: plan.profilePath,
    sandbox: {
      snapshot: plan.sandboxSnapshot,
    },
    setup: plan.setup,
    app: plan.app,
    artifacts: plan.artifacts,
    checks: plan.checks.map(check => ({
      name: check.name,
      driver: check.driver,
      source: check.source,
      max_minutes: check.maxMinutes,
      preview: check.preview,
    })),
  }))
}

function trimTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

function handleInput(input: string, key: { readonly ctrl?: boolean; readonly name?: string }): void {
  if (input === 'q' || (key.ctrl === true && key.name === 'c')) {
    process.stdin.pause()
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    return
  }

  switch (input) {
    case 'p':
      dispatch({ type: 'next-profile' })
      return
    case 'm':
      dispatch({ type: 'cycle-run-mode' })
      return
    case 'c':
      dispatch({ type: 'next-check' })
      return
    case 'r':
      dispatch({ type: 'toggle-recording' })
      return
    case 's':
      dispatch({ type: 'toggle-screenshots' })
      return
    case 'l':
      dispatch({ type: 'toggle-logs' })
      return
    case 'b':
      dispatch({ type: 'toggle-broken-instruction-path' })
      return
  }
}

if (process.argv.includes('--snapshot')) {
  console.log(renderFrame(state))
} else if (!process.stdin.isTTY) {
  console.log(renderFrame(state))
  console.log('\nRun in an interactive terminal to use keyboard controls.')
} else {
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('keypress', handleInput)
  render()
}
