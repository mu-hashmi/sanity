# Agent Output is verifier output

Sanity should use Agent Output as the broad term for agent-generated run output such as source-grounded plans, timeline annotations, setup notes, assertions, transcripts, screenshots, video, or reports. VerifierPlan was rejected as a core category because planning is only one reliability artifact and Sanity should not require or specially model it in the core run contract.

**Considered Options**

- Required VerifierPlan before execution: rejected because it conflicts with output sinks that may store nothing locally, external harnesses that own the session UX, and simple verifier integrations that do not expose planning as a separate phase.
- VerifierPlan as a standalone core artifact type: rejected because Devin-style reliability also includes annotations, setup notes, named sections, and assertions.

**Consequences**

Scenario execution can proceed without any particular Agent Output. Agent Output is opaque to Sanity core; integrations may still prompt for, store, display, enforce, or standardize plans and timeline annotations as part of their own harness contract.
