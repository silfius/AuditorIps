"""
routers/quality.py — Auditor IPs
CRUD de quality targets/settings, historial, export CSV y check manual.
La lógica de ping (run_quality_checks, reschedule_quality) vive aquí
para que main.py pueda importarla en startup.
"""

import csv
import io
import re
import subprocess
import threading
from datetime import timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse, Response

from config import cfg
from database import db
from utils import utc_now, utc_now_iso, parse_iso, get_app_tz

router = APIRouter()

# Scheduler se inyecta desde main.py tras la creación del APIRouter
# para evitar imports circulares. Se accede via _get_scheduler().
_scheduler_ref: Any = None

def set_scheduler(sched: Any) -> None:
    global _scheduler_ref
    _scheduler_ref = sched

def _get_scheduler():
    return _scheduler_ref


_quality_job_id = "quality_job"
_quality_running = False
_db_write_lock: threading.Lock = threading.Lock()   # compartido con scans.py via setter


def set_db_write_lock(lock: threading.Lock) -> None:
    global _db_write_lock
    _db_write_lock = lock


# ══════════════════════════════════════════════════════════════
#  Lógica de ping
# ══════════════════════════════════════════════════════════════

def run_quality_ping(host: str, count: int = 4, interface: str = "") -> Dict[str, Any]:
    """Ping a host y devuelve latencia media y packet loss."""
    try:
        cmd = ["ping", "-c", str(count), "-W", "3"]
        if interface:
            cmd += ["-I", interface]
        cmd.append(host)
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=30,
        )
        output = result.stdout
        m      = re.search(r"rtt min/avg/max/mdev = [\d.]+/([\d.]+)/", output)
        avg_ms = float(m.group(1)) if m else None
        loss_m = re.search(r"(\d+)% packet loss", output)
        loss_pct = int(loss_m.group(1)) if loss_m else 100
        status = "ok" if loss_pct < 100 else "down"
        return {"latency_ms": avg_ms, "packet_loss": loss_pct, "status": status}
    except Exception:
        return {"latency_ms": None, "packet_loss": 100, "status": "error"}


def run_quality_checks() -> None:
    """Ejecuta pings a todos los quality_targets activos y persiste resultados."""
    global _quality_running
    if _quality_running:
        return
    _quality_running = True
    try:
        with db() as conn:
            settings = conn.execute("SELECT * FROM quality_settings WHERE id=1").fetchone()
            if not settings or not settings["enabled"]:
                return
            # Interfaz global como fallback si el target no tiene una propia
            global_interface = (settings["quality_interface"] or "").strip() if "quality_interface" in settings.keys() else ""
            targets = conn.execute(
                "SELECT id, host, name, interface FROM quality_targets WHERE enabled=1"
            ).fetchall()
        if not targets:
            return

        now     = utc_now_iso()
        results = []
        for t in targets:
            # Prioridad: interfaz del target → interfaz global → automático
            iface = (t["interface"] or "").strip() if "interface" in t.keys() else ""
            if not iface:
                iface = global_interface
            r = run_quality_ping(t["host"], interface=iface)
            results.append((t["id"], t["host"], t["name"], r, iface))

        with _db_write_lock:
            with db() as conn:
                for (tid, host, name, r, iface) in results:
                    conn.execute("""
                        INSERT INTO quality_checks (target_id, checked_at, latency_ms, packet_loss, status)
                        VALUES (?, ?, ?, ?, ?)
                    """, (tid, now, r["latency_ms"], r["packet_loss"], r["status"]))
                # Purgar checks > 30 días
                cutoff = (utc_now() - timedelta(days=30)).isoformat()
                conn.execute("DELETE FROM quality_checks WHERE checked_at < ?", (cutoff,))

            # ── Evaluar umbral de alerta (nueva conexión, la anterior ya cerró) ──
            with db() as conn2:
                settings      = conn2.execute("SELECT * FROM quality_settings WHERE id=1").fetchone()
                threshold_pct = settings["alert_threshold_pct"] if settings else 200.0
                cooldown_min  = settings["alert_cooldown_minutes"] if settings else 30
                last_alert    = parse_iso(settings["last_alert_at"]) if settings else None
                quiet_start   = (settings["quiet_start"] or "").strip()
                quiet_end     = (settings["quiet_end"] or "").strip()

                # Período silencioso
                app_tz    = get_app_tz(cfg("app_tz", "Europe/Madrid"))
                now_local = utc_now().astimezone(app_tz)
                in_quiet  = False
                if quiet_start and quiet_end:
                    try:
                        qs_h, qs_m = map(int, quiet_start.split(":"))
                        qe_h, qe_m = map(int, quiet_end.split(":"))
                        cur_mins = now_local.hour * 60 + now_local.minute
                        qs_mins  = qs_h * 60 + qs_m
                        qe_mins  = qe_h * 60 + qe_m
                        if qs_mins <= qe_mins:
                            in_quiet = qs_mins <= cur_mins <= qe_mins
                        else:
                            in_quiet = cur_mins >= qs_mins or cur_mins <= qe_mins
                    except Exception:
                        pass
                if in_quiet:
                    return

                # Cooldown
                if last_alert and cooldown_min > 0:
                    elapsed = (utc_now() - last_alert).total_seconds() / 60
                    if elapsed < cooldown_min:
                        return

                # Baseline y anomalías
                anomalies = []
                for (tid, host, name, r, iface) in results:
                    if r["latency_ms"] is None:
                        continue
                    baseline_row = conn2.execute("""
                        SELECT AVG(latency_ms) avg FROM quality_checks
                        WHERE target_id=? AND latency_ms IS NOT NULL
                          AND checked_at >= datetime('now', '-24 hours')
                          AND checked_at < ?
                        LIMIT 1000
                    """, (tid, now)).fetchone()
                    baseline = baseline_row["avg"] if baseline_row else None
                    if baseline and baseline > 0:
                        pct_increase = (r["latency_ms"] / baseline) * 100
                        if pct_increase >= threshold_pct:
                            anomalies.append({
                                "name": name, "host": host,
                                "current": r["latency_ms"],
                                "baseline": round(baseline, 1),
                                "pct": round(pct_increase, 0),
                            })

                enabled_count = len(results)
                if anomalies and len(anomalies) >= enabled_count and enabled_count > 0:
                    lines = [
                        f"  • **{a['name']}** ({a['host']}): "
                        f"{a['current']}ms vs {a['baseline']}ms base ({a['pct']}%)"
                        for a in anomalies
                    ]
                    msg = "📡 **Calidad de Conexión — Anomalía detectada**\n" + "\n".join(lines)
                    if cfg("discord_webhook", ""):
                        from routers.scans import discord_notify
                        threading.Thread(target=discord_notify, args=(msg,), daemon=True).start()
                    conn2.execute("UPDATE quality_settings SET last_alert_at=? WHERE id=1", (now,))
    finally:
        _quality_running = False


