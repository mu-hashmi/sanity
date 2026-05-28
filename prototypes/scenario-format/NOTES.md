# Prototype Notes

PROTOTYPE - delete or absorb once the profile/check format becomes production code.

Question answered:

- A single scenario YAML file was too bloated once it tried to describe the behavioral claim, execution method, app setup, artifact policy, and trust/process metadata.
- Splitting the design into separate scenario/check/target schemas also felt too ceremonious and introduced duplicated natural-language instructions.
- The cleaner shape is a runnable profile file plus markdown check instructions:
  - `.sanity/profiles/<profile>.yml` owns sandbox, setup, app boot, check entries, and artifact capture policy.
  - `.sanity/checks/*.md` owns the natural-language instructions for a check.

Scenario format decisions worth keeping:

- Profiles are first-class files, not an inline `profiles:` section in a root `.sanity/sanity.yml`.
- A profile is the runnable unit: `sanity run --profile local team-invite` or `sanity run --profile pr --all`.
- The selection UI should expose one check concept: `check: <name>` or `check: all`, not separate `mode` and `single check` fields.
- Check entries should be compact:
  - agent checks point at one markdown instruction file.
  - command checks provide a command.
  - `max_minutes` belongs on the check entry.
- Artifact capture is profile-level for now: `recording`, `screenshots`, and `logs` booleans.
- The root README should stay minimal and product-level; prototype-specific details belong next to the prototype.

Awkward fields or rejected shapes:

- Removed `author`, `process`, `trustStrength`, and `reviewerRead`; they made the prototype explain itself too much.
- Removed `stakes`; it is policy/run context, not part of the behavioral instruction.
- Rejected `evidence.required` / `evidence.optional` in favor of simpler artifact booleans.
- Rejected putting natural-language instructions in both a scenario file and a check file. There should be exactly one natural-language instruction source per check.
- Rejected a three-schema split (`scenario`, `check`, `target`) because it repeated schema ceremony and made simple checks feel over-modeled.
- Rejected one root `.sanity/sanity.yml` with inline profiles because `.sanity/profiles/<profile>.yml` gives each run profile a clearer file boundary.
