#!/usr/bin/env node
// shunt.js — PreToolUse guard that keeps whole-file loads out of reasoning contexts.
//
// Pattern: Spotify's Portal "shunt" plugin (engineering.atspotify.com, Sep 2026):
// a frontier model should not spend its context on I/O. Reads over a line
// threshold are denied with instructions to (1) ask the bulk-reader agent one
// question, or (2) read a known range with offset/limit. Editing and reasoning
// are never delegated. See the Read budget rules in agent-kit/orchestration.md.
//
// Governs : the main session, plus the builder / refuter / debugger subagents
//           (bare names from a script install, agent-kit:<name> from the plugin).
// Exempt  : every other agent_type (bulk-reader, code-writer, scout, researcher,
//           Explore, other plugins' agents, ...).
// Config  : SHUNT_MIN_LINES (default 350). SHUNT_OFF=1 disables the guard.
// Safety  : fails open — any error or anything it cannot parse is allowed.
'use strict';

const fs = require('fs');
const path = require('path');

const THRESHOLD = (() => {
  const n = parseInt(process.env.SHUNT_MIN_LINES || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 350;
})();
const GOVERNED_AGENTS = new Set(['builder', 'refuter', 'debugger']);
const PLUGIN_PREFIX = 'agent-kit:';
// The plugin's agents are addressed by their scoped name; a script install's by the bare one.
const BULK_READER = process.env.CLAUDE_PLUGIN_ROOT ? `${PLUGIN_PREFIX}bulk-reader` : 'bulk-reader';
const READ_DEFAULT_LIMIT = 2000; // the Read tool reads up to 2000 lines when no limit is given
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf', '.ipynb', '.svg', '.ico']);
const DUMPERS = new Set(['cat', 'bat', 'less', 'more', 'nl', 'tac']);
const NON_FILTERS = new Set(['tee', 'cat', 'nl', 'sort', 'uniq', 'column', 'bat', 'less', 'more', 'tr', 'rev', 'tac', 'expand', 'unexpand', 'fold', 'pr']);
const MAX_BYTES = 64 * 1024 * 1024;

function allow() { process.exit(0); }
function deny(reasonText) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reasonText,
    },
  }));
  process.exit(0);
}

function main() {
  if (process.env.SHUNT_OFF === '1') return allow();
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (input.hook_event_name !== 'PreToolUse') return allow();
  const inSubagent = Boolean(input.agent_id);
  if (inSubagent && !isGoverned(input.agent_type)) return allow();
  const cwd = input.cwd || process.cwd();
  const ti = input.tool_input || {};
  let verdict = null;
  if (input.tool_name === 'Read') verdict = checkRead(ti, cwd);
  else if (input.tool_name === 'Bash') verdict = checkBash(ti, cwd);
  return verdict ? deny(verdict + nextStep(inSubagent)) : allow();
}

function isGoverned(agentType) {
  let t = String(agentType || '').toLowerCase();
  if (t.startsWith(PLUGIN_PREFIX)) t = t.slice(PLUGIN_PREFIX.length);
  return GOVERNED_AGENTS.has(t);
}

// The main session delegates the read; a governed subagent narrows it or hands it back,
// as its agent file says: it does not spawn agents of its own.
function nextStep(inSubagent) {
  if (inSubagent) {
    return `Instead, Read with offset/limit <= ${THRESHOLD} around the lines you need (find them with grep -n). ` +
      'If you need the whole file understood, stop and report that to the Orchestrator, naming the file and the question.';
  }
  return `Either (1) Agent(subagent_type: "${BULK_READER}") with the file(s) and ONE question — you get bullets with path:line anchors, not contents; ` +
    `or (2) Read with offset/limit <= ${THRESHOLD} for a range you already hold from grep -n, a Scout, or a Bulk-reader. ` +
    'Never delegate editing or reasoning. See the Read budget rules in agent-kit/orchestration.md.';
}

// ---------- Read tool ----------

function checkRead(ti, cwd) {
  const fp = resolvePath(ti.file_path, cwd);
  if (!fp) return null;
  const total = lineCount(fp);
  if (total == null) return null;
  const offset = num(ti.offset) > 0 ? num(ti.offset) : 1;
  const limit = num(ti.limit) > 0 ? num(ti.limit) : READ_DEFAULT_LIMIT;
  const wouldRead = Math.min(Math.max(0, total - offset + 1), limit);
  if (wouldRead <= THRESHOLD) return null;
  return reason(cwd, fp, total, `this Read would load ${wouldRead} lines`);
}

// ---------- Bash tool ----------

