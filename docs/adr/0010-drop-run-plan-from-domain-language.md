# Drop RunPlan from domain language

Sanity should use RunRequest for the normalized intent and input it will use to create a RunContext or run a verifier, and RunResult for the orchestration outcome of a supervised run. RunPlan was rejected as a domain term because it no longer adds meaning after removing command checks, output policies, and durable RunRecords from the core model.

**Consequences**

Implementation code may still resolve profiles, scenarios, sandbox config, and output sinks before execution, but that resolution is an internal implementation detail rather than product vocabulary.

RunRequest should contain the effective normalized input Sanity will execute or materialize, including sandbox choices after profile defaults and CLI inputs are resolved. It should not carry a separate override layer that recreates RunPlan under another name.

Output Sink follows the same rule: profiles may provide defaults, CLI or user input may override them, and RunRequest contains the effective sink Sanity will use.

RunRequest references selected scenarios by name/path rather than embedding scenario markdown. Loading scenario bodies is part of context creation or execution.

RunRequest references the profile rather than copying profile-owned setup or app boot instructions. Loading those commands is part of context creation or execution.
