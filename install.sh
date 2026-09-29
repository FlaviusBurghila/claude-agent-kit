#!/usr/bin/env bash
# claude-agent-kit installer. Run `install.sh --help` for usage; README.md explains
# what each component does. Everything it overwrites, rewrites or deletes is backed
# up first, and --dry-run shows every action without taking one.
#
# Portable to macOS /bin/bash 3.2 and Linux bash 5: no associative arrays, no
# mapfile, no sed -i, no readlink -f, no arrays at all.
set -euo pipefail

KIT_REPO="${KIT_REPO:-FlaviusBurghila/claude-agent-kit}"
KIT_REF="${KIT_REF:-main}"

AGENTS="builder bulk-reader code-writer debugger refuter researcher scout"
KIT_FILES="orchestration.md agent-contract.template.md CLAUDE.template.md hooks/shunt.js"
BEGIN='<!-- claude-agent-kit:begin -->'
END='<!-- claude-agent-kit:end -->'

usage() {
  cat <<'EOF'
Usage: install.sh [--global | --project [DIR]] [--no-hook] [--no-claude-md]
                  [--agents-only] [--dry-run] [--uninstall] [-h|--help]

  --global          install into ${CLAUDE_CONFIG_DIR:-~/.claude}
  --project [DIR]   install into DIR/.claude (DIR defaults to the current directory)
  --no-hook         do not add the read-budget hook to settings.json
  --no-claude-md    do not touch CLAUDE.md (no orchestration import, no contract scaffold)
  --agents-only     agents and agent-kit files only: no hook, no CLAUDE.md block, no .gitignore line
  --dry-run         print every action, change nothing
  --uninstall       remove everything install added (combine with --global or --project;
                    ignores --no-hook, --no-claude-md and --agents-only)

With no scope flag, asks on a terminal and otherwise installs globally.
Environment: KIT_REPO (default FlaviusBurghila/claude-agent-kit) and KIT_REF
(default main) select the source when run through curl | bash.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

# ---- arguments --------------------------------------------------------------
SCOPE=""
DIR=""
DIR_GIVEN=0
AGENTS_ONLY=0
DO_HOOK=1
DO_MD=1
DRY=0
UNINSTALL=0

set_scope() {
  if [ -n "$SCOPE" ] && [ "$SCOPE" != "$1" ]; then
    die "--global and --project are mutually exclusive"
  fi
  SCOPE="$1"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --global) set_scope global ;;
    --project)
      set_scope project
      if [ $# -gt 1 ]; then
        case "$2" in
          -*) ;;
          *)
            DIR="$2"
            DIR_GIVEN=1
            shift
            ;;
        esac
      fi
      ;;
    --no-hook) DO_HOOK=0 ;;
    --no-claude-md) DO_MD=0 ;;
    --agents-only)
      AGENTS_ONLY=1
      DO_HOOK=0
      DO_MD=0
      ;;
    --dry-run) DRY=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

if [ "$UNINSTALL" = 1 ]; then
  DO_HOOK=1
  DO_MD=1
  AGENTS_ONLY=0
fi

# ---- scratch space, removed on exit ------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/claude-agent-kit.XXXXXX")" || die "cannot create a temporary directory"
SRC_TMP=""
cleanup() {
  rm -rf "$WORK"
  if [ -n "$SRC_TMP" ]; then rm -rf "$SRC_TMP"; fi
}
trap cleanup EXIT

# ---- scope ------------------------------------------------------------------
if [ -z "$SCOPE" ]; then
  if ( : </dev/tty ) 2>/dev/null && [ -t 1 ]; then
    printf 'Install for all projects (g) or this project %s (p)? [g] ' "$PWD"
    ans=""
    read -r ans </dev/tty || ans=""
    case "$ans" in
      "" | g | G) SCOPE=global ;;
      p | P) SCOPE=project ;;
      *) die "answer g or p" ;;
    esac
  else
    SCOPE=global
    echo "No scope given and no terminal to ask: defaulting to --global."
  fi
fi

