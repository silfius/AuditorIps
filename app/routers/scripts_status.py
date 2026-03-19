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
import re
import threading
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from database import db

# ── Debug counters — contadores de llamadas a Gemini ─────────────────────────
_gemini_lock      = threading.Lock()
_gemini_calls     = []   # lista de dicts con info de cada llamada

def _gemini_log(call_type: str, endpoint: str, status: str, extra: str = ""):
    """Registra cada llamada a la API de Gemini con timestamp, tipo y origen."""
    import traceback
    entry = {
        "ts":        datetime.now().isoformat(timespec="seconds"),
        "type":      call_type,   # "generate" | "status_test" | "status_ping"
        "endpoint":  endpoint,
        "status":    status,      # "ok" | "429" | "error:XXX"
        "extra":     extra,
        "stack":     traceback.format_stack(limit=6),
    }
    with _gemini_lock:
        _gemini_calls.append(entry)
        # Mantener solo los últimos 200
        if len(_gemini_calls) > 200:
            _gemini_calls.pop(0)
    print(f"[GEMINI-DEBUG] {entry['ts']} type={call_type} status={status} {extra}", flush=True)

router = APIRouter()

# ── Directorios ───────────────────────────────────────────────────────────────
SCRIPTS_STATUS_DIR   = os.getenv("SCRIPTS_STATUS_DIR",   "/data/scripts_status")
SCRIPTS_PROMPTS_DIR  = os.getenv("SCRIPTS_PROMPTS_DIR",  "/data/scripts_prompts")
SCRIPTS_AUDITDOC_DIR = os.getenv("SCRIPTS_AUDITDOC_DIR", "/data/auditor_docs")

# ── Fallbacks de entorno (usados antes de que cfg() cargue la BD) ─────────────
_ENV_PROVIDER     = os.getenv("AI_PROVIDER",    "gemini")
_ENV_GEMINI_KEY   = os.getenv("GEMINI_API_KEY", "")
_ENV_GEMINI_MODEL  = os.getenv("GEMINI_MODEL",    "gemini-2.0-flash")
_ENV_OLLAMA_URL    = os.getenv("OLLAMA_URL",      "http://localhost:11434")
_ENV_OLLAMA_MODEL  = os.getenv("OLLAMA_MODEL",    "gemma2:2b")
_ENV_MISTRAL_KEY   = os.getenv("MISTRAL_API_KEY", "")
_ENV_MISTRAL_MODEL = os.getenv("MISTRAL_MODEL",   "mistral-small-latest")

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

def _mistral_key() -> str:
    try:
        from config import cfg
        return cfg("ai_mistral_key", _ENV_MISTRAL_KEY)
    except Exception:
        return _ENV_MISTRAL_KEY

def _mistral_model() -> str:
    try:
        from config import cfg
        return cfg("ai_mistral_model", _ENV_MISTRAL_MODEL)
    except Exception:
        return _ENV_MISTRAL_MODEL


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
# Prompt — Extracción rica de datos del log estructurado
# ─────────────────────────────────────────────────────────────────────────────

