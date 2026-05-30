import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AbsolutePath } from "../../src/domain.js"

export const makeFixtureProject = async (profile: string): Promise<AbsolutePath> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sanity-test-"))
  const projectRoot = await mkProjectDir(root)
  await mkdir(path.join(projectRoot, ".sanity", "profiles"), { recursive: true })
  await mkdir(path.join(projectRoot, ".sanity", "scenarios"), { recursive: true })
  await writeFile(path.join(projectRoot, ".sanity", "profiles", "pr.yml"), profile)
  await writeFile(
    path.join(projectRoot, ".sanity", "scenarios", "resolve-buttons.md"),
    [
      "# Resolve buttons",
      "",
      "Pass condition must be demonstrated through visible UI interaction.",
      "API or JS inspection may be used only for debugging."
    ].join("\n")
  )
  return AbsolutePath.make(projectRoot)
}

const mkProjectDir = async (root: string): Promise<string> => {
  const name = `project-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const projectRoot = path.join(root, name)
  await mkdir(projectRoot, { recursive: true })
  return projectRoot
}

export const minimalProfile = (overrides = ""): string => `
sandbox:
  provider: daytona
  disposal: delete
  config:
    image: node:22
setup:
  - command: npm
    args: ["install"]
app:
  start:
    command: npm
    args: ["run", "dev", "--", "--host", "0.0.0.0"]
  port: 3000
verifier:
  entrypoint:
    command: codex
    args: ["exec", "--cd", "/workspace"]
    stdin: verifier-input
  timeoutMinutes: 20
  agentOutputDir: .sanity/agent-output
runSurface: headless
artifactPath: .sanity/runs/{runId}
scenarios:
  resolve-buttons:
    path: .sanity/scenarios/resolve-buttons.md
${overrides}
`
