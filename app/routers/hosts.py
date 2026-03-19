"""
routers/hosts.py — Auditor IPs
CRUD de hosts y tipos, tags, WoL, uptime, latencia, búsqueda global, dashboard.
"""

import csv
import io
from datetime import timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Body, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.templating import Jinja2Templates

from auth_middleware import auth_enabled, validate_session, SESSION_COOKIE
from config import cfg, DB_PATH, SCAN_CIDR, WOL_PORT
from database import db
from utils import (
    utc_now, utc_now_iso, to_local_str, human_since, get_app_tz,
    normalize_mac, compute_broadcast_from_cidr, send_wol,
)

router     = APIRouter()
templates  = Jinja2Templates(directory="templates")


# Importadas desde scans para evitar duplicación
def _add_event(conn, ip, event_type, old, new):
    from routers.scans import add_event
    add_event(conn, ip, event_type, old, new)


def _oui_lookup(mac: str) -> str:
    from routers.scans import oui_lookup
    return oui_lookup(mac)


# ══════════════════════════════════════════════════════════════
#  Home page
# ══════════════════════════════════════════════════════════════

@router.get("/", response_class=HTMLResponse)
def home(request: Request):
    token    = request.cookies.get(SESSION_COOKIE)
    enabled  = auth_enabled(DB_PATH)
    username = validate_session(DB_PATH, token) if enabled else None
    app_tz   = get_app_tz(cfg("app_tz", "Europe/Madrid"))

    with db() as conn:
        types = conn.execute("SELECT id, name, icon FROM host_types ORDER BY name ASC").fetchall()
        rows  = conn.execute("""
            SELECT h.ip, h.mac, h.nmap_hostname, h.dns_name, h.manual_name, h.notes,
                   h.first_seen, h.last_seen, h.last_change, h.status,
                   h.type_id, h.known, COALESCE(t.name,'') AS type_name, COALESCE(t.icon,'') AS type_icon,
                   h.last_latency_ms, COALESCE(h.vendor,'') AS vendor, COALESCE(h.tags,'') AS tags,
                   COALESCE(h.router_hostname,'') AS router_hostname,
                   COALESCE(h.ip_assignment,'') AS ip_assignment,
                   h.dhcp_lease_expires, COALESCE(h.router_seen,0) AS router_seen
            FROM hosts h
            LEFT JOIN host_types t ON t.id = h.type_id
            ORDER BY h.status DESC, h.last_seen DESC
        """).fetchall()
        alerts_count = conn.execute("SELECT COUNT(*) c FROM alerts WHERE enabled=1").fetchone()["c"]
        # Secondary networks for host color-coding in the template
        sec_nets = conn.execute(
            "SELECT id, label, cidr, interface, enabled FROM secondary_networks WHERE enabled=1 ORDER BY id ASC"
        ).fetchall()

    from auth_middleware import SESSION_TTL_HOURS
    auth_sections = [s.strip() for s in cfg("auth_sections", "config,alertas").split(",") if s.strip()]

    # Build primary network entries (deduplicated against secondary CIDRs)
    primary_cidr_raw  = cfg("scan_cidr", SCAN_CIDR)
    primary_net_label = cfg("primary_net_label", "") or ""
    sec_cidrs         = {(r["cidr"] or "").strip() for r in sec_nets}
    primary_nets = [
        {"cidr": c.strip(), "label": primary_net_label}
        for c in primary_cidr_raw.split(",")
        if c.strip() and c.strip() not in sec_cidrs
    ]

    hosts = []
    for r in rows:
        hosts.append({
            "ip": r["ip"], "mac": r["mac"] or "",
            "nmap_hostname": r["nmap_hostname"] or "", "dns_name": r["dns_name"] or "",
            "manual_name": r["manual_name"] or "", "notes": r["notes"] or "",
            "type_id": r["type_id"], "type_name": r["type_name"] or "",
            "type_icon": r["type_icon"] or "", "last_latency_ms": r["last_latency_ms"],
            "vendor": r["vendor"] or "", "tags": r["tags"] or "",
            "last_change_raw": r["last_change"] or "",
            "first_seen": to_local_str(r["first_seen"]),
            "last_seen":  to_local_str(r["last_seen"]),
            "last_change": to_local_str(r["last_change"]),
            "seen_ago": human_since(r["last_seen"]), "status": r["status"] or "",
            "known": bool(r["known"]),
            "router_hostname": r["router_hostname"] or "",
            "ip_assignment": r["ip_assignment"] or "",
            "dhcp_lease_expires": r["dhcp_lease_expires"] or "",
            "router_seen": bool(r["router_seen"]),
        })

    return templates.TemplateResponse("index.html", {
        "request":           request,
        "hosts":             hosts,
        "types":             [dict(t) for t in types],
        "scan_cidr":         primary_cidr_raw,
        "primary_nets":      primary_nets,
        "secondary_nets":    [dict(r) for r in sec_nets],
        "primary_net_label": primary_net_label,
        "alerts_count":      alerts_count,
        "auth_enabled":      enabled,
        "is_logged_in":      bool(username),
        "is_admin":          bool(username) or not enabled,
        "router_enabled":    cfg("router_enabled", "0") == "1",
        "current_user":      username or "",
        "auth_sections":     auth_sections,
        "session_ttl":       SESSION_TTL_HOURS,
    })


