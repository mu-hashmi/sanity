# Sanity Context

Sanity is a sandbox-backed verification tool for showing what an agent verifier did against candidate code from outside the codebase. It creates sandboxed candidate contexts and can invoke bounded verifier entrypoints, while keeping the runnable scenario format small.

## Language

**Candidate**:
The code version or change source being exercised in a Sanity run.
_Avoid_: Candidate Code, trusted code, verified code, target

**Scenario**:
A persisted, selectable behavioral task or claim that tells a verifier what to exercise and observe.
_Avoid_: Check, test case when the instructions are not executable assertions

**Profile**:
A runnable YAML configuration for a class of Sanity runs.
_Avoid_: Environment, preset

**Verifier**:
The agent or agent harness that exercises a scenario against the sandboxed candidate.
_Avoid_: Sanity, tester

**Verifier Entrypoint**:
The bounded sandbox command Sanity invokes during `sanity run` to start a verifier, such as `codex exec`, `claude --print`, or a project-specific wrapper.
_Avoid_: Agent Runtime as a core term, Driver, command driver

**Agent Output**:
Agent-generated run output such as plans, timeline annotations, setup notes, assertions, transcripts, screenshots, video, or reports.
_Avoid_: VerifierPlan as a core category

**Run Output**:
Output captured, created, embedded, or referenced from a run, including agent output and harness output.
_Avoid_: Evidence when proof is not implied

**Output Sink**:
The local or external destination where run output can be written or referenced.
_Avoid_: Report format

**Run Surface**:
Deterministic profile or scenario-catalog config that tells Sanity whether a run needs graphical desktop/browser support.
_Avoid_: inferring graphical needs from scenario prose

**Run**:
A supervised Sanity execution that creates a RunContext, invokes a Verifier Entrypoint, and returns a RunResult.
_Avoid_: Check run

**RunRequest**:
The normalized intent and input Sanity uses to create a sandboxed context or run a verifier.
_Avoid_: RunSelection

**RunContext**:
The live machine-readable context for a sandboxed candidate and selected scenarios.
_Avoid_: RunPlan, handoff

**Verifier Input**:
The minimal prompt or input file Sanity gives a sandbox-local verifier entrypoint during `sanity run`.
_Avoid_: RunContext as verifier prompt

**RunResult**:
The machine-readable summary of a supervised Sanity run and its orchestration outcome.
_Avoid_: RunRecord, Receipt

## Relationships

- `sanity create` starts from one **RunRequest** and returns one **RunContext** for an already-running agent or harness to use.
- `sanity run` starts from one **RunRequest**, creates one **RunContext** internally, invokes and supervises a configured **Verifier Entrypoint**, applies sandbox disposal, and produces one **RunResult**.
- A **RunRequest** contains the effective sandbox choice Sanity will use after profile defaults and CLI inputs are resolved.
- A **RunRequest** contains the effective **Output Sink** after profile defaults and CLI inputs are resolved.
- A **RunRequest** references selected scenarios; it does not embed scenario markdown.
- A **RunRequest** references the profile; it does not copy profile-owned setup or app boot instructions.
- A **RunContext** is live operational context, not durable run output; it may include sandbox identifiers, workspace paths, URLs, and scenario references needed while the sandbox is usable.
- A **RunContext** is not the verifier prompt for `sanity run`.
- A **Verifier Input** contains only what the sandbox-local verifier needs: scenario text, relevant app/workspace paths or URLs, anti-cheating instructions, and optional agent-output path instructions.
- A **RunResult** identifies the **Candidate** as a normalized object, not only the raw input string.
- A **RunResult** omits verifier internals; external verifier session details belong in the **Output Sink** or verifier harness.
- A **RunResult** may identify the sandbox by provider, id, Sanity lifecycle/disposal state, region, and snapshot; it does not mirror the provider's full sandbox state machine.
- A **RunResult** may include the provider-specific sandbox config Sanity applied, scoped under sandbox config.
- Sandbox disposal applies to `sanity run` only and is explicit: delete, retain, or archive. Sanity does not retain or archive sandboxes automatically on failure.
- `sanity create` does not apply sandbox disposal because it must return a usable live **RunContext**. Its sandbox lifecycle comes from provider timers in sandbox config or a later explicit `sanity delete` command.
- Profile-level disposal defaults are resolved only for `sanity run`; command-level disposal input is invalid for `sanity create`.
- Archive disposal is valid only for sandbox providers that support archiving; unsupported disposal modes fail profile validation.
- Provider-specific sandbox settings belong under sandbox config and are typed by sandbox provider.
- A **Profile** contains one or more **Scenarios** and owns setup, app boot, sandbox, verifier entrypoint, run surface, and output sink defaults for that run shape.
- A scenario catalog entry may override profile-level **Run Surface** when one scenario needs graphical capture and another does not.
- An **Output Sink** is one of `none`, `local`, or `external`.
- An `external` **Output Sink** carries a URI or URI-like reference.
- `none` is an explicit **Output Sink** when Sanity should not store or reference run output.
- Sanity does not model fine-grained output toggles or mandate a baseline run output envelope in the core scenario/profile format.
- Every **Scenario** is exercised by a **Verifier**; commands and scripts are tools a verifier may use, not Sanity scenario types.
- A **Verifier** may run inside the sandbox, outside the sandbox, or inside an external agent harness.
- When Sanity supervises verifier execution in v0, it invokes a **Verifier Entrypoint** inside the sandbox. The entrypoint is a command that starts an agent or harness; it is not a command scenario.
- During `sanity run`, deterministic harness output capture belongs to Sanity where provider APIs support it, such as process logs and file download/upload.
- Sanity starts graphical desktop/browser capture, such as Computer Use recording or screenshots, only when the effective **Run Surface** is graphical. It does not infer graphical capture from markdown instructions.
- Agent-authored plans, annotations, assertions, and reports remain **Agent Output** because their content depends on verifier judgment.
- A **Scenario** is a persistent input; **Agent Output**, when produced, belongs to a specific run.
- **Agent Output** is opaque to Sanity core; specific verifier integrations may define optional output schemas later.
- **Run Output** is the umbrella for user-facing output from the run; **Agent Output** is the subset generated by the verifier.
- A **Verifier** owns the scenario conclusion it states; Sanity owns the orchestration outcome it reports.
- **RunResult** status describes Sanity orchestration only; `completed` means the verifier or harness returned control without a Sanity-level failure.
- **Run Output** can include video-grade desktop capture, but not every scenario needs Computer Use, a browser, or a UI.
- A **RunResult** is not the canonical run output; user-facing output lives in the **Output Sink** or external verifier harness.