function checkBash(ti, cwd) {
  const cmd = String(ti.command || '');
  if (!cmd.trim()) return null;
  for (const stages of parseCommand(cmd)) {
    const toks = tokenize(stages[0]);
    if (!toks.length) continue;
    const downstream = stages.slice(1).map((s) => baseCmd(tokenize(s)));
    const filtered = downstream.some((c) => c && !NON_FILTERS.has(c));
    if (filtered) continue;
    const v = checkStage(toks, cwd);
    if (v) return v;
  }
  return null;
}

function checkStage(toksIn, cwd) {
  let toks = stripPrefixes(toksIn);
  if (!toks.length) return null;
  // stdout redirected to a file → nothing reaches the context
  if (toks.some((t) => /^1?>{1,2}(?!&)/.test(t))) return null;
  let cmd = toks[0];
  let args = toks.slice(1);
  let rtkRead = false;
  if (cmd === 'rtk') {
    if (args[0] === 'proxy') args = args.slice(1);
    cmd = args[0]; args = args.slice(1);
    if (cmd === 'read') { rtkRead = true; cmd = 'cat'; }
  }
  if (cmd === 'git' && args[0] === 'show') return checkGitShow(args.slice(1), cwd);
  if (DUMPERS.has(cmd)) return checkDumper(cmd, args, rtkRead, cwd);
  if (cmd === 'head' || cmd === 'tail') return checkHeadTail(cmd, args, cwd);
  if (cmd === 'sed') return checkSed(args, cwd);
  return null;
}

function checkDumper(cmd, args, rtkRead, cwd) {
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (rtkRead && (a === '-m' || a === '--max-lines' || a === '--tail-lines')) {
      const n = num(args[++i]);
      if (n > 0 && n <= THRESHOLD) return null;
      continue;
    }
    if (rtkRead && /^--?(max-lines|tail-lines|m)=/.test(a)) {
      const n = num(a.split('=')[1]);
      if (n > 0 && n <= THRESHOLD) return null;
      continue;
    }
    if (a.startsWith('-') || a.startsWith('<')) continue;
    files.push(a);
  }
  return checkFiles(files, cwd, null, `${cmd} dumps the whole file`);
}

function checkHeadTail(cmd, args, cwd) {
  let n = 10;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '--bytes' || /^-c\d*$/.test(a) || a.startsWith('--bytes=')) return null;
    if (a === '-n' || a === '--lines') { n = Math.abs(num(args[++i])); continue; }
    if (a.startsWith('--lines=')) { n = Math.abs(num(a.slice(8))); continue; }
    if (/^-n[+-]?\d+$/.test(a)) { n = Math.abs(num(a.slice(2))); continue; }
    if (/^-[+-]?\d+$/.test(a)) { n = Math.abs(num(a.slice(1))); continue; }
    if (a.startsWith('-') || a.startsWith('<')) continue;
    files.push(a);
  }
  if (!Number.isFinite(n) || n <= THRESHOLD) return null;
  return checkFiles(files, cwd, n, `${cmd} -n ${n} would print ${n} lines`);
}

function checkSed(args, cwd) {
  let quiet = false, inPlace = false, script = null;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-n' || a === '--quiet' || a === '--silent') { quiet = true; continue; }
    if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(a) && !a.startsWith('-e') && !a.startsWith('-f') && !a.startsWith('-i')) { quiet = true; continue; }
    if (a === '-i' || a.startsWith('-i') || a.startsWith('--in-place')) { inPlace = true; continue; }
    if (a === '-e' || a === '--expression') { script = script ?? args[++i]; continue; }
    if (a.startsWith('--expression=')) { script = script ?? a.split('=').slice(1).join('='); continue; }
    if (a === '-f' || a === '--file' || a.startsWith('--file=')) return null; // script in a file: cannot know
    if (a.startsWith('-')) continue;
    if (script === null) { script = a; continue; }
    files.push(a);
  }
  if (inPlace) return null;
  if (!quiet) return checkFiles(files, cwd, null, 'sed without -n prints every line');
  if (script == null) return null;
  let m;
  if ((m = script.match(/^(\d+),(\d+)\s*p$/))) {
    const n = Math.max(0, num(m[2]) - num(m[1]) + 1);
    if (n <= THRESHOLD) return null;
    return checkFiles(files, cwd, n, `sed -n '${script}' would print ${n} lines`);
  }
  if ((m = script.match(/^(\d+),\$\s*p$/))) {
    return checkFiles(files, cwd, null, `sed -n '${script}' prints from line ${m[1]} to the end`, num(m[1]));
  }
  if (/^p$/.test(script) || /^1,\$\s*p$/.test(script)) return checkFiles(files, cwd, null, 'sed -n p prints every line');
  return null; // regex address or other filter
}

function checkGitShow(args, cwd) {
  for (const a of args) {
    const m = a.match(/^[^-][^:]*:(.+)$/);
    if (!m) continue;
    const v = checkFiles([m[1]], cwd, null, 'git show dumps the whole file');
    if (v) return v;
  }
  return null;
}