# ══════════════════════════════════════════════════════════════
#  Hosts CRUD
# ══════════════════════════════════════════════════════════════

@router.get("/api/hosts")
def api_hosts():
    """Listado base de hosts para frontend/prefetch."""
    with db() as conn:
        types = conn.execute("SELECT id, name, icon FROM host_types ORDER BY name ASC").fetchall()
        rows = conn.execute("""
            SELECT h.ip, h.mac, h.nmap_hostname, h.dns_name, h.manual_name, h.notes,
                   h.first_seen, h.last_seen, h.last_change, h.status,
                   h.type_id, h.known, COALESCE(t.name,'') AS type_name, COALESCE(t.icon,'') AS type_icon,
                   h.last_latency_ms, COALESCE(h.vendor,'') AS vendor, COALESCE(h.tags,'') AS tags,
                   COALESCE(h.router_hostname,'') AS router_hostname,
                   COALESCE(h.ip_assignment,'') AS ip_assignment,
                   h.dhcp_lease_expires, COALESCE(h.router_seen,0) AS router_seen
            FROM hosts h
            LEFT JOIN host_types t ON t.id = h.type_id
            ORDER BY h.status DESC, h.last_seen DESC
        """).fetchall()

    hosts = []
    for r in rows:
        hosts.append({
            "ip": r["ip"], "mac": r["mac"] or "",
            "nmap_hostname": r["nmap_hostname"] or "", "dns_name": r["dns_name"] or "",
            "manual_name": r["manual_name"] or "", "notes": r["notes"] or "",
            "type_id": r["type_id"], "type_name": r["type_name"] or "",
            "type_icon": r["type_icon"] or "", "last_latency_ms": r["last_latency_ms"],
            "vendor": r["vendor"] or "", "tags": r["tags"] or "",
            "last_change_raw": r["last_change"] or "",
            "first_seen": to_local_str(r["first_seen"]),
            "last_seen": to_local_str(r["last_seen"]),
            "last_change": to_local_str(r["last_change"]),
            "seen_ago": human_since(r["last_seen"]), "status": r["status"] or "",
            "known": bool(r["known"]),
            "router_hostname": r["router_hostname"] or "",
            "ip_assignment": r["ip_assignment"] or "",
            "dhcp_lease_expires": r["dhcp_lease_expires"] or "",
            "router_seen": bool(r["router_seen"]),
        })

    return {"ok": True, "hosts": hosts, "types": [dict(t) for t in types]}


