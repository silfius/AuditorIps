#!/usr/bin/env python3
"""
check_startup.py — Auditor IPs  (Sesión 10)
Script de pre-flight para validar que todos los módulos importan correctamente
y que la configuración tiene los valores mínimos necesarios.

Ejecutar dentro del contenedor ANTES del primer arranque:
    docker compose run --rm auditor_ips python check_startup.py

O directamente en el host (con el venv activo):
    python check_startup.py
"""

import sys
import os
import importlib
import traceback

# ── Colores ANSI ────────────────────────────────────────────────────────────
OK   = "\033[92m✅\033[0m"
ERR  = "\033[91m❌\033[0m"
WARN = "\033[93m⚠️ \033[0m"
INFO = "\033[94mℹ️ \033[0m"

errors   = 0
warnings = 0

def ok(msg):   print(f"  {OK}  {msg}")
def err(msg):  global errors;   errors   += 1; print(f"  {ERR}  {msg}")
def warn(msg): global warnings; warnings += 1; print(f"  {WARN} {msg}")
def info(msg): print(f"  {INFO} {msg}")


# ════════════════════════════════════════════════════════════════════════════
#  1. Dependencias Python
# ════════════════════════════════════════════════════════════════════════════
print("\n─── Dependencias Python ───────────────────────────────────────────")

REQUIRED_PACKAGES = [
    ("fastapi",                "fastapi"),
    ("uvicorn",                "uvicorn"),
    ("apscheduler",            "apscheduler"),
    ("dateutil",               "python-dateutil"),
    ("jinja2",                 "jinja2"),
    ("openpyxl",               "openpyxl"),
    ("dns",                    "dnspython"),
    ("starlette",              "starlette"),
]

for mod, pkg in REQUIRED_PACKAGES:
    try:
        importlib.import_module(mod)
        ok(f"{pkg}")
    except ImportError:
        err(f"{pkg} NO instalado — ejecuta: pip install {pkg}")


# ════════════════════════════════════════════════════════════════════════════
#  2. Módulos locales
# ════════════════════════════════════════════════════════════════════════════
print("\n─── Módulos locales ───────────────────────────────────────────────")

# Asegurarnos de que el directorio actual está en sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LOCAL_MODULES = [
    "utils",
    "database",
    "config",
    "auth_middleware",
    "routers.auth",
    "routers.alerts",
    "routers.hosts",
    "routers.quality",
    "routers.scans",
    "routers.services",
    "routers.router_ssh",
    "routers.config_api",
    "main",
]

for mod in LOCAL_MODULES:
    try:
        importlib.import_module(mod)
        ok(mod)
    except Exception as e:
        err(f"{mod} — {e}")
        if "--verbose" in sys.argv:
            traceback.print_exc()


# ════════════════════════════════════════════════════════════════════════════
#  3. Variables de entorno críticas
# ════════════════════════════════════════════════════════════════════════════
print("\n─── Variables de entorno ──────────────────────────────────────────")

DB_PATH        = os.getenv("DB_PATH", "/data/auditor.db")
SCAN_CIDR      = os.getenv("SCAN_CIDR", "192.168.1.0/24")
SCAN_INTERVAL  = os.getenv("SCAN_INTERVAL_SECONDS", "900")
DISCORD        = os.getenv("DISCORD_WEBHOOK_URL", "")
ROUTER_HOST    = os.getenv("ROUTER_SSH_HOST", "")
ROUTER_KEY     = os.getenv("ROUTER_SSH_KEY", "")

ok(f"DB_PATH = {DB_PATH}")

# Validar directorio BD
db_dir = os.path.dirname(DB_PATH)
if not db_dir:
    db_dir = "."
if os.path.isdir(db_dir):
    ok(f"Directorio DB existe: {db_dir}")
elif db_dir == "/data":
    warn(f"Directorio /data no existe aún — se creará al arrancar (normal en primer run)")
else:
    err(f"Directorio de BD no existe: {db_dir}")

# Validar CIDR(s)
import ipaddress
cidrs = [c.strip() for c in SCAN_CIDR.split(",") if c.strip()]
if not cidrs:
    err("SCAN_CIDR está vacío")
else:
    for cidr in cidrs:
        try:
            ipaddress.ip_network(cidr, strict=False)
            ok(f"CIDR válido: {cidr}")
        except ValueError:
            err(f"CIDR inválido: {cidr}")

