import { Option } from "effect"
import { describe, expect, it } from "vitest"
import { ScenarioName, SandboxPath } from "../src/domain.js"
import { renderVerifierInput } from "../src/verifier/verifier-input.js"

describe("renderVerifierInput", () => {
  it("keeps verifier input smaller than RunContext", () => {
    const rendered = renderVerifierInput({
      scenarioName: ScenarioName.make("resolve-buttons"),
      scenarioMarkdown: "Pass condition must be demonstrated through visible UI interaction.",
      workspacePath: SandboxPath.make("/workspace"),
      appUrl: Option.some("http://localhost:3000"),
      agentOutputDir: Option.some(SandboxPath.make("/workspace/.sanity/agent-output"))
    })

    expect(rendered).toContain("Pass condition must be demonstrated through visible UI interaction.")
    expect(rendered).toContain("/workspace")
    expect(rendered).toContain("http://localhost:3000")
    expect(rendered).toContain("Agent output directory: /workspace/.sanity/agent-output")
    expect(rendered).not.toContain("provider")
    expect(rendered).not.toContain("disposal")
    expect(rendered).not.toContain("autoDelete")
    expect(rendered).not.toContain("autoArchive")
    expect(rendered).not.toContain("sandbox")
    expect(rendered).not.toContain("RunContext")
  })
})
