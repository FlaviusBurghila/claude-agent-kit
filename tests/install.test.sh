#!/usr/bin/env bash
# Tests for install.sh. Every case runs in its own temp dir with HOME pointed
# into it, so the real ~/.claude is never touched. Bash 3.2 compatible.
#   bash tests/install.test.sh
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
AGENTS="builder bulk-reader code-writer debugger refuter researcher scout"
KIT_FILES="orchestration.md agent-contract.template.md CLAUDE.template.md hooks/shunt.js"
HOOK_MARK='agent-kit/hooks/shunt.js'
BEGIN='<!-- claude-agent-kit:begin -->'

# ---- helpers (run inside a case's subshell; a failed check prints its reason) ---
setup() {
  T="$(mktemp -d "${TMPDIR:-/tmp}/kit-test.XXXXXX")"
  trap 'rm -rf "$T"' EXIT
  mkdir -p "$T/home" "$T/bin" "$T/log"
  printf '#!/bin/sh\necho "2.1.284 (Claude Code)"\n' >"$T/bin/claude"
  chmod +x "$T/bin/claude"
  export HOME="$T/home"
  export PATH="$T/bin:$PATH"
  unset CLAUDE_CONFIG_DIR
  G="$HOME/.claude"
}

inst() { bash "$REPO/install.sh" "$@" </dev/null >"$T/log/out" 2>"$T/log/err"; }

ok() { # description command...: the command must succeed
  local d="$1"
  shift
  "$@" >/dev/null 2>&1 || echo "$d"
}
no() { # description command...: the command must fail
  local d="$1"
  shift
  if "$@" >/dev/null 2>&1; then echo "$d"; fi
}
eq() { [ "$2" = "$3" ] || echo "$1: got '$2', want '$3'"; }

count() { grep -cF -- "$2" "$1" 2>/dev/null || true; }

hook_count() { # settings.json -> number of shunt hook commands
  node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    console.log(JSON.stringify(c.hooks || {}).split(process.argv[2]).length - 1);' -- "$1" "$HOOK_MARK"
}

found() { # dir pattern: some path under dir matches
  [ -n "$(find "$1" -path "$2" 2>/dev/null)" ]
}

same_json() { # a b: equal as JSON
  node -e 'const fs = require("fs"); const r = (f) => JSON.stringify(JSON.parse(fs.readFileSync(f, "utf8")));
    process.exit(r(process.argv[1]) === r(process.argv[2]) ? 0 : 1);' -- "$1" "$2"
}

snap() { # dirs...: listing plus checksums
  local d
  for d in "$@"; do
    (cd "$d" && find . | sort && find . -type f -exec cksum {} + | sort)
  done
}

new_project() { # -> P, a git work tree
  P="$T/proj"
  mkdir -p "$P"
  git -C "$P" init -q
}

# ---- cases -----------------------------------------------------------------------
case_global_fresh() {
  inst --global || echo "install exited non-zero: $(cat "$T/log/err")"
  local a f
  for a in $AGENTS; do ok "agent $a" test -f "$G/agents/$a.md"; done
  for f in $KIT_FILES; do ok "kit file $f" test -f "$G/agent-kit/$f"; done
  eq "shunt hook entries" "$(hook_count "$G/settings.json")" 1
  eq "managed blocks" "$(count "$G/CLAUDE.md" "$BEGIN")" 1
  ok "import line" grep -qxF '@~/.claude/agent-kit/orchestration.md' "$G/CLAUDE.md"
}

case_global_twice() {
  inst --global
  inst --global || echo "second install exited non-zero"
  eq "shunt hook entries" "$(hook_count "$G/settings.json")" 1
  eq "managed blocks" "$(count "$G/CLAUDE.md" "$BEGIN")" 1
  no "second run made a backup" test -e "$G/backups"
}

case_preserve_settings() {
  mkdir -p "$G"
  cat >"$G/settings.json" <<'EOF'
{
  "model": "opus",
  "env": { "A": "1" },
  "hooks": {
    "PreToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "echo hi" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "echo stop" }] }]
  }
}
EOF
  cp "$G/settings.json" "$T/orig.json"
  inst --global || echo "install failed"
  eq "hook after install" "$(hook_count "$G/settings.json")" 1
  eq "other hook kept" "$(count "$G/settings.json" 'echo hi')" 1
  eq "Stop hook kept" "$(count "$G/settings.json" 'echo stop')" 1
  eq "model kept" "$(count "$G/settings.json" '"model": "opus"')" 1
  ok "backup of settings.json" found "$G/backups" '*global/settings.json'
  inst --global --uninstall || echo "uninstall failed"
  ok "settings equal to the original after uninstall" same_json "$G/settings.json" "$T/orig.json"
}

