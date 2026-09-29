#!/usr/bin/env node
// session-start.js — SessionStart hook of the agent-kit plugin.
//
// Puts agent-kit/orchestration.md into the main session's context, prefixed with
// the plugin-scoped agent names. SessionStart context reaches the main session
// only, so subagents keep their own prompt and do not pay for the Orchestrator's
// rules. Script installs load the same file through a CLAUDE.md import instead;
// when that import is present this hook prints nothing, so it is never loaded twice.
//
// Claude Code caps hook context at 10,000 characters (tests/plugin.test.js
// checks the payload stays under it). Fails open: any error prints nothing.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
const MARK = '<!-- claude-agent-kit:begin -->';

function pluginName() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).name;
  } catch { return 'agent-kit'; }
}

function agentNames() {
  return fs.readdirSync(path.join(ROOT, 'agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .sort();
}

function hasScriptInstall(projectDir) {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const files = [path.join(config, 'CLAUDE.md')];
  if (projectDir) files.push(path.join(projectDir, 'CLAUDE.md'), path.join(projectDir, '.claude', 'CLAUDE.md'));
  return files.some((f) => {
    try { return fs.readFileSync(f, 'utf8').includes(MARK); } catch { return false; }
  });
}

function build(projectDir) {
  if (hasScriptInstall(projectDir)) return '';
  const name = pluginName();
  const ids = agentNames().map((a) => `\`${name}:${a}\``).join(', ');
  const body = fs.readFileSync(path.join(ROOT, 'agent-kit', 'orchestration.md'), 'utf8');
  return `The ${name} plugin is enabled. Its agents are ${ids}; pass that scoped name as ` +
    '`subagent_type`. The rules below refer to them by role.\n\n' + body;
}

function main() {
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* no stdin */ }
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
