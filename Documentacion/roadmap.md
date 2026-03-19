# AUDITOR IPs — Roadmap

|                              |                                                              |
| ---------------------------- | ------------------------------------------------------------ |
| **Sesión actual**            | 26ª (en curso)                                               |
| **Última sesión completada** | 26ª (15-Mar-2026)                                            |
| **Features implementadas**   | 142+                                                         |
| **Líneas de código**         | ~7.100 backend · ~4.400 index.html · ~9.700 JS (11 módulos) |
| **Valoración global**        | **9.6/10**                                                   |

---

## 1. Descripción del Proyecto

Auditor IPs es una aplicación web **self-hosted** de monitorización de red local (LAN). Escanea rangos CIDR multi-red, identifica dispositivos, monitoriza servicios TCP/HTTP, configura alertas, muestra histórico de uptime/latencia, analiza scripts del servidor con IA, y detecta intrusiones contrastando fuentes (router SSH vs nmap). Corre en Docker con FastAPI + SQLite + Bootstrap 5.

### Stack

| Capa           | Tecnología                                                                     |
| -------------- | ------------------------------------------------------------------------------ |
| **Backend**    | Python 3.12, FastAPI, Uvicorn HTTPS (TLS autofirmado), APScheduler, SQLite WAL |
| **Frontend**   | Jinja2 SPA, Bootstrap 5, jQuery, DataTables, Chart.js                          |
| **Red**        | nmap, iputils-arping, iproute2, ARP cache (/proc/net/arp)                      |
| **Router SSH** | SSH clave pública → /proc/net/arp + dnsmasq.leases (Asus Mediatek)             |
| **IA**         | Gemini Flash 2.0 · Mistral Small · Ollama local (gemma2:2b)                    |
| **Auth**       | Multi-usuario, sesiones PBKDF2-HMAC-SHA256, audit log semántico SQLite         |
| **Infra**      | Docker Compose, network_mode: host, cap NET_RAW + NET_ADMIN, 5 volúmenes       |
| **Puerto**     | 8088 HTTPS, certificado TLS con SAN configurable por SERVER_IP                 |

---

## 2. Features Completadas ✅

### 2.1 Red y Escaneo

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Ping sweep nmap (-sn -n), MAC + latencia | ✅ | 1 |
| DNS PTR asíncrono (ThreadPoolExecutor 16, Pi-hole compatible) | ✅ | 1 |
| OUI Lookup (fabricante desde prefijo MAC) | ✅ | 1 |
| ARP cache local (/proc/net/arp) como backup de MAC | ✅ | 1 |
| Multi-CIDR (scans paralelos, chips con validación) | ✅ | 10 |
| auto_detect_interface(cidr) — elige interfaz correcta por CIDR | ✅ | 22 |
| get_local_ips_in_cidr() — inyecta IPs propias (nmap las omite) | ✅ | 22 |
| DNS en background post-scan (no bloquea resultado) | ✅ | 22 |
| Protección anti-vaciado (0 hosts → revierte offline, no machaca BD) | ✅ | 22 |

### 2.2 Motor de Detección Dual (Sesión 22)

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Router SSH como fuente primaria (detecta 100% dispositivos) | ✅ | 22 |
| nmap como fuente primaria (cuando no hay router) | ✅ | 22 |
| Scan secundario configurable (nmap o router, intervalo o manual) | ✅ | 22 |
| Scan nmap complementario cada 2h (APScheduler, solo discrepancias) | ✅ | 22 |
| Fallback automático a nmap si router no accesible | ✅ | 22 |
| Config → Escáner → Motor de detección (UI completa) | ✅ | 22 |
| `/api/scan/reconfigure-jobs` (aplica cambios en caliente) | ✅ | 22 |

### 2.3 Integración Router SSH

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| SSH con clave pública, fingerprint persistente | ✅ | 5 |
| ARP del router + dnsmasq.leases (hostname DHCP, lease TTL) | ✅ | 5 |
| Hosts silent (online_silent: router ve, nmap no) | ✅ | 5 |
| Panel Config → Router SSH (host/puerto/user/key, test) | ✅ | 6 |
| Reset fingerprint SSH desde UI | ✅ | 10 |

