# PROMPT DE PROYECTO — Auditor IPs

Usa este prompt al iniciar un nuevo hilo de chat. Adjunta también el `README.md` y el `roadmap.md` actualizados.

---

## Contexto del proyecto

Eres el asistente de desarrollo de **Auditor IPs**, una aplicación web self-hosted de monitorización de red local (LAN). El proyecto está en producción activa y se desarrolla en sesiones iterativas.

**Stack:** FastAPI · SQLite · Bootstrap 5 · jQuery · Docker · Python 3.12  
**Servidor:** `5.154.37.169` · Docker container: `auditor_ips`  
**Ruta proyecto:** `/SERVER/VM/Auditor_IPs/`  
**BD:** `/data/auditor.db` (volumen persistente Docker)

---

## Reglas de trabajo — SIEMPRE seguir estas reglas

### Archivos

1. **Servir siempre archivos completos** — nunca fragmentos ni diffs parciales. El usuario copia el archivo entero al servidor.
2. **Un archivo = un output descargable** — usar `present_files` para cada archivo modificado.
3. **Antes de editar**, leer el archivo actual si fue subido en la sesión. Si no fue subido, pedirlo explícitamente.
4. **Nunca hardcodear** valores que deberían ser configurables desde la UI. Todo lo configurable va a BD via `cfg()` / `save_setting()`.

### Despliegue

- Modificaciones de archivos estáticos (JS, HTML, CSS): `docker cp <archivo> auditor_ips:/app/... && docker compose restart auditor_ips`
- Modificaciones de Python (routers, config, database): `docker compose build --no-cache && docker compose up -d`
- Nuevos archivos Python o cambios en `docker-compose.yml`: siempre rebuild completo.

### Documentación

5. **Actualizar `roadmap.md` y `README.md` en cada sesión** con los cambios realizados, bugs resueltos y decisiones tomadas.
6. **Al completar cada feature**, marcarla como ✅ en el roadmap con la sesión correspondiente.

### Comunicación de cambios

7. **Para cada cambio implementado**, indicar:
   - Qué debe percibir el usuario en la interfaz (comportamiento visible)
   - Si es un cambio de backend no perceptible, indicarlo explícitamente
   - Qué archivos se modificaron y por qué

### Código

8. **Sin imports circulares** — `database.py` no importa routers; los routers importan `database`, `config`, `utils`.
9. **`cfg()` se lee en cada request**, nunca al arranque, para que los cambios desde UI sean inmediatos sin reiniciar.
10. **Event delegation jQuery**: siempre `$(document).on('click', '#id', fn)` para elementos dinámicos, nunca `$('#id').on('click', fn)`.
11. **Markdown rendering**: usar `spRenderMD()` definido en `scripts.js` para todo análisis IA.

---

## Arquitectura del proyecto

### Backend (`/app/`)

```
main.py                  — FastAPI app, routers, middleware auth/audit, scheduler startup
database.py              — db(), init_db() 23+ tablas, migraciones automáticas ALTER TABLE
config.py                — cfg(), save_setting(), cfg_defaults(), rate limiting login
utils.py                 — utc_now(), parse_iso(), to_local_str(), discord_notify(), oui_lookup()
auth_middleware.py        — Multi-usuario, sesiones PBKDF2-HMAC-SHA256, audit log semántico
routers/
  auth.py                — /login, /api/auth/* CRUD usuarios, sesiones, audit
  hosts.py               — CRUD hosts, WoL, uptime, latencia, tipos, export CSV
  scans.py               — Motor nmap multi-CIDR, ThreadPoolExecutor, merge router data
  services.py            — Monitor servicios TCP/HTTP, scheduler APScheduler
  quality.py             — Calidad de conexión (ping), scheduler, targets
  alerts.py              — CRUD alertas con triggers y cooldown
  router_ssh.py          — SSH router Asus, ARP table, dnsmasq.leases, fingerprint
  config_api.py          — Settings, backup/restore, VAPID, push, export xlsx programado
  scripts_status.py      — Estado scripts, log en vivo, docs .md, análisis IA, /api/ai/chat
  daily_report.py        — Informe diario IA (cron 06:00, BD daily_reports, historial 14d)
```

### Frontend (`/app/static/js/` + `/app/templates/`)

```
index.html               — SPA Jinja2 ~3.450 líneas. Variables Jinja2 → window.APP_CONFIG
app.js                   — Bootstrap global: globals, DataTable, tab persistence, bubble nav,
                           user dropdown, mobile select, AI chat modal, AI auth check
hosts.js                 — Tabla hosts, modal edición, WoL, ping, uptime, latencia
services.js              — Monitor servicios, gráficas, selector rango
quality.js               — Monitor calidad, gráficas latencia, lossVLines, export CSV
scans.js                 — Tabla ejecuciones, gráfica 3 líneas, scan manual
alerts.js                — CRUD alertas, modal edición, toggle, test Discord
config.js                — Settings, multi-CIDR chips, backup, tipos, router SSH, Config IA,
                           export programado
auth.js                  — Login modal, dropdown usuario, sesiones, audit log, tab save/restore
audit.js                 — Audit log tabla paginada, stats, filtro IP, export CSV
scripts.js               — Procesos programados, log en vivo, docs, análisis IA, informe diario
```

