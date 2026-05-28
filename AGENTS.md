## Sanity

This project is meant to solve the following problem: I (the human/user of AI agents) ask an agent to implement something for me in code. The agent listens and finishes, reports that the code works and tests pass. When I try to use the code it produced, it doesn't actually work.

The specific way that Sanity solves this problem is not important. While I (the human building this project, using agents to do it) have my own ideas and design in mind, if you (the agent reading this) have a better implementation, better design, etc. than what I'm proposing, you are encouraged to push back and propose another path - especially if I'm overcomplicating things.

**This is a WIP**

Nobody is using Sanity. It is not in production anywhere, not hosted anywhere, therefore deleting code whenever refactoring is encouraged - there is literally no reason to preserve backward compatibility. 

**End goal:**

Sanity lets developers and agents produce video-grade evidence that a user-facing change actually works, by exercising the running application from a user's seat inside a (Daytona) sandbox running the candidate code.

**A finished user flow should feel like:**

```text
I (or an agent) changed some code, or a reviewer flagged a possible bug.
I write or point to a short user scenario — e.g. "invite teammate X to channel Y, verify X appears in the member list."
Run sanity.
Sanity boots the candidate code in a fresh sandbox.
An agent driver exercises the scenario against the running app.
Sanity gives me a short, reviewable video plus screen recording, logs, and a structured receipt.
Now I (or a reviewer, or an agent) can watch the evidence, fix issues, dismiss noisy findings, or share/replay the run.
```

**Key user abilities:**

- Run a **local preflight check** before opening a PR — write a scenario, get a video showing the feature actually works end-to-end from a user's seat.
- Let an **agent verify its own work** by pointing a driver at a scenario file and a candidate ref, producing video evidence instead of agent-testimony.
- **Attach scenario + receipt to a PR** so reviewers can watch the evidence without pulling the branch.
- **Replay** a scenario against the same PR (or a different commit) in a fresh sandbox to confirm reproducibility or check a fix.
- Feed in a **reviewer-flagged finding** as a scenario and ask Sanity to reproduce it against the candidate code — verdicts: reproduced, not reproducible, scenario failed to run, inconclusive.
- Fix a confirmed bug and rerun the scenario to produce video evidence of the resolution.
- Produce **durable, inspectable artifacts** — video, screen recording, logs, agent transcript, sandbox recipe — beyond an agent's own testimony.
- Keep scenarios as **first-class, persistable, portable files** that can be authored ahead of time, refined over the life of a project, and read by either Sanity or a compatible agent runner.

**Scope boundaries (what Sanity is not):**

- Not a test-suite or CI replacement. Tests assert against the code's own surface; Sanity asserts against the running application from outside. The two complement each other — keep using your unit/integration tests for exhaustive coverage.
- Not a formal merge gate by default. Lead with inspectable evidence; gating is a layer that can be added later if a repo wants it.
- Not a hosted service. The durable core is a local CLI + scenario format + sandbox runner + receipt contract. GitHub Action, PR-attached evidence, and hosted review flows are wrappers on top.

**One sentence:**

> Sanity is a sandbox-backed verification tool that lets developers and agents produce short, reviewable video evidence of a user-facing change actually working, by running the candidate code in a fresh sandbox and exercising a portable, human-readable scenario against it.