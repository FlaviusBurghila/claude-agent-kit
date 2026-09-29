---
name: doctor
description: Check that agent-kit is set up correctly in this project and on this machine — hooks, agents, model aliases, the Agent contract and conflicts with a script install. Read-only.
disable-model-invocation: true
---

Check the agent-kit setup and report what is wrong. **Read-only:** change nothing; for each
problem, give the fix and let the user apply it.

Run the independent checks together, then report one line per check: `OK`, `WARN` or `FAIL`,
what you saw, and for anything but OK the fix.

1. **Node.js** — `node --version` is 18 or later. Both hooks need it; without it the read
   budget and the orchestration rules silently do nothing.
2. **Hooks run** — pipe `{}` into `node "${CLAUDE_PLUGIN_ROOT}/agent-kit/hooks/session-start.js"`:
   it must print JSON with `additionalContext`, or print nothing only when check 4 finds a
   script install.
3. **Claude Code version** — `claude --version`: 2.1.293 or later lets `haiku` mean Haiku 5.5 on
   the Anthropic API; under 2.1.246, `maxTurns` partial results are missing.
4. **Script install alongside the plugin** — look for `builder.md` in `~/.claude/agents/` and
   `<repo>/.claude/agents/`, and for the `<!-- claude-agent-kit:begin -->` marker in
   `~/.claude/CLAUDE.md`, `<repo>/CLAUDE.md` and `<repo>/.claude/CLAUDE.md`. Either means a
   script install: WARN, since each agent then exists twice (`builder` and `agent-kit:builder`)
   and the read-budget hook runs twice. Fix: `install.sh --uninstall --global` or `--project`.
5. **Model pins** — read `env` in `~/.claude/settings.json`, `<repo>/.claude/settings.json` and
   `<repo>/.claude/settings.local.json`. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` flattens the kit's
   model tiers: WARN. `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` pins an alias for the whole
   session: report the value.
6. **Explore** — if `permissions.deny` does not contain `Agent(Explore)`, report it as INFO only:
   the built-in Explore runs on the main session's model; denying it is optional.
7. **Agent contract** — the project's CLAUDE.md (or `.claude/CLAUDE.md`) has a
   `## Agent contract` section with a **Verify** line that is not a `<placeholder>`. If not:
   FAIL, fix: `/agent-kit:init`.
8. **Read threshold** — if `SHUNT_MIN_LINES` is set, the contract's "Read threshold" line names
   the same number. `SHUNT_OFF=1` anywhere: WARN, the read budget is off.
9. **Scratch space** — in a git work tree, `git check-ignore -q .claude/tmp/x` succeeds. If not:
   WARN, fix: add `.claude/tmp/` to `.gitignore`.

End with the count of OK / WARN / FAIL and the fixes in the order to apply them.
