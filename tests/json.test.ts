import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { RunId, type RunResult } from "../src/domain.js"
import { RunResultJsonSchema, runResultToJson } from "../src/json.js"

describe("JSON output contracts", () => {
  it("validates RunResult output with Effect Schema", () => {
    const result: RunResult = {
      status: "completed",
      runId: RunId.make("run-test"),
      verifier: {
        exitCode: 0,
        timedOut: false
      },
      sandbox: {
        id: "sandbox-id",
        name: "sandbox-name",
        target: "us"
      },
      outputSink: { _tag: "NoOutput" },
      disposal: { _tag: "Deleted" }
    }

    expect(() => Schema.decodeUnknownSync(RunResultJsonSchema)(runResultToJson(result))).not.toThrow()
  })

  it("rejects malformed RunResult JSON instead of relying on plain TypeScript types", () => {
    expect(() =>
      Schema.decodeUnknownSync(RunResultJsonSchema)({
        status: "failed",
        runId: "run-test",
        phase: "unknown",
        message: "bad",
        actionableFix: "fix",
        sandbox: null,
        disposal: Option.none()
      })
    ).toThrow()
  })
})
