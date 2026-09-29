---
name: init
description: Set up the current project for agent-kit — write a filled-in "## Agent contract" section into its CLAUDE.md (verify commands, test policy, excluded paths, generated files) and gitignore .claude/tmp/
disable-model-invocation: true
---

Set up this project for the agent-kit agents. Their only source of project facts is the
`## Agent contract` section of the project's CLAUDE.md; this skill writes it.

1. **Find the CLAUDE.md.** Use `<repo>/CLAUDE.md`; if only `<repo>/.claude/CLAUDE.md` exists, use
   that. If neither exists, create `<repo>/CLAUDE.md` from
   `${CLAUDE_PLUGIN_ROOT}/agent-kit/CLAUDE.template.md`, filling in what you can establish and
   deleting placeholder lines you cannot.
2. **If a `## Agent contract` section already exists,** do not rewrite it. Compare it with the
   template below, list the lines it lacks, and ask before adding them. Then go to step 5.
3. **Detect the stack** from the manifests at the repo root and one level down (`pubspec.yaml`,
   `Cargo.toml`, `package.json` + `tsconfig.json`, `pyproject.toml`, `go.mod`, ...). Take the
   matching starter lines from the comment at the end of
   `${CLAUDE_PLUGIN_ROOT}/agent-kit/agent-contract.template.md`, then make them true for this
   repo:
   - **Verify:** prefer the commands the repo already defines (`package.json` scripts, a
     `Makefile`, CI workflow steps) over generic ones. Name only static checks: analyzer,
     type-checker, linter, format check.
   - **Tests:** "subagents run none" unless the user says otherwise.
   - **Exclude from searches:** only directories that exist and hold build output, dependencies
     or copies of the source tree.
   - **Generated, never hand-edited:** only generators the repo actually uses (codegen config,
     `*.g.dart`, `build.rs`, ...), each with its regenerate command.
   - Drop any line you cannot back with something in the repo. A wrong contract line is worse
     than a missing one: every agent will follow it.
4. **Write the section** into the CLAUDE.md, after the existing content, in the template's
   shape, ending with `- **Read threshold:** 350 lines. Scratch files go to `.claude/tmp/`
   (gitignored).` Change nothing else in the file.
5. **Gitignore scratch space.** In a git work tree, append `.claude/tmp/` to `<repo>/.gitignore`
   unless it is already there.
6. **Report** the file(s) changed, the contract lines you wrote with the evidence for each
   (`path` of the manifest, script or workflow it came from), and the lines you left out and
   why. Suggest running the Verify commands once to confirm they pass on a clean tree.
