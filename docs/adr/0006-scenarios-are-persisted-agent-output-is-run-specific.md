# Persist Scenarios and treat Agent Output as run-specific

Sanity should use Scenario for the persisted, selectable verification intent and Agent Output for optional run-specific verifier output such as plans, annotations, assertions, transcripts, screenshots, videos, and reports. Reusing an agent-generated plan as the persisted input was rejected because it would collapse durable intent and verifier execution notes into one concept.

**Consequences**

Profiles select scenarios. Agent Output, when produced, belongs to one run through the configured verifier or output sink contract.
