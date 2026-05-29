# Prototype Notes

PROTOTYPE - delete or absorb once the verifier harness shape becomes production design.

Question being answered:

- Can the Sanity core stay an evidence harness around an arbitrary verifier command rather than a verifier-result authority?
- Is video plus process output enough when the verifier is unaware of Sanity-specific artifact/result conventions?
- Does a real agent naturally use the recorded desktop when the scenario asks for user-seat verification?

Initial hypothesis:

- Sanity should own the evidence window and RunRecord.
- The verifier should own any scenario conclusion it chooses to state.
- Sanity should record verifier process completion separately from any agent-reported scenario verdict.

Real Daytona pass results:

- Harness run: `.sanity/prototype-runs/verifier-harness/vh-harness-2026-05-29T01-26-18-766Z/run-record.json`
- Agent run: `.sanity/prototype-runs/verifier-harness/vh-agent-2026-05-29T01-26-59-017Z/run-record.json`

What the harness pass taught us:

- A verifier can be completely unaware of Sanity-specific result files and still produce a useful run record, verifier output, screenshots, app log, and MP4 recording.
- Sanity can honestly record process completion without claiming scenario truth. The dumb verifier exited 0, and the record describes that as process completion rather than a Sanity-owned verdict.
- A visible browser window in the recording makes the evidence immediately reviewable.

What the Codex agent pass taught us:

- Copying local Codex subscription auth into the sandbox was enough for `codex exec` to run inside Daytona.
- Codex produced a useful JSONL trace plus a concise final report without being asked to write a Sanity-specific result file.
- Codex did verify the scenario: it clicked the rendered `Send Invite` button through Chromium DevTools Protocol and observed the pending invite list change from `No pending invites` to `test@example.com`.
- The recording was not useful video-grade evidence for this run. Codex first tried headed Chromium, could not keep it alive, and then fell back to headless Chromium. The final screenshot shows the desktop, not the app.

Design implication:

- The "agent is unaware of Sanity artifacts" direction still looks right.
- The "Sanity simply records whatever happens" direction is not enough when the user specifically wants video-grade evidence. The verifier or scenario needs to make the relevant thing visible, or Sanity can provide optional evidence affordances such as a visible browser helper.
- This is still not a typed action API or result API. Browser commands, preopened windows, remote-debugging hints, terminal flows, desktop-app flows, and no-UI checks are all verifier/scenario choices.

Visible-browser matrix, 2026-05-29:

| Variant | Sanity setup | Instruction steering | What Codex did | Video result | Takeaway |
| --- | --- | --- | --- | --- | --- |
| Baseline | App running, recording started, no browser preopened | "Use the graphical browser as much as possible" | Found Chromium, launched a visible Chromium session with CDP, clicked the button through browser input events, then closed the browser | Useful during the middle of the recording, but final screenshot is desktop-only | Surprisingly workable, but not deterministic enough by itself. Earlier real run fell back to non-reviewable evidence, and final screenshots can mislead. |
| Hinted visible | App running, recording started, no browser preopened | Gave exact visible Chromium command and rough button location | Followed the command path, used the visible browser plus CDP, then closed the browser | Useful recording of before and after UI state, final screenshot desktop-only | Prompt steering can work and is flexible. Scenario instructions may carry environment mechanics when that is the right fit. |
| Preopened | Sanity opened Chromium on the recorded desktop before Codex started | Told Codex the visible browser was already open | Detected the existing Chromium process and remote debugging port, attached to that same visible browser, clicked the button | Cleanest reviewable web-app evidence: app visible from the beginning through the successful state | Useful optional helper for web-app evidence. It should not be the default Sanity workflow. |
| Preopened plus control hint | Sanity opened Chromium with remote debugging before Codex started | Told Codex the visible browser was open and attachable on 127.0.0.1:9222 | Attached directly to CDP and clicked the visible page | Clean reviewable evidence, same visual outcome as preopened | Useful optional reliability hint for shell-first agents. It is an environment convention, not a typed action API. |

Matrix run artifacts:

- Baseline: `.sanity/prototype-runs/verifier-harness/vh-agent-baseline-2026-05-29T02-10-04-165Z/run-record.json`
- Hinted visible: `.sanity/prototype-runs/verifier-harness/vh-agent-hinted-visible-2026-05-29T02-11-31-857Z/run-record.json`
- Preopened: `.sanity/prototype-runs/verifier-harness/vh-agent-preopened-2026-05-29T02-13-18-025Z/run-record.json`
- Preopened plus control hint: `.sanity/prototype-runs/verifier-harness/vh-agent-preopened-hinted-2026-05-29T02-14-22-490Z/run-record.json`

Working v0 shape:

- Start the app.
- Start requested capture, such as Computer Use recording, screenshots, logs, or no visual capture for non-UI checks.
- Run any verifier command inside the same sandbox.
- Let the scenario/verifier decide how to exercise the target: browser, desktop app, terminal, script, library call, or agent runtime.
- Optionally provide helper affordances such as a visible browser command, preopened window, or known debugging port when the scenario asks for that shape.
- Capture recording, screenshots, process output, transcript/report, app logs, and a RunRecord. Keep scenario verdict outside Sanity unless the verifier chooses to state one in normal output.
