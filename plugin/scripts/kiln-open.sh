#!/usr/bin/env bash
# Sobe UM avatar para ESTA sessão. Não instala nem baixa Electron em
# SessionStart: só usa um binário já presente.
set -u
umask 077

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'Kiln: jq é obrigatório para abrir o companion (instale com: brew install jq).' >&2
  exit 1
fi

in=$(cat 2>/dev/null || true)
jqr() { printf '%s' "$in" | jq -r "$1 // empty" 2>/dev/null; }
safe_name() {
  case "$1" in
    ''|.|..|*[!A-Za-z0-9._-]*) printf '%s' "$1" | shasum -a 256 2>/dev/null | cut -d ' ' -f1 ;;
    *) printf '%s' "$1" ;;
  esac
}

SID=$(jqr '.session_id'); SID=${SID:-avulsa}
CWD=$(jqr '.cwd'); CWD=${CWD:-$PWD}
LABEL=$(basename "$CWD")
SID_KEY=$(safe_name "$SID")
UID_VALUE=$(id -u 2>/dev/null || printf 'unknown')
ROOT="${KILN_RUNTIME_ROOT:-${TMPDIR:-/tmp}/kiln-$UID_VALUE}"
SESSION_DIR="$ROOT/$SID_KEY"
PIDFILE="$SESSION_DIR/pid"
BOOTFILE="$SESSION_DIR/.boot"
LOCK="$ROOT/.open.lock"

# onde está o companion? tenta o plugin primeiro, depois a instalação clássica
APP=""
for cand in "${CLAUDE_PLUGIN_ROOT:-}/companion" "$HOME/.claude/kiln" "$HOME/.claude/skills/kiln/companion"; do
  [ -n "$cand" ] && [ -f "$cand/main.js" ] && { APP="$cand"; break; }
done
[ -n "$APP" ] || exit 0

ELECTRON="$APP/node_modules/.bin/electron"
[ -x "$ELECTRON" ] || ELECTRON="$HOME/.claude/kiln/node_modules/.bin/electron"
[ -x "$ELECTRON" ] || exit 0

mkdir -p "$SESSION_DIR" 2>/dev/null || exit 0
chmod 700 "$ROOT" "$SESSION_DIR" 2>/dev/null || true

acquire_lock() {
  local i=0 owner
  while ! mkdir "$LOCK" 2>/dev/null; do
    owner=$(cat "$LOCK/pid" 2>/dev/null || true)
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rmdir "$LOCK" 2>/dev/null || true
      continue
    fi
    [ "$i" -ge 20 ] && return 1
    sleep 0.05
    i=$((i + 1))
  done
  printf '%s\n' "$$" > "$LOCK/pid" 2>/dev/null || { rmdir "$LOCK" 2>/dev/null || true; return 1; }
}
release_lock() { rm -f "$LOCK/pid" 2>/dev/null || true; rmdir "$LOCK" 2>/dev/null || true; }

launch_once() {
  local old tmp child log="$SESSION_DIR/companion.log"
  if [ -f "$PIDFILE" ]; then
    old=$(cat "$PIDFILE" 2>/dev/null || true)
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then return 0; fi
    rm -f "$PIDFILE"
  fi

  # O pid só passa a significar "pronto" depois de o main limpar pedidos.
  # Enquanto ele inicializa, o marcador impede que outro SessionStart lance
  # uma segunda janela.
  if [ -f "$BOOTFILE" ]; then
    if [ "$(find "$BOOTFILE" -mmin -1 2>/dev/null)" ]; then return 0; fi
    rm -f "$BOOTFILE"
  fi

  cd "$APP" || return 0
  printf '%s\n' "$$" > "$BOOTFILE" 2>/dev/null || return 0
  KILN_SESSION="$SID" KILN_LABEL="$LABEL" KILN_PARENT_PID="$PPID" \
    KILN_RUNTIME_ROOT="$ROOT" KILN_RUNTIME_DIR="$SESSION_DIR" \
    nohup "$ELECTRON" . >>"$log" 2>&1 &
  child=$!

  # O main grava PIDFILE somente depois do cleanup de startup. O marcador é
  # removido pelo main quando a sessão realmente está pronta.
}

acquire_lock || exit 0
launch_once
release_lock
exit 0
