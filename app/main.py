"""
main.py — Auditor IPs  (refactorizado Sesión 9)
Orquestador: crea la app FastAPI, registra routers y arranca el scheduler.

Toda la lógica de negocio vive en los módulos bajo routers/:
  routers/scans.py       — motor nmap, discord, push, OUI, fingerprint
  routers/hosts.py       — CRUD hosts, tipos, WoL, dashboard, export CSV
  routers/services.py    — servicios monitorizados TCP/HTTP
  routers/quality.py     — calidad de conexión (ping externo)
  routers/router_ssh.py  — integración router SSH
  routers/auth.py        — autenticación, sesiones, audit log
  routers/alerts.py      — alertas programables
  routers/config_api.py  — settings, backup/restore, push, VAPID, XLSX

Módulos compartidos (sin imports cruzados):
  database.py  — db(), init_db(), purge_old_scans()
  config.py    — cfg(), save_setting(), load_settings(), cfg_defaults()
  utils.py     — utc_now(), parse_iso(), to_local_str(), send_wol(), …
"""

import os
import struct
import threading
import zlib

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from auth_middleware import (
    SESSION_COOKIE, SESSION_TTL_HOURS,
    auth_enabled, validate_session,
    init_auth_tables, log_action, get_client_ip,
    should_audit, semantic_action,
)
from config import cfg, load_settings, DB_PATH, SCAN_CIDR, SCAN_INTERVAL_SECONDS
from database import db, init_db

# ── Routers ──────────────────────────────────────────────────
from routers.daily_report import router as daily_report_router, set_scheduler as dr_set_scheduler, register_daily_report_job
from routers import (
    auth    as r_auth,
    alerts  as r_alerts,
    hosts   as r_hosts,
    quality as r_quality,
    scans   as r_scans,
    services as r_services,
    router_ssh as r_router_ssh,
    config_api as r_config_api,
    scripts_status as r_scripts_status,
)

# ═══════════════════════════════════════════════════════════════
#  App y static files
# ═══════════════════════════════════════════════════════════════

app = FastAPI(
    title="Auditor IPs",
    docs_url="/docs",
    redoc_url="/redoc",
)
app.mount("/static", StaticFiles(directory="static", html=False), name="static")


# ═══════════════════════════════════════════════════════════════
#  Middleware — Auth enforce + Audit log
# ═══════════════════════════════════════════════════════════════

_FREE_WRITE_PATHS    = {"/api/auth/login", "/api/auth/logout"}
_FREE_WRITE_SUFFIXES = ("/ping", "/identify", "/fingerprint")
_WOL_SUFFIXES        = ("/wol",)
_FREE_WRITE_PREFIXES = ("/api/wol/",)

def _wol_is_public() -> bool:
    """Devuelve True si WoL está configurado como público (sin auth)."""
    try:
        return cfg("wol_public", "0") == "1"
    except Exception:
        return False

# Rutas de OpenAPI/docs — siempre públicas, nunca auditadas
_OPENAPI_PREFIXES = ("/docs", "/redoc", "/openapi.json")


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path   = request.url.path
        method = request.method
        token  = request.cookies.get(SESSION_COOKIE)

        # Docs y OpenAPI: pasar siempre sin comprobación
        if any(path.startswith(p) for p in _OPENAPI_PREFIXES):
            return await call_next(request)

        if auth_enabled(DB_PATH) and method in {"POST", "PUT", "DELETE", "PATCH"}:
            is_free = (
                path in _FREE_WRITE_PATHS
                or any(path.endswith(s) for s in _WOL_SUFFIXES)
                or any(path.endswith(s) for s in _FREE_WRITE_SUFFIXES)
                or any(path.startswith(p) for p in _FREE_WRITE_PREFIXES)
            )
            if not is_free and not validate_session(DB_PATH, token):
                return JSONResponse(
                    {"ok": False, "error": "Autenticación requerida",
                     "auth_required": True, "show_login": True},
                    status_code=401,
                )

        response = await call_next(request)

        if (should_audit(path) and response.status_code < 500
                and not any(path.startswith(p) for p in _OPENAPI_PREFIXES)):
            action = semantic_action(method, path)
            if action:
                ip       = get_client_ip(request)
                username = validate_session(DB_PATH, token)
                detail   = None
                if path.startswith("/api/hosts/"):
                    parts = path.split("/")
                    hip   = parts[3] if len(parts) > 3 else None
                    if hip and "." in hip:
                        detail = {"host": hip}
                log_action(
                    DB_PATH, ip, action,
                    authed=bool(username), username=username,
                    session_token=token, detail=detail,
                )
        return response


app.add_middleware(AuditMiddleware)


# ═══════════════════════════════════════════════════════════════
#  Registrar routers
# ═══════════════════════════════════════════════════════════════