def reschedule_quality(enabled: bool, interval_s: int = 30) -> None:
    """Añade o elimina el job de quality del scheduler global."""
    sched = _get_scheduler()
    if sched is None:
        return
    try:
        sched.remove_job(_quality_job_id)
    except Exception:
        pass
    if enabled:
        sched.add_job(
            run_quality_checks, "interval",
            seconds=max(15, interval_s),
            id=_quality_job_id, replace_existing=True,
        )


# ══════════════════════════════════════════════════════════════
#  API endpoints
# ══════════════════════════════════════════════════════════════

@router.get("/api/quality/settings")
def api_quality_settings_get():
    with db() as conn:
        row     = conn.execute("SELECT * FROM quality_settings WHERE id=1").fetchone()
        targets = conn.execute("SELECT * FROM quality_targets ORDER BY id").fetchall()
    return {
        "ok": True,
        "settings": dict(row) if row else {},
        "targets":  [dict(t) for t in targets],
    }


@router.put("/api/quality/settings")
def api_quality_settings_put(payload: Dict[str, Any] = Body(...)):
    enabled     = 1 if payload.get("enabled") else 0
    threshold   = float(payload.get("alert_threshold_pct", 200.0))
    cooldown    = int(payload.get("alert_cooldown_minutes", 30))
    quiet_start = (payload.get("quiet_start") or "").strip()
    quiet_end   = (payload.get("quiet_end") or "").strip()
    quality_interface = (payload.get("quality_interface") or "").strip()
    with db() as conn:
        conn.execute("""
            UPDATE quality_settings
            SET enabled=?, alert_threshold_pct=?, alert_cooldown_minutes=?,
                quiet_start=?, quiet_end=?, quality_interface=?, updated_at=?
            WHERE id=1
        """, (enabled, threshold, cooldown, quiet_start, quiet_end, quality_interface, utc_now_iso()))
    reschedule_quality(bool(enabled), 30)
    return {"ok": True}


@router.get("/api/quality/targets")
def api_quality_targets():
    with db() as conn:
        rows = conn.execute("SELECT * FROM quality_targets ORDER BY id").fetchall()
    return {"ok": True, "targets": [dict(r) for r in rows]}


