#!/usr/bin/env node
// Tests for the UserPromptSubmit hook that loads the rules once context grows.
// Run: node tests/engage.test.js
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'agent-kit', 'hooks');
const CONTEXT_CAP = 10000;

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { process.exitCode = 1; if (detail) console.log('      ' + detail); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-engage-'));
const cfg = path.join(tmp, 'cfg');
const proj = path.join(tmp, 'proj');
fs.mkdirSync(cfg); fs.mkdirSync(proj);
const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PROJECT_DIR: proj,
  CLAUDE_PLUGIN_DATA: path.join(tmp, 'data') };
delete env.AGENT_KIT_ENGAGE_TOKENS;

function run(script, input, extra) {
  const r = spawnSync('node', [path.join(HOOKS, script)], { input: JSON.stringify(input), encoding: 'utf8',
    env: { ...env, ...extra } });
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}

const assistant = (tokens, extra) => JSON.stringify({ type: 'assistant', message: { usage: {
  input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: tokens - 3 } }, ...extra });
let n = 0;
function transcript(lines) {
  const f = path.join(tmp, `t${n++}.jsonl`);
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}
const prompt = (sid, file) => run('engage.js', { session_id: sid, transcript_path: file, cwd: proj, prompt: 'hi' },
  { AGENT_KIT_ENGAGE_TOKENS: '1000' });

check('engage quiet below the threshold', prompt('s1', transcript([assistant(999)])) === '');
const ctx = prompt('s2', transcript([assistant(1000)]));
check('engage injects the rules at the threshold', ctx.includes('# Orchestration rules'));
check(`engage payload under ${CONTEXT_CAP} chars`, ctx.length < CONTEXT_CAP, `${ctx.length} chars`);
check('engage names the threshold', ctx.includes('passed 1000 tokens'));
check('engage quiet the second time for a session', prompt('s2', transcript([assistant(5000)])) === '');
run('session-start.js', { session_id: 's2', source: 'startup' });
check('SessionStart startup keeps the engaged state', prompt('s2', transcript([assistant(5000)])) === '');
run('session-start.js', { session_id: 's2', source: 'compact' });
check('SessionStart compact re-arms engage', prompt('s2', transcript([assistant(5000)])) !== '');
run('session-start.js', { session_id: 's2', source: 'clear' });
check('SessionStart clear re-arms engage', prompt('s2', transcript([assistant(5000)])) !== '');

check('engage ignores sidechain entries',
  prompt('s3', transcript([assistant(5000), assistant(10, { isSidechain: true })])) !== '');
check('engage uses the last main-thread entry', prompt('s4', transcript([assistant(5000), assistant(10)])) === '');
const big = transcript([assistant(5000), ...Array(3000).fill(JSON.stringify({ type: 'user', message: 'x'.repeat(300) }))]);
check('transcript larger than the tail window still finds the entry', fs.statSync(big).size > 512 * 1024 && prompt('s5', big) !== '');
check('engage quiet on a missing transcript', prompt('s6', path.join(tmp, 'nope.jsonl')) === '');
check('engage quiet on a garbage transcript', prompt('s7', transcript(['not json', '{'])) === '');
check('engage quiet on an unsafe session id', prompt('../x', transcript([assistant(5000)])) === '');
check('engage quiet when the threshold is 0',
  run('engage.js', { session_id: 's8', transcript_path: transcript([assistant(5000)]) }, { AGENT_KIT_ENGAGE_TOKENS: '0' }) === '');
check('invalid threshold falls back to the default (80000)',
  run('engage.js', { session_id: 's9', transcript_path: transcript([assistant(80000)]) }, { AGENT_KIT_ENGAGE_TOKENS: '-5' }) !== '');
check('engage skips a zero-usage entry after a real one',
  prompt('s11', transcript([assistant(5000), assistant(0)])) !== '');
const blocker = path.join(tmp, 'blocker');
fs.writeFileSync(blocker, '');
check('engage quiet when the state dir is unwritable',
  run('engage.js', { session_id: 's12', transcript_path: transcript([assistant(5000)]) },
    { AGENT_KIT_ENGAGE_TOKENS: '1000', CLAUDE_PLUGIN_DATA: blocker }) === '');

fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '<!-- claude-agent-kit:begin -->\n@x\n<!-- claude-agent-kit:end -->\n');
check('engage quiet when a script install imports the rules', prompt('s10', transcript([assistant(5000)])) === '');
check('engage ignores the import with AGENT_KIT_IGNORE_SCRIPT_INSTALL=1',
  run('engage.js', { session_id: 's13', transcript_path: transcript([assistant(5000)]), cwd: proj },
    { AGENT_KIT_ENGAGE_TOKENS: '1000', AGENT_KIT_IGNORE_SCRIPT_INSTALL: '1' }).includes('# Orchestration rules'));
check('SessionStart ignores the import with AGENT_KIT_IGNORE_SCRIPT_INSTALL=1',
  run('session-start.js', { source: 'startup', session_id: 's13', cwd: proj },
    { AGENT_KIT_IGNORE_SCRIPT_INSTALL: '1' }) !== '');

fs.rmSync(tmp, { recursive: true, force: true });