# Validar intervalo
try:
    iv = int(SCAN_INTERVAL)
    if iv < 30:
        warn(f"SCAN_INTERVAL_SECONDS={iv} es muy bajo (mín. recomendado: 60)")
    else:
        ok(f"SCAN_INTERVAL_SECONDS = {iv}s ({iv//60}min {iv%60}s)")
except ValueError:
    err(f"SCAN_INTERVAL_SECONDS no es un número: {SCAN_INTERVAL}")

# Discord (opcional)
if DISCORD:
    if DISCORD.startswith("https://discord.com/api/webhooks/"):
        ok(f"DISCORD_WEBHOOK_URL configurado")
    else:
        warn(f"DISCORD_WEBHOOK_URL tiene formato inesperado")
else:
    info("DISCORD_WEBHOOK_URL no configurado (opcional)")

# Router SSH (opcional pero valida si está parcialmente configurado)
router_user = os.getenv("ROUTER_SSH_USER", "")
if ROUTER_HOST or ROUTER_KEY or router_user:
    if not ROUTER_HOST:
        warn("ROUTER_SSH_HOST vacío pero otros parámetros SSH están definidos")
    if not router_user:
        warn("ROUTER_SSH_USER vacío")
    if not ROUTER_KEY:
        warn("ROUTER_SSH_KEY vacío")
    if ROUTER_KEY and not os.path.exists(ROUTER_KEY):
        # Buscar en /data también
        alt = os.path.join("/data", os.path.basename(ROUTER_KEY))
        if os.path.exists(alt):
            ok(f"Router SSH key encontrada en fallback: {alt}")
        else:
            warn(f"Router SSH key no encontrada: {ROUTER_KEY} (puede ser normal si el volumen no está montado)")
    elif ROUTER_KEY and os.path.exists(ROUTER_KEY):
        import stat
        mode = stat.S_IMODE(os.stat(ROUTER_KEY).st_mode)
        if mode & 0o077:
            warn(f"Router SSH key tiene permisos {oct(mode)} — SSH necesita 600 (se corregirá automáticamente)")
        else:
            ok(f"Router SSH key: {ROUTER_KEY} (permisos {oct(mode)})")
else:
    info("Router SSH no configurado (opcional)")


# ════════════════════════════════════════════════════════════════════════════
#  4. Herramientas del sistema
# ════════════════════════════════════════════════════════════════════════════
print("\n─── Herramientas del sistema ──────────────────────────────────────")

import subprocess

TOOLS = [
    ("nmap",    ["nmap", "--version"]),
    ("ping",    ["ping", "-c1", "-W1", "127.0.0.1"]),
    ("ssh",     ["ssh", "-V"]),
    ("openssl", ["openssl", "version"]),
]

for name, cmd in TOOLS:
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=5)
        ok(f"{name} disponible")
    except FileNotFoundError:
        if name == "nmap":
            err(f"{name} NO encontrado — el escaneo de red no funcionará")
        elif name == "ssh":
            warn(f"{name} no encontrado — Router SSH no funcionará")
        else:
            warn(f"{name} no encontrado")
    except Exception as e:
        warn(f"{name} — {e}")


# ════════════════════════════════════════════════════════════════════════════
#  5. Directorios y ficheros estáticos
# ════════════════════════════════════════════════════════════════════════════
print("\n─── Ficheros de la aplicación ─────────────────────────────────────")

APP_FILES = [
    "main.py",
    "auth_middleware.py",
    "database.py",
    "utils.py",
    "config.py",
    "templates/index.html",
    "templates/login.html",
    "static",
    "routers/__init__.py",
    "routers/auth.py",
    "routers/scans.py",
    "routers/hosts.py",
    "routers/services.py",
    "routers/quality.py",
    "routers/router_ssh.py",
    "routers/config_api.py",
    "routers/alerts.py",
]

for path in APP_FILES:
    if os.path.exists(path):
        ok(path)
    else:
        err(f"No encontrado: {path}")


# ════════════════════════════════════════════════════════════════════════════
#  6. Resumen
# ════════════════════════════════════════════════════════════════════════════
print()
print("═" * 60)
if errors == 0 and warnings == 0:
    print(f"  {OK}  Todo correcto — listo para arrancar")
elif errors == 0:
    print(f"  {WARN} {warnings} advertencia(s) — la app arrancará pero revisa los warnings")
else:
    print(f"  {ERR}  {errors} error(s), {warnings} advertencia(s) — corrige los errores antes de arrancar")
print("═" * 60)
print()

sys.exit(0 if errors == 0 else 1)