@router.get("/api/status")
def api_status():
    with db() as conn:
        online  = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='online'").fetchone()["c"]
        offline = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='offline'").fetchone()["c"]
        unknown = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='online' AND known=0").fetchone()["c"]
        last_scan = conn.execute(
            "SELECT started_at, finished_at, new_hosts FROM scans ORDER BY id DESC LIMIT 1"
        ).fetchone()
        recent_new = conn.execute("""
            SELECT ip, mac, manual_name, nmap_hostname, known FROM hosts
            WHERE status='online' AND first_seen >= datetime('now', '-10 minutes')
            ORDER BY first_seen DESC LIMIT 10
        """).fetchall()
        types = conn.execute("SELECT id, name, icon FROM host_types ORDER BY name ASC").fetchall()
    return {
        "ok": True, "online": online, "offline": offline,
        "unknown_online": unknown, "total": online + offline,
        "last_scan": {
            "started_at": last_scan["started_at"] if last_scan else None,
            "finished_at": last_scan["finished_at"] if last_scan else None,
            "new_hosts":  last_scan["new_hosts"] if last_scan else 0,
        } if last_scan else None,
        "recent_new": [dict(r) for r in recent_new],
        "types": [dict(t) for t in types],
    }


@router.get("/api/dashboard")
def api_dashboard(days: int = 14):
    try:
        with db() as conn:
            total_hosts   = conn.execute("SELECT COUNT(*) c FROM hosts").fetchone()["c"]
            online_hosts  = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='online'").fetchone()["c"]
            offline_hosts = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='offline'").fetchone()["c"]
            unknown_hosts = conn.execute("SELECT COUNT(*) c FROM hosts WHERE status='online' AND known=0").fetchone()["c"]

            try:
                uptime_avg = conn.execute("""
                    SELECT AVG(pct) avg FROM (
                        SELECT ip, SUM(online_seconds)*100.0/(SUM(online_seconds)+SUM(offline_seconds)) AS pct
                        FROM host_uptime WHERE date >= date('now','-7 days')
                        GROUP BY ip HAVING SUM(online_seconds)+SUM(offline_seconds) > 0
                    )
                """).fetchone()["avg"]
            except Exception:
                uptime_avg = None

            try:
                lat_avg = conn.execute(
                    "SELECT AVG(last_latency_ms) avg FROM hosts WHERE status='online' AND last_latency_ms IS NOT NULL"
                ).fetchone()["avg"]
                top_lat = conn.execute("""
                    SELECT ip, COALESCE(manual_name,nmap_hostname,dns_name,ip) AS name, last_latency_ms
                    FROM hosts WHERE status='online' AND last_latency_ms IS NOT NULL
                    ORDER BY last_latency_ms DESC LIMIT 5
                """).fetchall()
            except Exception:
                lat_avg = None; top_lat = []

            try:
                svcs = conn.execute("""
                    SELECT s.id, s.name, s.host, s.port, s.service_type, s.access_url,
                           sl.status AS last_status, sc.latency_ms AS last_latency
                    FROM services s
                    LEFT JOIN service_last_status sl ON sl.service_id = s.id
                    LEFT JOIN service_checks sc ON sc.id = (
                        SELECT id FROM service_checks WHERE service_id=s.id ORDER BY checked_at DESC LIMIT 1)
                    WHERE s.enabled=1 ORDER BY s.name
                """).fetchall()
            except Exception:
                svcs = []

            svc_up   = sum(1 for s in svcs if s["last_status"] == "up")
            svc_down = sum(1 for s in svcs if s["last_status"] in ("down", "timeout"))

            try:
                dash_cutoff = (utc_now() - timedelta(days=max(1, int(days)))).strftime('%Y-%m-%dT%H:%M:%S')
                if int(days) == 1:
                    recent_scans = conn.execute("""
                        SELECT finished_at AS day, online_hosts AS avg_online,
                               offline_hosts AS avg_offline,
                               online_hosts AS max_online, online_hosts AS min_online
                        FROM scans WHERE substr(started_at,1,19) >= ?
                        ORDER BY started_at ASC
                    """, (dash_cutoff,)).fetchall()
                else:
                    recent_scans = conn.execute("""
                        SELECT date(substr(started_at,1,10)) day,
                               ROUND(AVG(online_hosts),1) avg_online,
                               ROUND(AVG(offline_hosts),1) avg_offline,
                               MAX(online_hosts) max_online, MIN(online_hosts) min_online
                        FROM scans WHERE substr(started_at,1,19) >= ?
                        GROUP BY day ORDER BY day ASC
                    """, (dash_cutoff,)).fetchall()
            except Exception:
                recent_scans = []

            try:
                recent_events = conn.execute("""
                    SELECT e.ip, e.at, e.event_type, e.new_value,
                           COALESCE(h.manual_name,h.nmap_hostname,h.dns_name,e.ip) AS host_name
                    FROM host_events e LEFT JOIN hosts h ON h.ip=e.ip
                    WHERE e.at >= datetime('now','-24 hours')
                      AND e.event_type IN ('status','new','ip_change','mac')
                    ORDER BY e.at DESC LIMIT 25
                """).fetchall()
            except Exception:
                recent_events = []

            try:
                long_offline = conn.execute("""
                    SELECT ip, COALESCE(manual_name,nmap_hostname,dns_name,ip) AS name, last_change
                    FROM hosts WHERE status='offline' ORDER BY last_change ASC LIMIT 8
                """).fetchall()
            except Exception:
                long_offline = []

            scans_today = conn.execute(
                "SELECT COUNT(*) c FROM scans WHERE started_at >= date('now')"
            ).fetchone()["c"]

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

    return {
        "ok": True,
        "hosts": {"total": total_hosts, "online": online_hosts,
                  "offline": offline_hosts, "unknown": unknown_hosts},
        "uptime_avg_7d": round(uptime_avg, 1) if uptime_avg else None,
        "latency_avg_ms": round(lat_avg, 1) if lat_avg else None,
        "top_latency": [dict(r) for r in top_lat],
        "services": {"total": len(svcs), "up": svc_up, "down": svc_down,
                     "list": [dict(s) for s in svcs]},
        "recent_scans": [dict(r) for r in recent_scans],
        "recent_events": [{"ip": r["ip"], "at_local": to_local_str(r["at"]),
                           "event_type": r["event_type"], "new_value": r["new_value"],
                           "host_name": r["host_name"]} for r in recent_events],
        "long_offline": [{"ip": r["ip"], "name": r["name"],
                          "since": to_local_str(r["last_change"]),
                          "ago": human_since(r["last_change"])} for r in long_offline],
        "scans_today": scans_today,
    }