### 2.4 Hosts

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Tabla DataTables (filtros, búsqueda, columnas ocultables) | ✅ | 1 |
| Tags/Etiquetas (BD + widget modal + filtro) | ✅ | 7 |
| Uptime calendar (30 días histórico) | ✅ | 7 |
| Vista árbol por red (botón "Por red" — secciones por red configurada) | ✅ | 22 |
| Vista Grupos con modo "Red" (iconos primaria/secundaria, CIDR) | ✅ | 22 |
| Verificación cruzada (modal nmap vs router: discrepancias, solo-router, MACs) | ✅ | 22 |

### 2.5 Discrepancias y Seguridad

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Tabla scan_discrepancies (IP, MAC, first/last seen, accepted) | ✅ | 22 |
| Detección: nmap ve, router NO ve (solo en CIDR del router) | ✅ | 22 |
| IPs fuera del CIDR del router → nunca son discrepancia | ✅ | 22 |
| UI Config → Escáner: tabla pendientes/aceptadas, aceptar/eliminar | ✅ | 22 |
| Badge ⚠ en topbar con contador de discrepancias (polling 5 min) | ✅ | 22 |
| Botón "Scan nmap ahora" para detección manual | ✅ | 22 |

### 2.6 IA — Análisis de Red

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| _ai_analyze_discrepancies() — prompt con contexto completo | ✅ | 22 |
| Informe Markdown: causa probable + riesgo + acción por discrepancia | ✅ | 22 |
| Tabla scan_ai_reports en BD | ✅ | 22 |
| Endpoint síncrono /api/scan/ai-analyze-now | ✅ | 22 |
| Informe visible en modal Verificación cruzada | ✅ | 22 |
| Toggle IA post-verificación en Config → Escáner | ✅ | 22 |
| Ollama local (gemma2:2b) | ✅ | 13 |
| Gemini Flash 2.0 | ✅ | 14 |
| Mistral Small | ✅ | 15 |
| Análisis scripts con prompt estructurado | ✅ | 15 |
| Informe diario IA de red (cron 06:00, historial 14d) | ✅ | 15 |

### 2.7 Calidad de Conexión

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Monitor ping (targets configurables, interfaz por target) | ✅ | 3-21 |
| Gráfica latencia + líneas verticales en pérdida | ✅ | 3-4 |
| Ping perpetuo bajo demanda (loop 1/seg, columnas por destino) | ✅ | 21 |
| Selector muestra redes configuradas (no interfaces crudas SO) | ✅ | 21 |
| Red principal con interfaz configurable en settings | ✅ | 22 |

### 2.9 UX — Sesión 23

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Pestañas ocultables (hidden_tabs en BD, toggle en Config → Interfaz) | ✅ | 23 |
| applyHiddenTabs() — aplica sin reload, redirige al Dashboard si pestaña activa oculta | ✅ | 23 |
| Dashboard, Hosts y Ejecuciones fijos (no ocultables) | ✅ | 23 |

### 2.10 Alertas por Script — Sesión 23

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Tabla script_alert_rules en BD (missed, max_hours, error, cooldown, last_fired) | ✅ | 23 |
| GET/PUT/DELETE /api/scripts/alert-rules | ✅ | 23 |
| check_script_alerts() — motor de checks cada 15 min (APScheduler) | ✅ | 23 |
| Condición 1: sin ejecutarse más de X horas | ✅ | 23 |
| Condición 2: última ejecución con exit_code ≠ 0 | ✅ | 23 |
| Cooldown configurable por script (evita spam) | ✅ | 23 |
| Notificación Discord + push PWA | ✅ | 23 |
| UI en Config → Procesos: fila por script con toggles y campos inline | ✅ | 23 |

### 2.13 Historial Informes IA de Red — Sesión 24

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| GET /api/scan/ai-reports/{id} — informe completo por ID | ✅ | 24 |
| Sección historial en Config → Escáner (últimos 20, preview, badge discrepancias) | ✅ | 24 |
| Modal detalle con Markdown renderizado | ✅ | 24 |
| Carga automática al abrir panel Escáner | ✅ | 24 |

### 2.14 UX Fix + Notificaciones Email — Sesión 25

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Fix icono Config → Interfaz (bi-layout-tabs → bi-toggles, compatible BI 1.11) | ✅ | 25 |
| Descripciones por pestaña en panel Interfaz (para qué sirve cada sección) | ✅ | 25 |
| SMTP email: 8 keys en cfg_defaults() + allowed set en config_api.py | ✅ | 25 |
| Función send_email() — stdlib pura (smtplib), STARTTLS / SSL / sin cifrado | ✅ | 25 |
| Endpoint POST /api/settings/test-smtp | ✅ | 25 |
| UI completa en Config → Notificaciones: host, puerto, TLS, user, pass, to, from, test | ✅ | 25 |
| Email integrado en alertas de red (scans.py: eventos + evaluate_alerts) | ✅ | 25 |
| Email integrado en alertas de servicios (services.py) | ✅ | 25 |
| Email integrado en alertas de scripts (scripts_status.py) | ✅ | 25 |

