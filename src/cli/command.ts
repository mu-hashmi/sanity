import path from "node:path"
import { Effect, Option } from "effect"
import * as Context from "effect/Context"
import { CliError, Command, Flag } from "effect/unstable/cli"
import {
  AbsolutePath,
  ConfigError,
  ProfileName,
  ScenarioName,
  type RunCliInput,
  type RunOutcome,
  type RunResult
} from "../domain.js"
import { makeProjectConfig, ProjectConfig } from "../config/project-config.js"
import { CandidateArchiveLive } from "../run/candidate-archive.js"
import { run, type RunEnvironment } from "../run/run-service.js"
import { DaytonaGateway, type DaytonaGatewayShape } from "../sandbox/gateway.js"
import { runRequestToJson, runResultToJson, type JsonValue } from "../json.js"

type RunFlags = {
  readonly profile: Option.Option<string>
  readonly scenario: ReadonlyArray<string>
  readonly all: boolean
  readonly candidate: Option.Option<string>
  readonly artifactPath: Option.Option<string>
  readonly noArtifacts: boolean
  readonly json: boolean
  readonly noInput: boolean
  readonly dryRun: boolean
  readonly debug: boolean
}

type UsageFailure = {
  readonly message: string
  readonly actionableFix: string
}

type ParsedRunInput =
  | { readonly _tag: "Valid"; readonly input: RunCliInput }
  | { readonly _tag: "Invalid"; readonly failure: UsageFailure }

const fail = (message: string, actionableFix: string): ParsedRunInput => ({
  _tag: "Invalid",
  failure: { message, actionableFix }
})

const required = (value: Option.Option<string>, message: string, actionableFix: string): string | UsageFailure =>
  Option.match(value, {
    onNone: () => ({ message, actionableFix }),
    onSome: (selected) => selected
  })

const isUsageFailure = (value: string | UsageFailure): value is UsageFailure => typeof value !== "string"

export const runCliInputFromFlags = (flags: RunFlags): ParsedRunInput => {
  const profile = required(
    flags.profile,
    "Missing required --profile.",
    "Run `sanity run --profile <name> --candidate <path> --scenario <name>`."
  )
  if (isUsageFailure(profile)) {
    return { _tag: "Invalid", failure: profile }
  }

  const candidate = required(
    flags.candidate,
    "Missing required --candidate.",
    "Run `sanity run --candidate . --profile <name> --scenario <name>`."
  )
  if (isUsageFailure(candidate)) {
    return { _tag: "Invalid", failure: candidate }
  }

  if (flags.all && flags.scenario.length > 0) {
    return fail("Cannot combine --all with --scenario.", "Use either --all or one or more --scenario flags.")
  }
  if (!flags.all && flags.scenario.length === 0) {
    return fail("Missing scenario selection.", "Pass --scenario <name> or --all.")
  }
  if (flags.noArtifacts && Option.isSome(flags.artifactPath)) {
    return fail("Cannot combine --artifact-path with --no-artifacts.", "Use either --artifact-path <path> or --no-artifacts.")
  }

  return {
    _tag: "Valid",
    input: {
      profile: ProfileName.make(profile),
      scenario: flags.scenario.map(ScenarioName.make),
      all: flags.all,
      candidate: AbsolutePath.make(path.resolve(candidate)),
      artifactPath: Option.map(flags.artifactPath, AbsolutePath.make),
      noArtifacts: flags.noArtifacts,
      json: flags.json,
      noInput: flags.noInput,
      dryRun: flags.dryRun,
      debug: flags.debug
    }
  }
}

export class CliRuntime extends Context.Service<
  CliRuntime,
  {
    readonly gateway: DaytonaGatewayShape
    readonly environment: RunEnvironment
    readonly setExitCode: (code: number) => Effect.Effect<void>
  }
>()("CliRuntime") {}

export const exitCodeFor = (result: RunResult): number => {
  switch (result.status) {
    case "completed":
      return result.verifier.exitCode === 0 ? 0 : 1
    case "failed":
      return 69
    case "cancelled":
      return 130
  }
}

const printJson = (value: JsonValue): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  })

const printError = (failure: UsageFailure | ConfigError, debug: boolean): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stderr.write(`Error: ${failure.message}\n`)
    process.stderr.write(`Fix: ${failure.actionableFix}\n`)
    if (debug) {
      process.stderr.write(`${JSON.stringify(failure)}\n`)
    }
  })

