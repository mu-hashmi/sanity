# Sanity

`sanity` is a prototype for running trusted verification scenarios against candidate code in a Daytona sandbox.

The first slice only reads a trusted sanity config and prints the dry-run plan:

```bash
npm run dev -- run --config examples/basic/.sanity/sanity.yml --scenario pr --dry-run
```

The intended product shape is one core runner with multiple entrypoints:

- local CLI for development and debugging
- GitHub Action wrapper for normal PR sanity runs
- later GitHub App/webhook service for review-comment reproduction workflows
