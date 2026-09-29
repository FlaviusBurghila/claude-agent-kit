<!--
Starting point for a project's root CLAUDE.md. Replace every <placeholder>, delete what does not
apply, and keep each rule to what would otherwise cost a broken build or a wasted run.

Every subagent loads this file. A rule meant only for the main session must say so.
-->

# <Project>

<One or two lines: what it is, and the stack.>

## Start here

<The docs index or the three files a newcomer reads first.>

## Rules that will save you a broken build

- <Generated files that must not be hand-edited, and the command that regenerates them.>
- <Files or counts pinned by tests.>
- <Directories that hold copies of the source tree — exclude them from every search.>

## Common commands

```sh
<analyzer / type-checker>          # cheap, safe, run freely
<formatter> <the files you touched> # never the whole tree
<focused tests for your change>
<full test suite>                   # the main session only, once per batch
```

## Agent contract

- **Verify:** <static checks a subagent runs after changing code>
- **Tests:** subagents run none; they name the test files and the Orchestrator runs them.
- **Exclude from searches:** <generated or copied trees that .gitignore does not cover>
- **Formatting:** <formatter, and any hook that runs it on every edit>
- **Generated, never hand-edited:** <file> — regenerate with `<command>`
- **Pinned by tests:** <files or counts a guard test checks; report a change outside your brief>
- **Sources of truth:** <owning docs; search tools>
- **Test logs:** <how to attribute a failure, e.g. the error marker>
- **Read threshold:** 350 lines. Scratch files go to `.claude/tmp/` (gitignored).

With the agent-kit plugin, `/agent-kit:init` fills this section in from the repo. Stack-specific
starter lines (Flutter, Rust, TypeScript, Python, Go) are in `agent-contract.template.md`:
`.claude/agent-kit/` (project script install) or `~/.claude/agent-kit/` (global script install).