const printOutcome = (outcome: RunOutcome, json: boolean): Effect.Effect<number> =>
  Effect.gen(function* () {
    switch (outcome._tag) {
      case "DryRun":
        if (json) {
          yield* printJson(runRequestToJson(outcome.request))
        } else {
          yield* Effect.sync(() => {
            process.stdout.write(`Resolved run ${outcome.request.runId} with ${outcome.request.scenarios.length} scenario(s).\n`)
          })
        }
        return 0
      case "Executed":
        const result = outcome.result
        if (json) {
          yield* printJson(runResultToJson(result))
        } else if (result.status === "completed") {
          const verifierExitCode = result.verifier.exitCode
          yield* Effect.sync(() => {
            process.stdout.write(`Run ${result.runId} completed with verifier exit ${verifierExitCode}.\n`)
          })
        } else {
          yield* Effect.sync(() => {
            process.stdout.write(`Run ${result.runId} ${result.status}.\n`)
          })
        }
        return exitCodeFor(result)
    }
  })

const profileFlag = Flag.string("profile").pipe(
  Flag.optional,
  Flag.withDescription("Profile from .sanity/profiles/<name>.yml")
)
const candidateFlag = Flag.string("candidate").pipe(
  Flag.optional,
  Flag.withDescription("Local candidate directory to run in a sandbox")
)
const scenarioFlag = Flag.string("scenario").pipe(
  Flag.atLeast(0),
  Flag.withDescription("Scenario name from the profile; repeatable")
)
const allFlag = Flag.boolean("all").pipe(Flag.withDescription("Run every scenario in the profile"))
const artifactPathFlag = Flag.string("artifact-path").pipe(
  Flag.optional,
  Flag.withDescription("Local artifact directory; supports {runId}")
)
const noArtifactsFlag = Flag.boolean("no-artifacts").pipe(Flag.withDescription("Do not store local artifacts"))
const dryRunFlag = Flag.boolean("dry-run").pipe(Flag.withDescription("Resolve and print the RunRequest without creating a sandbox"))
const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Print machine-readable JSON"))
const noInputFlag = Flag.boolean("no-input").pipe(Flag.withDescription("Fail instead of prompting; Sanity does not prompt in V0"))
const debugFlag = Flag.boolean("debug").pipe(Flag.withDescription("Print extra error detail"))

const runCommand = Command.make(
  "run",
  {
    profile: profileFlag,
    scenario: scenarioFlag,
    all: allFlag,
    candidate: candidateFlag,
    artifactPath: artifactPathFlag,
    noArtifacts: noArtifactsFlag,
    json: jsonFlag,
    noInput: noInputFlag,
    dryRun: dryRunFlag,
    debug: debugFlag
  },
  (flags) =>
    Effect.gen(function* () {
      const runtime = yield* CliRuntime
      const parsed = runCliInputFromFlags(flags)

      if (parsed._tag === "Invalid") {
        yield* printError(parsed.failure, flags.debug)
        yield* runtime.setExitCode(2)
        return
      }

      const outcomeCode = yield* run(parsed.input, runtime.environment).pipe(
        Effect.provideService(ProjectConfig, makeProjectConfig(runtime.environment.projectRoot)),
        Effect.provideService(DaytonaGateway, runtime.gateway),
        Effect.provide(CandidateArchiveLive),
        Effect.matchEffect({
          onFailure: (failure) =>
            Effect.gen(function* () {
              yield* printError(failure, parsed.input.debug)
              return 2
            }),
          onSuccess: (value) => printOutcome(value, parsed.input.json)
        })
      )

      yield* runtime.setExitCode(outcomeCode)
    })
).pipe(
  Command.withDescription("Run one or more scenarios in a Daytona sandbox."),
  Command.withExamples([
    {
      command: "sanity run --profile pr --candidate . --scenario resolve-buttons --artifact-path .sanity/runs/{runId} --json --no-input",
      description: "Run one scenario and write JSON output"
    },
    {
      command: "sanity run --profile pr --candidate . --all",
      description: "Run every scenario in the selected profile"
    },
    {
      command: "sanity run --profile pr --candidate . --scenario resolve-buttons --dry-run --json",
      description: "Resolve the RunRequest without creating a sandbox"
    }
  ])
)

export const sanityCommand = Command.make("sanity").pipe(
  Command.withDescription("Sandbox-backed verification for agent-produced code changes."),
  Command.withSubcommands([runCommand])
)

export const exitCodeFromCliError = (error: CliError.CliError): number =>
  error._tag === "ShowHelp" && error.errors.length === 0 ? 0 : 2