case_invalid_settings() {
  mkdir -p "$G"
  echo '{ not json' >"$G/settings.json"
  cp "$G/settings.json" "$T/orig.json"
  if inst --global; then echo "install succeeded on invalid settings.json"; fi
  no "agents dir created" test -e "$G/agents"
  no "agent-kit dir created" test -e "$G/agent-kit"
  no "backups created" test -e "$G/backups"
  ok "settings.json changed" cmp "$G/settings.json" "$T/orig.json"
}

case_project_fresh() {
  new_project
  inst --project "$P" || echo "install failed: $(cat "$T/log/err")"
  ok "CLAUDE.md created" test -f "$P/CLAUDE.md"
  ok "relative import" grep -qxF '@.claude/agent-kit/orchestration.md' "$P/CLAUDE.md"
  eq "contract headings" "$(grep -c '^## Agent contract' "$P/CLAUDE.md")" 1
  # shellcheck disable=SC2016 # literal, expanded by Claude Code
  ok "hook uses CLAUDE_PROJECT_DIR" grep -qF '$CLAUDE_PROJECT_DIR/.claude/agent-kit/hooks/shunt.js' "$P/.claude/settings.json"
  ok ".gitignore line" grep -qxF '.claude/tmp/' "$P/.gitignore"
  ok "project agents" test -f "$P/.claude/agents/builder.md"
  no "global agents dir created" test -e "$G/agents"
}

case_project_contract() {
  new_project
  printf '# My app\n\n## Agent contract\n\n- **Verify:** make check\n' >"$P/CLAUDE.md"
  inst --project "$P"
  inst --project "$P"
  eq "contract headings (has one)" "$(grep -c '^## Agent contract' "$P/CLAUDE.md")" 1
  eq "blocks (has one)" "$(count "$P/CLAUDE.md" "$BEGIN")" 1
  ok "filled contract kept" grep -qF 'make check' "$P/CLAUDE.md"

  local Q="$T/proj2"
  mkdir -p "$Q"
  git -C "$Q" init -q
  printf '# Other app\n\nSome notes.\n' >"$Q/CLAUDE.md"
  inst --project "$Q"
  inst --project "$Q"
  eq "contract headings (scaffold)" "$(grep -c '^## Agent contract' "$Q/CLAUDE.md")" 1
  eq "blocks (scaffold)" "$(count "$Q/CLAUDE.md" "$BEGIN")" 1
  local h b
  h="$(grep -n '^## Agent contract' "$Q/CLAUDE.md" | cut -d: -f1)"
  b="$(grep -nF "$BEGIN" "$Q/CLAUDE.md" | cut -d: -f1)"
  [ "$h" -lt "$b" ] || echo "scaffold is not above the managed block ($h vs $b)"
  ok "notes kept" grep -qF 'Some notes.' "$Q/CLAUDE.md"
}

case_dry_run() {
  local before after
  before="$(snap "$T/home")"
  inst --global --dry-run || echo "global dry run failed"
  after="$(snap "$T/home")"
  eq "global dry run changed the tree" "$after" "$before"
  ok "dry run output says would" grep -q 'would' "$T/log/out"

  new_project
  printf '# App\n' >"$P/CLAUDE.md"
  before="$(snap "$T/home" "$P")"
  inst --project "$P" --dry-run || echo "project dry run failed"
  after="$(snap "$T/home" "$P")"
  eq "project dry run changed the tree" "$after" "$before"

  inst --global
  inst --project "$P"
  before="$(snap "$T/home" "$P")"
  inst --global --uninstall --dry-run
  inst --project "$P" --uninstall --dry-run
  inst --global --dry-run
  after="$(snap "$T/home" "$P")"
  eq "uninstall/reinstall dry run changed the tree" "$after" "$before"
}

case_uninstall_global() {
  mkdir -p "$G"
  printf '# Mine\n\nMY GLOBAL NOTES\n' >"$G/CLAUDE.md"
  inst --global
  inst --global --uninstall || echo "uninstall failed"
  local a
  for a in $AGENTS; do no "agent $a left" test -e "$G/agents/$a.md"; done
  no "agent-kit left" test -e "$G/agent-kit"
  ok "settings.json kept" test -f "$G/settings.json"
  eq "hook left" "$(hook_count "$G/settings.json")" 0
  ok "hooks key dropped" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).hooks === undefined ? 0 : 1)' -- "$G/settings.json"
  eq "block left" "$(count "$G/CLAUDE.md" "$BEGIN")" 0
  ok "notes kept" grep -qF 'MY GLOBAL NOTES' "$G/CLAUDE.md"
}

