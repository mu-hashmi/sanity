# Make sandbox disposal explicit

Sanity should support explicit sandbox disposal modes for supervised runs: delete, retain, and archive. Daytona exposes archive as a distinct lifecycle operation that preserves filesystem state in object storage after the sandbox is stopped, so it represents a different user intent from retaining a live or normally stopped sandbox.

**Considered Options**

- Delete or retain only: rejected because it hides Daytona's archive mode, which is useful for cheaper long-term inspection.
- Automatic retain or archive on failure: rejected because retention can leak cost/resources/secrets and makes cleanup behavior surprising.

**Consequences**

Delete should be the default cleanup behavior for `sanity run`. Retain and archive require explicit profile or user choice. `sandbox.disposal` is provider-neutral because it expresses Sanity's post-run intent. Archive disposal is valid only for providers that support archiving; unsupported disposal modes fail profile validation.

`sanity create` does not apply `sandbox.disposal`, because it returns a live RunContext that must remain usable after the command exits. Created contexts rely on provider lifecycle timers under `sandbox.config`, or on a later explicit `sanity delete` command. This is not the same as implicit retain: retain is a supervised-run disposal outcome, while create has no end-of-run disposal point.

Profile-level disposal defaults are resolved only for `sanity run`. They should not be copied into a create-shaped RunRequest. If a user passes disposal input directly to `sanity create`, Sanity should fail fast rather than silently ignoring it.

Provider-specific sandbox settings belong under `sandbox.config`, typed by the selected sandbox provider; for Daytona, that includes auto-stop, auto-archive, and auto-delete timers configured separately from Sanity's disposal mode.