// files: list of paths; cap: max lines the command prints per file (null = all);
// from: first printed line (1-based) when a tail range is known.
function checkFiles(files, cwd, cap, how, from) {
  let worst = null;
  let sum = 0;
  for (const f of files) {
    const fp = resolvePath(f, cwd);
    if (!fp) continue;
    const total = lineCount(fp);
    if (total == null) continue;
    let printed = total;
    if (from) printed = Math.max(0, total - from + 1);
    if (cap != null) printed = Math.min(printed, cap);
    sum += printed;
    if (!worst || printed > worst.printed) worst = { fp, total, printed };
  }
  if (!worst || sum <= THRESHOLD) return null;
  return reason(cwd, worst.fp, worst.total, files.length > 1 ? `${how}; ${sum} lines across ${files.length} files` : how);
}

// ---------- helpers ----------

function reason(cwd, fp, total, how) {
  const rel = path.relative(cwd, fp) || fp;
  const size = total === Infinity ? 'over 64 MB' : `${total} lines`;
  return `shunt: ${rel} is ${size} (${how}), over SHUNT_MIN_LINES=${THRESHOLD}. Do not load it into this context. `;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

function resolvePath(p, cwd) {
  if (!p || typeof p !== 'string') return null;
  let s = p.replace(/^~(?=\/|$)/, process.env.HOME || '~');
  return path.isAbsolute(s) ? s : path.resolve(cwd, s);
}

function lineCount(fp) {
  try {
    const st = fs.statSync(fp);
    if (!st.isFile()) return null;
    if (SKIP_EXT.has(path.extname(fp).toLowerCase())) return null;
    if (st.size > MAX_BYTES) return Infinity;
    const fd = fs.openSync(fp, 'r');
    try {
      const head = Buffer.alloc(8192);
      const n = fs.readSync(fd, head, 0, 8192, 0);
      if (head.subarray(0, n).includes(0)) return null; // binary
    } finally { fs.closeSync(fd); }
    const buf = fs.readFileSync(fp);
    let count = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) count++;
    if (buf.length && buf[buf.length - 1] !== 10) count++;
    return count;
  } catch { return null; }
}

function baseCmd(toks) {
  const t = stripPrefixes(toks);
  if (!t.length) return null;
  if (t[0] === 'rtk') return t[1] === 'proxy' ? t[2] : t[1];
  return t[0];
}

function stripPrefixes(toks) {
  let i = 0;
  while (i < toks.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]) || ['command', 'time', 'nice', 'exec', 'sudo', 'env'].includes(toks[i]))) i++;
  return toks.slice(i);
}

// Split a command string into pipelines (array of stage strings), quote-aware,
// with heredoc bodies removed so their contents are never mistaken for commands.
function parseCommand(cmd) {
  const lines = cmd.split('\n');
  let hereDelim = null;
  let acc = '';
  for (const line of lines) {
    if (hereDelim !== null) { if (line.trim() === hereDelim) hereDelim = null; continue; }
    const m = line.match(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/);
    if (m) hereDelim = m[1] || m[2] || m[3];
    acc += line + '\n';
  }
  const pipelines = [];
  let stages = [];
  let cur = '';
  let q = null;
  const s = acc;
  const endStage = () => { stages.push(cur); cur = ''; };
  const endPipeline = () => { endStage(); pipelines.push(stages); stages = []; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      else if (c === '\\' && q === '"') cur += s[++i] ?? '';
      continue;
    }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '\\') { cur += c + (s[++i] ?? ''); continue; }
    if (c === '|' && s[i + 1] === '|') { endPipeline(); i++; continue; }
    if (c === '&' && s[i + 1] === '&') { endPipeline(); i++; continue; }
    if (c === '|') { endStage(); continue; }
    if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<')) { cur += c; continue; }
    if (c === ';' || c === '\n' || c === '&') { endPipeline(); continue; }
    cur += c;
  }
  endPipeline();
  return pipelines.map((p) => p.map((x) => x.trim()).filter(Boolean)).filter((p) => p.length);
}

function tokenize(stage) {
  const out = [];
  let cur = '';
  let q = null;
  let had = false;
  for (let i = 0; i < stage.length; i++) {
    const c = stage[i];
    if (q) {
      if (c === q) { q = null; continue; }
      if (c === '\\' && q === '"') { cur += stage[++i] ?? ''; continue; }
      cur += c; continue;
    }
    if (c === "'" || c === '"') { q = c; had = true; continue; }
    if (c === '\\') { cur += stage[++i] ?? ''; had = true; continue; }
    if (/\s/.test(c)) { if (cur || had) out.push(cur); cur = ''; had = false; continue; }
    cur += c; had = true;
  }
  if (cur || had) out.push(cur);
  return out;
}

try { main(); } catch { allow(); }