### 2.15 Multi-idioma i18n — Sesión 26

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| Motor i18n.js con diccionarios incrustados (sin fetch, sin 404) | ✅ | 26 |
| 3 idiomas: ES / EN / CA con 62 keys cada uno | ✅ | 26 |
| Selector con banderas SVG inline (España, Reino Unido, Cataluña) | ✅ | 26 |
| Persistencia en BD (key `ui_lang`) + localStorage como fallback inmediato | ✅ | 26 |
| `window.t('key')`, `setLang()`, `applyI18n()` — API pública para JS dinámico | ✅ | 26 |
| 21 elementos marcados con `data-i18n` (nav, sidebar Config, botones) | ✅ | 26 |
| Fix: `ui_lang` añadida al `allowed` set del PUT /api/settings | ✅ | 26 |

### 2.16 Dashboard Móvil — Sesión 26

| Feature | Estado | Sesión |
| ------- | ------ | ------ |
| SortableJS 1.15 (jsdelivr) — reordenamiento táctil y escritorio | ✅ | 26 |
| Handle de arrastre `bi-grip-vertical` — visible solo en móvil (< 768px) | ✅ | 26 |
| CSS: sortable-ghost, sortable-drag, touch-action:pan-y (no bloquea scroll) | ✅ | 26 |
| Delay táctil 150ms para no interferir con scroll vertical | ✅ | 26 |
| Orden persistido en BD via `/api/dashboard/layout` (widget_order array) | ✅ | 26 |
| Reinicialización automática al girar el dispositivo | ✅ | 26 |
| Nota informativa "Arrastra los widgets" solo visible en móvil | ✅ | 26 |

### 2.12 Resto de módulos completados
| ------ | ------ | ------ |
| Dashboard (KPIs, widgets personalizables, countdown) | ✅ | 1-8 |
| Servicios TCP/HTTP (monitor, gráficas, selector rango) | ✅ | 1-6 |
| Procesos programados (log en vivo, análisis IA, color/etiqueta) | ✅ | 12-20 |
| Alertas (CRUD, Discord, push PWA, VAPID) | ✅ | 1-9 |
| Auth (multi-usuario, PBKDF2, rate limiting, audit log) | ✅ | 5-9 |
| Config modal fullscreen + móvil optimizado | ✅ | 18-19 |
| 10 temas + 6 animaciones + acento personalizado | ✅ | 10 |
| TLS autofirmado + CDN local + PWA | ✅ | 9 |
| Tab persistence + prefetch + stale-while-revalidate | ✅ | 19-20 |

---

## 3. Pendiente

### 🔴 Alta prioridad

*Todos los puntos completados.*

### 🟡 Media prioridad

*Todos los puntos completados.*

### 🟢 Baja prioridad

*Todos los puntos completados.*

---

## 🏁 Cierre del Proyecto — Asistente de Despliegue

> **A implementar en la sesión final, una vez todas las features estén completas.**

Script Python multiplataforma (Windows + Linux) que guía al usuario para desplegar Auditor IPs en una máquina nueva desde cero.

### Flujo del asistente

| Paso | Descripción |
| ---- | ----------- |
| **1. Entorno** | Detecta SO automáticamente. Pregunta dónde instalar el proyecto (ruta base). Valida que Docker y Docker Compose estén disponibles; si no, muestra instrucciones. |
| **2. Red principal** | Solicita el CIDR de la red principal (ej. `192.168.1.0/24`). Valida formato. |
| **3. Red secundaria** | Pregunta si existe una red secundaria. Si sí → solicita su CIDR. |
| **4. Router SSH** | Pregunta si se quiere integración SSH con el router. Si sí → solicita host, puerto, usuario y ruta a clave privada. |
| **5. Módulos opcionales** | Pregunta qué módulos activar: Calidad de red, Servicios TCP/HTTP, Procesos programados, Grupos, Alertas Discord/push. |
| **6. Proveedor IA** | Pregunta si se quiere IA. Si sí → elige entre Gemini, Mistral u Ollama local, y solicita API key si aplica. |
| **7. Usuario admin** | Solicita nombre de usuario y contraseña para el primer acceso. |
| **8. Servidor** | Pregunta la IP del servidor (para el certificado TLS con SAN). Puerto (por defecto 8088). |