@router.get("/api/hosts/{ip}/detail")
def host_detail(ip: str):
    with db() as conn:
        host = conn.execute("""
            SELECT h.ip, h.mac, h.nmap_hostname, h.dns_name, h.manual_name, h.notes, h.type_id,
                   h.first_seen, h.last_seen, h.last_change, h.status, h.known,
                   COALESCE(t.name,'') AS type_name, COALESCE(h.vendor,'') AS vendor,
                   COALESCE(h.tags,'') AS tags,
                   COALESCE(h.router_hostname,'') AS router_hostname,
                   COALESCE(h.ip_assignment,'') AS ip_assignment,
                   h.dhcp_lease_expires, COALESCE(h.router_seen,0) AS router_seen
            FROM hosts h LEFT JOIN host_types t ON t.id = h.type_id WHERE h.ip=?
        """, (ip,)).fetchone()
        if host is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        events = conn.execute("""
            SELECT at, event_type, old_value, new_value FROM host_events
            WHERE ip=? ORDER BY id DESC LIMIT 100
        """, (ip,)).fetchall()

    h = dict(host)
    h["first_seen_local"]  = to_local_str(h.get("first_seen"))
    h["last_seen_local"]   = to_local_str(h.get("last_seen"))
    h["last_change_local"] = to_local_str(h.get("last_change"))
    h["seen_ago"] = human_since(h.get("last_seen"))
    h["known"]    = bool(h.get("known"))
    ev = [{"at": e["at"], "at_local": to_local_str(e["at"]),
           "event_type": e["event_type"],
           "old_value": e["old_value"] or "", "new_value": e["new_value"] or ""}
          for e in events]
    return {"ok": True, "host": h, "events": ev}


