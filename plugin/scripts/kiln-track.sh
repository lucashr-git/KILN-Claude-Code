#!/usr/bin/env bash
# Mantém a lista de subagents vivos no runtime privado desta conta/sessão.
set -u
umask 077

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'Kiln: jq é obrigatório para rastrear agentes (instale com: brew install jq).' >&2
  exit 1
fi

in=$(cat 2>/dev/null || true)
jqr() { printf '%s' "$in" | jq -r "$1 // empty" 2>/dev/null; }

safe_name() {
  case "$1" in
    ''|.|..|*[!A-Za-z0-9._-]*)
      printf '%s' "$1" | shasum -a 256 2>/dev/null | cut -d ' ' -f1 ;;
    *) printf '%s' "$1" ;;
  esac
}

EV=$(jqr '.hook_event_name')
SID=$(jqr '.session_id'); SID=${SID:-none}
AID=$(jqr '.agent_id')
ATYPE=$(jqr '.agent_type'); ATYPE=${ATYPE:-agent}
UID_VALUE=$(id -u 2>/dev/null || printf 'unknown')
ROOT="${KILN_RUNTIME_ROOT:-${TMPDIR:-/tmp}/kiln-$UID_VALUE}"
SID_KEY=$(safe_name "$SID")
SESSION_DIR="$ROOT/$SID_KEY"
F="$SESSION_DIR/agents"
LOCK="$ROOT/.track.lock"

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
  return 0
}

release_lock() { rm -f "$LOCK/pid" 2>/dev/null || true; rmdir "$LOCK" 2>/dev/null || true; }

drop() {
  [ -f "$F" ] || return 0
  local tmp
  tmp=$(mktemp "$SESSION_DIR/.agents.XXXXXX" 2>/dev/null) || return 0
  if ! grep -vF "$AID$(printf '\t')" "$F" > "$tmp" 2>/dev/null; then : > "$tmp"; fi
  mv -f "$tmp" "$F" 2>/dev/null || rm -f "$tmp"
}

add() {
  local tmp
  tmp=$(mktemp "$SESSION_DIR/.agents.XXXXXX" 2>/dev/null) || return 0
  if [ -f "$F" ]; then
    if ! grep -vF "$AID$(printf '\t')" "$F" > "$tmp" 2>/dev/null; then : > "$tmp"; fi
  fi
  printf '%s\t%s\t%s\n' "$AID" "$ATYPE" "$(date +%s)" >> "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
  mv -f "$tmp" "$F" 2>/dev/null || rm -f "$tmp"
}

pid_vivo() {
  local dir="$1" pid
  pid=$(cat "$dir/pid" 2>/dev/null || true)
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null
}

prune_stale() {
  local dir
  for dir in "$ROOT"/*; do
    [ -d "$dir" ] || continue
    # Uma sessão viva pode estar sem eventos recentes; PID é a autoridade,
    # nunca a idade do arquivo agents.
    if pid_vivo "$dir"; then continue; fi
    rm -f "$dir/agents" "$dir"/*.ask "$dir"/*.ans "$dir"/stt.log 2>/dev/null || true
  done
}

wipe() {
  # Não trunque o tracking de uma sessão viva, inclusive quando outro Claude
  # inicia ou termina. Só sessões cujo companion PID morreu são limpas.
  prune_stale
}

with_lock() {
  acquire_lock || return 0
  "$@"
  release_lock
}

case "$EV" in
  SubagentStart) [ -n "$AID" ] && with_lock add ;;
  SubagentStop)  [ -n "$AID" ] && with_lock drop ;;
  SessionStart|SessionEnd) with_lock wipe ;;
esac
exit 0
