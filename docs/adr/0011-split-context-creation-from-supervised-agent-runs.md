# Split context creation from supervised agent runs

Sanity should support both `sanity create` and `sanity run`. `sanity create` resolves a RunRequest, creates the sandboxed candidate context, and returns a live RunContext for an already-running agent or harness. `sanity run` resolves a RunRequest, creates a RunContext internally, invokes and supervises a configured Verifier Entrypoint, applies sandbox disposal, and returns a RunResult.

**Considered Options**

- `sanity create` only: rejected because it makes Sanity too close to a thin Daytona sandbox wrapper and gives it no execution or verification story.
- `sanity run` only: rejected because existing agents and external harnesses need a way to receive sandbox context without Sanity pretending to own their lifecycle.
- `prepare` / `finish`: rejected because it introduces a handoff lifecycle and cleanup contract before Sanity has earned that abstraction.

**Consequences**

RunContext is the live operational context for a sandboxed candidate. It is visible from `sanity create` and internal to `sanity run`; it is not durable run output and should not replace RunResult.

Verifier Entrypoint is the bounded sandbox command Sanity invokes, such as `codex exec`, `claude --print`, or a project-specific wrapper. Verifier remains the role: the agent or harness exercising scenarios against the candidate. The entrypoint starts the verifier; it is not a command scenario.

For v0, `sanity run` invokes the verifier entrypoint inside the sandbox. Sanity should not add a `placement` field yet. Outside or already-running agents use `sanity create` to receive RunContext and own their own execution lifecycle.

`sanity run` is the product path for Sanity-supervised verification because it can wait for the verifier entrypoint, classify orchestration status, apply sandbox disposal, and return a RunResult. `sanity create` is the integration path for agents that already exist, such as a local Codex session or a Devin-like harness that wants to use Sanity for sandboxed context creation.

`sanity create` does not apply sandbox disposal. A created RunContext must remain usable after the command returns, so its lifetime is controlled by provider lifecycle timers under sandbox config, or by a later explicit `sanity delete` command. `sandbox.disposal` belongs to `sanity run`, where Sanity has a bounded runtime to wait for and a real end-of-run point. Profile-level disposal defaults are resolved only for `run`; direct disposal input on `create` is invalid.

`sanity delete` is cleanup for a created RunContext or sandbox id. It is not a verifier execution mode and does not produce a RunResult. For v0, it only deletes; manual archive after `create` can be added later if that becomes a concrete workflow.