@router.put("/api/hosts/{ip}")
def update_host(ip: str, payload: Dict[str, Any] = Body(...)):
    manual_name = (payload.get("manual_name") or "").strip()
    notes       = (payload.get("notes") or "").strip()
    type_id     = payload.get("type_id", None)
    known       = payload.get("known", None)
    if type_id is not None:
        try:
            type_id = int(type_id)
        except Exception:
            return JSONResponse({"ok": False, "error": "type_id inválido"}, status_code=400)
    with db() as conn:
        row = conn.execute(
            "SELECT ip, manual_name, notes, type_id, known FROM hosts WHERE ip=?", (ip,)
        ).fetchone()
        if row is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        if (row["manual_name"] or "") != (manual_name or ""):
            _add_event(conn, ip, "manual", row["manual_name"], manual_name)
        if (row["notes"] or "") != (notes or ""):
            _add_event(conn, ip, "notes", row["notes"], notes)
        if type_id is not None and row["type_id"] != type_id:
            _add_event(conn, ip, "type", str(row["type_id"] or ""), str(type_id))
        if known is not None:
            known_int = 1 if known else 0
            if (row["known"] or 0) != known_int:
                _add_event(conn, ip, "known", str(row["known"] or 0), str(known_int))
        known_clause = ""
        params: list = [manual_name or None, notes or None, type_id]
        if known is not None:
            known_clause = ", known=?"
            params.append(1 if known else 0)
        params.append(ip)
        conn.execute(
            f"UPDATE hosts SET manual_name=?, notes=?, type_id=COALESCE(?,type_id){known_clause} WHERE ip=?",
            params,
        )
    return {"ok": True}


@router.post("/api/hosts/{ip}/known")
def toggle_known(ip: str, payload: Dict[str, Any] = Body(...)):
    known = bool(payload.get("known", True))
    with db() as conn:
        row = conn.execute("SELECT ip, known FROM hosts WHERE ip=?", (ip,)).fetchone()
        if row is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        _add_event(conn, ip, "known", str(row["known"] or 0), str(1 if known else 0))
        conn.execute("UPDATE hosts SET known=? WHERE ip=?", (1 if known else 0, ip))
    return {"ok": True, "ip": ip, "known": known}


@router.delete("/api/hosts/{ip}")
def delete_host(ip: str):
    with db() as conn:
        row = conn.execute("SELECT ip FROM hosts WHERE ip=?", (ip,)).fetchone()
        if row is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        _add_event(conn, ip, "delete", None, "deleted")
        conn.execute("DELETE FROM hosts WHERE ip=?", (ip,))
    return {"ok": True, "ip": ip}


@router.post("/api/hosts/{ip}/clear-mac")
def clear_host_mac(ip: str):
    with db() as conn:
        row = conn.execute("SELECT ip, mac FROM hosts WHERE ip=?", (ip,)).fetchone()
        if row is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        old_mac = row["mac"] or ""
        if old_mac:
            _add_event(conn, ip, "manual", f"MAC:{old_mac}", "MAC:cleared")
        conn.execute("UPDATE hosts SET mac=NULL, vendor=NULL WHERE ip=?", (ip,))
    return {"ok": True, "ip": ip, "old_mac": old_mac}


@router.post("/api/hosts/bulk-clear-mac")
def bulk_clear_old_macs(payload: Dict[str, Any] = Body(...)):
    days   = int(payload.get("days", 30))
    cutoff = (utc_now() - timedelta(days=days)).isoformat()
    with db() as conn:
        rows = conn.execute(
            "SELECT ip, mac FROM hosts WHERE status='offline' AND (last_seen < ? OR last_seen IS NULL) AND mac IS NOT NULL",
            (cutoff,),
        ).fetchall()
        cleared = []
        for row in rows:
            _add_event(conn, row["ip"], "manual", f"MAC:{row['mac']}", "MAC:cleared")
            conn.execute("UPDATE hosts SET mac=NULL, vendor=NULL WHERE ip=?", (row["ip"],))
            cleared.append(row["ip"])
    return {"ok": True, "cleared": cleared, "count": len(cleared)}


