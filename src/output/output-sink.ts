import { mkdir } from "node:fs/promises"
import { Effect } from "effect"
import { ConfigError, RunFailure, type OutputSink } from "../domain.js"

export const prepareOutputSink = (sink: OutputSink): Effect.Effect<OutputSink, ConfigError | RunFailure> => {
  switch (sink._tag) {
    case "NoOutput":
      return Effect.succeed(sink)
    case "LocalArtifactPath":
      return Effect.tryPromise({
        try: async () => {
          await mkdir(sink.path, { recursive: true })
          return sink
        },
        catch: (cause) =>
          new RunFailure({
            phase: "output",
            message: `Could not create artifact path ${sink.path}: ${String(cause)}`,
            actionableFix: "Choose a writable --artifact-path or pass --no-artifacts."
          })
      })
    case "ExternalSink":
      return Effect.fail(
        new ConfigError({
          message: `External artifact sinks are not supported in V0: ${sink.uri}`,
          actionableFix: "Use a local --artifact-path or --no-artifacts for now."
        })
      )
  }
}