app.include_router(r_auth.router)
app.include_router(r_alerts.router)
app.include_router(r_hosts.router)
app.include_router(r_quality.router)
app.include_router(r_scans.router)
app.include_router(r_services.router)
app.include_router(r_router_ssh.router)
app.include_router(r_config_api.router)
app.include_router(r_scripts_status.router)
app.include_router(daily_report_router)


# ═══════════════════════════════════════════════════════════════
#  PWA icon generation (no deps externas)
# ═══════════════════════════════════════════════════════════════

def _generate_pwa_icons() -> None:
    """Genera iconos PNG mínimos para PWA si no existen."""
    static_dir = "static"
    os.makedirs(static_dir, exist_ok=True)
    for size in (192, 512):
        path = os.path.join(static_dir, f"icon-{size}.png")
        if os.path.exists(path):
            continue
        try:
            w = h = size
            color = (77, 255, 181)   # #4dffb5 accent
            bg    = (26, 31, 38)     # fondo oscuro
            r_c   = size // 4
            rows  = []
            for y in range(h):
                row = []
                for x in range(w):
                    cx, cy = w // 2, h // 2
                    dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                    row.extend(color if dist < r_c else bg)
                rows.append(bytes([0] + row))
            raw        = b"".join(rows)
            compressed = zlib.compress(raw)

            def chunk(tag: bytes, data: bytes) -> bytes:
                c = tag + data
                return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

            ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
            png  = (b"\x89PNG\r\n\x1a\n"
                    + chunk(b"IHDR", ihdr)
                    + chunk(b"IDAT", compressed)
                    + chunk(b"IEND", b""))
            with open(path, "wb") as f:
                f.write(png)
        except Exception as e:
            print(f"[PWA] Icon generation failed for {size}px: {e}")


# ═══════════════════════════════════════════════════════════════
#  Startup
# ═══════════════════════════════════════════════════════════════

@app.on_event("startup")
def startup() -> None:
    # 1. BD e inicialización
    init_db()
    load_settings()
    init_auth_tables(DB_PATH)
    _generate_pwa_icons()

    # 2. Backfill vendor para hosts con MAC pero sin vendor
    from routers.scans import oui_lookup
    with db() as conn:
        hosts_no_vendor = conn.execute(
            "SELECT ip, mac FROM hosts WHERE mac IS NOT NULL AND (vendor IS NULL OR vendor='')"
        ).fetchall()
        for h in hosts_no_vendor:
            vendor = oui_lookup(h["mac"])
            if vendor:
                conn.execute("UPDATE hosts SET vendor=? WHERE ip=?", (vendor, h["ip"]))

    # 3. Scheduler global
    scheduler = BackgroundScheduler(timezone="UTC")

    # Inyectar scheduler en los módulos que lo necesitan
    r_quality.set_scheduler(scheduler)
    r_services.set_scheduler(scheduler)
    r_config_api.set_scheduler(scheduler)
    r_scans.set_scheduler(scheduler)
    dr_set_scheduler(scheduler)
    register_daily_report_job()

    # Compartir el mismo _db_write_lock entre scans y quality
    lock = r_scans.get_db_write_lock()
    r_quality.set_db_write_lock(lock)

    # 4. Jobs periódicos
    scan_interval = int(cfg("scan_interval", SCAN_INTERVAL_SECONDS))

    scheduler.add_job(
        lambda: r_scans.run_scan(cfg("scan_cidr", SCAN_CIDR)),
        "interval", seconds=scan_interval,
        id="scan_job", replace_existing=True,
    )

    from routers.config_api import run_backup
    scheduler.add_job(
        run_backup, "cron",
        hour=3, minute=0,
        id="backup_job", replace_existing=True,
    )

    # Alertas por script — cada 15 minutos
    from routers.scripts_status import check_script_alerts
    scheduler.add_job(
        check_script_alerts, "interval", minutes=15,
        id="script_alerts_job", replace_existing=True,
    )

    scheduler.start()

    # 5. Checks de servicios existentes
    r_services.schedule_services()

    # 6. Quality si está habilitada
    with db() as conn_q:
        qs = conn_q.execute("SELECT enabled FROM quality_settings WHERE id=1").fetchone()
        if qs and qs["enabled"]:
            r_quality.reschedule_quality(True, 30)

    # 7. Scan inicial en background (no bloquea el arranque)
    def _first_scan():
        import time
        time.sleep(3)   # esperar a que uvicorn esté listo
        try:
            r_scans.run_scan(cfg("scan_cidr", SCAN_CIDR))
        except Exception as e:
            print(f"[startup] Primer scan fallido: {e}")

    threading.Thread(target=_first_scan, daemon=True).start()

    print(f"[startup] Auditor IPs listo — CIDR={cfg('scan_cidr', SCAN_CIDR)} "
          f"interval={scan_interval}s DB={DB_PATH}")
