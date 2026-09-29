#!/usr/bin/env node
// Self-test for agent-kit/hooks/shunt.js. Run: node tests/shunt.test.js
// Every case names the verdict it expects; a guard that never fails on purpose
// is not a guard.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'agent-kit', 'hooks', 'shunt.js');
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'shunt-test-'));
const BIG = 'big.txt';                          // 2,268 lines
const SMALL = 'small.txt';                       // 20 lines, well under threshold
const png = 'pixel.png';
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
fs.writeFileSync(path.join(CWD, BIG), lines(2268));
fs.writeFileSync(path.join(CWD, SMALL), lines(20));
fs.writeFileSync(path.join(CWD, png), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

function run(name, expect, tool, tool_input, extra = {}, env = {}) {
  const input = { hook_event_name: 'PreToolUse', tool_name: tool, tool_input, cwd: CWD, session_id: 't', ...extra };
  const r = spawnSync('node', [HOOK], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, SHUNT_OFF: '', SHUNT_MIN_LINES: '', CLAUDE_PLUGIN_ROOT: '', ...env } });
  let verdict = 'allow';
  let reason = '';
  if (r.stdout.trim()) {
    const j = JSON.parse(r.stdout);
    verdict = j.hookSpecificOutput.permissionDecision;
    reason = j.hookSpecificOutput.permissionDecisionReason;
  }
  const ok = verdict === expect && r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  → ${verdict}${r.status !== 0 ? ` (exit ${r.status}: ${r.stderr.trim()})` : ''}`);
  if (!ok) { process.exitCode = 1; if (reason) console.log('      ' + reason.slice(0, 160)); }
  return reason;
}

const R = (o) => ({ file_path: path.join(CWD, o.f), ...(o.offset ? { offset: o.offset } : {}), ...(o.limit ? { limit: o.limit } : {}) });
const B = (command) => ({ command });

// Read tool
const firstReason = run('Read big file, main session', 'deny', 'Read', R({ f: BIG }));
run('Read small file', 'allow', 'Read', R({ f: SMALL }));
run('Read big file, limit 100', 'allow', 'Read', R({ f: BIG, limit: 100 }));
run('Read big file, limit 400', 'deny', 'Read', R({ f: BIG, limit: 400 }));
run('Read big file, offset near end', 'allow', 'Read', R({ f: BIG, offset: 2200 }));
run('Read big file, relative path', 'deny', 'Read', { file_path: BIG });
run('Read nonexistent file', 'allow', 'Read', { file_path: 'nope/missing.txt' });
run('Read PNG', 'allow', 'Read', { file_path: png });
// Scope
run('Read big file as bulk-reader', 'allow', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'bulk-reader' });
run('Read big file as scout', 'allow', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'scout' });
run('Read big file as plugin agent', 'allow', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'some-plugin:worker' });
run('Read big file as refuter', 'deny', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'refuter' });
run('Read big file as builder', 'deny', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'builder' });
run('Read big file as plugin builder', 'deny', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'agent-kit:builder' });
run('Read big file as plugin debugger', 'deny', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'agent-kit:debugger' });
run('Read big file as plugin bulk-reader', 'allow', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'agent-kit:bulk-reader' });
run("Read big file as another plugin's builder", 'allow', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'other-plugin:builder' });
// Deny message: the main session delegates; a governed subagent narrows the read or hands it back
const expectIn = (name, text, wanted, unwanted) => {
  const ok = text.includes(wanted) && !(unwanted && text.includes(unwanted));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { process.exitCode = 1; console.log('      ' + text.slice(0, 200)); }
};
const subReason = run('Read big file as builder (message)', 'deny', 'Read', R({ f: BIG }), { agent_id: 'a1', agent_type: 'builder' });
expectIn('subagent deny says report to the Orchestrator, not spawn', subReason, 'report that to the Orchestrator', 'Agent(');
const plugReason = run('Read big file, main session, plugin install', 'deny', 'Read', R({ f: BIG }), {}, { CLAUDE_PLUGIN_ROOT: '/tmp/plugin' });
expectIn('plugin deny names the scoped bulk-reader', plugReason, 'subagent_type: "agent-kit:bulk-reader"');
run('Read big file with SHUNT_OFF=1', 'allow', 'Read', R({ f: BIG }), {}, { SHUNT_OFF: '1' });
run('Read big file with SHUNT_MIN_LINES=5000', 'allow', 'Read', R({ f: BIG }), {}, { SHUNT_MIN_LINES: '5000' });
run('Read small file with SHUNT_MIN_LINES=5', 'deny', 'Read', R({ f: SMALL }), {}, { SHUNT_MIN_LINES: '5' });
run('Other event passes through', 'allow', 'Read', R({ f: BIG }), { hook_event_name: 'PostToolUse' });
// Where we deliberately differ from Spotify's shunt evals (theirs allow any offset/limit and block bare head/tail)
run('Read big file, offset 0 (Spotify allows)', 'deny', 'Read', { file_path: path.join(CWD, BIG), offset: 0 });
run('Read big file, limit 0 (Spotify allows)', 'deny', 'Read', { file_path: path.join(CWD, BIG), limit: 0 });
run('Read big file, limit 2000 (Spotify allows)', 'deny', 'Read', R({ f: BIG, limit: 2000 }));
run('Read big file, offset 100 no limit (Spotify allows)', 'deny', 'Read', R({ f: BIG, offset: 100 }));
// Bash: dumpers
run('cat big', 'deny', 'Bash', B(`cat ${BIG}`));
run('cat big | grep', 'allow', 'Bash', B(`cat ${BIG} | grep -n foo`));
run('cat big | head', 'allow', 'Bash', B(`cat ${BIG} | head -20`));
run('cat big | tee', 'deny', 'Bash', B(`cat ${BIG} | tee /tmp/x`));
run('cat big > file', 'allow', 'Bash', B(`cat ${BIG} > /tmp/x`));
run('cat big 2>&1', 'deny', 'Bash', B(`cat ${BIG} 2>&1`));
run('cat small', 'allow', 'Bash', B(`cat ${SMALL}`));
run('cat nonexistent', 'allow', 'Bash', B(`cat nope/missing.txt`));
run('rtk read big', 'deny', 'Bash', B(`rtk read ${BIG}`));
run('rtk read -m 100 big', 'allow', 'Bash', B(`rtk read -m 100 ${BIG}`));
run('rtk proxy cat big', 'deny', 'Bash', B(`rtk proxy cat ${BIG}`));
run('git show HEAD:big', 'deny', 'Bash', B(`git show HEAD:${BIG}`));
run('git show HEAD (commit)', 'allow', 'Bash', B(`git show HEAD --stat`));
// Bash: head/tail/sed
run('head -n 50 big', 'allow', 'Bash', B(`head -n 50 ${BIG}`));
run('bare head big (Spotify blocks; prints 10 lines)', 'allow', 'Bash', B(`head ${BIG}`));
run('bare tail big (Spotify blocks; prints 10 lines)', 'allow', 'Bash', B(`tail ${BIG}`));
run('head -100 big (Spotify blocks; prints 100 lines)', 'allow', 'Bash', B(`head -100 ${BIG}`));
run('head -n 5000 big (Spotify allows by accident)', 'deny', 'Bash', B(`head -n 5000 ${BIG}`));
run('head -50 big', 'allow', 'Bash', B(`head -50 ${BIG}`));
run('head -n 500 big', 'deny', 'Bash', B(`head -n 500 ${BIG}`));
run('tail -n 500 big', 'deny', 'Bash', B(`tail -n 500 ${BIG}`));
run('tail -c 100 big', 'allow', 'Bash', B(`tail -c 100 ${BIG}`));
run("sed -n '1,400p' big", 'deny', 'Bash', B(`sed -n '1,400p' ${BIG}`));
run("sed -n '10,60p' big", 'allow', 'Bash', B(`sed -n '10,60p' ${BIG}`));
run("sed -n '2000,$p' big", 'allow', 'Bash', B(`sed -n '2000,$p' ${BIG}`));
run("sed -n '100,$p' big", 'deny', 'Bash', B(`sed -n '100,$p' ${BIG}`));
run("sed -n '/foo/p' big", 'allow', 'Bash', B(`sed -n '/foo/p' ${BIG}`));
run("sed 's/a/b/' big (no -n)", 'deny', 'Bash', B(`sed 's/a/b/' ${BIG}`));
run("sed -i 's/a/b/' big", 'allow', 'Bash', B(`sed -i '' 's/a/b/' ${BIG}`));
run("sed -n -e '1,400p' big", 'deny', 'Bash', B(`sed -n -e '1,400p' ${BIG}`));
// Bash: structure
run('grep -n on big', 'allow', 'Bash', B(`grep -n "foo" ${BIG}`));
run('wc -l big', 'allow', 'Bash', B(`wc -l ${BIG}`));
run('multiline: analyze then cat big', 'deny', 'Bash', B(`flutter analyze\ncat ${BIG}`));
run('cd && cat big (relative to hook cwd)', 'deny', 'Bash', B(`cd ${CWD} && cat ${BIG}`));
run('env prefix: FOO=1 cat big', 'deny', 'Bash', B(`FOO=1 cat ${BIG}`));
run('heredoc body mentioning cat big', 'allow', 'Bash', B(`cat > /tmp/note.md <<'EOF'\ncat ${BIG}\nEOF`));
run('heredoc then real cat big after', 'deny', 'Bash', B(`cat > /tmp/note.md <<'EOF'\nhello\nEOF\ncat ${BIG}`));
run('quoted pipe in grep arg', 'allow', 'Bash', B(`grep -E "a|b" ${BIG}`));
run('echo with pipe char', 'allow', 'Bash', B(`echo "x|y" | cat`));
run('python3 script', 'allow', 'Bash', B(`python3 - <<'PY'\nprint(open("${BIG}").read())\nPY`));
run('empty command', 'allow', 'Bash', B(''));
run('malformed json', 'allow', 'Bash', undefined);

console.log('\nSample deny reason:\n  ' + firstReason);

fs.rmSync(CWD, { recursive: true, force: true });