@router.post("/api/hosts/{ip}/wol")
def wol_host(ip: str):
    with db() as conn:
        row = conn.execute("SELECT ip, mac FROM hosts WHERE ip=?", (ip,)).fetchone()
        if row is None:
            return JSONResponse({"ok": False, "error": "IP no encontrada"}, status_code=404)
        mac = row["mac"] or ""
    mac_n = normalize_mac(mac)
    if not mac_n:
        return JSONResponse({"ok": False, "error": "No hay MAC válida para este host"}, status_code=400)
    broadcast_ip = (cfg("wol_broadcast", "") or
                    compute_broadcast_from_cidr(cfg("scan_cidr", SCAN_CIDR)))
    try:
        send_wol(mac_n, broadcast_ip, int(cfg("wol_port", WOL_PORT)))
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"WOL falló: {e}"}, status_code=500)
    with db() as conn:
        _add_event(conn, ip, "wol", None, f"sent to {broadcast_ip}:{WOL_PORT} mac={mac_n}")
    return {"ok": True, "ip": ip, "mac": mac_n, "broadcast": broadcast_ip,
            "port": int(cfg("wol_port", WOL_PORT))}


@router.post("/api/wol/fixed")
def wol_fixed(payload: Dict[str, Any] = Body(...)):
    mac   = normalize_mac(payload.get("mac") or "")
    label = (payload.get("label") or "").strip()
    if not mac:
        return JSONResponse({"ok": False, "error": "MAC inválida o vacía"}, status_code=400)
    broadcast_ip = (cfg("wol_broadcast", "") or
                    compute_broadcast_from_cidr(cfg("scan_cidr", SCAN_CIDR)))
    try:
        send_wol(mac, broadcast_ip, int(cfg("wol_port", WOL_PORT)))
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"WOL falló: {e}"}, status_code=500)
    return {"ok": True, "label": label, "mac": mac, "broadcast": broadcast_ip,
            "port": int(cfg("wol_port", WOL_PORT))}


# ══════════════════════════════════════════════════════════════
#  Tipos, tags, búsqueda
# ══════════════════════════════════════════════════════════════

@router.get("/api/types")
def api_types():
    with db() as conn:
        rows = conn.execute("SELECT id, name, icon FROM host_types ORDER BY name ASC").fetchall()
    return {"ok": True, "types": [dict(r) for r in rows]}


@router.post("/api/types")
def api_type_create(payload: Dict[str, Any] = Body(...)):
    import sqlite3 as _sqlite3
    name = (payload.get("name") or "").strip()
    icon = (payload.get("icon") or "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Nombre vacío"}, status_code=400)
    with db() as conn:
        try:
            conn.execute("INSERT INTO host_types (name, icon, created_at) VALUES (?,?,?)",
                         (name, icon, utc_now_iso()))
        except _sqlite3.IntegrityError:
            return JSONResponse({"ok": False, "error": "Ese tipo ya existe"}, status_code=400)
    return {"ok": True}


@router.put("/api/types/{type_id}")
def api_type_update(type_id: int, payload: Dict[str, Any] = Body(...)):
    import sqlite3 as _sqlite3
    name = (payload.get("name") or "").strip()
    icon = (payload.get("icon") or "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Nombre vacío"}, status_code=400)
    with db() as conn:
        row = conn.execute("SELECT id FROM host_types WHERE id=?", (type_id,)).fetchone()
        if not row:
            return JSONResponse({"ok": False, "error": "Tipo no encontrado"}, status_code=404)
        try:
            conn.execute("UPDATE host_types SET name=?, icon=? WHERE id=?", (name, icon, type_id))
        except _sqlite3.IntegrityError:
            return JSONResponse({"ok": False, "error": "Ese tipo ya existe"}, status_code=400)
    return {"ok": True}


@router.delete("/api/types/{type_id}")
def api_type_delete(type_id: int):
    with db() as conn:
        row = conn.execute("SELECT id, name FROM host_types WHERE id=?", (type_id,)).fetchone()
        if not row:
            return JSONResponse({"ok": False, "error": "Tipo no encontrado"}, status_code=404)
        if row["name"] == "Por defecto":
            return JSONResponse({"ok": False, "error": "No se puede borrar 'Por defecto'"}, status_code=400)
        default_id = conn.execute("SELECT id FROM host_types WHERE name='Por defecto' LIMIT 1").fetchone()
        if default_id:
            conn.execute("UPDATE hosts SET type_id=? WHERE type_id=?", (default_id["id"], type_id))
        conn.execute("DELETE FROM host_types WHERE id=?", (type_id,))
    return {"ok": True}


