#!/usr/bin/env node
// engage.js — UserPromptSubmit hook of the agent-kit plugin.
//
// Once the main session's context reaches AGENT_KIT_ENGAGE_TOKENS, injects the full
// orchestration rules, once per session (session-start.js clears the marker on
// compact and clear). Context size comes from the last main-thread assistant usage
// in the transcript; only the tail of the file is read. Stays quiet when a script
// install already imports the rules, when the threshold is 0, or when the size is
// unknown. Payload stays under Claude Code's 10,000-character hook-context cap.
// Fails open: any error prints nothing.
'use strict';

const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const TAIL_BYTES = [512 * 1024, 4 * 1024 * 1024];

// The last main-thread assistant entry's usage in the last `bytes` of the file, or null.
// `whole` reports that the read covered the entire file.
function tailTokens(file, bytes) {
  const fd = fs.openSync(file, 'r');
  let text;
  let whole;
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    text = buf.toString('utf8');
    whole = len === size;
  } finally { fs.closeSync(fd); }
  const lines = text.split('\n');
  if (!whole) lines.shift(); // starts mid-line
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const u = e && e.type === 'assistant' && e.isSidechain !== true && e.message && e.message.usage;
    if (!u) continue;
    const sum = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (sum > 0) return { tokens: sum, whole }; // zero: synthetic or interrupted entry
  }
  return { tokens: null, whole };
}

function contextTokens(file) {
  for (const bytes of TAIL_BYTES) {
    const r = tailTokens(file, bytes);
    if (r.tokens !== null || r.whole) return r.tokens;
  }
  return null;
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const tokens = lib.engageTokens();
  if (tokens === 0) return;
  if (lib.hasScriptInstall(process.env.CLAUDE_PROJECT_DIR || input.cwd || '')) return;
  const state = lib.statePath(input.session_id);
  if (!state || fs.existsSync(state)) return;
  if (typeof input.transcript_path !== 'string') return;
  const used = contextTokens(input.transcript_path);
  if (used === null || used < tokens) return;
  const context = `This session passed ${tokens} tokens of context; the orchestration rules are now in force.\n\n` +
    lib.fullRules();
  // Mark first: if the marker cannot be written, print nothing rather than re-inject on every prompt.
  fs.mkdirSync(path.dirname(state), { recursive: true });
  fs.writeFileSync(state, '');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
  }));
}

try { main(); } catch { /* fail open */ }
