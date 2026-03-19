"""
scripts_status.py — Procesos programados + Log en vivo + Docs + Análisis IA
Sesión 13: Ollama (gemma2:2b)
Sesión 14: Gemini Flash + selector de proveedor desde Config → IA (BD via cfg())

Proveedor activo: cfg("ai_provider")  →  "gemini" | "ollama"
API key Gemini:   cfg("ai_gemini_key")
Modelo Gemini:    cfg("ai_gemini_model")
"""

import os
import json
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException

router = APIRouter()

# ── Directorios ───────────────────────────────────────────────────────────────
SCRIPTS_STATUS_DIR   = os.getenv("SCRIPTS_STATUS_DIR",   "/data/scripts_status")
SCRIPTS_PROMPTS_DIR  = os.getenv("SCRIPTS_PROMPTS_DIR",  "/data/scripts_prompts")
SCRIPTS_AUDITDOC_DIR = os.getenv("SCRIPTS_AUDITDOC_DIR", "/data/auditor_docs")

# ── Fallbacks de entorno (usados antes de que cfg() cargue la BD) ─────────────
_ENV_PROVIDER     = os.getenv("AI_PROVIDER",    "gemini")
_ENV_GEMINI_KEY   = os.getenv("GEMINI_API_KEY", "")
_ENV_GEMINI_MODEL = os.getenv("GEMINI_MODEL",   "gemini-2.0-flash")
_ENV_OLLAMA_URL   = os.getenv("OLLAMA_URL",     "http://localhost:11434")
_ENV_OLLAMA_MODEL = os.getenv("OLLAMA_MODEL",   "gemma2:2b")

# ── Whitelist docs ────────────────────────────────────────────────────────────
PROCESS_DOCS = {"PROMPT.md", "PROMPT para nuevo script.md", "PROMPT para dashboard.md"}
README_DOCS  = {"README.md"}
ALLOWED_DOCS = PROCESS_DOCS | README_DOCS


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: leer config dinámica desde BD (con fallback a .env)
# ─────────────────────────────────────────────────────────────────────────────

def _ai_provider() -> str:
    try:
        from config import cfg
        return cfg("ai_provider", _ENV_PROVIDER).lower()
    except Exception:
        return _ENV_PROVIDER.lower()

def _gemini_key() -> str:
    try:
        from config import cfg
        return cfg("ai_gemini_key", _ENV_GEMINI_KEY)
    except Exception:
        return _ENV_GEMINI_KEY

def _gemini_model() -> str:
    try:
        from config import cfg
        return cfg("ai_gemini_model", _ENV_GEMINI_MODEL)
    except Exception:
        return _ENV_GEMINI_MODEL

def _ollama_url() -> str:
    return _ENV_OLLAMA_URL

def _ollama_model() -> str:
    return _ENV_OLLAMA_MODEL


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de ficheros
# ─────────────────────────────────────────────────────────────────────────────

def _status_dir() -> Path:
    return Path(SCRIPTS_STATUS_DIR)