@router.get("/api/tags")
def api_tags_list():
    with db() as conn:
        rows = conn.execute(
            "SELECT COALESCE(tags,'') AS tags FROM hosts WHERE tags IS NOT NULL AND tags != ''"
        ).fetchall()
    tag_set: set = set()
    for r in rows:
        for t in (r["tags"] or "").split(","):
            t = t.strip()
            if t:
                tag_set.add(t)
    return {"ok": True, "tags": sorted(tag_set)}


@router.post("/api/hosts/{ip}/tags")
def api_host_tags_update(ip: str, payload: Dict[str, Any] = Body(...)):
    raw  = (payload.get("tags") or "").strip()
    tags = sorted({t.strip().lower() for t in raw.split(",") if t.strip()})
    with db() as conn:
        conn.execute("UPDATE hosts SET tags=? WHERE ip=?", (",".join(tags), ip))
    return {"ok": True, "tags": ",".join(tags)}


@router.get("/api/search")
def api_global_search(q: str = ""):
    q = q.strip()
    if len(q) < 2:
        return {"ok": True, "results": [], "query": q}
    like    = f"%{q}%"
    results = []
    with db() as conn:
        for r in conn.execute("""
            SELECT h.ip, h.mac, COALESCE(h.manual_name,'') mn, COALESCE(h.nmap_hostname,'') nh,
                   COALESCE(h.dns_name,'') dn, COALESCE(h.notes,'') no, COALESCE(h.tags,'') tg,
                   COALESCE(h.vendor,'') vd, h.status, COALESCE(t.icon,'') ti
            FROM hosts h LEFT JOIN host_types t ON t.id = h.type_id
            WHERE h.ip LIKE ? OR h.mac LIKE ? OR h.manual_name LIKE ? OR h.nmap_hostname LIKE ?
               OR h.dns_name LIKE ? OR h.notes LIKE ? OR h.tags LIKE ? OR h.vendor LIKE ?
            LIMIT 20
        """, (like,) * 8).fetchall():
            label = r["mn"] or r["nh"] or r["dn"] or r["ip"]
            results.append({"type": "host", "icon": r["ti"] or "🖥️", "title": label,
                            "subtitle": r["ip"] + (f" · {r['vd']}" if r["vd"] else ""),
                            "status": r["status"], "action": f"openHost:{r['ip']}"})
        for r in conn.execute("""
            SELECT s.id, s.name, s.host, s.port, COALESCE(s.service_type,'') st FROM services s
            WHERE s.name LIKE ? OR s.host LIKE ? OR CAST(s.port AS TEXT) LIKE ? LIMIT 10
        """, (like, like, like)).fetchall():
            ck = conn.execute(
                "SELECT status FROM service_checks WHERE service_id=? ORDER BY checked_at DESC LIMIT 1",
                (r["id"],),
            ).fetchone()
            results.append({"type": "service", "icon": "⚙️", "title": r["name"],
                            "subtitle": f"{r['host']}:{r['port']} · {r['st']}",
                            "status": ck["status"] if ck else "unknown", "action": "openTab:servicios"})
        for r in conn.execute("""
            SELECT id, started_at, cidr, online_hosts FROM scans
            WHERE cidr LIKE ? OR started_at LIKE ? ORDER BY started_at DESC LIMIT 5
        """, (like, like)).fetchall():
            results.append({"type": "scan", "icon": "📋",
                            "title": f"Scan #{r['id']} — {r['cidr']}",
                            "subtitle": f"{(r['started_at'] or '')[:16]} · {r['online_hosts']} online",
                            "status": "info", "action": "openTab:ejecuciones"})
    return {"ok": True, "results": results, "query": q}


# ══════════════════════════════════════════════════════════════
#  Uptime y latencia
# ══════════════════════════════════════════════════════════════

