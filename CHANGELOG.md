# Changelog

The plugin version lives in `.claude-plugin/plugin.json`; each release is tagged `vX.Y.Z`.

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
