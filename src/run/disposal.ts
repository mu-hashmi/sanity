import { Effect, Option } from "effect"
import { type DisposalOutcome, type SandboxHandle } from "../domain.js"
import { DaytonaGateway } from "../sandbox/gateway.js"

export const applyDisposal = (
  disposal: "delete" | "retain" | "archive",
  sandbox: SandboxHandle
): Effect.Effect<DisposalOutcome, never, DaytonaGateway> =>
  Effect.gen(function* () {
    const gateway = yield* DaytonaGateway
    switch (disposal) {
      case "delete":
        return yield* gateway.delete(sandbox).pipe(
          Effect.as<DisposalOutcome>({ _tag: "Deleted" }),
          Effect.catch((failure) => Effect.succeed<DisposalOutcome>({ _tag: "Failed", message: failure.message }))
        )
      case "retain":
        return { _tag: "Retained" }
      case "archive": {
        const stopOutcome = yield* gateway.stop(sandbox).pipe(
          Effect.as(Option.none<string>()),
          Effect.catch((failure) => Effect.succeed(Option.some(failure.message)))
        )
        if (Option.isSome(stopOutcome)) {
          return { _tag: "Failed", message: stopOutcome.value }
        }
        return yield* gateway.archive(sandbox).pipe(
          Effect.as<DisposalOutcome>({ _tag: "Archived" }),
          Effect.catch((failure) => Effect.succeed<DisposalOutcome>({ _tag: "Failed", message: failure.message }))
        )
      }
    }
  })
