# Scenario Format Prototype

PROTOTYPE - throwaway once the scenario shape is understood.

Question: does `.sanity/profiles/<profile>.yml` plus markdown check instructions express what to check, how to check it, and what is required to run it without schema sprawl or duplicate natural-language instructions?

Run it:

```bash
npm run prototype:scenario
```

The prototype renders the selected `.sanity/profiles/<profile>.yml`, validates it with Effect Schema, previews selected markdown instruction files, and shows the effective run plan for one check or all checks in that profile.

Current shape:

- `.sanity/profiles/<profile>.yml` owns sandbox, setup, app startup, check catalog, and artifacts for one runnable profile.
- `.sanity/checks/*.md` owns the natural-language behavior instructions.
- `sanity run --profile local team-invite` selects one check from one profile.
- `sanity run --profile pr --all` selects every check in one profile.
