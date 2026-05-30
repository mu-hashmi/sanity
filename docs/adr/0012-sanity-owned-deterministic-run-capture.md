# Keep deterministic run capture in Sanity

During `sanity run`, Sanity should own deterministic harness capture around the verifier entrypoint wherever the sandbox provider exposes reliable APIs. The sandbox-local verifier should receive a minimal Verifier Input, not the full RunContext.

**Considered Options**

- Give the verifier the full RunContext: rejected because sandbox-local verifiers do not need provider ids, disposal mode, timers, or external lifecycle details.
- Ask the verifier to save all output itself: rejected because recordings, screenshots, process logs, and file transfers can be captured deterministically by Sanity and should not depend on agent obedience.
- Make Sanity define a canonical report format: rejected because user-facing presentation belongs to output sinks, viewers, or external harnesses.

**Consequences**

Verifier Input should contain only the information needed to execute the scenario: scenario text, relevant app or workspace paths and URLs, anti-cheating instructions, and optional instructions for an agent-output directory.

Sanity-owned capture can include collecting verifier stdout/stderr or session logs and downloading files from an agent-output directory when configured. These are raw run output mechanics, not a report format.

Graphical desktop/browser capture is controlled by deterministic run surface config, not by natural-language scenario instructions. Sanity should start Daytona Computer Use recording or take screenshots only when the effective run surface is graphical.

Agent-authored plans, annotations, assertions, and narrative reports remain Agent Output because their content depends on verifier judgment. Sanity may collect those files if they exist, but should not require or interpret them in v0.