def _read_status_files() -> list[dict]:
    d = _status_dir()
    if not d.exists():
        return []
    results = []
    for f in sorted(d.glob("*.status.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            data.setdefault("_file", f.name)
            results.append(data)
        except Exception:
            pass
    return results

def _script_name_from_file(filename: str) -> str:
    return filename.replace(".status.json", "")

def _find_log_file(name: str) -> Path | None:
    d = _status_dir()
    for ext in [".log", f".{name}.log"]:
        p = d / f"{name}{ext}"
        if p.exists():
            return p
    candidates = list(d.glob(f"*{name}*.log"))
    return candidates[0] if candidates else None

def _tail_file(path: Path, lines: int = 100) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            if size == 0:
                return ""
            buf = bytearray()
            found = 0
            pos = size
            chunk = 4096
            while pos > 0 and found <= lines:
                read_size = min(chunk, pos)
                pos -= read_size
                f.seek(pos)
                buf[:0] = f.read(read_size)
                found = buf.count(b"\n")
            text = buf.decode("utf-8", errors="replace")
            return "\n".join(text.splitlines()[-lines:])
    except Exception as e:
        return f"[Error leyendo log: {e}]"


# ─────────────────────────────────────────────────────────────────────────────
# Prompt
# ─────────────────────────────────────────────────────────────────────────────

def _build_analysis_prompt(script_name: str, status: dict, log_tail: str) -> str:
    last_run  = status.get("start_time", status.get("last_run", "desconocido"))
    duration  = status.get("duration_seconds", "?")
    exit_code = status.get("exit_code", "?")
    state     = status.get("status",    status.get("state", "?"))
    errors    = status.get("error_messages", status.get("errors", []))
    error_txt = "\n".join(str(e) for e in errors) if errors else "ninguno"
    step      = status.get("step_label", "")
    progress  = status.get("progress_pct", "")

    return f"""Eres un asistente de sistemas Linux. Analiza el siguiente log de un script automatizado del servidor y responde SIEMPRE en español.

=== SCRIPT: {script_name} ===
Estado: {state}
Última ejecución: {last_run}
Duración: {duration}s
Código de salida: {exit_code}
Errores detectados: {error_txt}

=== ÚLTIMAS LÍNEAS DEL LOG ===
{log_tail}

=== INSTRUCCIONES ===
Responde con exactamente estas 3 secciones en formato Markdown:

## ¿Qué ocurrió?
(2-3 frases: qué hizo el script y si hubo algún problema)

## Causa probable
(La causa más probable del comportamiento o error)

## Sugerencia
(Una recomendación concreta y accionable)

Sé directo y conciso. No repitas el log textualmente."""


# ─────────────────────────────────────────────────────────────────────────────
# Proveedor: Gemini
# ─────────────────────────────────────────────────────────────────────────────

def _gemini_generate(prompt: str) -> str:
    key   = _gemini_key()
    model = _gemini_model()

    if not key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY no configurada. Guárdala en Config → IA o en el .env."
        )

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={key}"
    )
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512},
    }).encode("utf-8")

    req = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Gemini error {e.code}: {body[:300]}")
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f"Gemini no accesible: {e.reason}")
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Respuesta inesperada de Gemini: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error llamando a Gemini: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Proveedor: Ollama
# ─────────────────────────────────────────────────────────────────────────────

