# Use output sink instead of output policy

Sanity should not model fine-grained output toggles such as recording, screenshots, logs, transcript, or annotations in the core scenario/profile format. The core contract is an output sink where run output can be written or referenced; users can instruct the verifier or external agent harness to create, store, embed, or omit whatever output makes sense for the scenario.

This does not mean Sanity asks the verifier to perform mechanical capture during `sanity run`. Where the sandbox provider exposes deterministic capture APIs, Sanity may collect raw run output around the verifier entrypoint and write or reference it through the configured output sink.

**Considered Options**

- Fine-grained output booleans: rejected because they push Sanity toward owning a report shape and create policy questions before the product has real usage.
- Required/optional output lists: rejected because they over-model output expectations before Sanity knows which output users actually rely on.
- Mandatory baseline run output envelope: rejected because Sanity should not decide which logs, transcripts, videos, or local files every run must capture.

**Consequences**

Agent Output is not required by Sanity core. Run output can be raw files, external URLs, embedded agent-session media, hosted objects, or omitted entirely without changing the profile schema. `none` is an explicit output sink for runs where Sanity should not store or reference run output.

Output Sink is the destination abstraction, not an output policy. It should not become a list of per-artifact capture requirements.

The initial Output Sink variants are `none`, `local`, and `external`. `external` carries a URI or URI-like reference. More specific sinks such as agent sessions, object stores, or GitHub artifacts can be added later as concrete integrations need them.
