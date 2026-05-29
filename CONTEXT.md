# Sanity Context

Sanity is a sandbox-backed evidence tool for showing what candidate code did from outside the codebase. It focuses on reviewable artifacts from real runs while keeping the runnable scenario format small.

## Language

**Candidate Code**:
The code version being exercised in a Sanity run.
_Avoid_: Trusted code, verified code

**Scenario**:
A human-readable behavioral task or claim that tells a verifier what to exercise and observe.
_Avoid_: Test case when the instructions are not executable assertions

**Check**:
A named executable entry in a profile that defines one verification unit.
_Avoid_: Scenario when referring to the configured runnable entry

**Profile**:
A runnable YAML configuration for a class of Sanity runs.
_Avoid_: Environment, preset

**Verifier**:
The command, script, agent runtime, or other process that exercises a check inside the sandbox.
_Avoid_: Sanity, tester

**Driver**:
The declared execution style for a check, such as `command` or `agent`.
_Avoid_: Typed action API

**Evidence**:
Artifacts captured from a run, such as video, screenshots, logs, command output, and agent transcript.
_Avoid_: Proof when the artifact still needs human judgment

**Run**:
One Sanity invocation against candidate code and selected checks.
_Avoid_: Check run

**RunRequest**:
The normalized user intent for a run: a profile and a non-empty list of requested checks.
_Avoid_: RunSelection

**RunPlan**:
The resolved executable plan for a run after profile paths, check names, defaults, and artifact settings are validated.
_Avoid_: Request

**RunRecord**:
The durable artifact that records what Sanity attempted, what phases ran, which artifacts were captured, and what each check reported.
_Avoid_: Receipt

**CheckResult**:
The result details for one planned check.
_Avoid_: CheckRunResult

## Relationships

- A **Run** starts from one **RunRequest**, resolves one **RunPlan**, and produces one **RunRecord**.
- A **Profile** contains one or more **Checks** and owns setup, app boot, sandbox, and artifact policy for that run shape.
- A **Check** references exactly one natural-language instruction source when it is agent-driven.
- A **Verifier** owns the scenario conclusion it states; Sanity owns the evidence envelope and process/run record.
- **Evidence** can include video-grade desktop capture, but not every check needs Computer Use, a browser, or a UI.

## Example Dialogue

> **Dev:** "Can I run a one-off browser check that tells Codex how to open the app?"
> **Domain expert:** "Yes. Put that behavior in the **Scenario** or check instructions. Sanity should capture the **Evidence**, not decide the browser workflow."
>
> **Dev:** "If Codex exits 0, did the **Run** pass?"
> **Domain expert:** "Sanity can say the **Verifier** process completed. The scenario conclusion belongs in the verifier output and **CheckResult**, with video and logs for review."

## Flagged Ambiguities

- `author`, `process`, `trustStrength`, `reviewerRead`, and `stakes` were explored and then removed from the current scenario/profile format because they made simple runs feel over-modeled.
- `evidence.required` and `evidence.optional` were explored and then replaced by simple profile-level artifact booleans.
- "Trusted" was overloaded early in planning. Do not reintroduce trust/provenance metadata until there is a concrete product flow that needs it.
- "Receipt" sounded too transactional and too verdict-like. Use **RunRecord** for the durable artifact.
- "Driver API" suggested Sanity would restrict verifier actions. Use **Driver** only for the execution style; verifier commands remain arbitrary.
- "Preopen browser" was briefly treated as a default. It is an optional evidence affordance or scenario instruction, not the core Sanity workflow.