@router.post("/api/quality/targets")
def api_quality_target_create(payload: Dict[str, Any] = Body(...)):
    name      = (payload.get("name")      or "").strip()
    host      = (payload.get("host")      or "").strip()
    interface = (payload.get("interface") or "").strip()
    if not name or not host:
        return JSONResponse({"ok": False, "error": "name y host requeridos"}, status_code=400)
    with db() as conn:
        conn.execute(
            "INSERT INTO quality_targets (name, host, interface, enabled, created_at) VALUES (?,?,?,1,?)",
            (name, host, interface, utc_now_iso()),
        )
    return {"ok": True}


@router.put("/api/quality/targets/{tid}")
def api_quality_target_update(tid: int, payload: Dict[str, Any] = Body(...)):
    name      = (payload.get("name")      or "").strip()
    host      = (payload.get("host")      or "").strip()
    interface = (payload.get("interface") or "").strip()
    if not name or not host:
        return JSONResponse({"ok": False, "error": "name y host requeridos"}, status_code=400)
    with db() as conn:
        conn.execute(
            "UPDATE quality_targets SET name=?, host=?, interface=? WHERE id=?",
            (name, host, interface, tid),
        )
    return {"ok": True}


@router.delete("/api/quality/targets/{tid}")
def api_quality_target_delete(tid: int):
    with db() as conn:
        conn.execute("DELETE FROM quality_checks WHERE target_id=?", (tid,))
        conn.execute("DELETE FROM quality_targets WHERE id=?", (tid,))
    return {"ok": True}


@router.post("/api/quality/targets/{tid}/toggle")
def api_quality_target_toggle(tid: int):
    with db() as conn:
        row = conn.execute("SELECT enabled FROM quality_targets WHERE id=?", (tid,)).fetchone()
        if not row:
            return JSONResponse({"ok": False, "error": "No encontrado"}, status_code=404)
        new_state = 0 if row["enabled"] else 1
        conn.execute("UPDATE quality_targets SET enabled=? WHERE id=?", (new_state, tid))
    return {"ok": True, "enabled": bool(new_state)}


@router.get("/api/quality/interfaces")
def api_quality_interfaces():
    """Lista interfaces IPv4 activas del host para elegir la salida del ping."""
    import json as _json

    result = []

    try:
        out = subprocess.run(
            ["ip", "-j", "addr"],
            capture_output=True,
            text=True,
            timeout=5,
        )

        if out.returncode == 0 and (out.stdout or "").strip():
            ifaces = _json.loads(out.stdout)
            for iface in ifaces:
                name = (iface.get("ifname") or "").strip()
                # Excluir loopback y virtual docker/bridge
                if not name or name in ("lo",) or name.startswith(("docker", "br-", "veth", "virbr")):
                    continue
                # Aceptar si tiene al menos una IPv4 O si está UP (aunque sea sin IP, puede usar -I)
                operstate = (iface.get("operstate") or "").upper()
                flags = iface.get("flags", [])
                is_up = operstate == "UP" or "UP" in flags
                addrs = [
                    a.get("local")
                    for a in iface.get("addr_info", [])
                    if a.get("family") == "inet" and a.get("local")
                ]
                if not is_up and not addrs:
                    continue

                result.append({
                    "name": name,
                    "addrs": addrs,
                })
    except Exception:
        pass

    # Nunca devolver 500 aquí: el frontend debe poder seguir cargando.
    return {"ok": True, "interfaces": result}


@router.get("/api/quality/history")
def api_quality_history(days: int = 1):
    days   = max(1, int(days))
    cutoff = (utc_now() - timedelta(days=days)).isoformat()
    with db() as conn:
        targets = conn.execute("SELECT * FROM quality_targets ORDER BY id").fetchall()
        result  = []
        for t in targets:
            rows = conn.execute("""
                SELECT checked_at, latency_ms, packet_loss, status
                FROM quality_checks
                WHERE target_id=? AND checked_at >= ?
                ORDER BY checked_at ASC
            """, (t["id"], cutoff)).fetchall()
            result.append({
                "id":      t["id"],
                "name":    t["name"],
                "host":    t["host"],
                "enabled": bool(t["enabled"]),
                "data":    [dict(r) for r in rows],
            })
    return {"ok": True, "targets": result}


