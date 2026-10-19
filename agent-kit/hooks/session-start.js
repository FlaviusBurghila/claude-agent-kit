#!/usr/bin/env node
// session-start.js — SessionStart hook of the agent-kit plugin.
//
// By default prints a short stub naming the plugin's scoped agents; engage.js
// (UserPromptSubmit) loads agent-kit/orchestration.md once the context passes
// AGENT_KIT_ENGAGE_TOKENS. With that set to 0 this hook injects the full rules
// itself. On compact or clear it forgets that engage.js already fired, so the
// rules come back. SessionStart context reaches the main session only, so
// subagents keep their own prompt. Script installs load the same file through a
// CLAUDE.md import instead; when that import is present this hook prints nothing,
// so it is never loaded twice.
//
// Claude Code caps hook context at 10,000 characters (tests/plugin.test.js
// checks the payload stays under it). Fails open: any error prints nothing.
'use strict';

const fs = require('fs');
const lib = require('./lib');

function stub(tokens) {
  return `The ${lib.pluginName()} plugin is enabled. Its agents are ${lib.scopedIds()}; pass that scoped name ` +
    'as `subagent_type`. The full orchestration rules load automatically once this session\'s context passes ' +
    `${tokens} tokens; until then work normally. For a file over the read threshold, use the bulk-reader ` +
    'agent or a ranged Read (offset/limit).';
}

function build(projectDir) {
  if (lib.hasScriptInstall(projectDir)) return '';
  const tokens = lib.engageTokens();
  return tokens === 0 ? lib.fullRules() : stub(tokens);
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin */ }
  if (input.source === 'compact' || input.source === 'clear') {
    const state = lib.statePath(input.session_id);
    if (state) fs.rmSync(state, { force: true });
  }
  const context = build(process.env.CLAUDE_PROJECT_DIR || input.cwd || '');
  if (!context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  }));
}

if (require.main === module) {
  try { main(); } catch { /* fail open */ }
}
module.exports = { build };
