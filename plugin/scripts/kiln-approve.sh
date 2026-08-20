#!/usr/bin/env bash
# Hook PreToolUse: uma aprovação, um requestId e um nonce por pedido.
set -u
umask 077

in=$(cat 2>/dev/null || true)
jqr() { printf '%s' "$in" | jq -r "$1 // empty" 2>/dev/null; }
deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"aprovação Kiln expirou ou falhou"}}\n'
  exit 0
}
if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'Kiln: jq é obrigatório para aprovação; instale com: brew install jq.' >&2
  deny
fi

TOOL=$(jqr '.tool_name'); TOOL=${TOOL:-?}
SID=$(jqr '.session_id')
MODE=$(jqr '.permission_mode')
TOOL_USE_ID=$(jqr '.tool_use_id')

case "$TOOL" in Bash|Write|Edit|MultiEdit|NotebookEdit) ;; *) exit 0 ;; esac
case "$MODE" in acceptEdits|bypassPermissions) exit 0 ;; esac
[ -n "$SID" ] || deny

safe_name() {
  case "$1" in
    ''|.|..|*[!A-Za-z0-9._-]*) printf '%s' "$1" | shasum -a 256 2>/dev/null | cut -d ' ' -f1 ;;
    *) printf '%s' "$1" ;;
  esac
}
UID_VALUE=$(id -u 2>/dev/null || printf 'unknown')
ROOT="${KILN_RUNTIME_ROOT:-${TMPDIR:-/tmp}/kiln-$UID_VALUE}"
SESSION_DIR="$ROOT/$(safe_name "$SID")"
mkdir -p "$SESSION_DIR" 2>/dev/null || deny
chmod 700 "$ROOT" "$SESSION_DIR" 2>/dev/null || true

PIDF="$SESSION_DIR/pid"
PID=$(cat "$PIDF" 2>/dev/null || true)
if ! kill -0 "$PID" 2>/dev/null && [ -f "$SESSION_DIR/.boot" ]; then
  # O companion só publica PIDF depois do cleanup de startup. Aguarde essa
  # transição curta em vez de criar um pedido enquanto ele ainda inicializa.
  n=0
  while [ "$n" -lt 50 ]; do
    PID=$(cat "$PIDF" 2>/dev/null || true)
    if kill -0 "$PID" 2>/dev/null; then break; fi
    sleep 0.1
    n=$((n + 1))
  done
fi
kill -0 "$PID" 2>/dev/null || deny

nonce() {
  if [ -r /dev/urandom ]; then
    od -An -N32 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n'
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 2>/dev/null
  fi
}
NONCE=$(nonce)
[ "${#NONCE}" -eq 64 ] || deny
case "$NONCE" in *[!0-9a-f]*) deny ;; esac

REQUEST_ID="r-${NONCE:0:24}-$$-${RANDOM:-0}-$(date +%s)"
case "$REQUEST_ID" in *[!A-Za-z0-9._-]*) deny ;; esac
ASK="$SESSION_DIR/$REQUEST_ID.ask"
ANS="$SESSION_DIR/$REQUEST_ID.ans"
TMP_ASK=""
cleanup() { [ -n "$TMP_ASK" ] && rm -f "$TMP_ASK"; rm -f "$ASK" "$ANS"; }
trap cleanup EXIT INT TERM

RESUMO=$(printf '%s' "$in" | jq -r '
  .tool_input.command // .tool_input.file_path // .tool_input.url //
  (.tool_input | tostring)' 2>/dev/null | tr '\n' ' ' | cut -c1-220)
LIMITE=${KILN_APPROVE_TIMEOUT:-110}
case "$LIMITE" in ''|*[!0-9]*) LIMITE=110 ;; esac
NOW=$(date +%s)
EXPIRES_AT=$(( (NOW + LIMITE) * 1000 ))

TMP_ASK=$(mktemp "$SESSION_DIR/.ask.XXXXXX" 2>/dev/null) || deny
jq -n --arg id "$REQUEST_ID" --arg nonce "$NONCE" --arg tool "$TOOL" \
  --arg resumo "$RESUMO" --arg toolUseId "$TOOL_USE_ID" \
  --argjson expiresAt "$EXPIRES_AT" \
  '{id:$id,requestId:$id,nonce:$nonce,tool:$tool,resumo:$resumo,toolUseId:$toolUseId,expiresAt:$expiresAt}' \
  > "$TMP_ASK" 2>/dev/null || deny
mv -f "$TMP_ASK" "$ASK" 2>/dev/null || deny
TMP_ASK=""

LIMITE_TICKS=$((LIMITE * 10))
i=0
while [ "$i" -lt "$LIMITE_TICKS" ]; do
  if [ -f "$ANS" ]; then
    R=$(jq -r '.requestId // empty' "$ANS" 2>/dev/null)
    N=$(jq -r '.nonce // empty' "$ANS" 2>/dev/null)
    D=$(jq -r '.decisao // empty' "$ANS" 2>/dev/null)
    [ "$R" = "$REQUEST_ID" ] && [ "$N" = "$NONCE" ] || deny
    case "$D" in
      allow) printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"aprovado no avatar Kiln"}}\n'; exit 0 ;;
      deny) deny ;;
      *) deny ;;
    esac
  fi
  [ "$(date +%s)" -ge "$((NOW + LIMITE))" ] && deny
  sleep 0.1
  i=$((i + 1))
done
deny
