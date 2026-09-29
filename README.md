# claude-agent-kit

[![test](https://github.com/FlaviusBurghila/claude-agent-kit/actions/workflows/test.yml/badge.svg)](https://github.com/FlaviusBurghila/claude-agent-kit/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Seven Claude Code subagents, orchestration rules for the main session, and a read-budget hook.
Cheap models do the I/O and the implementation; Opus spends its context on judgment and on the
review gate.

## Quick start

Inside Claude Code:

```text
/plugin marketplace add FlaviusBurghila/claude-agent-kit
/plugin install agent-kit@agent-kit
```

Then, in each project:

```text
/agent-kit:init      # writes the project's ## Agent contract into its CLAUDE.md
/agent-kit:doctor    # checks the setup, changes nothing
```

From a shell: `claude plugin marketplace add FlaviusBurghila/claude-agent-kit && claude plugin install agent-kit@agent-kit`
(add `--scope project` to the install to record it in the repo's `.claude/settings.json`).

Prerequisites: Claude Code 2.1.293 or later (2.1.246 is the minimum, for `maxTurns` partial
results), Node.js 18+ for the hooks, and model access to Opus, Sonnet and Haiku. The install
script also needs macOS, Linux or WSL, bash, and `curl` and `tar` (or git).

## What you get

| Agent | Model | Effort | Role |
|---|---|---|---|
| `scout` | `haiku` | medium, `maxTurns` 25 | finds files, symbols and call sites; returns paths and line numbers only |
| `bulk-reader` | `haiku` | medium, `maxTurns` 20 | answers ONE question about a large file, many files or a large diff, in `path:line` bullets |
| `code-writer` | `haiku` | medium, `maxTurns` 30 | writes predictable output (scaffolds, fixtures, stubs) from a spec and a reference file |
| `researcher` | `sonnet` | medium | reads docs and source, returns verified facts with sources; flags what it could not confirm |
| `builder` | `sonnet` | medium | implements from a written spec; returns a constraint ledger |
| `refuter` | `opus` | medium | independently reviews the Builder's diff against every constraint in the spec |
| `debugger` | `opus` | high | hard root-cause work only |

The plugin names the agents `agent-kit:scout`, `agent-kit:builder` and so on; the install script
uses the bare names.

Also included: the orchestration rules (`agent-kit/orchestration.md`), the read-budget hook
(`agent-kit/hooks/shunt.js`), the `init` and `doctor` skills, and templates for a project
CLAUDE.md and its `## Agent contract` with starter lines for Flutter/Dart, Rust,
flutter_rust_bridge, TypeScript/Node, Python and Go.

## How it works

The orchestration rules tell the main session (the Orchestrator) how to brief, delegate and
review. The plugin loads them with a SessionStart hook that reaches only the main session; the
install script loads them with an `@` import in CLAUDE.md. They do not depend on the project's
CLAUDE.md or `CLAUDE.template.md`. Run `/context` and look under "Memory files" to confirm they
loaded. The workers don't spawn agents of their own (`disallowedTools: Agent`), so every
delegation goes through the Orchestrator.

Project facts (verify commands, test policy, excluded paths, generated files, traps) live in the
`## Agent contract` section of the project's CLAUDE.md, which every subagent loads, so the agents
stay stack-agnostic. Without a contract the orchestration still runs, but the agents have no
verify commands or exclusions to follow.

A file read into the main session stays in the prompt for every later turn. The hook denies
whole-file reads over 350 lines (`Read`, and `cat`, `head`, `tail`, `sed -n`, `git show` through
Bash) in the main session, `builder`, `refuter` and `debugger`, and points to a ranged read or
the Bulk-reader. The I/O agents (scout, bulk-reader, code-writer, researcher) are exempt.

### Credits

The read budget, the Bulk-reader and the Code-writer come from Spotify's
[shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt) plugin, described
in "Portal by Spotify cut my Claude Code token usage by 90%" (see Sources). Its key idea is that a
frontier model should not spend its context on I/O. Shunt blocks large reads and sends them to a
cheaper external model through scripts. The kit keeps the idea and the `SHUNT_MIN_LINES=350`
threshold, but delegates to Claude Code subagents, so it needs no external CLI or model. The hook
is a separate Node.js implementation. It also counts ranged reads, `sed -n`, `git show` and
multi-file `cat`, and it applies to the main session and selected subagents.

The orchestration side follows Cognition (see Sources): an agent run's cost is dominated by how
many turns the lead model takes, how much context it carries, and what it declines to do itself.

## Install for a team

Commit this to the repo's `.claude/settings.json`. Teammates get the plugin once they trust the
folder:

```json
{
  "extraKnownMarketplaces": {
    "agent-kit": {
      "source": { "source": "github", "repo": "FlaviusBurghila/claude-agent-kit" }
    }
  },
  "enabledPlugins": {
    "agent-kit@agent-kit": true
  }
}
```

Run `/agent-kit:init` once and commit the CLAUDE.md it writes.

## Install script (alternative)

Use the script when you want the agents copied into `.claude/` and committed with the repo, or
can't use plugins. Don't combine it with the plugin: you would get both `builder` and
`agent-kit:builder`.

```sh
# global: every project on this machine
curl -fsSL https://raw.githubusercontent.com/FlaviusBurghila/claude-agent-kit/main/install.sh | bash -s -- --global

# project: the current repo (or pass a directory: --project DIR)
curl -fsSL https://raw.githubusercontent.com/FlaviusBurghila/claude-agent-kit/main/install.sh | bash -s -- --project
```

Or clone and run it:

```sh
git clone https://github.com/FlaviusBurghila/claude-agent-kit.git
cd claude-agent-kit
./install.sh --global                          # or:
./install.sh --project /path/to/your/repo
```

To pin a release, set `KIT_REF` to its tag: `... | KIT_REF=v1.0.0 bash -s -- --global`.

- Global writes under `~/.claude` and applies to every project on this machine; teammates do not
  get it.
- Project writes under `<repo>/.claude`; commit it and the team gets the same agents. A project
  agent overrides a global one of the same name.
- Project also adds a `## Agent contract` scaffold to CLAUDE.md and `.claude/tmp/` to
  `.gitignore` (in a git work tree).

| Option | Effect |
|---|---|
| `--global` | install into `~/.claude` |
| `--project [DIR]` | install into `DIR/.claude` (default: the current directory) |
| `--no-hook` | do not add the hook to `settings.json` (Node.js is then not needed) |
| `--no-claude-md` | do not touch CLAUDE.md; no import is added |
| `--agents-only` | install only the agents and the `agent-kit/` files; no CLAUDE.md block, settings hook or `.gitignore` line; no import is added |
| `--dry-run` | print what would change; write nothing |
| `--uninstall` | remove everything the kit added; every removed file is backed up first |

After `--no-claude-md` or `--agents-only` the orchestration rules don't load until you add the
import line the installer printed.

The installer's CLAUDE.md block is delimited by `<!-- claude-agent-kit:begin -->` and
`<!-- claude-agent-kit:end -->`; re-running replaces what is between them and nothing else. Every
file it changes is first backed up to `${CLAUDE_CONFIG_DIR:-~/.claude}/backups/claude-agent-kit/<timestamp>/`.
Re-running is idempotent, which is also how you update. `settings.json` must be plain JSON:
comments or trailing commas make the installer stop before changing anything.

After a script install:

1. Fill in `## Agent contract` in the project's CLAUDE.md. Starter lines are in
   `agent-kit/agent-contract.template.md`.
2. Restart Claude Code if the agents directory did not exist before.
3. If Claude Code asks you to approve the CLAUDE.md import, approve it.
4. Make sure `.claude/tmp/` is gitignored: agents write scratch files and long reports there.

## Configuration

- `SHUNT_MIN_LINES`: the read threshold (default 350). Set it in the `env` of `settings.json`
  and keep the Agent contract's "Read threshold" line in step; the hook reads only this variable.
- `SHUNT_OFF=1`: disables the hook.
- The built-in Explore agent runs on the main session's model, so cheap I/O can drift to Opus.
  To remove it, add `"permissions": { "deny": ["Agent(Explore)"] }` to `settings.json`.
- The agent files name models by alias (`haiku`, `sonnet`, `opus`), never by version, so the kit
  follows new releases. To pin a version, set `ANTHROPIC_DEFAULT_HAIKU_MODEL`,
  `ANTHROPIC_DEFAULT_SONNET_MODEL` or `ANTHROPIC_DEFAULT_OPUS_MODEL` in the `env` of
  `settings.json`; that changes the alias for the whole session. See the
  [model configuration docs](https://code.claude.com/docs/en/model-config).

## Updating

Third-party marketplaces don't auto-update by default. Run
`claude plugin marketplace update agent-kit && claude plugin update agent-kit@agent-kit`, or turn
on auto-update for the marketplace in `/plugin` → Marketplaces. A running session keeps the
version it loaded; start a new session to apply the update.

## Troubleshooting

- Agents not listed: after a plugin install, run `/reload-plugins`; after a script install into a
  new agents directory, restart Claude Code. `claude plugin details agent-kit` lists what the
  plugin loaded.
- Orchestration rules don't load (plugin): check that Node.js 18+ is on the `PATH` Claude Code
  runs hooks with, and run with `--debug` to see the SessionStart hook's output.
- Import not applied (script): approve it if Claude Code asked; until then the rules are not
  loaded. After `--no-claude-md` or `--agents-only`, add the line the installer printed to a
  CLAUDE.md, or re-run without the flag.
- A project agent shadows a global one: remove or rename the project copy.
- The hook blocks a read you need: `Read` a range with `offset`/`limit`, ask the Bulk-reader, or
  set `SHUNT_OFF=1`.

## Uninstall

```sh
claude plugin uninstall agent-kit@agent-kit     # plugin
./install.sh --uninstall --global               # script, global
./install.sh --uninstall --project              # script, project
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

## Sources

- Spotify, "Portal by Spotify cut my Claude Code token usage by 90%" (3 Sep 2026) —
  https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90;
  the shunt plugin (Apache-2.0): https://github.com/spotify/portal-ai-plugins
- Cognition, "Making Fable cheaper than Opus" (13 Jul 2026) —
  https://cognition.com/blog/making-fable-cheaper-than-opus
- Claude Code docs: "Create custom subagents" (https://code.claude.com/docs/en/sub-agents),
  model configuration (https://code.claude.com/docs/en/model-config),
  hooks (https://code.claude.com/docs/en/hooks), plugin manifest and marketplace references
  (https://code.claude.com/docs/en/plugins/manifest-reference,
  https://code.claude.com/docs/en/plugins/marketplace-reference)
