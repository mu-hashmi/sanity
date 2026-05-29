# Verifier Harness Prototype

PROTOTYPE - delete or absorb once the evidence harness shape is understood.

Question: can Sanity treat every verifier as an ordinary sandbox command, keep the verifier unaware of Sanity-specific result formats, and still produce reviewable evidence from Daytona recording, screenshots, process output, and a structured run record?

Run both real Daytona passes:

```bash
npm run prototype:verifier-harness
```

Run one pass:

```bash
npm run prototype:verifier-harness:harness
npm run prototype:verifier-harness:agent
npm run prototype:verifier-harness:agent-hinted-visible
npm run prototype:verifier-harness:agent-preopened
npm run prototype:verifier-harness:agent-preopened-hinted
```

Run only the real Codex visible-browser matrix:

```bash
npm run prototype:verifier-harness:matrix
```

Requires `DAYTONA_API_KEY` in the environment. The agent pass also requires local Codex subscription auth at `~/.codex/auth.json`; the prototype copies that auth file into the temporary Daytona sandbox and does not persist it in local artifacts.