if [ "$SCOPE" = project ]; then
  if [ "$DIR_GIVEN" = 1 ] && [ -z "$DIR" ]; then die "--project needs a directory, got an empty string"; fi
  [ -n "$DIR" ] || DIR="$PWD"
  [ -d "$DIR" ] || die "project directory does not exist: $DIR"
  DIR="$(cd "$DIR" && pwd -P)"
  BASE="$DIR/.claude"
  # Compare physical paths even when one of them does not exist yet.
  GLOBAL_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -d "$GLOBAL_DIR" ]; then
    GLOBAL_PHYS="$(cd "$GLOBAL_DIR" && pwd -P)"
  else
    GLOBAL_PARENT="$(dirname "$GLOBAL_DIR")"
    if [ -d "$GLOBAL_PARENT" ]; then GLOBAL_PARENT="$(cd "$GLOBAL_PARENT" && pwd -P)"; fi
    GLOBAL_PHYS="$GLOBAL_PARENT/$(basename "$GLOBAL_DIR")"
  fi
  BASE_PHYS="$BASE"
  if [ -d "$BASE" ]; then BASE_PHYS="$(cd "$BASE" && pwd -P)"; fi
  if [ "$BASE_PHYS" = "$GLOBAL_PHYS" ]; then
    die "$BASE is the global Claude config directory: use --global, or pick another project directory"
  fi
else
  BASE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
fi

# ---- prerequisites -----------------------------------------------------------
ver_num() { # X.Y.Z -> integer
  local a b c
  IFS=. read -r a b c <<<"$1"
  echo $((a * 1000000 + b * 1000 + c))
}
ver_lt() { [ "$(ver_num "$1")" -lt "$(ver_num "$2")" ]; }

echo "Prerequisites:"
case "$(uname -s)" in
  Darwin | Linux) echo "  ✓ OS $(uname -s)" ;;
  *) die "unsupported OS $(uname -s): use WSL on Windows" ;;
esac

NEED_NODE=0
if [ "$DO_HOOK" = 1 ]; then
  if [ "$UNINSTALL" = 0 ] || [ -f "$BASE/settings.json" ]; then NEED_NODE=1; fi
fi
if [ "$NEED_NODE" = 1 ]; then
  if command -v node >/dev/null 2>&1 && node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; then
    echo "  ✓ Node.js $(node --version)"
  else
    die "Node.js 18+ is required for the read-budget hook: install Node.js 18+ or re-run with --no-hook"
  fi
else
  echo "  ✓ Node.js not needed for this run"
fi

if [ "$UNINSTALL" = 0 ]; then
  if command -v claude >/dev/null 2>&1; then
    CLAUDE_VER="$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
    if [ -z "$CLAUDE_VER" ]; then
      echo "  ! Claude Code found but its version could not be read"
    else
      echo "  ✓ Claude Code $CLAUDE_VER"
      if ver_lt "$CLAUDE_VER" 2.1.293; then
        echo "  ! Claude Code < 2.1.293: on the Anthropic API the 'haiku' alias means Haiku 5.5 only from 2.1.293 ('sonnet' means Sonnet 5.5 from 2.1.284)"
      fi
      if ver_lt "$CLAUDE_VER" 2.1.246; then
        echo "  ! Claude Code < 2.1.246: maxTurns partial results need 2.1.246"
      fi
    fi
  else
    echo "  ! Claude Code not found on PATH (install: https://code.claude.com/docs/en/setup)"
  fi
fi

