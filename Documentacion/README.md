# Auditor IPs

> Aplicación web self-hosted de monitorización de red local (LAN).  
> Detecta dispositivos, monitoriza servicios, mide calidad de conexión, alerta ante intrusiones y analiza scripts del servidor con IA.  
> Stack: FastAPI · SQLite · Bootstrap 5 · Docker  
> Última actualización: marzo 2026 · Sesión 26 completada

---

## Índice

1. [Qué es y qué hace](#qué-es-y-qué-hace)
2. [Decisiones de arquitectura y por qué](#decisiones-de-arquitectura-y-por-qué)
3. [Requisitos previos](#requisitos-previos)
4. [Instalación paso a paso](#instalación-paso-a-paso)
5. [Variables de entorno](#variables-de-entorno)
6. [Estructura de ficheros](#estructura-de-ficheros)
7. [Cómo funciona cada módulo](#cómo-funciona-cada-módulo)
8. [Flujos de las acciones principales](#flujos-de-las-acciones-principales)
9. [Base de datos](#base-de-datos)
10. [Seguridad](#seguridad)
11. [Inteligencia Artificial](#inteligencia-artificial)
12. [Notificaciones por email (SMTP)](#notificaciones-por-email-smtp)
13. [Historial de informes IA de red](#historial-de-informes-ia-de-red)
14. [Exportación histórica](#exportación-histórica)
15. [Pestañas ocultables](#pestañas-ocultables)
16. [Alertas por script](#alertas-por-script)
17. [Multi-idioma](#multi-idioma)
18. [Dashboard móvil](#dashboard-móvil)
19. [Reglas de despliegue](#reglas-de-despliegue)
20. [Errores conocidos y cómo evitarlos](#errores-conocidos-y-cómo-evitarlos)
21. [Guía para nuevas implementaciones](#guía-para-nuevas-implementaciones)

---

## Qué es y qué hace

Auditor IPs nació para monitorizar una red local doméstica/PYME con más profundidad que una simple lista de IPs. El objetivo central es **saber en todo momento qué hay conectado en la red, detectar intrusos, y entender el estado de los servicios y scripts del servidor**.

Las funciones principales son:

- **Descubrir dispositivos** en uno o varios rangos CIDR, con MAC, hostname, fabricante, historial de uptime y latencia
- **Detectar intrusos** contrastando lo que ve nmap con lo que reporta el router via SSH — si algo está en la red pero el router no lo reconoce, se marca como discrepancia y se analiza con IA
- **Monitorizar servicios** TCP/HTTP/HTTPS con historial de disponibilidad y alertas
- **Medir calidad de conexión** hacia targets externos (latencia, pérdida de paquetes) con gráficas
- **Ver el estado de scripts automatizados** del servidor con log en vivo y análisis IA
- **Alertar por script** si un proceso no se ejecuta en el plazo esperado o termina con error
- **Alertar** por Discord, push PWA y/o email (SMTP) ante eventos de red, servicios o scripts
- **Exportar datos históricos** de uptime, latencia y servicios por rango de fechas a Excel
- **Personalizar la interfaz**: pestañas ocultables, 3 idiomas (ES/EN/CA), 10 temas visuales
- **Dashboard reordenable** en móvil con arrastre táctil

---

## Decisiones de arquitectura y por qué

### Por qué Docker con network_mode: host

La aplicación necesita hacer pings y scans nmap directamente en la red local. Si el contenedor usara una red Docker bridge, nmap solo vería el rango de la red Docker, no la LAN real. Con `network_mode: host` el contenedor comparte la interfaz de red del host y puede hacer `nmap 192.168.1.0/24` exactamente igual que si fuera el host.

**Consecuencia importante:** las IPs `192.168.1.250` y `192.168.1.253` (las del servidor) aparecen en la LAN pero nmap nunca se reporta a sí mismo. Por eso existe `get_local_ips_in_cidr()` que inyecta las IPs propias del servidor en los resultados del scan.

### Por qué SQLite en lugar de PostgreSQL

La aplicación corre en un único servidor de uso doméstico/PYME. SQLite con WAL mode soporta múltiples lecturas simultáneas y una escritura a la vez sin problemas a esta escala. PostgreSQL añadiría complejidad de despliegue sin beneficio real. El único cuidado necesario es un lock de escritura compartido (`_db_write_lock`) que ya está implementado en todos los módulos que escriben en BD.

### Por qué FastAPI y no Flask/Django

FastAPI da validación automática, documentación OpenAPI en `/docs`, y soporte nativo para async. Para una SPA con muchos endpoints pequeños es más limpio que Flask y más ligero que Django.

### Por qué una SPA Jinja2 en lugar de React/Vue

El proyecto empezó con un único fichero HTML y fue creciendo. Convertirlo a React añadiría un build step, dependencias npm y complejidad de despliegue sin ventaja real para un proyecto self-hosted de uso personal. El patrón actual (Jinja2 + jQuery + Bootstrap) funciona bien y es fácil de mantener.

### Por qué el router SSH como fuente primaria de detección

nmap lanza pings ICMP y espera respuesta. Los móviles Android modernos tienen WiFi power saving agresivo: la radio se duerme entre paquetes y puede no responder a tiempo. El router, en cambio, ve **todo lo que está conectado** porque gestiona el ARP y el DHCP — no depende de que el dispositivo responda a pings. Por eso, si el router está configurado, es la fuente primaria de detección. nmap se usa como complemento cada 2h para detectar dispositivos con IP estática que no aparecen en el DHCP del router.

### Por qué un lock global de escritura en lugar de transacciones por módulo

Al tener scans, quality checks, services checks y router scans corriendo en paralelo, hay riesgo de `database is locked` con SQLite. Un único threading.Lock() compartido entre todos los módulos que escriben serializa las escrituras y elimina el problema completamente. Las lecturas no necesitan lock.

---

## Requisitos previos

- **Docker** y **Docker Compose** instalados en el servidor
- El servidor debe estar **conectado a la red que se quiere monitorizar** (cableado o WiFi)
- Para monitorizar múltiples redes: el servidor necesita interfaces de red en cada una (ej. `enp3s0` en 192.168.1.x y `wlp2s0` en 192.168.18.x)
- Para integración con router: clave SSH del servidor copiada al router
- (Opcional) API key de Gemini o Mistral para análisis IA cloud, o Ollama instalado localmente

---

## Instalación paso a paso

### 1. Clonar/copiar el proyecto

```bash
mkdir -p /SERVER/VM/Auditor_IPs
cd /SERVER/VM/Auditor_IPs
# Copiar todos los ficheros del proyecto aquí
```

### 2. Crear el directorio de datos

```bash
mkdir -p data
```

### 3. Crear el .env

```bash
cp .env.example .env
nano .env  # Editar con los valores del entorno
```

Variables mínimas para arrancar:

```env
SCAN_CIDR=192.168.1.0/24
SERVER_IP=192.168.1.253
PORT=8088
DB_PATH=/data/auditor.db
```

### 4. Preparar la clave SSH del router (si se quiere integración)

```bash
# Generar clave si no existe
ssh-keygen -t ed25519 -f ~/.ssh/router_auditor -N ""

# Copiar clave pública al router (Asus con SSH habilitado)
ssh-copy-id -i ~/.ssh/router_auditor.pub admin@192.168.1.1

# Verificar
ssh -i ~/.ssh/router_auditor admin@192.168.1.1 "arp -a" | head -3
```

### 5. Build y arranque

```bash
docker compose build --no-cache
docker compose up -d
```

### 6. Primer acceso

Ir a `https://192.168.1.253:8088` en el navegador. El certificado TLS es autofirmado — el navegador pedirá excepción de seguridad.

En el primer acceso sin usuarios configurados, la aplicación funciona en modo libre (sin login). Para crear el primer admin: Config → Seguridad → Nuevo usuario.

### 7. Configuración inicial recomendada

En este orden:

1. **Config → Escáner**: verificar el CIDR, ajustar intervalo (300s por defecto)
2. **Config → Redes**: añadir nombre e interfaz a la red principal; añadir redes secundarias si hay más de una
3. **Config → Router SSH**: configurar si hay router Asus con SSH (mejora drásticamente la detección)
4. **Config → Escáner → Motor de detección**: elegir fuente primaria (Router si está configurado)
5. **Config → Notificaciones**: webhook Discord si se quieren alertas
6. **Lanzar primer scan**: botón "Escanear ahora" en el topbar

---

## Variables de entorno

Las variables son **semilla de primer arranque**. Una vez en BD, los settings se gestionan desde la UI y persisten en SQLite. Cambiar una variable de entorno después del primer arranque no tiene efecto — hay que cambiarla desde Config o resetear la BD.

| Variable                | Ejemplo                   | Descripción                                     |
| ----------------------- | ------------------------- | ----------------------------------------------- |
| `SCAN_CIDR`             | `192.168.1.0/24`          | CIDR principal. Multi-CIDR separado por comas   |
| `SERVER_IP`             | `192.168.1.253`           | IP del servidor (SAN del certificado TLS)       |
| `PORT`                  | `8088`                    | Puerto HTTPS                                    |
| `DB_PATH`               | `/data/auditor.db`        | Ruta de la BD dentro del contenedor             |
| `DNS_SERVER`            | `192.168.1.252`           | DNS local (Pi-hole compatible). Vacío = sistema |
| `SCAN_INTERVAL_SECONDS` | `300`                     | Intervalo entre scans automáticos               |
| `DISCORD_WEBHOOK_URL`   | `https://discord.com/...` | Webhook para notificaciones                     |
| `ROUTER_SSH_HOST`       | `192.168.1.1`             | IP del router                                   |
| `ROUTER_SSH_PORT`       | `1999`                    | Puerto SSH del router                           |
| `ROUTER_SSH_USER`       | `admin`                   | Usuario SSH del router                          |
| `ROUTER_SSH_KEY`        | `/app/router_key`         | Ruta de la clave SSH dentro del contenedor      |
| `AI_PROVIDER`           | `gemini`                  | Proveedor IA: `gemini`, `mistral`, `ollama`     |
| `GEMINI_API_KEY`        | `AIzaSy...`               | API key de Gemini (aistudio.google.com, gratis) |
| `MISTRAL_API_KEY`       | `...`                     | API key de Mistral (console.mistral.ai, gratis) |
| `OLLAMA_URL`            | `http://localhost:11434`  | URL de Ollama local                             |

### Volúmenes Docker

```yaml
volumes:
  - ./data:/data                          # BD + certificados TLS + known_hosts SSH
  - ~/.ssh/router_auditor:/app/router_key:ro   # Clave SSH del router (solo lectura)
  - /path/to/scripts_status:/data/scripts_status:ro  # .status.json de scripts
  - /path/to/docs:/data/scripts_prompts:ro     # Docs del sistema de monitorización
  - ./Documentacion:/data/auditor_docs:ro       # README y docs del proyecto
```

---

## Estructura de ficheros

```
app/
├── main.py                  # Orquestador: registra routers, middleware, scheduler
├── database.py              # init_db() con 25+ tablas, migraciones automáticas
├── config.py                # cfg(), save_setting(), cfg_defaults() — la fuente de verdad de settings
├── utils.py                 # Helpers: utc_now, oui_lookup, discord_notify, send_push
├── auth_middleware.py       # Middleware de autenticación, PBKDF2, audit log
├── routers/
│   ├── auth.py              # /login, CRUD usuarios, sesiones
│   ├── hosts.py             # CRUD hosts + renderiza el template SPA
│   ├── scans.py             # Motor de scan: nmap, router, auto-interfaz, discrepancias, IA
│   ├── services.py          # Monitor TCP/HTTP/HTTPS
│   ├── quality.py           # Monitor calidad (ping a targets externos)
│   ├── alerts.py            # CRUD alertas, evaluate_alerts()
│   ├── router_ssh.py        # Helpers SSH: fetch_router_data(), fingerprint
│   ├── config_api.py        # API de settings, redes, backup, interfaces, discrepancias
│   ├── scripts_status.py    # Estado scripts, log en vivo, análisis IA scripts
│   └── daily_report.py      # Informe diario IA (cron 06:00)
├── templates/
│   └── index.html           # SPA completa (~3.950 líneas, Jinja2 + Bootstrap 5)
└── static/
    ├── js/
    │   ├── app.js           # Init global, prefetch, tab persistence
    │   ├── hosts.js         # Tabla hosts, modal, vista por red, verificación cruzada
    │   ├── quality.js       # Calidad: ping perpetuo, columnas, mapa iface→label
    │   ├── scans.js         # Historial scans, gráfica
    │   ├── services.js      # Monitor servicios, gráficas
    │   ├── alerts.js        # CRUD alertas
    │   ├── config.js        # Toda la UI de configuración
    │   ├── auth.js          # Login, sesiones, usuarios
    │   ├── audit.js         # Audit log
    │   └── scripts.js       # Procesos, log en vivo, análisis IA
    └── cdn/                 # Bootstrap, jQuery, Chart.js (local, sin internet)
```

---

## Cómo funciona cada módulo

### Scan de hosts

El scan se lanza automáticamente según el intervalo configurado (APScheduler) o manualmente desde el topbar.

**Flujo cuando router está configurado como fuente primaria:**

1. `run_scan()` llama a `_run_router_primary_scan()` para la red principal
2. Se conecta al router via SSH y ejecuta `arp -a` + lee `dnsmasq.leases`
3. Cada IP que ve el router → `online` en BD
4. Si el router no es accesible → fallback automático a nmap
5. Para redes secundarias → siempre `_run_scan_inner()` con nmap (el router no las ve)
6. Cada 2h corre `run_nmap_complement_scan()` que busca IPs en el CIDR del router que nmap ve pero el router no → van a `scan_discrepancies`
7. DNS se resuelve en background (thread separado, no bloquea el resultado)
8. `get_local_ips_in_cidr()` inyecta las IPs propias del servidor (nmap nunca se reporta a sí mismo)
9. Protección anti-vaciado: si todos los scans devuelven 0 hosts y antes había hosts, se revierte el UPDATE offline y se aborta el ciclo

**Flujo cuando nmap es fuente primaria (sin router):**

1. `run_scan()` llama a `_run_scan_inner()` para cada CIDR
2. `auto_detect_interface(cidr)` detecta la interfaz correcta mirando qué interfaz local tiene IP en ese CIDR — crucial para redes secundarias
3. `run_nmap_ping_sweep()` lanza nmap con `-sn -n --min-rtt-timeout 200ms` (sin DNS, tiempo mínimo para móviles WiFi)
4. El resto del flujo es igual

### Detección de interfaces de red

El servidor tiene dos interfaces: `enp3s0` (192.168.1.253) y `wlp2s0` (192.168.18.9). Cuando nmap escanea 192.168.18.0/24, necesita salir por `wlp2s0` o no verá nada. `auto_detect_interface("192.168.18.0/24")` lee `ip -j addr` y busca qué interfaz local tiene IP dentro de ese CIDR. Sin esta función, nmap usaría la ruta por defecto (`enp3s0`) y no detectaría ningún host en la red secundaria.

**Requisito:** `iproute2` debe estar instalado en el Dockerfile. Sin él, `ip -j addr` no existe y la detección falla silenciosamente.

### Verificación cruzada

El botón "Verificación cruzada" en la barra de Hosts (solo visible si router_enabled=1) abre un modal que llama a `/api/router-analysis`. Este endpoint:

1. Obtiene datos frescos del router SSH
2. Obtiene todos los hosts de la BD
3. Filtra los hosts de nmap que están en el CIDR del router
4. Compara con lo que el router reporta
5. Devuelve cuatro listas: discrepancias nmap/router, solo en router, discrepancias de MAC, en común sin problemas

El modal muestra cada categoría con color de fondo diferente. El botón "Analizar ahora" llama a `/api/scan/ai-analyze-now` que genera un informe IA síncrono con causa probable, nivel de riesgo y acción recomendada para cada discrepancia.

### Calidad de conexión

Targets configurables (ej. Google DNS 8.8.8.8 via Tecnocolor, Google Asus 8.8.8.8 via Red principal). Cada target tiene su propia interfaz de salida. El scheduler lanza pings periódicos. El ping bajo demanda corre en bucle perpetuo (1 ping/segundo) hasta que el usuario pulsa "Parar", mostrando una columna por destino con scroll.

El selector de interfaz en Calidad muestra los **nombres de redes configuradas** (ej. "Tecnocolor") no las interfaces crudas del SO (ej. "wlp2s0"). Internamente se mapea nombre→interfaz para el `-I` de ping.

---

## Flujos de las acciones principales

### Escaneo de red (scan manual)

```
Usuario pulsa "Escanear ahora"
  → POST /scan
  → _scan_running.set() (evita scans paralelos)
  → Thread: run_scan(cidr_raw)
    → Determina fuente primaria (router o nmap)
    → Red principal: _run_router_primary_scan() o _run_scan_inner()
    → Redes secundarias: _run_scan_inner() con auto_detect_interface()
    → get_local_ips_in_cidr() inyecta IPs propias
    → Merge resultados → UPDATE hosts SET status=...
    → Protección anti-vaciado
    → Discord/Push si hay eventos
    → DNS en background thread
  → _scan_running.clear()
```

### Login y sesiones

```
Usuario envía credenciales → POST /api/auth/login
  → verify_password(hash PBKDF2-HMAC-SHA256, 310k iteraciones)
  → Si OK: crea sesión (token aleatorio, TTL 8h, cookie httponly+secure)
  → Rate limiting: 10 intentos / 5min → HTTP 429
  → Audit log: acción "login_ok" o "login_fail" con IP y timestamp

Cada request POST/PUT/DELETE:
  → auth_middleware.py verifica el token en auth_sessions
  → Si expirado o inválido → 401 → frontend redirige a /login
```

### Análisis IA de red

```
Usuario pulsa "Analizar ahora" en modal Verificación cruzada
  → POST /api/scan/ai-analyze-now
  → Lee scan_discrepancies WHERE accepted=0 de BD
  → Construye prompt con: CIDR, hora, hosts conocidos, lista de discrepancias
  → Llama al proveedor configurado (Gemini/Mistral/Ollama)
  → Guarda informe en scan_ai_reports
  → Devuelve report_text en JSON → frontend lo renderiza con marked.parse()
```

### Ping de calidad (bajo demanda)

```
Usuario pulsa "Iniciar pings"
  → Loop hasta pulsar "Parar":
    → POST /api/quality/ping-now
      → Para cada target activo: subprocess ping -c4 -I <interfaz> <host>
      → Devuelve JSON con latencia, pérdida, status por target
    → Frontend actualiza columna del target
    → Espera 1 segundo
    → Siguiente ciclo
```

---

## Base de datos

SQLite en `/data/auditor.db`, WAL mode, `synchronous=NORMAL`, cache 8MB. Migraciones automáticas en `init_db()` — añadir una tabla nueva solo requiere añadir el `CREATE TABLE IF NOT EXISTS` en `database.py`.

### Tablas principales

| Tabla                                | Descripción                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| `hosts`                              | IP, MAC, hostnames, status, tipo, tags, notas, campos router |
| `scans`                              | Historial de scans con contadores online/offline/new         |
| `host_events`                        | Cambios de estado, IP, MAC por host                          |
| `host_uptime`                        | Segundos online/offline por host y día                       |
| `host_latency`                       | Latencia por host y timestamp                                |
| `services` / `service_checks`        | Monitor servicios TCP/HTTP                                   |
| `quality_targets` / `quality_checks` | Monitor calidad (ping)                                       |
| `secondary_networks`                 | Redes secundarias (label, CIDR, interfaz)                    |
| `scan_discrepancies`                 | IPs que nmap ve pero el router no (CIDR del router)          |
| `scan_ai_reports`                    | Informes IA de análisis de red                               |
| `settings`                           | Key-value: todos los settings de la aplicación               |
| `alerts`                             | Reglas de alerta (trigger, cooldown, Discord/push)           |
| `monitored_scripts`                  | Scripts a monitorizar (nombre, color, label, orden)          |
| `script_alert_rules`                 | Reglas de alerta por script (missed, max_hours, error, cooldown) |
| `scan_ai_reports`                    | Informes IA de análisis de discrepancias de red              |
| `daily_reports`                      | Informes diarios IA de red                                   |
| `auth_users` / `auth_sessions`       | Usuarios y sesiones                                          |
| `audit_log`                          | Log semántico de acciones                                    |

### Patrón de settings

Todos los settings siguen el mismo patrón: `cfg("key", default)` para leer, `save_setting("key", value)` para escribir. Los defaults están en `cfg_defaults()` en `config.py`. La UI de Config hace PUT a `/api/settings` con un JSON `{key: value}`.

**Error frecuente:** añadir una key nueva en la UI pero olvidar añadirla en `cfg_defaults()`. El endpoint PUT tiene una whitelist de keys permitidas construida desde `cfg_defaults().keys()`.

---

## Seguridad

| Acción                      | Sin usuarios | Con usuarios, sin sesión | Con sesión |
| --------------------------- | ------------ | ------------------------ | ---------- |
| Ver panel (GET)             | ✅            | ✅ (solo lectura)         | ✅          |
| Modificar (POST/PUT/DELETE) | ✅            | ❌ 401                    | ✅          |
| Wake-on-LAN                 | ✅            | ✅                        | ✅          |
| Login excesivo              | —            | 429 tras 10/5min         | —          |
| `/docs`, `/redoc`           | ✅            | ✅                        | ✅          |

Certificado TLS autofirmado. Para instalarlo en el navegador: Config → Apariencia → HTTPS/TLS → "Descargar CA raíz".

---

## Inteligencia Artificial

### Proveedores disponibles

| Proveedor            | Velocidad         | Coste                     | Requisito                            |
| -------------------- | ----------------- | ------------------------- | ------------------------------------ |
| **Gemini Flash 2.0** | ~2-3s             | Gratis hasta 1500 req/día | API key en aistudio.google.com       |
| **Mistral Small**    | ~3-5s             | Gratis (sin tarjeta)      | API key en console.mistral.ai        |
| **Ollama local**     | ~40-60s (sin GPU) | Gratis                    | Ollama instalado + modelo descargado |

### Casos de uso actuales

- **Análisis de scripts**: diagnóstico de logs de scripts automatizados
- **Informe diario de red**: cron 06:00, patrones de hosts, anomalías, historial 14 días
- **Análisis de discrepancias**: para cada IP que nmap ve pero el router no, la IA sugiere causa probable (IP estática, MAC aleatoria, intruso, falso positivo), nivel de riesgo y acción recomendada

### Añadir un nuevo caso de uso de IA

1. Usar la función `_ai_generate(prompt)` de `scripts_status.py` (o replicar el patrón con `_ai_analyze_discrepancies` de `scans.py`)
2. Construir un prompt estructurado con el contexto específico
3. Guardar el resultado en una tabla dedicada (patrón: `scan_ai_reports`)
4. Exponer via endpoint y mostrar en la UI con `marked.parse()`

---

## Notificaciones por email (SMTP)

Configurable en **Config → Notificaciones → Correo electrónico**. Una vez habilitado, los mismos eventos que generan alertas Discord o push se envían también por email.

**Campos configurables:** servidor SMTP (host:puerto), modo TLS (STARTTLS / SSL / sin cifrado), usuario, contraseña, dirección destinatario y remitente opcional.

La función `send_email()` en `config_api.py` usa solo stdlib Python (`smtplib` + `email`), sin dependencias externas. Los errores de envío se loguean pero no interrumpen el flujo principal.

**Eventos que disparan email:**
- Cambios de estado de hosts en la red (nuevos, offline, online, cambio de MAC)
- Alertas programadas (`evaluate_alerts`) — mismas reglas que Discord
- Cambios de estado de servicios TCP/HTTP monitorizados
- Alertas por script (missed + error), respetando el cooldown configurado

**Test de conexión:** botón "Enviar test" en Config → Notificaciones que guarda la configuración y envía un email de prueba al destinatario.

---

## Historial de informes IA de red

Accesible desde **Config → Escáner → Historial de informes IA de red**. Lista los últimos 20 informes generados (automáticamente tras verificaciones secundarias o manualmente desde Verificación cruzada), con fecha, número de discrepancias y preview del texto.

Al pulsar "Ver" en cualquier informe, se abre un modal con el texto completo renderizado en Markdown.

**Endpoints:** `GET /api/scan/ai-reports?limit=N` (lista con preview) · `GET /api/scan/ai-reports/{id}` (texto completo).

---

## Exportación histórica

En **Config → Exportar / Importar → Exportación histórica**. Permite descargar un Excel con datos históricos de uptime, latencia y servicios filtrados por rango de fechas.

El fichero incluye tres hojas: **Uptime** (segundos online/offline por host y día, con % y formato h:m), **Latencia** (agrupada por hora para mantener el fichero manejable), **Servicios** (checks individuales con estado, latencia y error). Se genera en memoria y se devuelve como descarga directa sin escribir en disco.

**Endpoint:** `GET /api/export/history?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`. Si se omiten las fechas, devuelve los últimos 30 días.

---

## Pestañas ocultables

Las pestañas **Dashboard, Hosts y Ejecuciones** son fijas y siempre visibles. El resto (Servicios, Mapa, Calidad, Grupos, Alertas, Procesos) se pueden ocultar individualmente desde **Config → Interfaz**.

El estado se guarda en la BD como un CSV en la key `hidden_tabs` (ej. `"quality,groups"`). Al cargar la página, `applyHiddenTabs()` lee este valor y oculta los `<li>` correspondientes del nav sin recargar la página. Si la pestaña activa queda oculta, redirige automáticamente al Dashboard.

Para reactivar una pestaña: Config → Interfaz → marcar el checkbox → Aplicar.

---

## Alertas por script

El sistema comprueba cada 15 minutos si algún script monitorizado cumple condiciones de alerta configuradas en **Config → Procesos → Alertas por script**.

### Condiciones disponibles

| Condición | Campo | Descripción |
| --------- | ----- | ----------- |
| Sin ejecutarse | `alert_missed` + `max_hours` | Dispara si `last_run` tiene más de X horas de antigüedad |
| Fallo | `alert_error` | Dispara si `exit_code ≠ 0` en la última ejecución |

### Cooldown

Cada regla tiene un `cooldown_min` (por defecto 60 min). Si se dispara una alerta, no vuelve a dispararse hasta que pasen X minutos. El campo `last_fired` en BD registra cuándo fue la última vez.

### Canales de notificación

Se reutilizan los canales existentes: Discord webhook (si configurado) y push PWA. No requiere configuración adicional.

### Tabla en BD

```sql
script_alert_rules (
    script_name  TEXT UNIQUE,   -- nombre del .status.json sin extensión
    alert_missed INTEGER,       -- 1 = activo
    max_hours    REAL,          -- horas máximas sin ejecutarse
    alert_error  INTEGER,       -- 1 = activo
    cooldown_min INTEGER,       -- minutos entre alertas
    last_fired   TEXT           -- ISO timestamp de la última alerta disparada
)
```

---

## Multi-idioma

La interfaz soporta tres idiomas seleccionables en **Config → Apariencia**: español (por defecto), inglés y catalán. El selector muestra botones con las banderas de España, Reino Unido y Cataluña.

El motor `i18n.js` tiene los diccionarios incrustados directamente (sin peticiones adicionales al servidor), lo que garantiza la traducción instantánea desde el primer render. El idioma elegido se persiste en `localStorage` para respuesta inmediata y en BD (`settings.ui_lang`) para sincronización entre sesiones y dispositivos.

**Para añadir traducciones a elementos nuevos:** añadir el atributo `data-i18n="clave"` en el HTML. La función `window.t('clave')` está disponible globalmente para uso en JS dinámico.

---

## Dashboard móvil

En dispositivos móviles (< 768px), los widgets del dashboard son reordenables con arrastre táctil gracias a **SortableJS**. Cada widget muestra un icono de grip (`⠿`) en su cabecera al que agarrarse para arrastrar.

El delay táctil de 150ms evita que el gesto de arrastre interfiera con el scroll vertical normal de la página. El orden se guarda automáticamente en BD al soltar un widget (`/api/dashboard/layout`) y se restaura en la próxima carga.

En escritorio el reordenamiento también funciona arrastrando desde el handle, aunque los handles no son visibles hasta que se entra en una pantalla estrecha.

---

## Reglas de despliegue

Esta es la regla más importante para no romper nada:

| Tipo de cambio                    | Acción necesaria                                          |
| --------------------------------- | --------------------------------------------------------- |
| Solo `.js` o `.html`              | `docker cp` + Ctrl+Shift+R en navegador (sin restart)     |
| Fichero `.py`                     | `docker cp` + `docker compose restart auditor_ips`        |
| `Dockerfile` o `requirements.txt` | `docker compose build --no-cache && docker compose up -d` |
| Nueva variable de entorno         | `docker compose down && docker compose up -d`             |
| Nuevo fichero Python              | Copiar + rebuild completo                                 |

### Comandos habituales

```bash
# Actualizar un fichero Python
docker cp routers/scans.py auditor_ips:/app/routers/scans.py
docker compose restart auditor_ips

# Actualizar HTML/JS (sin restart)
docker cp templates/index.html auditor_ips:/app/templates/index.html
docker cp static/js/hosts.js auditor_ips:/app/static/js/hosts.js
# Luego Ctrl+Shift+R en el navegador

# Rebuild completo
cd /SERVER/VM/Auditor_IPs
docker compose build --no-cache && docker compose up -d

# Ver logs en tiempo real
docker logs -f auditor_ips

# Acceder al shell del contenedor
docker exec -it auditor_ips bash

# Verificar interfaces de red
docker exec auditor_ips ip -j addr

# Consultar BD
docker exec auditor_ips python3 -c "
from database import db
with db() as c:
    for r in c.execute(\"SELECT ip, status, mac FROM hosts WHERE status='online'\").fetchall():
        print(dict(r))
"
```

---

## Errores conocidos y cómo evitarlos

Esta sección recoge los errores más significativos que ocurrieron durante el desarrollo para no repetirlos.

### `database is locked`

**Causa:** múltiples threads intentando escribir en SQLite simultáneamente. Ocurrió cuando `purge_expired_sessions` abría una conexión dentro de `_db_write_lock`, creando un deadlock.

**Solución:** usar siempre el `_db_write_lock` compartido para todas las escrituras. Las lecturas no necesitan lock. El lock es un `threading.Lock()` importado desde `scans.py` a todos los módulos que escriben.

**Patrón correcto:**

```python
with _db_write_lock:
    with db() as conn:
        conn.execute("INSERT ...")
```

### Botones dinámicos sin respuesta

**Causa:** usar `$('#id').on('click', fn)` en elementos que se renderizan dinámicamente después de la carga del DOM. El handler se registra antes de que el elemento exista.

**Solución:** siempre usar `$(document).on('click', '#id', fn)` para elementos dinámicos.

### `ip -j addr` command not found dentro del contenedor

**Causa:** la imagen `python:3.12-slim` no incluye `iproute2`. Sin él, la detección de interfaces falla silenciosamente y `auto_detect_interface()` devuelve string vacío.

**Solución:** añadir `iproute2` al `RUN apt-get install` del Dockerfile. Requiere rebuild completo.

### nmap no detecta el propio host del servidor

**Causa:** nmap nunca reporta el host desde el que se lanza el scan. Con `network_mode: host`, el contenedor y el servidor comparten IPs, por lo que `192.168.18.9` (wlp2s0) nunca aparece en los resultados.

**Solución:** `get_local_ips_in_cidr(cidr)` lee `ip -j addr`, encuentra las IPs locales dentro del CIDR escaneado, y las inyecta en `found_by_ip` con latencia 0ms antes del merge con BD.

### Red secundaria no detectada

**Causa:** si no se especifica interfaz para la red secundaria en `secondary_networks.interface`, nmap usa la ruta por defecto (`enp3s0`) que no tiene visibilidad hacia `192.168.18.0/24`.

**Solución:** `auto_detect_interface("192.168.18.0/24")` lee las IPs locales y devuelve `wlp2s0` porque esa interfaz tiene `192.168.18.9` que cae dentro del CIDR. Se llama automáticamente si la interfaz no está configurada explícitamente.

### Móvil Android no detectado por nmap

**Causa:** los móviles Android tienen WiFi power saving agresivo. La radio puede tardar 150-400ms en despertar y responder al ping. El nmap por defecto tiene timeouts más cortos.

**Solución 1 (parcial):** añadir `--min-rtt-timeout 200ms` al comando nmap.

**Solución 2 (completa):** usar el router SSH como fuente primaria. El router gestiona el ARP y sabe que el móvil está conectado independientemente de si responde a pings.

### Pings automáticos de Calidad se abortaban silenciosamente

**Causa:** dentro de `run_quality_checks()`, se usaba una conexión SQLite `conn` después de salir del bloque `with db() as conn:`. Al salir del `with`, SQLite cierra la conexión. Las llamadas posteriores a `conn` lanzaban una excepción que era capturada silenciosamente.

**Solución:** abrir una segunda conexión `conn2` para el bloque de evaluación de anomalías y alertas.

### Análisis IA daba error al pulsar "Analizar ahora"

**Causa:** el endpoint `/api/scan/ai-analyze-now` llamaba a `run_secondary_scan_with_ai()` que primero comprobaba `scan_secondary_source`. Si valía `"none"` (el default), la función retornaba sin hacer nada y sin devolver error al frontend.

**Solución:** reescribir el endpoint para que ejecute el análisis IA directamente, leyendo las discrepancias de BD e invocando `_ai_analyze_discrepancies()`, sin depender de ninguna configuración de scan secundario.

### Redes secundarias no guardaban al pulsar Añadir

**Causa:** el botón en HTML tenía `id="cfgNetAddBtn"` pero el handler en `config.js` escuchaba `$(document).on('click', '#cfgNetAdd', ...)`. La diferencia de `Btn` al final hacía que el click nunca llegara al handler.

**Solución:** cambiar el ID del botón en HTML para que coincida con el selector del handler.

### SSE (Server-Sent Events) de pings no llegaban al navegador

**Causa:** uvicorn con un proxy inverso (nginx) bufferiza el stream antes de enviarlo al cliente. Los eventos SSE llegaban todos juntos al final en lugar de uno a uno.

**Solución:** reemplazar SSE por un endpoint POST síncrono que devuelve todos los resultados en un único JSON. El frontend muestra feedback inmediato ("iniciando…") y luego reemplaza con los resultados reales.

---

## Guía para nuevas implementaciones

Esta sección es para quien quiera desplegar Auditor IPs en su propia red, con una configuración diferente.

### Adaptaciones necesarias según el entorno

**Router diferente al Asus Mediatek:**

El código actual en `router_ssh.py` parsea la salida específica de `arp -a` y `cat /var/lib/misc/dnsmasq.leases` de Asus. Para otro router hay que modificar `fetch_router_data()`:

- `arp -a` suele tener formato similar en la mayoría de routers Linux
- Los leases DHCP pueden estar en `/tmp/dnsmasq.leases` o `/var/run/dnsmasq/dnsmasq-dhcp.leases` según el router
- OpenWRT: `cat /tmp/dhcp.leases` en lugar de dnsmasq

**Sin router SSH:**

Simplemente no configurar `ROUTER_SSH_HOST` ni activar `router_enabled`. El sistema usará nmap como fuente primaria y funcionará bien, aunque no detectará móviles con ICMP bloqueado.

**Red diferente a /24:**

El código asume /24 en varios sitios (especialmente en la agrupación por subred). Para /16 o /23 habría que revisar `auto_detect_interface()` y el cálculo de subredes en `hosts.js`.

**Múltiples redes en el mismo servidor:**

El patrón ya está implementado: `secondary_networks` en BD, cada una con su CIDR, label e interfaz. `auto_detect_interface()` elige la interfaz correcta automáticamente si se deja vacío.

### Cómo añadir una nueva pestaña/módulo

1. Crear el router Python en `routers/nuevo_modulo.py`
2. Registrar en `main.py`: `from routers.nuevo_modulo import router as r_nuevo; app.include_router(r_nuevo)`
3. Añadir el panel en `index.html` (seguir el patrón de hostsView/qualityView)
4. Crear `static/js/nuevo_modulo.js` con el patrón `$(function() { ... })`
5. Añadir la carga del script en `index.html` respetando el orden: app.js primero, luego módulos
6. Si necesita tablas en BD: añadir `CREATE TABLE IF NOT EXISTS` en `database.py`
7. Si necesita settings: añadir la key con su default en `cfg_defaults()` en `config.py`

### Cómo añadir un nuevo proveedor IA

En `scripts_status.py` y en `scans.py`, seguir el patrón de `_gemini_generate()`:

```python
def _nuevo_proveedor_generate(prompt: str) -> str:
    key   = cfg("ai_nuevo_key", "")
    model = cfg("ai_nuevo_model", "modelo-default")
    # ... llamada HTTP ...
    return texto_respuesta

# En _ai_generate() añadir:
elif provider == "nuevo":
    return _nuevo_proveedor_generate(prompt), model
```

Añadir las keys en `cfg_defaults()` y en la UI de Config → IA.

### Diagnóstico cuando algo no funciona

```bash
# 1. Ver logs del contenedor
docker logs -f auditor_ips 2>&1 | grep -i "error\|warn\|exception"

# 2. Verificar que las interfaces de red se detectan
docker exec auditor_ips python3 -c "
import subprocess, json
r = subprocess.run(['ip','-j','addr'], capture_output=True, text=True)
for i in json.loads(r.stdout):
    print(i['ifname'], i.get('operstate'), [a['local'] for a in i.get('addr_info',[]) if a.get('family')=='inet'])
"

# 3. Verificar que nmap puede ver la red
docker exec auditor_ips nmap -sn -n 192.168.1.0/24 2>&1 | tail -3

# 4. Verificar conexión al router
docker exec auditor_ips ssh -i /app/router_key -o StrictHostKeyChecking=no admin@192.168.1.1 "echo OK"

# 5. Ver la BD directamente
docker exec auditor_ips python3 -c "
from database import db
with db() as c:
    print('Hosts online:', c.execute(\"SELECT COUNT(*) FROM hosts WHERE status='online'\").fetchone()[0])
    print('Discrepancias pendientes:', c.execute(\"SELECT COUNT(*) FROM scan_discrepancies WHERE accepted=0\").fetchone()[0])
    print('Último scan:', c.execute(\"SELECT finished_at FROM scans ORDER BY id DESC LIMIT 1\").fetchone())
"

# 6. Reinicio limpio si hay problemas raros
docker compose restart auditor_ips
```

---

## Nota sobre el certificado TLS

```
SecurityError: An SSL certificate error occurred when fetching the script (sw.js)
```

Este error en consola es inofensivo — solo afecta a las notificaciones push cuando el SW no puede cargar el certificado autofirmado. No afecta a ninguna funcionalidad. Para eliminarlo: Config → Apariencia → HTTPS/TLS → "Descargar CA raíz" e instalarla en el sistema.

---

*Auditor IPs · cpueyo · ServerLinuxAuxiliar · marzo 2026 · Sesión 26 completada*
