# PROMPT DE PROYECTO — Auditor IPs
# Versión 2.0 — Actualizado tras sesión de Bug-Fixing Config (Marzo 2026)

Usa este prompt al iniciar un nuevo hilo de chat.
**Adjunta siempre:** `README.md` + `BUGS_Y_FIXES.docx` + los ficheros relevantes para la tarea.

---

## Cómo usar este prompt

```
Eres el asistente de desarrollo de Auditor IPs. Adjunto:
- README.md (arquitectura completa)
- BUGS_Y_FIXES.docx (historial de bugs y estado actual)
- [ficheros .py / .js / .html de la tarea]

[DESCRIBE AQUÍ TU TAREA]

Al terminar, actualiza BUGS_Y_FIXES.docx con los cambios de esta sesión.
```

---

## Contexto del proyecto

**Auditor IPs** — App web self-hosted de monitorización de red local (LAN).

**Stack:** FastAPI · SQLite · Bootstrap 5 · jQuery · Docker · Python 3.12  
**Servidor:** `5.154.37.169` · Container: `auditor_ips`  
**Ruta proyecto:** `/SERVER/VM/Auditor_IPs/`  
**BD:** `/data/auditor.db` (volumen persistente Docker)

---

## Reglas de trabajo — SIEMPRE seguir

### Archivos
1. **Servir siempre archivos completos** — nunca fragmentos ni diffs parciales.
2. **Un archivo = un output descargable** — usar `present_files` para cada archivo modificado.
3. **Antes de editar**, leer el archivo actual si fue subido en la sesión.
4. **Nunca hardcodear** valores configurables. Todo va a BD via `cfg()` / `save_setting()`.

### Despliegue
- Estáticos (JS, HTML, CSS): `docker cp <archivo> auditor_ips:/app/...`  *(no requiere restart)*
- Python (routers, config, database): `docker compose build --no-cache && docker compose up -d`
- Nuevos ficheros o cambios en `docker-compose.yml`: siempre rebuild completo.

### Documentación — OBLIGATORIO al terminar cada sesión
5. **Actualizar `BUGS_Y_FIXES.docx`** con: bug ID, causa raíz, fix aplicado, decisión de diseño.
6. **Actualizar `README.md`** si hay cambios de arquitectura, nuevas tablas BD o nuevos endpoints.
7. **Al completar cada feature**, marcarla como ✅ en el roadmap con la sesión.

### Código
8. **Sin imports circulares** — `database.py` no importa routers.
9. **`cfg()` se lee en cada request**, nunca al arranque.
10. **Event delegation jQuery**: `$(document).on('click', '#id', fn)` para elementos dinámicos.
11. **Guardas defensivas** en interdependencias JS: `if (typeof fn === 'function') fn();`
12. **Markdown rendering**: usar `spRenderMD()` de `scripts.js` para análisis IA.

---

## Arquitectura del proyecto

### Backend (`/app/`)
```
main.py              — FastAPI app, routers, middleware, scheduler startup
database.py          — db(), init_db(), 23+ tablas, migraciones ALTER TABLE
config.py            — cfg(), save_setting(), cfg_defaults(), rate limiting login
utils.py             — utc_now(), parse_iso(), discord_notify(), oui_lookup()
auth_middleware.py   — Multi-usuario, PBKDF2-HMAC-SHA256, audit log semántico
routers/
  auth.py            — /login, /api/auth/* CRUD usuarios, sesiones, audit
  hosts.py           — CRUD hosts, WoL, uptime, latencia, tipos, export CSV
  scans.py           — Motor nmap multi-CIDR, ThreadPoolExecutor
  services.py        — Monitor servicios TCP/HTTP, scheduler APScheduler
  quality.py         — Calidad conexión (ping), scheduler, targets
  alerts.py          — CRUD alertas con triggers y cooldown
  router_ssh.py      — SSH router Asus, ARP table, dnsmasq.leases
  config_api.py      — Settings, backup/restore, VAPID, push, export xlsx
  scripts_status.py  — Estado scripts, log en vivo, análisis IA
  daily_report.py    — Informe diario IA (cron 06:00)
```