@router.get("/api/quality/summary")
def api_quality_summary():
    """Último check por destino + estado agregado (ok / degraded / down)."""
    with db() as conn:
        targets = conn.execute(
            "SELECT id, name, host, enabled FROM quality_targets ORDER BY id"
        ).fetchall()
        out = []
        for t in targets:
            last = conn.execute("""
                SELECT checked_at, latency_ms, packet_loss, status
                FROM quality_checks
                WHERE target_id=?
                ORDER BY checked_at DESC
                LIMIT 1
            """, (t["id"],)).fetchone()
            out.append({
                "id":      t["id"],
                "name":    t["name"],
                "host":    t["host"],
                "enabled": bool(t["enabled"]),
                "last":    dict(last) if last else None,
            })

    enabled = [x for x in out if x["enabled"]]
    worst = "ok"
    for x in enabled:
        last = x.get("last") or {}
        st   = last.get("status")
        loss = last.get("packet_loss")
        if st in ("down", "error"):
            worst = "down"
            break
        if isinstance(loss, (int, float)) and loss and loss > 0:
            worst = "degraded" if worst == "ok" else worst

    return {"ok": True, "overall": worst, "targets": out}


@router.post("/api/quality/check-now")
def api_quality_check_now():
    """Lanza un check manual inmediato en background."""
    threading.Thread(target=run_quality_checks, daemon=True).start()
    return {"ok": True}


@router.post("/api/quality/ping-now")
def api_quality_ping_now():
    """
    Lanza pings a todos los targets activos sincrónicamente y devuelve resultados.
    También persiste los checks en BD.
    """
    import time as _time

    try:
        with db() as conn:
            settings     = conn.execute("SELECT * FROM quality_settings WHERE id=1").fetchone()
            global_iface = (settings["quality_interface"] or "").strip() if settings and "quality_interface" in settings.keys() else ""
            targets      = conn.execute(
                "SELECT id, host, name, interface FROM quality_targets WHERE enabled=1"
            ).fetchall()

        if not targets:
            return {"ok": False, "error": "No hay destinos activos configurados", "results": []}

        now     = utc_now_iso()
        results = []
        for t in targets:
            iface = (t["interface"] or "").strip() or global_iface
            ts    = _time.strftime("%H:%M:%S")
            r     = run_quality_ping(t["host"], count=4, interface=iface)
            results.append({
                "name":        t["name"],
                "host":        t["host"],
                "interface":   iface or "auto",
                "latency_ms":  r["latency_ms"],
                "packet_loss": r["packet_loss"],
                "status":      r["status"],
                "ts":          ts,
            })

        # Persistir en BD
        with _db_write_lock:
            with db() as conn:
                for (idx, t) in enumerate(targets):
                    r = results[idx]
                    conn.execute("""
                        INSERT INTO quality_checks (target_id, checked_at, latency_ms, packet_loss, status)
                        VALUES (?, ?, ?, ?, ?)
                    """, (t["id"], now, r["latency_ms"], r["packet_loss"], r["status"]))

        return {"ok": True, "results": results}

    except Exception as e:
        return {"ok": False, "error": str(e), "results": []}



@router.get("/api/quality/export.csv")
def api_quality_export_csv(
    date_from: str = "",
    date_to:   str = "",
    target_id: int = 0,
    loss_only: int = 0,
    loss_min:  int = 1,
):
    """Exporta quality checks como CSV con filtros opcionales."""
    conditions: List[str] = []
    params: List[Any]     = []

    if date_from:
        conditions.append("qc.checked_at >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("qc.checked_at <= ?")
        params.append(date_to + "T23:59:59")
    if target_id:
        conditions.append("qc.target_id = ?")
        params.append(target_id)
    if loss_only:
        conditions.append("qc.packet_loss IS NOT NULL AND qc.packet_loss >= ?")
        params.append(int(loss_min))

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db() as conn:
        rows = conn.execute(f"""
            SELECT qt.name AS target_name, qt.host,
                   qc.checked_at, qc.latency_ms, qc.packet_loss, qc.status
            FROM quality_checks qc
            JOIN quality_targets qt ON qt.id = qc.target_id
            {where}
            ORDER BY qc.checked_at ASC
        """, params).fetchall()

    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(["Destino", "Host", "Fecha/Hora (UTC)", "Ping (ms)", "Pérdida paquetes (%)", "Estado"])
    for r in rows:
        w.writerow([
            r["target_name"], r["host"], r["checked_at"],
            r["latency_ms"] if r["latency_ms"] is not None else "",
            r["packet_loss"] if r["packet_loss"] is not None else "",
            r["status"],
        ])

    filename = f"calidad_{date_from or 'inicio'}_{date_to or 'hoy'}.csv"
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),  # BOM para Excel
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