## Example Dialogue

> **Dev:** "Can I run a browser scenario that tells Codex how to open the app?"
> **Domain expert:** "Yes. Put that behavior in the **Scenario**. Sanity should capture the **Run Output**, not decide the browser workflow."
>
> **Dev:** "If Codex exits 0, did the **Run** pass?"
> **Domain expert:** "Sanity can say the **Verifier** process completed. The scenario conclusion belongs in the **Output Sink** or verifier harness."
>
> **Dev:** "Can I use Sanity for a shell command scenario?"
> **Domain expert:** "No. Shell commands belong inside the **Verifier**'s work. Sanity scenarios are for agent verification, not CI-style command tests."
>
> **Dev:** "Does every run need a saved test plan or timeline annotations?"
> **Domain expert:** "No. Those are useful **Agent Output** when a verifier or harness produces them, but Sanity core does not require them."
>
> **Dev:** "Should the verifier receive the whole RunContext?"
> **Domain expert:** "No. Sandbox-local verifiers get a minimal **Verifier Input**. Sanity owns deterministic capture around the entrypoint."
>
> **Dev:** "When does Sanity start screen recording?"
> **Domain expert:** "Only when the effective **Run Surface** is graphical. That is config, not natural-language inference."
>
> **Dev:** "When do I use `sanity create` instead of `sanity run`?"
> **Domain expert:** "`create` returns a live **RunContext** for an agent that already exists. `run` asks Sanity to invoke and supervise a **Verifier Entrypoint**."
>
> **Dev:** "How do I clean up after `sanity create`?"
> **Domain expert:** "Use `sanity delete` with the RunContext or sandbox id, or rely on provider lifecycle timers. For v0, `delete` only deletes."

## Flagged Ambiguities

- `author`, `process`, `trustStrength`, `reviewerRead`, and `stakes` were explored and then removed from the current scenario/profile format because they made simple runs feel over-modeled.
- Required/optional output lists, output booleans, and mandatory baseline output envelopes were explored and then rejected. Use **Output Sink** for output destinations without making Sanity own storage or presentation.
- Graphical capture is controlled by **Run Surface**, not output booleans or scenario prose.
- "Trusted" was overloaded early in planning. Do not reintroduce trust/provenance metadata until there is a concrete product flow that needs it.
- "RunRecord" and "Receipt" suggested Sanity owns durable run output. Use **RunResult** for the lightweight orchestration result.
- "Check" suggested a CI-like executable assertion. Use **Scenario** for the persisted verification intent; plans, annotations, and assertions are optional **Agent Output**.
- "Driver" and "command scenario" suggested Sanity should run non-agent verification units. Sanity is agent-only; commands are tools verifiers may run.
- "Agent Runtime" suggested Sanity owns a broader agent runtime abstraction. Use **Verifier Entrypoint** for the bounded command Sanity invokes.
- "Placement" suggested Sanity should model host-vs-sandbox verifier execution in profile schema. For v0, `sanity run` invokes the verifier entrypoint inside the sandbox; outside or already-running agents use `sanity create`.
- "Prepare" and "finish" suggested a handoff lifecycle Sanity would have to own. Use `sanity create` for live **RunContext** creation and `sanity run` for supervised verifier entrypoint execution.
- "RunContext as prompt" gives sandbox-local verifiers lifecycle and provider details they do not need. Use **Verifier Input** for sandbox-local verifier instructions.
- "Preopen browser" was briefly treated as a default. It is an optional output affordance or scenario instruction, not the core Sanity workflow.
- "Report format" suggests Sanity owns presentation. Sanity owns run orchestration; viewers, reports, storage, and agent-session embeds are derived or external layers.
- `sandbox.disposal` belongs to `sanity run`, not `sanity create`. Do not treat `create` as an implicit retain; its lifetime is controlled by provider timers or later explicit `sanity delete`. Disposal flags on `create` should fail fast.
- `sanity delete` is intentionally delete-only for v0. Manual archive after `create` can be added later if it becomes a real workflow.
