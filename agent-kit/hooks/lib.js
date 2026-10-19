// lib.js — helpers shared by the agent-kit plugin's session-start.js and engage.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
const MARK = '<!-- claude-agent-kit:begin -->';
const DEFAULT_ENGAGE_TOKENS = 80000;

// Context size, in tokens, at which the full rules load. 0 loads them at session start.
function engageTokens() {
  const raw = process.env.AGENT_KIT_ENGAGE_TOKENS;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_ENGAGE_TOKENS;
  return Number(raw.trim());
}

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

function scopedIds() {
  const name = pluginName();
  return agentNames().map((a) => `\`${name}:${a}\``).join(', ');
}

// True when a CLAUDE.md already imports the rules. AGENT_KIT_IGNORE_SCRIPT_INSTALL=1 skips the check
// for runs that do not load user memory (--setting-sources without user, SDK settingSources).
function hasScriptInstall(projectDir) {
  if (process.env.AGENT_KIT_IGNORE_SCRIPT_INSTALL === '1') return false;
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const files = [path.join(config, 'CLAUDE.md')];
  if (projectDir) files.push(path.join(projectDir, 'CLAUDE.md'), path.join(projectDir, '.claude', 'CLAUDE.md'));
  return files.some((f) => {
    try { return fs.readFileSync(f, 'utf8').includes(MARK); } catch { return false; }
  });
}

// The preamble plus agent-kit/orchestration.md.
function fullRules() {
  const body = fs.readFileSync(path.join(ROOT, 'agent-kit', 'orchestration.md'), 'utf8');
  return `The ${pluginName()} plugin is enabled. Its agents are ${scopedIds()}; pass that scoped name as ` +
    '`subagent_type`. The rules below refer to them by role.\n\n' + body;
}

// Per-session "rules already injected" marker; null when the id is not a safe file name.
function statePath(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const dir = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'claude-agent-kit');
  return path.join(dir, `engaged-${sessionId}`);
}

module.exports = { engageTokens, pluginName, agentNames, scopedIds, hasScriptInstall, fullRules, statePath };
