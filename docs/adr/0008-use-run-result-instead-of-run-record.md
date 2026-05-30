# Use RunResult instead of RunRecord

Sanity should return a lightweight RunResult that describes its own orchestration outcome, not a durable RunRecord that pretends to be the user's run output. The user's record of run output is whatever the configured verifier or output sink saves, embeds, hosts, or omits.

**Considered Options**

- Durable RunRecord: rejected because it implies Sanity owns output storage, report structure, or run output durability.
- Run Output manifest: rejected for now because output sinks may be external agent sessions, hosted media, local files, or no persisted artifacts at all.

**Consequences**

RunResult is useful for CLI output, exit behavior, GitHub Actions, and agent harness integrations. Its top-level status describes Sanity orchestration only, such as completed, failed, or cancelled; `completed` means the verifier or harness returned control without a Sanity-level failure, even if the verifier's own run output shows the scenario behavior failed. CLI exit codes should be derived from RunResult status only, not from verifier verdicts hidden in the output sink. Scenario verdicts belong in the output sink or verifier harness, outside Sanity core. RunResult should identify the candidate as a normalized object so local worktrees, git refs, PRs, commits, and future change sources do not become stringly typed. RunResult should omit verifier internals; if users need an external session id, URL, or harness-specific details, those belong in the output sink or harness output. RunResult should stay focused on profile, candidate, scenarios, sandbox/verifier orchestration, status, and output sink information rather than becoming a report or output packet.

Sandbox details in RunResult should stay control-plane shaped: provider, id, Sanity lifecycle/disposal state, region, snapshot, and applied provider-specific config when available. Sandbox state should be `created`, `deleted`, `retained`, or `archived`; it is Sanity's disposal outcome, not a mirror of the provider's full sandbox state machine. Inability to determine state is a Sanity-level error, not an `unknown` state. Sandbox disposal must be explicit through user or profile choice: delete removes the sandbox, retain leaves it available under its configured Daytona lifecycle timers, and archive stops and archives it for cheaper long-term preservation. Sanity should not automatically retain or archive sandboxes on failure.
