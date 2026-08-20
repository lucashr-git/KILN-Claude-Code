#!/usr/bin/env bash
# Fecha o avatar desta sessão.
set -u
umask 077
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'Kiln: jq é obrigatório para fechar o companion (instale com: brew install jq).' >&2
  exit 1
fi
in=$(cat 2>/dev/null || true)
SID=$(printf '%s' "$in" | jq -r '.session_id // empty' 2>/dev/null)
SID=${SID:-avulsa}

safe_name() {
  case "$1" in
    ''|.|..|*[!A-Za-z0-9._-]*) printf '%s' "$1" | shasum -a 256 2>/dev/null | cut -d ' ' -f1 ;;
    *) printf '%s' "$1" ;;
  esac
}
UID_VALUE=$(id -u 2>/dev/null || printf 'unknown')
ROOT="${KILN_RUNTIME_ROOT:-${TMPDIR:-/tmp}/kiln-$UID_VALUE}"
SESSION_DIR="$ROOT/$(safe_name "$SID")"
PIDFILE="$SESSION_DIR/pid"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE" 2>/dev/null || true)
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  rm -f "$PIDFILE"
fi
rm -f "$SESSION_DIR/agents" "$SESSION_DIR"/*.ask "$SESSION_DIR"/*.ans 2>/dev/null || true

exit 0