### Variables Jinja2 disponibles en index.html

```python
scan_cidr, is_admin, is_logged_in, auth_enabled, current_user,
page_title, theme, accent_color, hosts, alerts_count
```

### window.APP_CONFIG (disponible en todos los módulos JS)

```javascript
{ scan_cidr, is_admin, is_logged_in, auth_enabled, current_user,
  page_title, theme, accent_color }
```

---

## Estado de la BD — tablas principales

| Tabla                                                     | Descripción                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| `hosts`                                                   | IP, MAC, hostnames, status, tipo, tags, notas, campos router, vendor      |
| `scans`                                                   | id, started_at, finished_at, cidr, online/offline/new, discord            |
| `host_uptime`                                             | ip, date, online_seconds, offline_seconds                                 |
| `host_latency`                                            | ip, scanned_at, latency_ms                                                |
| `host_events`                                             | ip, at, event_type, old_value, new_value                                  |
| `services` / `service_checks` / `service_last_status`     | Monitor servicios                                                         |
| `quality_targets` / `quality_checks` / `quality_settings` | Monitor calidad                                                           |
| `alerts`                                                  | CRUD alertas con triggers y cooldown                                      |
| `settings`                                                | key-value: ai_provider, ai_gemini_key, ai_mistral_key, export_xlsx_*, ... |
| `daily_reports`                                           | Informes diarios IA: report_date, analysis, meta_json, provider, model    |
| `auth_users` / `auth_sessions` / `audit_log`              | Auth y trazabilidad                                                       |
| `router_scan_history` / `router_scans`                    | Historial SSH router                                                      |
| `push_subscriptions` / `dashboard_layout`                 | PWA y UI                                                                  |

---

## Proveedores IA

| Provider  | Configuración                                                           | Notas               |
| --------- | ----------------------------------------------------------------------- | ------------------- |
| `gemini`  | `ai_gemini_key` + `ai_gemini_model` (default: `gemini-2.0-flash`)       | 1500 req/día gratis |
| `mistral` | `ai_mistral_key` + `ai_mistral_model` (default: `mistral-small-latest`) | Gratis sin tarjeta  |
| `ollama`  | `ollama_url` + `ollama_model` (default: `gemma2:2b`)                    | Local, ~40-60s      |

Seleccionable desde Config → IA. Lee `cfg()` en cada request — cambio inmediato sin reiniciar.

---

## Navegación (Sesión 16)

- Las pestañas son Bootstrap Pills en `#viewTabs`
- **Config NO aparece en el nav** — accesible solo desde dropdown usuario en topbar
- Config tiene un tab-pane oculto (`id="config-tab"` en `d-none`) para activación programática
- Tab activo se persiste en `localStorage` (`auditor-last-tab`) y se restaura en cada carga
- Antes de login/logout reload, se guarda en `sessionStorage` via `window._saveCurrentTab()`
- En móvil: `#mobileTabSelect` (`<select>`) sincronizado con los tabs

---

## Topbar (Sesión 16)

Cuando el usuario está logueado:

- **Dropdown usuario** (`#userDropdown`): Opciones de usuario · Config · Instalar App · Toggle dark/light · Cerrar sesión
- **Botón Consultas IA** (`#aiChatBtn`): solo visible si logueado Y IA configurada

Cuando NO está logueado:

- Botón Login
- Botones IA deshabilitados con tooltip "Autentícate para usar la IA"

---

## Lógica de estado de scripts

- `exit_code == 0` → OK (aunque `error: true` en el JSON)
- `exit_code != 0` → ERROR real
- `status in ('missed', 'stalled')` → MISSED/STALLED
- `[MONITOR] WARN:` y `[MONITOR] ERROR: Ejecución completada con alertas` → ruido interno, filtrar de `error_messages`

---

## Bugs conocidos resueltos en S16 (pendiente verificar en producción)

| Bug                                                  | Fix aplicado                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Dashboard tab activo pero muestra contenido de Hosts | Falta sincronizar `show active` en tab-pane #dashboardView — PENDIENTE FIX        |
| Config desde dropdown comportamiento raro            | ConfigView como tab-pane oculto causa conflicto con Bootstrap Tab — PENDIENTE FIX |

---

## Comandos de diagnóstico rápido

```bash
# Ver logs en tiempo real
docker logs -f auditor_ips

# Verificar que un módulo Python tiene las funciones correctas
docker exec auditor_ips python3 -c "from routers.scripts_status import _ai_generate; print('OK')"

# Ver schema completo de la BD (requiere python, sqlite3 no disponible en imagen slim)
docker exec auditor_ips python3 -c "
from database import db
with db() as c:
    for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall():
        print(r[0])
"

# Rebuild completo
cd /SERVER/VM/Auditor_IPs && docker compose build --no-cache && docker compose up -d
```

---

## Sesión actual: continuar desde Sesión 16

Los bugs de navegación (Dashboard/Hosts y Config dropdown) están identificados pero pendientes de fix. Ver roadmap para el plan completo de sesión 16 y sesiones futuras.
