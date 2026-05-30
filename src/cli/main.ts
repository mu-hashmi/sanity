#!/usr/bin/env node
import { Effect, Exit } from "effect"
import { Command } from "effect/unstable/cli"
import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices"
import { AbsolutePath, RunId } from "../domain.js"
import { makeDaytonaGateway } from "../sandbox/daytona-gateway.js"
import type { DaytonaGatewayShape } from "../sandbox/gateway.js"
import { CliRuntime, exitCodeFromCliError, sanityCommand } from "./command.js"

export { exitCodeFor, runCliInputFromFlags, sanityCommand } from "./command.js"

const cliVersion = "0.0.0"

const runCli = (argv: ReadonlyArray<string>, gateway: DaytonaGatewayShape): Effect.Effect<number> =>
  Effect.gen(function* () {
    let exitCode = 0
    const projectRoot = AbsolutePath.make(process.cwd())
    const runtime = {
      gateway,
      environment: {
        projectRoot,
        nextRunId: () => RunId.make(`run-${Date.now()}`)
      },
      setExitCode: (code: number) =>
        Effect.sync(() => {
          exitCode = code
        })
    }

    yield* Command.runWith(sanityCommand, { version: cliVersion })(argv).pipe(
      Effect.provideService(CliRuntime, runtime),
      Effect.provide(NodeServicesLayer),
      Effect.catchTags({
        ShowHelp: (error) =>
          Effect.sync(() => {
            exitCode = exitCodeFromCliError(error)
          }),
        UnrecognizedOption: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        DuplicateOption: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        MissingOption: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        MissingArgument: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        InvalidValue: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        UnknownSubcommand: () =>
          Effect.sync(() => {
            exitCode = 2
          }),
        UserError: () =>
          Effect.sync(() => {
            exitCode = 69
          })
      })
    )

    return exitCode
  })

export const main = (argv: ReadonlyArray<string>): Promise<number> =>
  new Promise((resolve) => {
    let interrupt: (() => void) | undefined
    let finished = false
    const removeSignalHandlers = (): void => {
      if (interrupt !== undefined) {
        process.off("SIGINT", interrupt)
        process.off("SIGTERM", interrupt)
      }
    }
    interrupt = Effect.runCallback(runCli(argv, makeDaytonaGateway()), {
      onExit: (exit) => {
        finished = true
        removeSignalHandlers()
        resolve(
          Exit.match(exit, {
            onFailure: () => 130,
            onSuccess: (code) => code
          })
        )
      }
    })
    if (!finished) {
      process.once("SIGINT", interrupt)
      process.once("SIGTERM", interrupt)
    }
  })

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
