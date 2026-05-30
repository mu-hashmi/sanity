import { Duration, Option } from "effect"
import { describe, expect, it } from "vitest"
import { AbsolutePath, NonEmptyString, SandboxPath, type AppSpec } from "../src/domain.js"
import { appSessionCommand, recordingPathFor } from "../src/sandbox/daytona-gateway.js"

const app = (env: Readonly<Record<string, string>>): AppSpec => ({
  start: {
    command: NonEmptyString.make("npm"),
    args: ["run", "dev"],
    cwd: Option.some(SandboxPath.make("/workspace")),
    env
  },
  port: 3000,
  healthcheckPath: "/",
  readinessTimeout: Duration.seconds(10)
})

describe("Daytona gateway helpers", () => {
  it("passes app start environment through the session command", () => {
    expect(appSessionCommand(app({ FEATURE_FLAG: "enabled", TOKEN: "a b" }))).toContain("env FEATURE_FLAG='enabled' TOKEN='a b'")
  })

  it("uses distinct recording names for multi-scenario graphical runs", () => {
    expect(recordingPathFor({ _tag: "LocalArtifactPath", path: AbsolutePath.make("/tmp/run") }, "recording-resolve-buttons")).toBe(
      "/tmp/run/recording-resolve-buttons.mp4"
    )
  })
})
