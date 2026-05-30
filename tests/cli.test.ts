import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Option, Schema } from "effect"
import { describe, expect, it } from "vitest"
import { exitCodeFor, main, runCliInputFromFlags, sanityCommand } from "../src/cli/main.js"
import { RunId, type RunResult } from "../src/domain.js"
import { RunRequestJsonSchema } from "../src/json.js"
import { makeFixtureProject, minimalProfile } from "./helpers/project.js"

describe("CLI contract", () => {
  it.each([
    [["run", "--candidate", ".", "--scenario", "resolve-buttons"], "Missing required --profile."],
    [["run", "--profile", "pr", "--scenario", "resolve-buttons"], "Missing required --candidate."],
    [["run", "--profile", "pr", "--candidate", "."], "Missing scenario selection."],
    [["run", "--profile", "pr", "--candidate", ".", "--all", "--scenario", "resolve-buttons"], "Cannot combine --all with --scenario."],
    [
      ["run", "--profile", "pr", "--candidate", ".", "--scenario", "resolve-buttons", "--artifact-path", "out", "--no-artifacts"],
      "Cannot combine --artifact-path with --no-artifacts."
    ]
  ])("rejects invalid invocation %j", (argv, message) => {
    const baseFlags = {
      profile: Option.none<string>(),
      scenario: [] as ReadonlyArray<string>,
      all: false,
      candidate: Option.none<string>(),
      artifactPath: Option.none<string>(),
      noArtifacts: false,
      json: false,
      noInput: false,
      dryRun: false,
      debug: false
    }
    const flags = argv.reduce<typeof baseFlags>((current, arg, index) => {
      const next = argv[index + 1]
      switch (arg) {
        case "--profile":
          return { ...current, profile: Option.some(next ?? "") }
        case "--candidate":
          return { ...current, candidate: Option.some(next ?? "") }
        case "--scenario":
          return { ...current, scenario: [...current.scenario, next ?? ""] }
        case "--all":
          return { ...current, all: true }
        case "--artifact-path":
          return { ...current, artifactPath: Option.some(next ?? "") }
        case "--no-artifacts":
          return { ...current, noArtifacts: true }
        default:
          return current
      }
    }, baseFlags)

    expect(runCliInputFromFlags(flags)).toMatchObject({ _tag: "Invalid", failure: { message } })
  })

  it("defines the public CLI through Effect Command", () => {
    expect(sanityCommand.name).toBe("sanity")
    expect(sanityCommand.subcommands.flatMap((group) => group.commands.map((command) => command.name))).toContain("run")
  })

  it("returns exit code 2 for usage errors through the Effect CLI entrypoint", async () => {
    const writes: Array<string> = []
    const originalWrite = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    try {
      await expect(main(["run", "--candidate", ".", "--scenario", "resolve-buttons"])).resolves.toBe(2)
      expect(writes.join("")).toContain("Missing required --profile.")
    } finally {
      process.stderr.write = originalWrite
    }
  })

  it("maps verifier nonzero completion to exit code 1", () => {
    const result: RunResult = {
      status: "completed",
      runId: RunId.make("run-test"),
      verifier: {
        exitCode: 1,
        timedOut: false
      },
      sandbox: {
        id: "sandbox-id",
        name: "sandbox",
        target: "local"
      },
      outputSink: { _tag: "NoOutput" },
      disposal: { _tag: "Deleted" }
    }

    expect(exitCodeFor(result)).toBe(1)
  })

  it("prints dry-run JSON through the real CLI entrypoint", async () => {
    const projectRoot = await makeFixtureProject(minimalProfile())
    const originalCwd = process.cwd()
    const writes: Array<string> = []
    const originalWrite = process.stdout.write
    process.chdir(projectRoot)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      const code = await main(["run", "--profile", "pr", "--candidate", ".", "--scenario", "resolve-buttons", "--dry-run", "--json"])
      expect(code).toBe(0)
      const output = JSON.parse(writes.join(""))
      expect(() => Schema.decodeUnknownSync(RunRequestJsonSchema)(output)).not.toThrow()
      expect(output).toMatchObject({
        profileName: "pr",
        scenarios: [{ name: "resolve-buttons" }]
      })
    } finally {
      process.stdout.write = originalWrite
      process.chdir(originalCwd)
    }
  })

  it("returns exit code 2 for config errors through the real CLI entrypoint", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "sanity-cli-empty-"))
    const originalCwd = process.cwd()
    const originalWrite = process.stderr.write
    process.chdir(projectRoot)
    process.stderr.write = (() => true) as typeof process.stderr.write
    try {
      await expect(main(["run", "--profile", "missing", "--candidate", ".", "--scenario", "resolve-buttons"])).resolves.toBe(2)
    } finally {
      process.stderr.write = originalWrite
      process.chdir(originalCwd)
    }
  })
})