case_uninstall_project() {
  new_project
  printf '# App\n\nMY NOTES\n\n## Agent contract\n\n- **Verify:** flutter analyze\n' >"$P/CLAUDE.md"
  inst --project "$P"
  inst --project "$P" --uninstall || echo "uninstall failed"
  no "agents left" test -e "$P/.claude/agents/builder.md"
  no "agent-kit left" test -e "$P/.claude/agent-kit"
  eq "hook left" "$(hook_count "$P/.claude/settings.json")" 0
  eq "block left" "$(count "$P/CLAUDE.md" "$BEGIN")" 0
  ok "notes kept" grep -qF 'MY NOTES' "$P/CLAUDE.md"
  ok "filled contract kept" grep -qF 'flutter analyze' "$P/CLAUDE.md"
  ok ".gitignore line kept" grep -qxF '.claude/tmp/' "$P/.gitignore"
}

case_agents_only() {
  mkdir -p "$G"
  printf '# Mine\n' >"$G/CLAUDE.md"
  cp "$G/CLAUDE.md" "$T/orig.md"
  inst --global --agents-only || echo "install failed"
  ok "agents installed" test -f "$G/agents/scout.md"
  no "settings.json created" test -e "$G/settings.json"
  ok "CLAUDE.md unchanged" cmp "$G/CLAUDE.md" "$T/orig.md"
}

case_backup_modified_agent() {
  inst --global
  echo "local edit" >>"$G/agents/builder.md"
  inst --global || echo "re-install failed"
  ok "modified agent backed up" found "$G/backups" '*global/agents/builder.md'
  ok "agent restored" cmp "$G/agents/builder.md" "$REPO/agents/builder.md"
}

case_default_scope() {
  inst || echo "install failed: $(cat "$T/log/err")"
  ok "says it defaulted" grep -q 'defaulting to --global' "$T/log/out"
  ok "global agents" test -f "$G/agents/builder.md"
}

case_hook_smoke() {
  inst --global
  seq 1 2000 >"$T/big.txt"
  local out
  out="$(printf '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"%s"},"cwd":"%s"}' "$T/big.txt" "$T" |
    node "$G/agent-kit/hooks/shunt.js" 2>&1)"
  case "$out" in
    *'"permissionDecision":"deny"'*) ;;
    *) echo "no deny for a 2000-line Read: $out" ;;
  esac
}

case_missing_project_dir() {
  local before after
  before="$(snap "$T/home")"
  if inst --project "$T/does-not-exist"; then echo "install succeeded"; fi
  after="$(snap "$T/home")"
  eq "tree changed" "$after" "$before"
  no "project dir created" test -e "$T/does-not-exist"
}

case_symlinked_config() {
  mkdir -p "$G" "$T/real"
  printf '# real notes\n' >"$T/real/CLAUDE.md"
  printf '{"model":"opus"}\n' >"$T/real/settings.json"
  cp "$T/real/CLAUDE.md" "$T/orig.md"
  cp "$T/real/settings.json" "$T/orig.json"
  ln -s "$T/real/CLAUDE.md" "$G/CLAUDE.md"
  ln -s "$T/real/settings.json" "$G/settings.json"
  inst --global || echo "install failed: $(cat "$T/log/err")"
  local bmd bjs
  bmd="$(find "$G/backups" -path '*global/CLAUDE.md')"
  bjs="$(find "$G/backups" -path '*global/settings.json')"
  ok "CLAUDE.md backup is a regular file" test -f "$bmd" -a ! -L "$bmd"
  ok "CLAUDE.md backup has the original bytes" cmp "$bmd" "$T/orig.md"
  ok "settings.json backup is a regular file" test -f "$bjs" -a ! -L "$bjs"
  ok "settings.json backup has the original bytes" cmp "$bjs" "$T/orig.json"
  eq "CLAUDE.md link target" "$(readlink "$G/CLAUDE.md")" "$T/real/CLAUDE.md"
  eq "settings.json link target" "$(readlink "$G/settings.json")" "$T/real/settings.json"
  eq "block written through the link" "$(count "$T/real/CLAUDE.md" "$BEGIN")" 1
}

case_project_is_global() {
  inst --global
  cp "$G/settings.json" "$T/s.json"
  cp "$G/CLAUDE.md" "$T/c.md"
  if inst --project "$HOME"; then echo "project install into HOME succeeded"; fi
  ok "error suggests --global" grep -q -- '--global' "$T/log/err"
  ok "settings.json unchanged" cmp "$G/settings.json" "$T/s.json"
  ok "CLAUDE.md unchanged" cmp "$G/CLAUDE.md" "$T/c.md"
}

