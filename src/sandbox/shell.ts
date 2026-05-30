import { Option } from "effect"
import type { CommandSpec, SandboxPath } from "../domain.js"

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

export const commandToShell = (command: CommandSpec): string =>
  [command.command, ...command.args].map(shellQuote).join(" ")

export const dirname = (sandboxPath: SandboxPath): string => {
  const index = sandboxPath.lastIndexOf("/")
  return index <= 0 ? "/" : sandboxPath.slice(0, index)
}

export const basename = (sandboxPath: SandboxPath): string => {
  const index = sandboxPath.lastIndexOf("/")
  return index < 0 ? sandboxPath : sandboxPath.slice(index + 1)
}

export const optionEnv = (entries: ReadonlyArray<readonly [string, Option.Option<string>]>): Readonly<Record<string, string>> => {
  const env: Record<string, string> = {}
  for (const [name, value] of entries) {
    if (Option.isSome(value)) {
      env[name] = value.value
    }
  }
  return env
}