### Acciones que ejecuta

| Acción | Detalle |
| ------ | ------- |
| Crear estructura de carpetas | `data/`, `logs/`, `certs/`, `cdn/`, etc. según la instalación |
| Generar `docker-compose.yml` | Con variables de entorno, volúmenes y puertos configurados |
| Generar `.env` | Con todas las variables derivadas de las respuestas del asistente |
| Extraer archivos del paquete | Descomprime el tar/zip de distribución en la ruta elegida |
| Instrucciones finales | Muestra el comando exacto para levantar el stack y la URL de acceso |

### Características del script

- **Un solo archivo** `setup.py`, sin dependencias externas (solo stdlib Python 3.8+)
- **Multiplataforma**: detecta Windows / Linux / macOS, adapta rutas y comandos
- **Reanudable**: guarda progreso en `setup_state.json`; si se interrumpe, retoma desde el último paso
- **No destructivo**: nunca sobreescribe archivos existentes sin confirmación explícita
- **Silencioso si no aplica**: los módulos no activados no generan preguntas innecesarias

---

## 4. Historial de Sesiones

| Sesión | Fecha | Contenido principal |
| ------ | ----- | ------------------- |
| 1-3 | Feb-2026 | Core: escaneo, hosts, servicios, alertas, dashboard, calidad |
| 4-8 | Feb-Mar | Gráficas, auth, config, uptime, dashboard personalizable |
| 9-11 | 04-05-Mar | Refactor backend modular, temas, CDN local, frontend modular |
| 12-15 | 09-10-Mar | Procesos, IA (Ollama/Gemini/Mistral), informe diario |
| 16-19 | 11-12-Mar | Config modal, móvil, tab persistence |
| 20 | 12-Mar | Prefetch orquestador, color scripts API |
| 21 | 13-Mar | Calidad refactor: ping perpetuo, redes, iproute2 |
| 22 | 14-Mar | Motor dual router/nmap, auto-interfaz, discrepancias, IA red, vista por red, verificación cruzada |
| 23 | 14-Mar | Pestañas ocultables, alertas por script (missed + error + cooldown + Discord/push) |
| 24 | 14-Mar | Historial informes IA de red (lista + modal detalle); exportación histórica Excel (uptime/latencia/servicios por rango fechas) |
| 25 | 14-Mar | Fix icono Interfaz; descripciones pestañas; alertas email SMTP completo (red, servicios, scripts) |
| 26 | 15-Mar | Multi-idioma ES/EN/CA (i18n.js incrustado, banderas SVG, persistencia BD); dashboard móvil (SortableJS táctil, orden persistido) |

---

## 5. Referencia Rápida

### Reglas de despliegue

| Cambio | Acción |
| ------ | ------ |
| Solo JS o HTML | `docker cp` + Ctrl+Shift+R (sin restart) |
| Python (.py) | `docker cp` + `docker compose restart auditor_ips` |
| Dockerfile o requirements.txt | `docker compose build --no-cache && docker compose up -d` |

### Bugs clave resueltos

| Bug | Fix | Sesión |
| --- | --- | ------ |
| Database is locked | purge_expired_sessions fuera de _db_write_lock | 8 |
| Botones dinámicos sin respuesta | $('#id').on() → $(document).on('click','#id') | 12 |
| Pings automáticos silenciosos | conn SQLite cerrada reutilizada → conn2 | 21 |
| Redes secundarias no guardaban | id="cfgNetAddBtn" ≠ #cfgNetAdd en JS | 21 |
| ip -j addr command not found | Añadir iproute2 al Dockerfile + rebuild | 21 |
| nmap no detecta el propio host | get_local_ips_in_cidr() inyecta IPs locales | 22 |
| Red secundaria no detectada | auto_detect_interface(cidr) elige interfaz por CIDR | 22 |
| Scan devuelve 0 hosts → machaca BD | Protección anti-vaciado + restaurar estados | 22 |
| Análisis IA daba error | Endpoint síncrono directo, sin depender de config scan | 22 |

---

*Auditor IPs · Roadmap actualizado 15-Mar-2026 · Sesión 26 completada · **Todas las features completadas** — solo queda el asistente de despliegue*