# ---- source ------------------------------------------------------------------
SRC=""
if [ "$UNINSTALL" = 0 ]; then
  if [ -f "$0" ] && [ -d "$(dirname "$0")/agents" ]; then
    SRC="$(cd "$(dirname "$0")" && pwd -P)"
  else
    command -v curl >/dev/null 2>&1 || die "curl is required to download the kit: install curl or clone the repository and run ./install.sh"
    command -v tar >/dev/null 2>&1 || die "tar is required to unpack the kit"
    echo "  ✓ curl, tar"
    SRC_TMP="$(mktemp -d "${TMPDIR:-/tmp}/claude-agent-kit-src.XXXXXX")" || die "cannot create a temporary directory"
    echo "Downloading $KIT_REPO@$KIT_REF ..."
    curl -fsSL "https://codeload.github.com/$KIT_REPO/tar.gz/$KIT_REF" | tar -xz -C "$SRC_TMP" ||
      die "could not download or unpack https://codeload.github.com/$KIT_REPO/tar.gz/$KIT_REF"
    for d in "$SRC_TMP"/*/; do
      SRC="${d%/}"
      break
    done
    if [ -z "$SRC" ] || [ ! -d "$SRC/agents" ]; then die "downloaded archive has no agents/ directory"; fi
  fi
  for a in $AGENTS; do
    [ -f "$SRC/agents/$a.md" ] || die "missing in the kit: agents/$a.md"
  done
  for f in $KIT_FILES; do
    [ -f "$SRC/agent-kit/$f" ] || die "missing in the kit: agent-kit/$f"
  done
fi

# Uninstall never downloads; a local checkout lets it tell modified agents from kit copies.
if [ "$UNINSTALL" = 1 ] && [ -f "$0" ] && [ -d "$(dirname "$0")/agents" ]; then
  SRC="$(cd "$(dirname "$0")" && pwd -P)"
fi

# ---- hook command, settings and CLAUDE.md targets ------------------------------
if [ "$SCOPE" = project ]; then
  # shellcheck disable=SC2016 # the literal $CLAUDE_PROJECT_DIR is expanded by Claude Code, not here
  HOOK_CMD='node "$CLAUDE_PROJECT_DIR/.claude/agent-kit/hooks/shunt.js"'
else
  case "$BASE" in
    "$HOME"/*) HOOK_CMD="node \"\$HOME/${BASE#"$HOME"/}/agent-kit/hooks/shunt.js\"" ;;
    *) HOOK_CMD="node \"$BASE/agent-kit/hooks/shunt.js\"" ;;
  esac
fi

read -r -d '' SETTINGS_JS <<'EOF' || true
const fs = require("fs");
const [mode, file, cmd] = process.argv.slice(1);
const MARK = "agent-kit/hooks/shunt.js";
const fail = (why) => {
  console.error("error: " + file + ": " + why);
  process.exit(1);
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
let text = "{}";
if (fs.existsSync(file)) text = fs.readFileSync(file, "utf8");
let cfg;
try {
  cfg = JSON.parse(text);
} catch (e) {
  fail("not valid JSON (" + e.message + ")");
}
if (!isObj(cfg)) fail("top level is not a JSON object");
const isKit = (h) => isObj(h) && typeof h.command === "string" && h.command.includes(MARK);
const entryHas = (e) => isObj(e) && Array.isArray(e.hooks) && e.hooks.some(isKit);
if (cfg.hooks !== undefined && !isObj(cfg.hooks)) fail('"hooks" is not an object');
if (cfg.hooks && cfg.hooks.PreToolUse !== undefined && !Array.isArray(cfg.hooks.PreToolUse)) {
  fail('"hooks.PreToolUse" is not an array');
}
if (mode === "install") {
  if (cfg.hooks === undefined) cfg.hooks = {};
  if (cfg.hooks.PreToolUse === undefined) cfg.hooks.PreToolUse = [];
  const fresh = { type: "command", command: cmd, timeout: 10 };
  const entry = cfg.hooks.PreToolUse.find(entryHas);
  if (entry) {
    const hook = entry.hooks.find(isKit);
    hook.command = cmd;
    hook.timeout = fresh.timeout;
  } else {
    cfg.hooks.PreToolUse.push({ matcher: "Read|Bash", hooks: [fresh] });
  }
  process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
} else if (!(cfg.hooks && Array.isArray(cfg.hooks.PreToolUse) && cfg.hooks.PreToolUse.some(entryHas))) {
  process.stdout.write(text);
} else {
  const kept = [];
  for (const e of cfg.hooks.PreToolUse) {
    if (!entryHas(e)) {
      kept.push(e);
      continue;
    }
    const rest = e.hooks.filter((h) => !isKit(h));
    if (rest.length) kept.push(Object.assign({}, e, { hooks: rest }));
  }
  if (kept.length) cfg.hooks.PreToolUse = kept;
  else delete cfg.hooks.PreToolUse;
  if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
}
EOF

SETTINGS="$BASE/settings.json"
SETTINGS_NEW="$WORK/settings.new"
if [ "$DO_HOOK" = 1 ] && { [ "$UNINSTALL" = 0 ] || [ -f "$SETTINGS" ]; }; then
  if [ "$UNINSTALL" = 1 ]; then mode=uninstall; else mode=install; fi
  node -e "$SETTINGS_JS" -- "$mode" "$SETTINGS" "$HOOK_CMD" >"$SETTINGS_NEW" || exit 1
fi

# The CLAUDE.md that install writes. Uninstall searches both project locations.
MD_FILE=""
MD_IMPORT=""
MD_FROM_TEMPLATE=0
if [ "$SCOPE" = global ]; then
  MD_FILE="$BASE/CLAUDE.md"
  case "$BASE" in
    "$HOME/.claude") MD_IMPORT='@~/.claude/agent-kit/orchestration.md' ;;
    *) MD_IMPORT="@$BASE/agent-kit/orchestration.md" ;;
  esac
elif [ -f "$DIR/CLAUDE.md" ]; then
  MD_FILE="$DIR/CLAUDE.md"
  MD_IMPORT='@.claude/agent-kit/orchestration.md'
elif [ -f "$DIR/.claude/CLAUDE.md" ]; then
  MD_FILE="$DIR/.claude/CLAUDE.md"
  MD_IMPORT='@agent-kit/orchestration.md'
else
  MD_FILE="$DIR/CLAUDE.md"
  MD_IMPORT='@.claude/agent-kit/orchestration.md'
  MD_FROM_TEMPLATE=1
fi

# Marker lines match with an optional trailing CR, so CRLF files behave.
CR="$(printf '\r')"
RE_BEGIN="^${BEGIN}${CR}?\$"
RE_END="^${END}${CR}?\$"

check_markers() { # file: the managed block must be absent or exactly one well-formed pair, begin first
  local b e bl el
  [ -f "$1" ] || return 0
  b="$(grep -cE "$RE_BEGIN" "$1" || true)"
  e="$(grep -cE "$RE_END" "$1" || true)"
  if [ "$b" != "$e" ] || [ "$b" -gt 1 ]; then
    die "$1 has an unbalanced or duplicated claude-agent-kit block: fix the begin/end markers by hand"
  fi
  if [ "$b" = 1 ]; then
    bl="$(grep -nE "$RE_BEGIN" "$1" | cut -d: -f1)"
    el="$(grep -nE "$RE_END" "$1" | cut -d: -f1)"
    if [ "$el" -lt "$bl" ]; then
      die "$1 has the claude-agent-kit end marker before the begin marker: fix it by hand"
    fi
  fi
}
if [ "$DO_MD" = 1 ]; then
  check_markers "$MD_FILE"
  if [ "$SCOPE" = project ]; then
    check_markers "$DIR/CLAUDE.md"
    check_markers "$DIR/.claude/CLAUDE.md"
  fi
fi

NEW_AGENTS_DIR=0
[ -d "$BASE/agents" ] || NEW_AGENTS_DIR=1

# ---- actions (nothing above this line writes outside $WORK) --------------------
TS="$(date +%Y%m%d-%H%M%S)-$$"
BK_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/backups/claude-agent-kit/$TS"
BACKED_UP=0
CHG=0

TILDE='~'
shown() { # path as displayed: ~/... for global paths under $HOME, relative to DIR for a project
  if [ "$SCOPE" = project ]; then
    echo "${1#"$DIR"/}"
  else
    case "$1" in
      "$HOME"/*) echo "$TILDE/${1#"$HOME"/}" ;;
      *) echo "$1" ;;
    esac
  fi
}

note() {
  if [ "$DRY" = 1 ]; then printf '  would %s\n' "$*"; else printf '  %s\n' "$*"; fi
}

backup() { # abs path (file or directory) under BASE or DIR
  local rel dst
  if [ "$SCOPE" = global ]; then
    rel="global/${1#"$BASE"/}"
  else
    rel="project-$(basename "$DIR")/${1#"$DIR"/}"
  fi
  dst="$BK_ROOT/$rel"
  BACKED_UP=1
  note "back up $(shown "$1")"
  if [ "$DRY" = 0 ]; then
    mkdir -p "$(dirname "$dst")"
    if [ -d "$1" ] && [ ! -L "$1" ]; then cp -Rp "$1" "$dst"; else cp -pL "$1" "$dst"; fi
  fi
}

write_file() { # new-content-file dst verb-if-existing: back up an existing dst, then write
  if [ -e "$2" ]; then
    backup "$2"
    note "$3 $(shown "$2")"
  else
    note "create $(shown "$2")"
  fi
  if [ "$DRY" = 0 ]; then
    mkdir -p "$(dirname "$2")"
    cp "$1" "$2"
  fi
  CHG=1
}

put_file() { # src dst: copy unless identical
  if [ -f "$2" ] && cmp -s "$1" "$2"; then return 0; fi
  write_file "$1" "$2" overwrite
}

state() { # done-verb idle-text
  if [ "$CHG" = 1 ]; then
    if [ "$DRY" = 1 ]; then echo "would be $1"; else echo "$1"; fi
  else
    echo "$2"
  fi
}

ends_with_newline() { [ -z "$(tail -c1 "$1")" ]; }

SCAFFOLD="$WORK/scaffold"
BLOCK="$WORK/block"
cat >"$SCAFFOLD" <<'EOF'
## Agent contract

<!-- Starter lines per stack: .claude/agent-kit/agent-contract.template.md -->

- **Verify:** `<static checks the Builder runs>`
- **Tests:** subagents run none; they name the test files and the main session runs them.
- **Exclude from searches:** `<directories that hold copies or build output>`
- **Read threshold:** 350 lines. Scratch files go to `.claude/tmp/` (gitignored).
EOF

md_install() {
  local cur="$WORK/md.cur" new="$WORK/md.new" want_scaffold=0 verb
  {
    echo "$BEGIN"
    echo "## Orchestration"
    echo
    echo "$MD_IMPORT"
    echo "$END"
  } >"$BLOCK"
  if [ -f "$MD_FILE" ]; then
    cp "$MD_FILE" "$cur"
  elif [ "$MD_FROM_TEMPLATE" = 1 ]; then
    cp "$SRC/agent-kit/CLAUDE.template.md" "$cur"
  else
    : >"$cur"
  fi
  if [ "$SCOPE" = project ] && ! grep -q '^## Agent contract' "$cur"; then want_scaffold=1; fi
  if grep -qE "$RE_BEGIN" "$cur"; then
    verb="update the managed block in"
    awk -v bf="$BLOCK" -v sf="$SCAFFOLD" -v ws="$want_scaffold" -v b="$BEGIN" -v e="$END" '
      { line = $0; sub(/\r$/, "", line) }
      skip == 0 && line == b {
        if (ws == 1) {
          while ((getline l < sf) > 0) print l
          print ""
        }
        while ((getline l < bf) > 0) print l
        skip = 1; next
      }
      skip == 1 { if (line == e) skip = 0; next }
      { print }
    ' "$cur" >"$new"
  else
    verb="append the managed block to"
    {
      cat "$cur"
      if [ -s "$cur" ]; then
        ends_with_newline "$cur" || echo
        echo
      fi
      if [ "$want_scaffold" = 1 ]; then
        cat "$SCAFFOLD"
        echo
      fi
      cat "$BLOCK"
    } >"$new"
  fi
  if [ -f "$MD_FILE" ] && cmp -s "$new" "$MD_FILE"; then return 0; fi
  write_file "$new" "$MD_FILE" "$verb"
}

md_uninstall() { # file
  local new="$WORK/md.new"
  if [ ! -f "$1" ] || ! grep -qE "$RE_BEGIN" "$1"; then return 0; fi
  awk -v b="$BEGIN" -v e="$END" '
    { line = $0; sub(/\r$/, "", line) }
    skip == 0 && line == b { skip = 1; next }
    skip == 1 { if (line == e) skip = 0; next }
    { print }
  ' "$1" >"$new"
  write_file "$new" "$1" "remove the managed block from"
}

gitignore_install() {
  local gi="$DIR/.gitignore" new="$WORK/gitignore.new"
  if ! git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "  skipped .gitignore: $DIR is not a git work tree"
    return 0
  fi
  if [ -f "$gi" ] && grep -qxF '.claude/tmp/' "$gi"; then return 0; fi
  {
    if [ -s "$gi" ]; then
      cat "$gi"
      ends_with_newline "$gi" || echo
    fi
    echo '.claude/tmp/'
  } >"$new"
  write_file "$new" "$gi" "append .claude/tmp/ to"
}

remove_path() { # file-or-dir [suffix]: always backed up first
  backup "$1"
  note "remove $(shown "$1")${2:+ $2}"
  if [ "$DRY" = 0 ]; then rm -rf "$1"; fi
  CHG=1
}

echo
if [ "$SCOPE" = project ]; then ROOT_SHOWN="$DIR"; else ROOT_SHOWN="$(shown "$BASE")"; fi
if [ "$UNINSTALL" = 1 ]; then echo "Uninstalling from $ROOT_SHOWN:"; else echo "Installing into $ROOT_SHOWN:"; fi
if [ "$DRY" = 1 ]; then echo "(dry run: nothing will be changed)"; fi

if [ "$UNINSTALL" = 0 ]; then
  CHG=0
  for a in $AGENTS; do put_file "$SRC/agents/$a.md" "$BASE/agents/$a.md"; done
  S_AGENTS="$(state installed 'up to date')"

  CHG=0
  for f in $KIT_FILES; do put_file "$SRC/agent-kit/$f" "$BASE/agent-kit/$f"; done
  S_KIT="$(state installed 'up to date')"

  S_MD="skipped"
  if [ "$DO_MD" = 1 ]; then
    CHG=0
    md_install
    S_MD="$(state installed 'up to date')"
  fi

  S_IGN="n/a"
  if [ "$SCOPE" = project ] && [ "$AGENTS_ONLY" = 0 ]; then
    CHG=0
    gitignore_install
    S_IGN="$(state updated 'up to date')"
  fi

  S_HOOK="skipped"
  if [ "$DO_HOOK" = 1 ]; then
    CHG=0
    if [ -f "$SETTINGS" ] && cmp -s "$SETTINGS_NEW" "$SETTINGS"; then
      :
    elif [ -f "$SETTINGS" ]; then
      write_file "$SETTINGS_NEW" "$SETTINGS" "merge the read-budget hook into"
    else
      write_file "$SETTINGS_NEW" "$SETTINGS" "create"
    fi
    S_HOOK="$(state installed 'up to date')"
  fi
else
  CHG=0
  for a in $AGENTS; do
    if [ -f "$BASE/agents/$a.md" ]; then
      if [ -n "$SRC" ] && ! cmp -s "$SRC/agents/$a.md" "$BASE/agents/$a.md"; then
        remove_path "$BASE/agents/$a.md" "(modified — backed up)"
      else
        remove_path "$BASE/agents/$a.md"
      fi
    fi
  done
  S_AGENTS="$(state removed 'nothing to remove')"

  CHG=0
  if [ -d "$BASE/agent-kit" ]; then remove_path "$BASE/agent-kit"; fi
  S_KIT="$(state removed 'nothing to remove')"

  S_IGN="n/a"
  S_MD="skipped"
  if [ "$DO_MD" = 1 ]; then
    CHG=0
    md_uninstall "$MD_FILE"
    if [ "$SCOPE" = project ]; then
      if [ "$MD_FILE" != "$DIR/CLAUDE.md" ]; then md_uninstall "$DIR/CLAUDE.md"; fi
      if [ "$MD_FILE" != "$DIR/.claude/CLAUDE.md" ]; then md_uninstall "$DIR/.claude/CLAUDE.md"; fi
    fi
    S_MD="$(state removed 'nothing to remove')"
  fi

  S_HOOK="skipped"
  if [ "$DO_HOOK" = 1 ]; then
    CHG=0
    if [ -f "$SETTINGS" ] && ! cmp -s "$SETTINGS_NEW" "$SETTINGS"; then
      write_file "$SETTINGS_NEW" "$SETTINGS" "remove the read-budget hook from"
    fi
    S_HOOK="$(state removed 'nothing to remove')"
  fi
fi

# ---- summary -----------------------------------------------------------------
echo
if [ "$UNINSTALL" = 1 ]; then echo "Summary (uninstall):"; else echo "Summary:"; fi
echo "  scope:     $SCOPE"
echo "  base:      $BASE"
echo "  agents:    $S_AGENTS"
echo "  kit files: $S_KIT"
echo "  CLAUDE.md: $S_MD"
echo "  hook:      $S_HOOK"
if [ "$SCOPE" = project ]; then echo "  .gitignore: $S_IGN"; fi
if [ "$BACKED_UP" = 1 ]; then
  if [ "$DRY" = 1 ]; then echo "  backups:   would go to $BK_ROOT"; else echo "  backups:   $BK_ROOT"; fi
fi
if [ "$DRY" = 1 ]; then
  echo "Dry run: nothing was changed."
elif [ "$UNINSTALL" = 0 ]; then
  echo
  echo "Next:"
  if [ "$NEW_AGENTS_DIR" = 1 ]; then echo "  - Restart Claude Code to load the new agents."; fi
  if [ "$DO_MD" = 1 ]; then
    if [ "$SCOPE" = project ]; then
      echo "  - Fill in '## Agent contract' in $MD_FILE."
    else
      echo "  - In each project, copy '## Agent contract' from $BASE/agent-kit/agent-contract.template.md into its CLAUDE.md and fill it in."
      echo "  - If Claude Code asks you to approve the CLAUDE.md import, approve it."
    fi
  else
    echo "  - CLAUDE.md was not touched, so the orchestration rules are not loaded. To load them, add"
    echo "    this line to $MD_FILE: $MD_IMPORT"
  fi
fi
