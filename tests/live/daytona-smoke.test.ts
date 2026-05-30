import { execFile } from "node:child_process"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { Effect, Option } from "effect"
import { describe, expect, it } from "vitest"
import { makeProjectConfig, ProjectConfig } from "../../src/config/project-config.js"
import { AbsolutePath, ProfileName, RunId, ScenarioName, type RunCliInput } from "../../src/domain.js"
import { CandidateArchiveLive } from "../../src/run/candidate-archive.js"
import { run } from "../../src/run/run-service.js"
import { makeDaytonaGateway } from "../../src/sandbox/daytona-gateway.js"
import { DaytonaGateway } from "../../src/sandbox/gateway.js"

const execFilePromise = promisify(execFile)
const hasDaytonaKey = process.env.DAYTONA_API_KEY !== undefined && process.env.DAYTONA_API_KEY.trim().length > 0

const createSmokeProject = async (): Promise<AbsolutePath> => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "sanity-live-"))
  await mkdir(path.join(projectRoot, ".sanity", "profiles"), { recursive: true })
  await mkdir(path.join(projectRoot, ".sanity", "scenarios"), { recursive: true })
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          start: "node server.mjs"
        }
      },
      null,
      2
    )
  )
  await writeFile(
    path.join(projectRoot, "server.mjs"),
    [
      "import http from 'node:http'",
      "const server = http.createServer((_req, res) => {",
      "  if (process.env.SANITY_LIVE_APP_ENV !== 'present') {",
      "    res.writeHead(500, { 'content-type': 'text/plain' })",
      "    res.end('missing app env')",
      "    return",
      "  }",
      "  res.writeHead(200, { 'content-type': 'text/plain' })",
      "  res.end('sanity live smoke ok')",
      "})",
      "server.listen(3000, '0.0.0.0')"
    ].join("\n")
  )
  await writeFile(
    path.join(projectRoot, "verifier.mjs"),
    [
      "import { mkdir, writeFile } from 'node:fs/promises'",
      "let input = ''",
      "for await (const chunk of process.stdin) input += chunk",
      "if (!input.includes('Sanity live smoke scenario')) process.exit(2)",
      "if (process.env.SANITY_APP_URL !== 'http://localhost:3000') process.exit(4)",
      "if (process.env.SANITY_AGENT_OUTPUT_DIR !== '/workspace/.sanity/agent-output') process.exit(5)",
      "const response = await fetch(process.env.SANITY_APP_URL)",
      "const body = await response.text()",
      "if (!body.includes('sanity live smoke ok')) process.exit(3)",
      "await mkdir('/workspace/.sanity/agent-output', { recursive: true })",
      "await writeFile('/workspace/.sanity/agent-output/notes.txt', 'verified')"
    ].join("\n")
  )
  await writeFile(
    path.join(projectRoot, ".sanity", "scenarios", "smoke.md"),
    "Sanity live smoke scenario: open the app and verify it responds from the user's seat.\n"
  )
  await writeFile(
    path.join(projectRoot, ".sanity", "profiles", "live.yml"),
    `
sandbox:
  provider: daytona
  disposal: delete
  config:
    image: node:22
    autoDeleteMinutes: 0
setup:
  - command: npm
    args: ["install"]
app:
  start:
    command: npm
    args: ["run", "start"]
    env:
      SANITY_LIVE_APP_ENV: present
  port: 3000
  healthcheckPath: /
  readinessTimeoutSeconds: 120
verifier:
  entrypoint:
    command: node
    args: ["/workspace/verifier.mjs"]
    stdin: verifier-input
  timeoutMinutes: 5
  agentOutputDir: .sanity/agent-output
runSurface: headless
artifactPath: .sanity/runs/{runId}
scenarios:
  smoke:
    path: .sanity/scenarios/smoke.md
`
  )
  return AbsolutePath.make(projectRoot)
}

const input = (projectRoot: AbsolutePath): RunCliInput => ({
  profile: ProfileName.make("live"),
  scenario: [ScenarioName.make("smoke")],
  all: false,
  candidate: projectRoot,
  artifactPath: Option.none(),
  noArtifacts: false,
  json: true,
  noInput: true,
  dryRun: false,
  debug: false
})

describe("Daytona live smoke", () => {
  const liveIt = hasDaytonaKey ? it : it.skip

  liveIt("runs the V0 runner graph against a real Daytona sandbox", async () => {
    const projectRoot = await createSmokeProject()
    const outcome = await Effect.runPromise(
      run(input(projectRoot), {
        projectRoot,
        nextRunId: () => RunId.make("run-live-smoke")
      }).pipe(
        Effect.provideService(ProjectConfig, makeProjectConfig(projectRoot)),
        Effect.provideService(DaytonaGateway, makeDaytonaGateway()),
        Effect.provide(CandidateArchiveLive)
      )
    )

    expect(outcome._tag).toBe("Executed")
    if (outcome._tag === "Executed") {
      expect(outcome.result.status, JSON.stringify(outcome.result, null, 2)).toBe("completed")
      if (outcome.result.status === "completed") {
        expect(outcome.result.verifier.exitCode).toBe(0)
        expect(outcome.result.disposal._tag).toBe("Deleted")
      }
    }
    const { stdout } = await execFilePromise("tar", ["-tzf", path.join(projectRoot, ".sanity", "runs", "run-live-smoke", "agent-output.tgz")])
    expect(stdout).toContain("agent-output/notes.txt")
  }, 600_000)
})
