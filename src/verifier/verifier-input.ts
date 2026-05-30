import { Option } from "effect"
import type { VerifierInput } from "../domain.js"

export const renderVerifierInput = (input: VerifierInput): string => {
  const appUrl = Option.match(input.appUrl, {
    onNone: () => "none",
    onSome: (value) => value
  })
  const agentOutputDir = Option.match(input.agentOutputDir, {
    onNone: () => "none",
    onSome: (value) => value
  })

  return [
    "# Sanity Verifier Input",
    "",
    `Scenario: ${input.scenarioName}`,
    `Workspace: ${input.workspacePath}`,
    `App URL: ${appUrl}`,
    `Agent output directory: ${agentOutputDir}`,
    "",
    "## Scenario",
    "",
    input.scenarioMarkdown
  ].join("\n")
}
