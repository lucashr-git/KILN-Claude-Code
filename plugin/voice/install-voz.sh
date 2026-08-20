#!/usr/bin/env bash
# Instala a transcrição local opcional do Kiln em um ambiente isolado.
# A instalação baixa as dependências e o modelo uma vez; o servidor é offline.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${KILN_STT_DIR:-$HOME/.claude/kiln-stt}"
MODEL="${KILN_WHISPER_MODEL:-small}"

case "$MODEL" in
  base|small|medium|large-v1|large-v2|large-v3|distil-small.en|distil-medium.en|distil-large-v3)
    ;;
  *)
    printf '✗ modelo não suportado pelo instalador: %s\n' "$MODEL" >&2
    exit 2
    ;;
esac

python_version() {
  "$1" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")' 2>/dev/null || true
}

PY="${KILN_PYTHON:-}"
if [ -n "$PY" ]; then
  if [ ! -x "$PY" ]; then
    PY="$(command -v "$PY" || true)"
  fi
else
  for candidate in python3.12 python3.13; do
    candidate_path="$(command -v "$candidate" || true)"
    candidate_version=""
    if [ -n "$candidate_path" ]; then
      candidate_version="$(python_version "$candidate_path")"
    fi
    if [ "$candidate_version" = '3.12' ] || [ "$candidate_version" = '3.13' ]; then
      PY="$candidate_path"
      break
    fi
  done
fi

PY_VERSION=""
if [ -n "$PY" ]; then
  PY_VERSION="$(python_version "$PY")"
fi
if [ "$PY_VERSION" != '3.12' ] && [ "$PY_VERSION" != '3.13' ]; then
  printf '✗ Python 3.12 ou 3.13 é obrigatório para a voz local (Python 3.14 não é suportado).\n' >&2
  printf '  Instale manualmente com: brew install python@3.12\n' >&2
  exit 1
fi

printf '%s\n' '→ Kiln · voz local (Whisper, opcional)'
mkdir -p "$DEST"

VPY="$DEST/venv/bin/python"
if [ -x "$VPY" ]; then
  VPY_VERSION="$(python_version "$VPY")"
  if [ "$VPY_VERSION" != '3.12' ] && [ "$VPY_VERSION" != '3.13' ]; then
    printf '%s\n' '  ambiente Python existente não é 3.12/3.13; recriando…'
    rm -rf "$DEST/venv"
  fi
fi

if [ ! -x "$VPY" ]; then
  printf '%s\n' '  criando ambiente Python isolado…'
  "$PY" -m venv "$DEST/venv"
fi
[ -x "$VPY" ] || { printf '✗ não consegui criar %s\n' "$VPY" >&2; exit 1; }
VPY_VERSION="$(python_version "$VPY")"
if [ "$VPY_VERSION" != '3.12' ] && [ "$VPY_VERSION" != '3.13' ]; then
  printf '✗ o venv criado não usa Python 3.12 ou 3.13\n' >&2
  exit 1
fi

# Permite certificados corporativos sem tornar o servidor dependente deles.
CA=""
for candidate in "${REQUESTS_CA_BUNDLE:-}" "$HOME/.cert/ciandt-ca-bundle.pem" \
  "${NODE_EXTRA_CA_CERTS:-}" "$HOME/.claude/hcss-certs.pem" \
  "/etc/ssl/cert.pem" "/etc/ssl/certs/ca-certificates.crt"; do
  if [ -n "$candidate" ] && [ -f "$candidate" ]; then
    CA="$candidate"
    break
  fi
done
PIP_CERT=()
if [ -n "$CA" ]; then
  export REQUESTS_CA_BUNDLE="$CA" SSL_CERT_FILE="$CA" CURL_CA_BUNDLE="$CA"
  PIP_CERT=(--cert "$CA")
fi

printf '%s\n' '  instalando dependências fixadas…'
"$VPY" -m pip install "${PIP_CERT[@]}" --requirement "$SRC/requirements.txt"

# A validação é deliberadamente feita no venv. Assim, ausência de dependência
# é detectada na instalação, e nunca corrigida com pip quando o servidor roda.
"$VPY" - <<'PY'
from importlib.metadata import version
from faster_whisper import WhisperModel

assert WhisperModel is not None
print(f"  ✓ faster-whisper disponível ({version('faster-whisper')})")
PY

cp "$SRC/kiln-stt-server.py" "$DEST/kiln-stt-server.py"
cp "$SRC/requirements.txt" "$DEST/requirements.txt"

printf "  preparando o modelo '%s' (download único)…\n" "$MODEL"
env -u HF_HUB_OFFLINE -u TRANSFORMERS_OFFLINE \
  KILN_WHISPER_MODEL="$MODEL" "$VPY" - <<'PY'
import os
from faster_whisper import WhisperModel

WhisperModel(os.environ["KILN_WHISPER_MODEL"], device="cpu", compute_type="int8")
print("  ✓ modelo pronto; o servidor usará somente o cache local")
PY

# O servidor é iniciado depois, sem depender do ambiente do instalador.
# Persista a escolha somente depois que o download/validação terminou.
MODEL_TMP="$DEST/.model.$$"
printf '%s\n' "$MODEL" > "$MODEL_TMP"
chmod 600 "$MODEL_TMP"
mv -f "$MODEL_TMP" "$DEST/model"

printf '\n✓ voz local instalada em %s\n' "$DEST"
printf '  ambiente: %s\n' "$VPY"
printf '  servidor: %s %s/kiln-stt-server.py\n' "$VPY" "$DEST"