### Frontend (`/app/static/js/` + `/app/templates/`)
```
index.html     — SPA Jinja2 ~3.450 líneas
app.js         — Bootstrap global, DataTable, tab persistence, AI chat modal
hosts.js       — Tabla hosts, modal edición, WoL, ping
               ⚠️  Depende de window.renderTagWrap (config.js) — guardia typeof
services.js    — Monitor servicios, gráficas
quality.js     — Monitor calidad, latencia, lossVLines
scans.js       — Tabla ejecuciones, gráfica, scan manual
alerts.js      — CRUD alertas, toggle, test Discord
config.js      — Settings, multi-CIDR, backup, tipos, router SSH, IA, export
               ⚠️  Define: window.loadBackupList, window.renderTagWrap, window.loadCfg
auth.js        — Login modal, sesiones, audit log, tab save/restore
               ⚠️  Depende de loadBackupList (config.js) — guardia typeof
scripts.js     — Procesos, log en vivo, análisis IA, informe diario
```

### Orden de carga de scripts (crítico)
```
app.js → hosts.js → services.js → alerts.js → dashboard.js →
scans.js → quality.js → config.js → auth.js → scripts.js
```

### Paneles Config (11 paneles, data-panel="...")
| data-panel | Contenido |
|------------|-----------|
| `scanner` | Redes CIDR, intervalo, DNS, retención, WoL, tipos dispositivo, redes secundarias |
| `notifications` | Discord webhook + eventos, Push PWA + eventos |
| `appearance` | Tema, acento, título |
| `router` | Router SSH, credenciales, test |
| `ai` | Proveedor IA, API key, modelo |
| `scripts` | Scripts monitorizados (Procesos) |
| `networks` | Redes secundarias: CIDR, label, interfaz |
| `backup` | Backup BD automático/manual, restaurar, resetear |
| `exports` | Exportar xlsx/csv, exportación programada, **Importar CSV** |
| `auth` | Usuarios admin, contraseñas |
| `audit` | Audit log paginado, filtros |

---

## Gestión de settings

```python
# Backend — config.py
cfg_defaults()         # valores por defecto (usados si la key no está en BD)
load_settings()        # startup: carga BD + siembra defaults ausentes
cfg(key, default)      # lectura en cada request
save_setting(key, val) # persiste en BD + actualiza caché
```

```javascript
// Frontend — config.js populateCfgForm()
// Usar _notifyDef() para defaults cuando val puede ser null/vacío:
const _notifyDef = (val, def1) => (val == null || val === '') ? def1 : val;
$('#cfgNotifyNew').prop('checked', _notifyDef(s.notify_new, '1') === '1');
```

**Regla:** Si añades una nueva setting, actualiza `cfg_defaults()` en `config.py` Y los defaults explícitos en `populateCfgForm()` en `config.js`.

---

## Proveedores IA

| Provider | Keys en BD | Default model |
|----------|-----------|---------------|
| `gemini` | `ai_gemini_key`, `ai_gemini_model` | `gemini-2.0-flash` |
| `mistral` | `ai_mistral_key`, `ai_mistral_model` | `mistral-small-latest` |
| `ollama` | `ollama_url`, `ollama_model` | `gemma2:2b` |

---

## WoL — Flujo
1. Clic dropdown → `GET /api/hosts/{ip}/detail` para obtener MAC
2. MAC vacía → `showToast` warning ("lanzar scan primero")
3. MAC válida → `POST /api/wol/fixed` con `{ mac, label }`
4. Resultado → `showToast` success/danger

---

## Comandos de diagnóstico rápido

```bash
# Logs en tiempo real
docker logs -f auditor_ips

# Verificar módulo Python
docker exec auditor_ips python3 -c "from routers.scripts_status import _ai_generate; print('OK')"

# Ver tablas BD
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

## Al terminar la sesión — checklist

- [ ] `BUGS_Y_FIXES.docx` actualizado con bugs resueltos (causa + fix + decisión)
- [ ] `README.md` actualizado si hay cambios de arquitectura
- [ ] Todos los ficheros modificados entregados como outputs descargables
- [ ] Comandos de despliegue indicados para cada fichero
