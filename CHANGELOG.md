# Changelog

The plugin version lives in `.claude-plugin/plugin.json`; each release is tagged `vX.Y.Z`.

## 1.1.0

- The SessionStart hook now injects a short stub; the full rules load through a new
  UserPromptSubmit hook (`agent-kit/hooks/engage.js`) once the context passes
  `AGENT_KIT_ENGAGE_TOKENS` (default 80000). `AGENT_KIT_ENGAGE_TOKENS=0` keeps the old
  always-on loading. Compact and clear re-arm it.
- Shorter agent descriptions.
- The Orchestrator makes small changes itself (one or two files, under about 150 changed lines);
  the Builder is for larger slices.
- The Refuter runs on Sonnet by default and is skipped for small diffs whose tests pass; pass
  `model: "opus"` for security, migrations, concurrency, public API changes, or a repeat review.
- The SessionStart hook also fires for forked sessions (`--fork-session`).
- `AGENT_KIT_IGNORE_SCRIPT_INSTALL=1` makes the hooks ignore a CLAUDE.md import of the rules, for
  runs that do not load user memory.

## 1.0.0

Initial release.

- Seven agents: scout, bulk-reader, code-writer, researcher, builder, refuter, debugger.
- Orchestration rules for the main session (`agent-kit/orchestration.md`).
- SessionStart hook that loads the rules into the main session only.
- Read-budget hook (`agent-kit/hooks/shunt.js`).
- `/agent-kit:init` and `/agent-kit:doctor` skills.
- Install script (`install.sh`) for global and project installs.
- Templates for a project CLAUDE.md and its Agent contract.
- Tests for the hook, the plugin and the installer.