case_uninstall_ignores_skips() {
  inst --global
  inst --global --uninstall --no-hook --no-claude-md || echo "uninstall failed"
  eq "hook left" "$(hook_count "$G/settings.json")" 0
  eq "block left" "$(count "$G/CLAUDE.md" "$BEGIN")" 0
  no "agent-kit left" test -e "$G/agent-kit"
}

case_reversed_markers() {
  mkdir -p "$G"
  printf '<!-- claude-agent-kit:end -->\nx\n<!-- claude-agent-kit:begin -->\n' >"$G/CLAUDE.md"
  if inst --global; then echo "install succeeded"; fi
  no "agents dir created" test -e "$G/agents"
}

case_crlf() {
  mkdir -p "$G"
  printf '# Mine\r\n\r\nnotes\r\n' >"$G/CLAUDE.md"
  inst --global
  inst --global
  eq "blocks after two installs" "$(grep -c 'claude-agent-kit:begin' "$G/CLAUDE.md")" 1
  # A CRLF-converted block must also be found: convert the whole file.
  awk '{ printf "%s\r\n", $0 }' "$G/CLAUDE.md" >"$T/crlf.md"
  cp "$T/crlf.md" "$G/CLAUDE.md"
  inst --global
  eq "blocks after CRLF re-run" "$(grep -c 'claude-agent-kit:begin' "$G/CLAUDE.md")" 1
  inst --global --uninstall
  eq "markers after uninstall" "$(grep -c 'claude-agent-kit:' "$G/CLAUDE.md")" 0
}

case_empty_project_arg() {
  local before after
  before="$(snap "$T/home")"
  if inst --project ""; then echo "install succeeded"; fi
  after="$(snap "$T/home")"
  eq "tree changed" "$after" "$before"
  ok "message on stderr" test -s "$T/log/err"
}

case_remote() {
  mkdir -p "$T/tb/claude-agent-kit-main" "$T/empty" "$T/tmp"
  cp -R "$REPO/agents" "$REPO/agent-kit" "$T/tb/claude-agent-kit-main/"
  tar -czf "$T/kit.tgz" -C "$T/tb" claude-agent-kit-main
  printf '#!/bin/sh\ncat "%s"\n' "$T/kit.tgz" >"$T/bin/curl"
  chmod +x "$T/bin/curl"
  (cd "$T/empty" && TMPDIR="$T/tmp" bash -s -- --global <"$REPO/install.sh" >"$T/log/out" 2>"$T/log/err") ||
    echo "remote install failed: $(cat "$T/log/err")"
  ok "agents installed" test -f "$G/agents/builder.md"
  ok "hook installed" test -f "$G/settings.json"
  eq "temp dirs left" "$(find "$T/tmp" -mindepth 1 | wc -l | tr -d ' ')" 0
}

case_project_home_no_global() {
  if inst --project "$HOME"; then echo "install succeeded"; fi
  no "global dir created" test -e "$G"
  inst --project "$HOME" --dry-run && echo "dry run succeeded"
  inst --project "$HOME" --uninstall && echo "uninstall succeeded"
  no "global dir created by dry run or uninstall" test -e "$G"
}

# ---- runner ----------------------------------------------------------------------
FAILS=0
run_case() { # name function
  local out
  out="$( (
    setup
    "$2"
  ) 2>&1)"
  if [ -z "$out" ]; then
    echo "PASS $1"
  else
    echo "FAIL $1: $(echo "$out" | tr '\n' ';')"
    FAILS=$((FAILS + 1))
  fi
}

run_case "1 global fresh" case_global_fresh
run_case "2 global twice" case_global_twice
run_case "3 settings preserved" case_preserve_settings
run_case "4 invalid settings" case_invalid_settings
run_case "5 project fresh" case_project_fresh
run_case "6 project contract" case_project_contract
run_case "7 dry run" case_dry_run
run_case "8a uninstall global" case_uninstall_global
run_case "8b uninstall project" case_uninstall_project
run_case "9 agents only" case_agents_only
run_case "10 backup of modified agent" case_backup_modified_agent
run_case "11 default scope" case_default_scope
run_case "12 hook smoke" case_hook_smoke
run_case "13 missing project dir" case_missing_project_dir
run_case "14 symlinked config" case_symlinked_config
run_case "15 project dir is global config" case_project_is_global
run_case "16 uninstall ignores skip flags" case_uninstall_ignores_skips
run_case "17 reversed markers" case_reversed_markers
run_case "18 CRLF CLAUDE.md" case_crlf
run_case "19 empty project arg" case_empty_project_arg
run_case "20 remote mode" case_remote
run_case "21 project HOME without global dir" case_project_home_no_global

[ "$FAILS" -eq 0 ] || exit 1
