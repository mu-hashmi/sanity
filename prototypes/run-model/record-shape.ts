import { emitKeypressEvents } from 'node:readline'
import { Console, Effect, Ref, Runtime, Schema } from 'effect'
import YAML from 'yaml'
import {
  RecordShapeScenarioSchema,
  recordShapeScenarios,
  type RecordShapeScenario,
} from './model.js'

const bold = '\x1b[1m'
const dim = '\x1b[2m'
const reset = '\x1b[0m'

const viewValues = ['request', 'plan', 'record'] as const

type View = (typeof viewValues)[number]

interface State {
  readonly scenarioIndex: number
  readonly view: View
}

type Key = {
  readonly ctrl?: boolean
  readonly name?: string
}

const loadScenarios = Effect.fn('prototype.loadScenarios')(function* () {
  return yield* Schema.decodeUnknown(Schema.Array(RecordShapeScenarioSchema))(recordShapeScenarios())
})

const snapshot = Effect.fn('prototype.snapshot')(function* (scenarios: ReadonlyArray<RecordShapeScenario>) {
  for (const [index, scenario] of scenarios.entries()) {
    yield* Console.log(`--- scenario ${index + 1}: ${scenario.name} ---`)
    yield* Console.log(stringify({
      request: scenario.request,
      plan: scenario.plan,
      record: scenario.record,
    }))
  }
})

const runNonInteractive = Effect.fn('prototype.runNonInteractive')(function* (
  scenarios: ReadonlyArray<RecordShapeScenario>,
) {
  yield* Console.log(renderFrame(initialState(), scenarios))
  yield* Console.log('\nRun in an interactive terminal to use keyboard controls.')
})

const runInteractive = Effect.fn('prototype.runInteractive')(function* (
  scenarios: ReadonlyArray<RecordShapeScenario>,
) {
  const stateRef = yield* Ref.make<State>(initialState())
  const runtime = yield* Effect.runtime<never>()
  yield* render(stateRef, scenarios)

  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('keypress', (input: string, key: Key) => {
    Runtime.runPromise(runtime)(dispatch(stateRef, scenarios, input, key)).catch(error => {
      console.error(error)
      process.exitCode = 1
    })
  })
})

const dispatch = Effect.fn('prototype.dispatch')(function* (
  stateRef: Ref.Ref<State>,
  scenarios: ReadonlyArray<RecordShapeScenario>,
  input: string,
  key: Key,
) {
  if (input === 'q' || (key.ctrl === true && key.name === 'c')) {
    process.stdin.pause()
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    return
  }

  yield* Ref.update(stateRef, current => reduce(current, input, scenarios.length))
  yield* render(stateRef, scenarios)
})

const render = Effect.fn('prototype.render')(function* (
  stateRef: Ref.Ref<State>,
  scenarios: ReadonlyArray<RecordShapeScenario>,
) {
  const state = yield* Ref.get(stateRef)
  yield* Effect.sync(() => console.clear())
  yield* Console.log(renderFrame(state, scenarios))
})

const main = Effect.gen(function* () {
  const scenarios = yield* loadScenarios()

  if (process.argv.includes('--snapshot')) {
    yield* snapshot(scenarios)
    return
  }

  if (!process.stdin.isTTY) {
    yield* runNonInteractive(scenarios)
    return
  }

  yield* runInteractive(scenarios)
})

function initialState(): State {
  return {
    scenarioIndex: 0,
    view: 'record',
  }
}

function reduce(current: State, input: string, scenarioCount: number): State {
  switch (input) {
    case 'n':
      return {
        ...current,
        scenarioIndex: (current.scenarioIndex + 1) % scenarioCount,
      }
    case 'v':
      return {
        ...current,
        view: nextView(current.view),
      }
    case 'r':
      return { ...current, view: 'request' }
    case 'p':
      return { ...current, view: 'plan' }
    case 'd':
      return { ...current, view: 'record' }
    default:
      return current
  }
}

function renderFrame(current: State, scenarios: ReadonlyArray<RecordShapeScenario>): string {
  const scenario = currentScenario(current, scenarios)

  return [
    `${bold}Sanity run-model prototype${reset} ${dim}(throwaway)${reset}`,
    `${dim}Question: does RunRequest -> RunPlan -> RunRecord with CheckResult feel right?${reset}`,
    '',
    `${bold}Scenario${reset}`,
    `${current.scenarioIndex + 1}/${scenarios.length}: ${scenario.name}`,
    `${dim}${scenario.question}${reset}`,
    '',
    `${bold}View${reset}`,
    current.view,
    '',
    `${bold}${viewTitle(current.view)}${reset}`,
    formatView(current.view, scenario),
    '',
    `${bold}Actions${reset}`,
    `${bold}n${reset} next scenario  ${bold}v${reset} next view  ${bold}r${reset} request  ${bold}p${reset} plan  ${bold}d${reset} record  ${bold}q${reset} quit`,
  ].join('\n')
}

function currentScenario(
  current: State,
  scenarios: ReadonlyArray<RecordShapeScenario>,
): RecordShapeScenario {
  const scenario = scenarios[current.scenarioIndex]

  if (scenario === undefined) {
    throw new Error('Scenario index is outside the prototype scenario list.')
  }

  return scenario
}

function viewTitle(view: View): string {
  switch (view) {
    case 'request':
      return 'RunRequest'
    case 'plan':
      return 'RunPlan'
    case 'record':
      return 'RunRecord'
  }
}

function formatView(view: View, scenario: RecordShapeScenario): string {
  switch (view) {
    case 'request':
      return stringify(scenario.request)
    case 'plan':
      return stringify(scenario.plan)
    case 'record':
      return stringify(scenario.record)
  }
}

function nextView(view: View): View {
  const next = viewValues[(viewValues.indexOf(view) + 1) % viewValues.length]

  if (next === undefined) {
    throw new Error('Non-empty view list produced no next value.')
  }

  return next
}

function stringify(value: unknown): string {
  return YAML.stringify(value, {
    aliasDuplicateObjects: false,
  })
}

Effect.runPromise(main).catch(error => {
  console.error(error)
  process.exitCode = 1
})
