<!--
Agent contract template. Copy the section below into the project's root CLAUDE.md and fill it
in, or run `/agent-kit:init` with the plugin. The kit's agents (from the agent-kit plugin,
`~/.claude/agents/` or the project's `.claude/agents/`) look for this heading, and every subagent
loads CLAUDE.md, so nothing else is needed. Delete lines that don't apply; keep each line to one
command, path or trap, and point at the CLAUDE.md section that owns the detail.
-->

## Agent contract

- **Verify:** <static checks a subagent runs after changing code>
- **Tests:** subagents run none; they name the test files and the Orchestrator runs them.
  <or: subagents may run `<command> <one file>`>
- **Exclude from searches:** <generated or copied trees that .gitignore does not already cover>
- **Formatting:** <formatter, and any hook that runs it on every edit>
- **Generated, never hand-edited:** <file> — regenerate with `<command>`
- **Pinned by tests:** <files or counts a guard test checks; report a change outside your brief>
- **Sources of truth:** <owning docs; search tools>
- **Test logs:** <how to attribute a failure, e.g. the error marker>
- **Read threshold:** 350 lines. Scratch files go to `.claude/tmp/` (gitignored).
  <If you pick another number, also set `SHUNT_MIN_LINES` in `.claude/settings.json` `env`;
  the hook reads only that variable.>

<!--
Starter lines by stack.

Flutter / Dart
- **Verify:** `flutter analyze`; `dart format --output=none --set-exit-if-changed <files you touched>`
- **Tests:** `flutter test <file>` — only if subagents may run tests
- **Exclude from searches:** `build/`, `.dart_tool/`
- **Generated, never hand-edited:** `*.g.dart`, `*.freezed.dart` — `dart run build_runner build`;
  `lib/l10n/app_localizations*.dart` — `flutter gen-l10n`

Rust
- **Verify:** `cargo clippy --workspace --all-targets -- -D warnings`; `cargo fmt --check`
- **Tests:** `cargo test -p <crate> <test name>` — only if subagents may run tests
- **Exclude from searches:** `target/`

Flutter app with a Rust core (flutter_rust_bridge)
- Both lists above, plus **Generated, never hand-edited:** the bridge bindings —
  `flutter_rust_bridge_codegen generate`

TypeScript / Node
- **Verify:** `tsc --noEmit`; `eslint <files you touched>`; `prettier --check <files you touched>`
- **Tests:** `npx vitest run <file>` or `npx jest <file>` — only if subagents may run tests
- **Exclude from searches:** `node_modules/`, `dist/`

Python
- **Verify:** `ruff check`; `ruff format --check`; `mypy .` or `pyright`
- **Tests:** `pytest <file>` — only if subagents may run tests
- **Exclude from searches:** `.venv/`, `__pycache__/`

Go
- **Verify:** `go vet ./...`; `gofmt -l .`; `staticcheck ./...` if installed
- **Tests:** `go test ./pkg/...` — only if subagents may run tests
- **Exclude from searches:** `vendor/`
-->
