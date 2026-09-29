# Contributing

Issues and pull requests are welcome.

## Ground rules

- **The repo is the source of truth.** Edit `agents/`, `agent-kit/` and `skills/` here, not an
  installed copy.
- **Keep the agents stack-agnostic.** Project facts belong in a project's `## Agent contract`,
  not in an agent file.
- **Agent files are prompts.** Prefer outcomes, stops and report shapes over procedure; don't add
  "think step by step" (use `effort:`); keep each `description` short, since every description
  costs context in every session.
- **Mind the context cap.** The plugin injects `agent-kit/orchestration.md` through a SessionStart
  hook, capped at 10,000 characters. `tests/plugin.test.js` fails if it grows past that.
- **Cite what you claim.** Cost or model-behavior claims in the README need a primary source in
  its Sources list.

## Checks

Run all of these before opening a PR. CI runs the tests on Linux and macOS, and the plugin
validation on Linux:

```sh
node tests/shunt.test.js
node tests/plugin.test.js
bash tests/install.test.sh
shellcheck install.sh tests/install.test.sh
claude plugin validate --strict .
```

To try your working copy as a plugin without installing it:

```sh
claude --plugin-dir .
```

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json`. Plugin users stay on the version they have
   until this changes.
2. Add the release to `CHANGELOG.md`.
3. Tag it: `git tag vX.Y.Z && git push --tags`.
