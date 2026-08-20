#!/usr/bin/env python3
"""Servidor local de transcrição do Kiln.

Expõe somente 127.0.0.1 e implementa o pequeno subconjunto da API de
transcrições usado pelo companion. O modelo precisa ser instalado previamente
por ``install-voz.sh``; o processo nunca tenta baixá-lo durante a execução.
"""

import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# faster-whisper/huggingface deve falhar se o modelo não estiver no cache, em
# vez de tentar uma chamada remota quando o avatar for aberto.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

def _modelo_configurado() -> str:
    """Lê o modelo escolhido pelo instalador; env é só compatibilidade local."""
    configuracao = os.path.join(os.path.dirname(__file__), "model")
    try:
        with open(configuracao, encoding="utf-8") as arquivo:
            modelo = arquivo.read().strip()
            if modelo:
                return modelo
    except OSError:
        pass
    return os.environ.get("KILN_WHISPER_MODEL", "small")


MODEL = _modelo_configurado()
PORT = int(os.environ.get("KILN_STT_PORT", "8760"))

# O companion grava no máximo 60 segundos; 25 MiB deixa margem para WebM e
# multipart sem permitir que uma requisição local consuma memória sem limite.
MAX_REQUEST_BODY = 25 * 1024 * 1024
CONNECTION_TIMEOUT_SECONDS = 30
# Transcrição é CPU/memória pesada: uma por vez mantém o servidor previsível.
TRANSCRIPTION_SLOTS = threading.BoundedSemaphore(1)

try:
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]
except ImportError:
    sys.stderr.write(
        "faster-whisper não está instalado no ambiente da voz. "
        "Rode plugin/voice/install-voz.sh.\n"
    )
    sys.exit(3)

try:
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
except Exception as exc:
    sys.stderr.write(
        f"modelo Whisper '{MODEL}' ausente ou inválido: {exc}\n"
        "Rode plugin/voice/install-voz.sh para preparar o modelo.\n"
    )
    sys.exit(4)

sys.stderr.write(f"[kiln-stt] pronto em http://127.0.0.1:{PORT}\n")
sys.stderr.flush()


def _arquivo_do_multipart(body: bytes, content_type: str) -> bytes:
    """Extrai os bytes do campo ``file`` ou usa o corpo cru."""
    if "multipart/form-data" not in content_type or "boundary=" not in content_type:
        return body
    boundary = ("--" + content_type.split("boundary=", 1)[1].strip()).encode()
    for parte in body.split(boundary):
        cabecalho, _, dados = parte.partition(b"\r\n\r\n")
        if b"filename=" in cabecalho and dados:
            return dados.rsplit(b"\r\n", 1)[0]
    return body


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(CONNECTION_TIMEOUT_SECONDS)

    def log_message(self, format, *args):
        pass

    def _json(self, code, obj):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _endpoint_error(self, code=404):
        self._json(code, {"error": "endpoint não encontrado"})

    def _read_body(self):
        raw_size = self.headers.get("Content-Length")
        if raw_size is None:
            self._json(411, {"error": "Content-Length obrigatório"})
            return None
        try:
            size = int(raw_size)
        except (TypeError, ValueError):
            self._json(400, {"error": "Content-Length inválido"})
            return None
        if size < 0:
            self._json(400, {"error": "Content-Length inválido"})
            return None
        if size > MAX_REQUEST_BODY:
            self._json(413, {"error": "corpo da requisição excede o limite"})
            return None
        return self.rfile.read(size)

    def do_GET(self):
        if self.path != "/v1/models":
            self._endpoint_error()
            return
        self._json(200, {"data": [{"id": MODEL}], "status": "ok", "model": MODEL})

    def do_POST(self):
        if self.path != "/v1/audio/transcriptions":
            self._endpoint_error()
            return
        body = self._read_body()
        if body is None:
            return
        audio = _arquivo_do_multipart(body, self.headers.get("Content-Type", ""))
        if not audio:
            self._json(400, {"error": "corpo de áudio vazio"})
            return

        if not TRANSCRIPTION_SLOTS.acquire(blocking=False):
            self._json(429, {"error": "transcrição ocupada"})
            return
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as audio_file:
                audio_file.write(audio)
                tmp = audio_file.name
            segmentos, _info = model.transcribe(tmp, beam_size=1, vad_filter=True)
            texto = "".join(segmento.text for segmento in segmentos).strip()
            self._json(200, {"text": texto})
        except Exception:
            sys.stderr.write("[kiln-stt] falha interna na transcrição\n")
            self._json(500, {"error": "falha interna na transcrição"})
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
            TRANSCRIPTION_SLOTS.release()

    def do_OPTIONS(self):
        self._endpoint_error(405)

    def do_PUT(self):
        self._endpoint_error(405)

    def do_DELETE(self):
        self._endpoint_error(405)

    def do_PATCH(self):
        self._endpoint_error(405)


if __name__ == "__main__":
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError as exc:
        sys.stderr.write(f"[kiln-stt] porta {PORT} ocupada (já rodando?): {exc}\n")
        sys.exit(0)