def _ollama_generate(prompt: str) -> str:
    payload = json.dumps({
        "model": _ollama_model(),
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 256},
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{_ollama_url()}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("response", "").strip()
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f"Ollama no disponible: {e.reason}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error llamando a Ollama: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Router IA
# ─────────────────────────────────────────────────────────────────────────────

def _ai_generate(prompt: str) -> tuple[str, str]:
    """Devuelve (texto_respuesta, modelo_usado)."""
    provider = _ai_provider()
    if provider == "gemini":
        return _gemini_generate(prompt), _gemini_model()
    elif provider == "ollama":
        return _ollama_generate(prompt), _ollama_model()
    else:
        raise HTTPException(
            status_code=500,
            detail=f"ai_provider desconocido: '{provider}'. Usa 'gemini' u 'ollama'."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints — scripts
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/scripts/status")
def get_scripts_status():
    items = _read_status_files()
    result = []
    for item in items:
        name = _script_name_from_file(item.get("_file", ""))
        item["name"] = name

        # ── Normalizar campos reales del .status.json ──────────────────────
        # Los scripts usan: status, start_time, end_time, error, error_messages
        # El frontend espera: state, last_run, next_run, errors

        # state — exit_code es la fuente de verdad.
        # "error: true" en el JSON puede aparecer aunque el script completó OK
        # (p.ej. monitor_end_error con exit_code=0 cuando hay cambios detectados).
        if "state" not in item:
            raw_status = item.get("status", "")
            ec         = item.get("exit_code")
            if raw_status in ("running", "started"):
                item["state"] = "running"
            elif ec == 0:
                # exit_code 0 = OK siempre, independientemente del campo "error"
                item["state"] = "ok"
            elif ec is not None and ec != 0:
                item["state"] = "error"
            elif raw_status in ("failed", "error"):
                item["state"] = "error"
            elif raw_status == "completed":
                item["state"] = "ok"
            else:
                item["state"] = "unknown"

        # last_run — usar start_time si no hay last_run
        if not item.get("last_run") and item.get("start_time"):
            item["last_run"] = item["start_time"]

        # next_run — calcular desde expected_start si existe
        if not item.get("next_run") and item.get("expected_start"):
            from datetime import datetime, timedelta, timezone
            try:
                h, m   = map(int, item["expected_start"].split(":"))
                now    = datetime.now()
                today  = now.replace(hour=h, minute=m, second=0, microsecond=0)
                # Si ya pasó hoy, será mañana
                if today <= now:
                    today += timedelta(days=1)
                item["next_run"] = today.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                pass

        # errors — usar error_messages, pero filtrar avisos internos del monitor
        # que no son errores reales (aparecen aunque exit_code=0)
        _MONITOR_NOISE = (
            "[MONITOR] WARN:",
            "[MONITOR] ERROR: Ejecución completada con alertas",
        )
        raw_errors = item.get("error_messages", item.get("errors", []))
        real_errors = [
            e for e in raw_errors
            if not any(str(e).startswith(n) for n in _MONITOR_NOISE)
        ]
        item["errors"] = real_errors

        result.append(item)
    return result


@router.get("/api/scripts/log/{name}")
def get_script_log(name: str, lines: int = 100):
    log_path = _find_log_file(name)
    if not log_path:
        raise HTTPException(status_code=404, detail=f"Log no encontrado para '{name}'")
    content = _tail_file(log_path, lines=min(lines, 500))
    return {"name": name, "lines": content, "path": str(log_path)}


@router.get("/api/scripts/docs")
def list_docs():
    d = Path(SCRIPTS_PROMPTS_DIR)
    if not d.exists():
        return []
    return [
        {"name": f.name, "size": f.stat().st_size}
        for f in sorted(d.glob("*.md"))
        if f.name in PROCESS_DOCS
    ]


@router.get("/api/scripts/doc/{filename}")
def get_doc(filename: str):
    if filename not in ALLOWED_DOCS:
        raise HTTPException(status_code=403, detail="Documento no permitido")
    for base in [SCRIPTS_PROMPTS_DIR, SCRIPTS_AUDITDOC_DIR]:
        p = Path(base) / filename
        if p.exists():
            return {"name": filename, "content": p.read_text(encoding="utf-8")}
    raise HTTPException(status_code=404, detail="Documento no encontrado")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint — Análisis IA
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/scripts/analyze/{name}")
def analyze_script_with_ai(name: str, lines: int = 30):
    """Analiza el log con el proveedor IA activo (Gemini o Ollama)."""
    # Status
    status_path = _status_dir() / f"{name}.status.json"
    status = {}
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Log
    log_path = _find_log_file(name)
    log_tail = "(log no disponible)"
    if log_path:
        log_tail = _tail_file(log_path, lines=lines) or "(log vacío)"

    # IA
    prompt = _build_analysis_prompt(name, status, log_tail)
    analysis, model_used = _ai_generate(prompt)

    return {
        "name":           name,
        "provider":       _ai_provider(),
        "model":          model_used,
        "analysis":       analysis,
        "log_lines_used": lines,
        "analyzed_at":    datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint — Estado IA (badge en UI)
# Mantiene nombre /ollama/status para compatibilidad con el frontend existente
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/scripts/ollama/status")
def ai_status():
    provider = _ai_provider()

    if provider == "gemini":
        key   = _gemini_key()
        model = _gemini_model()
        if not key:
            return {"available": False, "provider": "gemini",
                    "model": model, "model_ready": False,
                    "error": "GEMINI_API_KEY no configurada"}
        try:
            url = (
                f"https://generativelanguage.googleapis.com/v1beta/models/"
                f"{model}:generateContent?key={key}"
            )
            payload = json.dumps({
                "contents": [{"parts": [{"text": "ok"}]}],
                "generationConfig": {"maxOutputTokens": 1}
            }).encode("utf-8")
            req = urllib.request.Request(url, data=payload,
                                         headers={"Content-Type": "application/json"},
                                         method="POST")
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
            return {"available": True, "provider": "gemini",
                    "model": model, "model_ready": True}
        except Exception as e:
            return {"available": False, "provider": "gemini",
                    "model": model, "model_ready": False, "error": str(e)}

    else:  # ollama
        url   = _ollama_url()
        model = _ollama_model()
        try:
            req = urllib.request.Request(f"{url}/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                models = [m.get("name", "") for m in data.get("models", [])]
                model_ready = any(model in m for m in models)
                return {"available": True, "provider": "ollama",
                        "model": model, "model_ready": model_ready, "models": models}
        except Exception as e:
            return {"available": False, "provider": "ollama",
                    "model": model, "model_ready": False, "error": str(e)}