def _parse_log_executions(log_text: str) -> list:
    """
    Parsea el log estructurado de monitor_lib.sh/py y extrae cada ejecución
    con sus pasos, tiempos por paso, errores y duración total.
    """
    import re
    executions = []
    current = None

    for line in log_text.splitlines():
        # Inicio de ejecución
        m = re.match(r'\[MONITOR\] Inicio: (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
        if m:
            current = {
                "start":    m.group(1),
                "end":      None,
                "duration": None,
                "steps":    [],
                "errors":   [],
                "warnings": [],
                "fin_ok":   False,
            }
            continue

        if current is None:
            continue

        # Paso individual
        m = re.match(r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[PASO (\d+)/(\d+)\] (.+)', line)
        if m:
            current["steps"].append({
                "ts":    m.group(1),
                "num":   int(m.group(2)),
                "total": int(m.group(3)),
                "label": m.group(4),
            })
            continue

        # Fin exitoso
        m = re.match(r'\[MONITOR\] Fin: (\S+ \S+) \| Duración: (\d+)s', line)
        if m:
            current["end"]      = m.group(1)
            current["duration"] = int(m.group(2))
            current["fin_ok"]   = True
            executions.append(current)
            current = None
            continue

        # Error explícito del monitor
        m = re.match(r'\[MONITOR\] ERROR: (.+)', line)
        if m:
            current["errors"].append(m.group(1))
            continue

        # Líneas con ERROR/FATAL que no son del monitor
        if re.search(r'\bERROR\b|\bFATAL\b', line, re.IGNORECASE):
            if "[MONITOR]" not in line:
                current["errors"].append(line.strip())

        # WARN
        if re.search(r'\bWARN\b|\bWARNING\b', line):
            if "[MONITOR] WARN" in line or "[MONITOR]" not in line:
                current["warnings"].append(line.strip())

    # Ejecución sin cerrar (script en marcha o abortado)
    if current:
        executions.append(current)

    return executions


def _format_duration(secs) -> str:
    if secs is None:
        return "?"
    secs = int(secs)
    if secs < 60:
        return f"{secs}s"
    m, s = divmod(secs, 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m"


def _build_analysis_prompt(script_name: str, status: dict, log_text: str) -> str:
    from datetime import datetime as _dt

    # ── Datos del status.json ─────────────────────────────────────────────────
    state      = status.get("status", "?")
    exit_code  = status.get("exit_code")
    duration   = status.get("duration_seconds")
    start_time = status.get("start_time", "?")
    end_time   = status.get("end_time", "?")
    expected   = status.get("expected_start", "")
    raw_errors = status.get("error_messages", [])

    # Distinguir alertas funcionales de errores reales
    is_functional_alert = (status.get("error") is True and exit_code == 0)
    is_real_error       = (status.get("error") is True and exit_code not in (0, None))
    is_missed           = (state == "missed")
    is_stalled          = (state == "stalled")

    # Filtrar ruido interno del monitor
    _NOISE = ("[MONITOR] ERROR: Ejecución completada con alertas",)
    real_error_msgs = [e for e in raw_errors
                       if not any(e.startswith(n) for n in _NOISE)]

    # ── Parseo estructurado del log ───────────────────────────────────────────
    executions = _parse_log_executions(log_text)

    exec_summary_parts = []
    for i, ex in enumerate(executions, 1):
        n_steps = len(ex["steps"])
        total   = ex["steps"][0]["total"] if ex["steps"] else "?"
        dur_str = _format_duration(ex["duration"])
        status_str = "✓ Completada" if ex["fin_ok"] else "✗ Incompleta/abortada"

        # Tiempos por paso (solo los que tardaron > 10s)
        step_times = []
        for j in range(1, len(ex["steps"])):
            try:
                t0 = _dt.strptime(ex["steps"][j-1]["ts"], "%Y-%m-%d %H:%M:%S")
                t1 = _dt.strptime(ex["steps"][j]["ts"],   "%Y-%m-%d %H:%M:%S")
                delta = int((t1 - t0).total_seconds())
                if delta > 10:
                    step_times.append(
                        f"    · {ex['steps'][j-1]['label']}: {_format_duration(delta)}"
                    )
            except Exception:
                pass

        step_list = "\n".join(
            f"  {s['num']}/{s['total']}: {s['label']}" for s in ex["steps"]
        )
        times_block = ("\n  Tiempos destacados:\n" + "\n".join(step_times)) if step_times else ""
        err_block   = ("\n  Errores:\n" + "\n".join(f"  ✗ {e}" for e in ex["errors"][:5])) \
                      if ex["errors"] else ""
        warn_block  = ("\n  Avisos:\n" + "\n".join(f"  ⚠ {w}" for w in ex["warnings"][:3])) \
                      if ex["warnings"] else ""

        exec_summary_parts.append(
            f"── Ejecución {i}: {ex['start']} | Duración: {dur_str} | {status_str}\n"
            f"  Pasos: {n_steps}/{total}\n"
            f"{step_list}"
            f"{times_block}{err_block}{warn_block}"
        )

    exec_summary = "\n\n".join(exec_summary_parts) if exec_summary_parts else log_text

    # ── Tendencias entre ejecuciones ──────────────────────────────────────────
    trend_lines = []
    if len(executions) >= 2:
        durs = [e["duration"] for e in executions if e["duration"] is not None]
        if len(durs) >= 2:
            diff = durs[-1] - durs[-2]
            pct  = int(abs(diff) * 100 / durs[-2]) if durs[-2] else 0
            if abs(diff) > 30:
                arrow = "⬆️ aumentó" if diff > 0 else "⬇️ disminuyó"
                trend_lines.append(
                    f"Duración {arrow} {_format_duration(abs(diff))} ({pct}%) "
                    f"respecto a la ejecución anterior."
                )
        totals = [e["steps"][0]["total"] if e["steps"] else None for e in executions]
        totals = [t for t in totals if t is not None]
        if len(totals) >= 2 and totals[-1] != totals[-2]:
            diff_t = totals[-1] - totals[-2]
            trend_lines.append(
                f"Volumen procesado cambió de {totals[-2]} a {totals[-1]} elementos "
                f"({'+' if diff_t > 0 else ''}{diff_t})."
            )

    trend_ctx = ("\nTendencias:\n" + "\n".join(f"  · {t}" for t in trend_lines)) \
                if trend_lines else ""

    # ── Estado ───────────────────────────────────────────────────────────────
    if is_missed:
        state_ctx = "⚠️ MISSED — El script NO arrancó en su hora prevista"
    elif is_stalled:
        state_ctx = "⚠️ STALLED — Bloqueado sin actualizar estado"
    elif is_real_error:
        state_ctx = f"❌ ERROR — Falló con exit_code={exit_code}"
    elif is_functional_alert:
        state_ctx = "⚠️ ALERTA FUNCIONAL — Terminó OK (exit_code=0) pero detectó condiciones de alerta"
    else:
        state_ctx = "✅ COMPLETADO — Sin errores"

    error_ctx = ("\nAlertas/errores reportados:\n" +
                 "\n".join(f"  · {e}" for e in real_error_msgs[:5])) \
                if real_error_msgs else ""

    return f"""Eres un experto en sistemas Linux y administración de servidores. \
Analiza la siguiente información de un script automatizado y responde SIEMPRE en español, \
usando los datos concretos que aparecen (nombres, tiempos, cantidades reales).

══════════════════════════════════════════
SCRIPT: {script_name}
Hora prevista: {expected or '—'}  |  Inicio: {start_time}  |  Fin: {end_time}
Duración: {_format_duration(duration)}  |  Exit code: {exit_code if exit_code is not None else '—'}
Estado: {state_ctx}{error_ctx}{trend_ctx}
══════════════════════════════════════════
EJECUCIONES EN EL LOG:
{exec_summary}
══════════════════════════════════════════
INSTRUCCIONES:
- Responde con las 4 secciones Markdown siguientes.
- Usa nombres concretos del log (VMs, ficheros, pasos), no genéricos.
- Si el script terminó con exit_code=0, NO lo trates como fallo aunque error=true.
- Si no hay problemas reales, dilo claramente en "Alertas".

## ¿Qué ocurrió?
(Qué procesó el script, cuántos elementos, resultado. Menciona los nombres reales.)

## Detalles técnicos
(Pasos que tardaron más, cambios respecto a ejecuciones anteriores, elementos nuevos o eliminados.)

## Alertas o problemas
(Errores reales o anomalías. Si todo fue bien → "Ninguna anomalía detectada.")

## Recomendación
(Una acción concreta basada en los datos observados.)"""


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint — Análisis IA
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/api/scripts/analyze/{name}")
def analyze_script_with_ai(name: str, lines: int = 200):
    """Analiza el log con el proveedor IA activo (Gemini, Mistral u Ollama)."""
    status_path = _status_dir() / f"{name}.status.json"
    status = {}
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    log_path = _find_log_file(name)
    log_text = "(log no disponible)"
    if log_path:
        log_text = _tail_file(log_path, lines=lines) or "(log vacío)"

    prompt = _build_analysis_prompt(name, status, log_text)
    analysis, model_used = _ai_generate(prompt)

    return {
        "name":           name,
        "provider":       _ai_provider(),
        "model":          model_used,
        "analysis":       analysis,
        "log_lines_used": lines,
        "analyzed_at":    datetime.now(timezone.utc).isoformat(),
    }

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
        f"{model}:generateContent?key={key[:8]}…"
    )
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512},
    }).encode("utf-8")

    real_url = url.replace(key[:8] + "…", key)
    req = urllib.request.Request(
        real_url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _gemini_log("generate", "generateContent", "ok", f"model={model}")
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        _gemini_log("generate", "generateContent", f"{e.code}", body[:80])
        raise HTTPException(status_code=502, detail=f"Gemini error {e.code}: {body[:300]}")
    except urllib.error.URLError as e:
        _gemini_log("generate", "generateContent", "url_error", str(e.reason))
        raise HTTPException(status_code=503, detail=f"Gemini no accesible: {e.reason}")
    except (KeyError, IndexError) as e:
        _gemini_log("generate", "generateContent", "parse_error", str(e))
        raise HTTPException(status_code=502, detail=f"Respuesta inesperada de Gemini: {e}")
    except Exception as e:
        _gemini_log("generate", "generateContent", "exception", str(e))
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
# Proveedor: Mistral
# ─────────────────────────────────────────────────────────────────────────────

def _mistral_generate(prompt: str) -> str:
    key   = _mistral_key()
    model = _mistral_model()

    if not key:
        raise HTTPException(
            status_code=503,
            detail="MISTRAL_API_KEY no configurada. Guárdala en Config → IA o en el .env."
        )

    payload = json.dumps({
        "model":       model,
        "messages":    [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens":  800,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.mistral.ai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {key}",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            raw = data["choices"][0]["message"]["content"].strip()
            # Limpiar wrappers ```markdown ... ``` que Mistral añade a veces
            raw = re.sub(r'^```(?:markdown)?\s*', '', raw, flags=re.IGNORECASE)
            raw = re.sub(r'\s*```\s*$', '', raw).strip()
            return raw
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=502, detail=f"Mistral error {e.code}: {body[:300]}")
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f"Mistral no accesible: {e.reason}")
    except (KeyError, IndexError) as e:
        raise HTTPException(status_code=502, detail=f"Respuesta inesperada de Mistral: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error llamando a Mistral: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Router IA
# ─────────────────────────────────────────────────────────────────────────────

def _ai_generate(prompt: str) -> tuple[str, str]:
    """Devuelve (texto_respuesta, modelo_usado)."""
    provider = _ai_provider()
    if provider == "gemini":
        return _gemini_generate(prompt), _gemini_model()
    elif provider == "mistral":
        return _mistral_generate(prompt), _mistral_model()
    elif provider == "ollama":
        return _ollama_generate(prompt), _ollama_model()
    else:
        raise HTTPException(
            status_code=500,
            detail=f"ai_provider desconocido: '{provider}'. Usa 'gemini', 'mistral' u 'ollama'."
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

    # ── Enriquecer con cfg_color, cfg_label y filtrar por monitored_scripts (S19) ──
    try:
        with db() as _conn:
            cfg_rows = _conn.execute(
                "SELECT script_name, label, color, active "
                "FROM monitored_scripts ORDER BY sort_order ASC, id ASC"
            ).fetchall()
        cfg_map = {
            r[0]: {"label": r[1], "color": r[2], "active": r[3]}
            for r in cfg_rows
        }
        # Si hay scripts configurados, filtrar solo los activos y respetar su orden
        if cfg_map:
            active_names = [name for name, v in cfg_map.items() if v["active"]]
            # Reordenar result según sort_order de monitored_scripts
            indexed = {s["name"]: s for s in result}
            result = [indexed[n] for n in active_names if n in indexed]
        # Añadir cfg_color y cfg_label a cada script del resultado
        for s in result:
            cfg = cfg_map.get(s["name"], {})
            s["cfg_color"] = cfg.get("color", "")
            s["cfg_label"] = cfg.get("label", "") or s["name"]
    except Exception:
        # Degradación elegante: si falla la BD, los scripts se muestran sin color/etiqueta
        pass

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
# Endpoint — Estado IA (badge en UI)
# Mantiene nombre /ollama/status para compatibilidad con el frontend existente
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/scripts/ollama/status")
def ai_status(request: Request, test: bool = False):
    """
    Badge de estado IA (llamado cada 30s por el frontend).
    - test=false (por defecto): GET /v1beta/models/{model} — sin tokens, sin RPM
    - test=true  (solo desde Config → Probar conexión): hace generateContent real
    """
    caller_ip = request.client.host if request.client else "unknown"
    referer   = request.headers.get("referer", "")
    provider  = _ai_provider()

    if provider == "gemini":
        key   = _gemini_key()
        model = _gemini_model()
        if not key:
            return {"available": False, "provider": "gemini",
                    "model": model, "model_ready": False,
                    "error": "GEMINI_API_KEY no configurada"}
        try:
            if test:
                # Prueba real con generateContent (solo desde Config → Probar conexión)
                _gemini_log("status_test", "generateContent",
                            "calling", f"ip={caller_ip} ref={referer}")
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
            else:
                # Comprobación ligera: verifica modelo y key sin gastar RPM de generación
                _gemini_log("status_ping", "GET /models/{model}",
                            "calling", f"ip={caller_ip} ref={referer}")
                url = (
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{model}?key={key}"
                )
                req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
            call_type = "status_test" if test else "status_ping"
            _gemini_log(call_type, "response", "ok", f"model={model}")
            return {"available": True, "provider": "gemini",
                    "model": model, "model_ready": True}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            call_type = "status_test" if test else "status_ping"
            _gemini_log(call_type, "response", f"{e.code}", body[:80])
            return {"available": False, "provider": "gemini",
                    "model": model, "model_ready": False,
                    "error": f"HTTP Error {e.code}: {body[:200]}"}
        except Exception as e:
            _gemini_log("status_ping", "response", "exception", str(e))
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


@router.get("/api/scripts/gemini/debug")
def gemini_debug():
    """Devuelve el historial de llamadas a Gemini para diagnóstico."""
    with _gemini_lock:
        calls = list(_gemini_calls)
    summary = {}
    for c in calls:
        k = c["type"]
        summary[k] = summary.get(k, 0) + 1
    return {
        "total_calls": len(calls),
        "summary":     summary,
        "calls":       calls,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Alertas por script — CRUD de reglas + motor de checks (Sesión 23)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/scripts/alert-rules")
def get_alert_rules():
    """Lista todas las reglas de alerta de scripts."""
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM script_alert_rules ORDER BY script_name"
        ).fetchall()
    return {"ok": True, "rules": [dict(r) for r in rows]}


@router.put("/api/scripts/alert-rules/{script_name}")
async def upsert_alert_rule(script_name: str, request: Request):
    """Crea o actualiza la regla de alerta para un script."""
    payload      = await request.json()
    alert_missed = 1 if payload.get("alert_missed", True) else 0
    max_hours    = float(payload.get("max_hours", 25))
    alert_error  = 1 if payload.get("alert_error", True) else 0
    cooldown_min = int(payload.get("cooldown_min", 60))

    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM script_alert_rules WHERE script_name=?", (script_name,)
        ).fetchone()
        if existing:
            conn.execute("""
                UPDATE script_alert_rules
                SET alert_missed=?, max_hours=?, alert_error=?, cooldown_min=?
                WHERE script_name=?
            """, (alert_missed, max_hours, alert_error, cooldown_min, script_name))
        else:
            conn.execute("""
                INSERT INTO script_alert_rules
                    (script_name, alert_missed, max_hours, alert_error, cooldown_min, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (script_name, alert_missed, max_hours, alert_error, cooldown_min,
                  datetime.now(timezone.utc).isoformat()))
    return {"ok": True}


@router.delete("/api/scripts/alert-rules/{script_name}")
def delete_alert_rule(script_name: str):
    """Elimina la regla de alerta de un script."""
    with db() as conn:
        conn.execute(
            "DELETE FROM script_alert_rules WHERE script_name=?", (script_name,)
        )
    return {"ok": True}


def check_script_alerts() -> int:
    """
    Comprueba todos los scripts con reglas activas y dispara notificaciones
    Discord/push si se cumple alguna condición de alerta.
    Devuelve el número de alertas disparadas.
    Llamado por APScheduler cada 15 minutos.
    """
    from datetime import datetime, timezone, timedelta

    fired = 0
    statuses = {s["name"]: s for s in get_scripts_status()}

    with db() as conn:
        rules = conn.execute("SELECT * FROM script_alert_rules").fetchall()

    for rule in rules:
        name         = rule["script_name"]
        alert_missed = bool(rule["alert_missed"])
        max_hours    = float(rule["max_hours"])
        alert_error  = bool(rule["alert_error"])
        cooldown_min = int(rule["cooldown_min"])
        last_fired   = rule["last_fired"]

        # Cooldown — no spamear
        if last_fired:
            try:
                lf = datetime.fromisoformat(last_fired)
                if lf.tzinfo is None:
                    lf = lf.replace(tzinfo=timezone.utc)
                if (datetime.now(timezone.utc) - lf).total_seconds() < cooldown_min * 60:
                    continue
            except Exception:
                pass

        s = statuses.get(name)
        if not s:
            continue  # script sin status.json todavía

        msgs = []

        # ── Condición 1: sin ejecutarse hace más de max_hours ─────────────────
        if alert_missed and max_hours > 0:
            last_run_str = s.get("last_run") or s.get("start_time")
            if last_run_str:
                try:
                    last_run = datetime.fromisoformat(last_run_str)
                    if last_run.tzinfo is None:
                        last_run = last_run.replace(tzinfo=timezone.utc)
                    hours_ago = (datetime.now(timezone.utc) - last_run).total_seconds() / 3600
                    if hours_ago >= max_hours:
                        label = s.get("cfg_label") or name
                        msgs.append(
                            f"⏰ **Script sin ejecutarse**: `{label}`\n"
                            f"Última ejecución hace **{hours_ago:.1f}h** "
                            f"(límite configurado: {max_hours}h)"
                        )
                except Exception:
                    pass
            else:
                # Nunca se ha ejecutado
                label = s.get("cfg_label") or name
                msgs.append(
                    f"⏰ **Script nunca ejecutado**: `{label}`\n"
                    f"No existe registro de ejecución y el límite es {max_hours}h."
                )

        # ── Condición 2: última ejecución terminó con error ───────────────────
        if alert_error and s.get("state") == "error":
            label     = s.get("cfg_label") or name
            ec        = s.get("exit_code", "?")
            err_list  = s.get("errors", [])
            err_short = err_list[0][:120] if err_list else "sin detalle"
            msgs.append(
                f"❌ **Script con error**: `{label}`\n"
                f"Exit code: `{ec}` — {err_short}"
            )

        if not msgs:
            continue

        # ── Disparar notificaciones ───────────────────────────────────────────
        full_msg = "\n\n".join(msgs)
        header   = f"🔔 **Alerta de proceso — Auditor IPs**\n"
        _send_script_alert(header + full_msg)
        fired += 1

        # Actualizar last_fired
        with db() as conn:
            conn.execute(
                "UPDATE script_alert_rules SET last_fired=? WHERE script_name=?",
                (datetime.now(timezone.utc).isoformat(), name)
            )

    if fired:
        print(f"[script_alerts] {fired} alerta(s) disparada(s)", flush=True)
    return fired


def _send_script_alert(msg: str) -> None:
    """Envía la alerta por Discord, push y/o email según la configuración activa."""
    # Discord
    try:
        from config import cfg as _cfg
        webhook = _cfg("discord_webhook", "")
        if webhook:
            import urllib.request, json as _json
            payload = _json.dumps({"content": msg[:1900]}).encode("utf-8")
            req = urllib.request.Request(
                webhook, data=payload,
                headers={"Content-Type": "application/json"}, method="POST"
            )
            urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[script_alerts] Discord error: {e}", flush=True)

    # Push (web push PWA)
    try:
        from routers.scans import send_push_notification
        send_push_notification("⚙️ Alerta de proceso", msg[:200])
    except Exception as e:
        print(f"[script_alerts] Push error: {e}", flush=True)

    # Email
    try:
        from routers.config_api import send_email
        ok, err = send_email("⚙️ Alerta de proceso — Auditor IPs", msg)
        if not ok and err:
            print(f"[script_alerts] Email error: {err}", flush=True)
    except Exception as e:
        print(f"[script_alerts] Email error: {e}", flush=True)