@router.get("/api/hosts/{ip}/uptime")
def api_host_uptime(ip: str, days: int = 30):
    days   = max(1, min(90, int(days)))
    cutoff = (utc_now() - timedelta(days=days)).strftime("%Y-%m-%d")
    with db() as conn:
        rows = conn.execute("""
            SELECT date, online_seconds, offline_seconds FROM host_uptime
            WHERE ip=? AND date >= ? ORDER BY date ASC
        """, (ip, cutoff)).fetchall()
    total_online  = sum(r["online_seconds"]  for r in rows)
    total_offline = sum(r["offline_seconds"] for r in rows)
    total = total_online + total_offline
    pct   = round(total_online * 100 / total, 1) if total > 0 else None
    return {
        "ok": True, "ip": ip, "days": days, "uptime_pct": pct,
        "total_online_h":  round(total_online  / 3600, 1),
        "total_offline_h": round(total_offline / 3600, 1),
        "daily": [{
            "date": r["date"],
            "online_h":  round(r["online_seconds"]  / 3600, 2),
            "offline_h": round(r["offline_seconds"] / 3600, 2),
            "pct": round(r["online_seconds"] * 100 / (r["online_seconds"] + r["offline_seconds"]), 1)
                   if (r["online_seconds"] + r["offline_seconds"]) > 0 else None,
        } for r in rows],
    }


@router.get("/api/hosts/{ip}/latency")
def api_host_latency(ip: str, hours: int = 24):
    cutoff = (utc_now() - timedelta(hours=max(1, int(hours)))).isoformat()
    with db() as conn:
        rows = conn.execute("""
            SELECT scanned_at, latency_ms FROM host_latency
            WHERE ip=? AND scanned_at >= ? ORDER BY scanned_at ASC
        """, (ip, cutoff)).fetchall()
    return {"ok": True, "ip": ip, "hours": hours, "data": [dict(r) for r in rows]}


# ══════════════════════════════════════════════════════════════
#  Dashboard layout
# ══════════════════════════════════════════════════════════════

@router.get("/api/dashboard/layout")
def api_dashboard_layout_get():
    with db() as conn:
        row = conn.execute("SELECT layout FROM dashboard_layout WHERE id=1").fetchone()
    return {"ok": True, "layout": row["layout"] if row else "{}"}


@router.put("/api/dashboard/layout")
def api_dashboard_layout_put(payload: Dict[str, Any] = Body(...)):
    import json
    layout = json.dumps(payload.get("layout", {}))
    with db() as conn:
        conn.execute("""
            INSERT INTO dashboard_layout (id, layout, updated_at) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET layout=excluded.layout, updated_at=excluded.updated_at
        """, (layout, utc_now_iso()))
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
#  Export CSV / XLSX
# ══════════════════════════════════════════════════════════════

@router.get("/export.csv")
def export_csv():
    app_tz = get_app_tz(cfg("app_tz", "Europe/Madrid"))
    from datetime import datetime as _dt
    with db() as conn:
        rows = conn.execute("""
            SELECT h.ip, h.mac, h.nmap_hostname, h.dns_name, h.manual_name, h.notes,
                   COALESCE(t.name,'') AS type_name, COALESCE(t.icon,'') AS type_icon,
                   h.first_seen, h.last_seen, h.last_change, h.status, h.known, h.last_latency_ms
            FROM hosts h LEFT JOIN host_types t ON t.id = h.type_id
            ORDER BY h.status DESC, h.last_seen DESC
        """).fetchall()
    sio    = io.StringIO()
    writer = csv.writer(sio)
    writer.writerow(["IP","MAC","Hostname","DNS","Nombre manual","Tipo","Icono","Notas",
                     "Primera vez","Última vez","Último cambio","Visto hace","Estado","Conocido","Latencia (ms)"])
    for r in rows:
        writer.writerow([
            r["ip"], r["mac"] or "", r["nmap_hostname"] or "", r["dns_name"] or "",
            r["manual_name"] or "", r["type_name"] or "", r["type_icon"] or "", r["notes"] or "",
            to_local_str(r["first_seen"]), to_local_str(r["last_seen"]),
            to_local_str(r["last_change"]), human_since(r["last_seen"]),
            r["status"] or "", "SI" if r["known"] else "NO", r["last_latency_ms"] or "",
        ])
    sio.seek(0)
    filename = f"auditor_ips_{_dt.now(app_tz).strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([sio.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/db/reset")
def reset_db():
    with db() as conn:
        conn.execute("DELETE FROM host_events")
        conn.execute("DELETE FROM hosts")
        conn.execute("DELETE FROM scans")
    return {"ok": True, "message": "Base de datos reseteada."}
