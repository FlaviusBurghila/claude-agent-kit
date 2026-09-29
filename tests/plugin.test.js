#!/usr/bin/env node
// Consistency checks for the plugin packaging. Run: node tests/plugin.test.js
// `claude plugin validate .` checks the manifests' schema; this checks what it cannot:
// that the manifests, hooks, agents, installer and SessionStart payload agree.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const CONTEXT_CAP = 10000; // Claude Code's cap on hook context; over it, Claude sees a 2,000-char preview

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { process.exitCode = 1; if (detail) console.log('      ' + detail); }
}

const plugin = json('.claude-plugin/plugin.json');
const market = json('.claude-plugin/marketplace.json');
const entry = market.plugins.find((p) => p.source === './');
check('marketplace lists the repo-root plugin', Boolean(entry));
check('entry name matches the manifest name', entry && entry.name === plugin.name, `${entry && entry.name} vs ${plugin.name}`);
check('plugin name has no reserved claude- prefix', !/^(claude|anthropic)/i.test(plugin.name));
check('plugin.json carries a version', typeof plugin.version === 'string' && /^\d+\.\d+\.\d+/.test(plugin.version));

// The shunt hook recognizes the plugin's agents by this prefix.
const shunt = read('agent-kit/hooks/shunt.js');
check('shunt.js prefix matches the plugin name', shunt.includes(`const PLUGIN_PREFIX = '${plugin.name}:'`));

// Hooks point at files that exist.
const hooks = json('hooks/hooks.json').hooks;
for (const [event, entries] of Object.entries(hooks)) {
  for (const e of entries) {
    for (const h of e.hooks) {
      const m = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/);
      check(`${event} hook script exists`, m && fs.existsSync(path.join(ROOT, m[1])), h.command);
    }
  }
}

// Agents: frontmatter name = filename, installer list = directory, no nested spawning.
const agentFiles = fs.readdirSync(path.join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).sort();
const installList = (read('install.sh').match(/^AGENTS="([^"]+)"/m) || [])[1] || '';
check('install.sh AGENTS matches agents/', installList.split(' ').sort().join(' ') === agentFiles.map((f) => f.slice(0, -3)).join(' '), installList);
for (const f of agentFiles) {
  const fm = (read(`agents/${f}`).match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const field = (k) => ((fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')) || [])[1] || '').trim();
  check(`${f}: name matches filename`, field('name') === f.slice(0, -3));
  check(`${f}: has a description`, field('description').length > 0);
  check(`${f}: cannot spawn agents`, field('disallowedTools').split(/,\s*/).includes('Agent'));
}

// SessionStart payload: under the cap, names every agent scoped, skips when a script install is present.
const SS = path.join(ROOT, 'agent-kit', 'hooks', 'session-start.js');
function sessionStart(env) {
  const r = spawnSync('node', [SS], { input: '{}', encoding: 'utf8', env: { ...process.env, ...env } });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-plugin-'));
const cfg = path.join(tmp, 'cfg');
const proj = path.join(tmp, 'proj');
fs.mkdirSync(cfg); fs.mkdirSync(proj);
const base = { CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj };
const ctx = sessionStart(base);
check('SessionStart injects the orchestration rules', ctx.includes('# Orchestration rules'));
check(`SessionStart payload under ${CONTEXT_CAP} chars`, ctx.length < CONTEXT_CAP, `${ctx.length} chars`);
check('SessionStart names every agent with the plugin scope', agentFiles.every((f) => ctx.includes(`\`${plugin.name}:${f.slice(0, -3)}\``)));
fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# P\n\n<!-- claude-agent-kit:begin -->\n@.claude/agent-kit/orchestration.md\n<!-- claude-agent-kit:end -->\n');
check('SessionStart stays quiet when a project script install imports the rules', sessionStart(base) === '');
fs.mkdirSync(path.join(proj, '.claude'));
fs.renameSync(path.join(proj, 'CLAUDE.md'), path.join(proj, '.claude', 'CLAUDE.md'));
check('SessionStart stays quiet when the import is in .claude/CLAUDE.md', sessionStart(base) === '');
fs.rmSync(path.join(proj, '.claude'), { recursive: true });
check('SessionStart speaks again once the import is gone', sessionStart(base) !== '');
fs.writeFileSync(path.join(cfg, 'CLAUDE.md'), '<!-- claude-agent-kit:begin -->\n@~/.claude/agent-kit/orchestration.md\n<!-- claude-agent-kit:end -->\n');
check('SessionStart stays quiet when a global script install imports the rules', sessionStart(base) === '');
fs.rmSync(tmp, { recursive: true, force: true });
