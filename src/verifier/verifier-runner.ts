import { Option } from "effect"
import { NonEmptyString, SandboxPath, type CommandSpec, type VerifierEntrypoint } from "../domain.js"
import { commandToShell, shellQuote } from "../sandbox/shell.js"

export const verifierCommand = (
  verifier: VerifierEntrypoint,
  verifierInputPath: SandboxPath,
  workspacePath: SandboxPath,
  appUrl: Option.Option<string>
): CommandSpec => {
  const base: CommandSpec = {
    command: verifier.command,
    args: verifier.args,
    cwd: Option.some(workspacePath),
    env: {
      SANITY_VERIFIER_INPUT: verifierInputPath,
      SANITY_WORKSPACE: workspacePath,
      ...Option.match(verifier.agentOutputDir, {
        onNone: () => ({}),
        onSome: (value) => ({ SANITY_AGENT_OUTPUT_DIR: value })
      }),
      ...Option.match(appUrl, {
        onNone: () => ({}),
        onSome: (value) => ({ SANITY_APP_URL: value })
      })
    }
  }

  if (verifier.stdin === "none") {
    return base
  }

  return {
    command: NonEmptyString.make("sh"),
    args: ["-lc", `${shellQuote("cat")} ${shellQuote(verifierInputPath)} | ${commandToShell(base)}`],
    cwd: Option.some(workspacePath),
    env: base.env
  }
}
