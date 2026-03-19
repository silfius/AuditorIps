// ════════════════════════════════════════════════════════
//  dashboard.js — Auditor IPs  (Sesión 27 — rewrite)
//  Layout: CSS Grid 12 columnas — sin .row de Bootstrap
//  Widgets: grafica · wol · kpis · servicios · procesos · eventos · offline
// ════════════════════════════════════════════════════════
$(function () {

  // ── Estado global ─────────────────────────────────────────────────────────
  let dashChart  = null;
  let _dashRange = 1;

  // ══════════════════════════════════════════════════════════
  //  CARGA DE DATOS
  // ══════════════════════════════════════════════════════════

  window.loadDashboard = async function loadDashboard() {
    const el = document.getElementById('dashLastUpdate');
    if (el) el.textContent = 'Cargando…';
    try {
      const [resD, resQ] = await Promise.all([
        fetch(`/api/dashboard?days=${_dashRange}&_=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/quality/history?days=${_dashRange}&_=${Date.now()}`,  { cache: 'no-store' })
      ]);
      if (!resD.ok) { if (el) el.textContent = `Error HTTP ${resD.status}`; return; }
      const d = await resD.json();
      const q = resQ.ok ? await resQ.json() : { ok: false, targets: [] };
      if (!d?.ok) {
        if (el) el.textContent = d?.error || 'Sin datos — realiza un primer escaneo';
        return;
      }
      _renderDashboard(d, q);
    } catch (e) {
      console.error('[Dashboard]', e);
      const el2 = document.getElementById('dashLastUpdate');
      if (el2) el2.textContent = 'Error: ' + e.message;
    }
  };

  // ── Renderizado ───────────────────────────────────────────────────────────
  function _renderDashboard(d, q) {
    try {
      document.getElementById('dashLastUpdate').textContent =
        'Actualizado: ' + new Date().toLocaleTimeString('es-ES');

      // KPIs
      document.getElementById('dKpiOnline').textContent   = d.hosts.online;
      document.getElementById('dKpiOffline').textContent  = d.hosts.offline;
      document.getElementById('dKpiUnknown').textContent  = d.hosts.unknown;
      document.getElementById('dKpiUptime').textContent   = d.uptime_avg_7d  != null ? d.uptime_avg_7d  + '%'   : '—';
      document.getElementById('dKpiLatency').textContent  = d.latency_avg_ms != null ? d.latency_avg_ms + 'ms' : '—';
      document.getElementById('dKpiScans').textContent    = d.scans_today;

      // Servicios
      const svcs  = d.services.list || [];
      const badge = d.services.down > 0
        ? `<span class="badge bg-danger ms-1">${d.services.down} caídos</span>`
        : `<span class="badge bg-success ms-1">${d.services.up} arriba</span>`;
      document.getElementById('dSvcBadge').innerHTML = badge;
      document.getElementById('dSvcList').innerHTML = svcs.length
        ? svcs.map(s => {
            const st   = s.last_status || 'unknown';
            const url  = s.access_url  || `http://${s.host}:${s.port}`;
            const icon = (typeof SVC_TYPE_ICONS !== 'undefined' && SVC_TYPE_ICONS[s.service_type]) || '🔌';
            const lat  = s.last_latency != null
              ? `<span class="svc-latency ms-auto">${s.last_latency}ms</span>` : '';
            return `<div class="dash-svc-row">
              <div class="dash-svc-dot ${st}"></div>
              <a href="${esc(url)}" target="_blank" class="dash-svc-name text-decoration-none" style="color:inherit">
                ${icon} ${esc(s.name)}</a>${lat}</div>`;
          }).join('')
        : '<div class="small-muted">Sin servicios configurados</div>';

      // Eventos — excluir host→online (solo cambios relevantes)
      const PILL = { new: 'ep-new', status: 'ep-status', mac: 'ep-mac' };
      const relevant = (d.recent_events || []).filter(e => {
        if (e.event_type === 'status') {
          const v = (e.new_value || '').toLowerCase();
          return v !== 'online' && v !== 'online_silent';
        }
        return true;
      });
      document.getElementById('dEventList').innerHTML = relevant.length
        ? relevant.map(e => {
            const cls = PILL[e.event_type] || 'ep-other';
            const lbl = e.event_type === 'new'    ? 'NUEVO'
                      : e.event_type === 'status' ? (e.new_value || '').toUpperCase()
                      : e.event_type.toUpperCase();
            return `<div class="dash-svc-row">
              <span class="event-pill ${cls}">${lbl}</span>
              <span class="dash-svc-name mono">${esc(e.host_name)}</span>
              <span class="svc-latency">${e.at_local}</span></div>`;
          }).join('')
        : '<div class="small-muted">Sin eventos relevantes</div>';

      // Offline más tiempo
      document.getElementById('dOfflineList').innerHTML = d.long_offline.length
        ? d.long_offline.map(h =>
            `<div class="dash-svc-row">
              <div class="dash-svc-dot down"></div>
              <span class="dash-svc-name mono">${esc(h.name)}</span>
              <span class="svc-latency">${h.ago}</span></div>`
          ).join('')
        : '<div class="small-muted">Ningún host offline</div>';

      // Gráfica
      _renderQualityChart(q);

    } catch (e) {
      console.error('[Dashboard render]', e);
    }
  }

  function _renderQualityChart(q) {
    const ctx = document.getElementById('dashChart');
    if (!ctx) return;
    if (dashChart) { dashChart.destroy(); dashChart = null; }

    const targets  = (q?.ok && q.targets) ? q.targets : [];
    const PALETTE  = ['#4e91d4', '#f0ad4e', '#5cb85c', '#d9534f', '#9b59b6', '#1abc9c'];
    const allTsSet = new Set();
    targets.forEach(t => (t.data || []).forEach(c => allTsSet.add(c.checked_at)));
    const allTs = [...allTsSet].sort();

    const datasets = targets.map((t, i) => {
      const m = {};
      (t.data || []).forEach(c => { m[c.checked_at] = c; });
      return {
        label: t.name || t.host,
        data:  allTs.map(ts => { const c = m[ts]; return c ? (c.latency_ms ?? null) : null; }),
        borderColor:     PALETTE[i % PALETTE.length],
        backgroundColor: 'transparent',
        borderWidth:     1.5,
        pointRadius:     allTs.length > 200 ? 0 : 1,
        tension:         0.2,
        spanGaps:        true,
      };
    });

    const timeouts = [];
    targets.forEach(t => (t.data || []).forEach(c => {
      if (c.status === 'timeout') {
        const xi = allTs.indexOf(c.checked_at);
        if (xi >= 0) timeouts.push({ x: xi, y: 0 });
      }
    }));
    if (timeouts.length) datasets.push({
      label: 'Timeout', type: 'scatter', data: timeouts,
      backgroundColor: 'rgba(217,83,79,0.7)', pointRadius: 3, pointStyle: 'circle',
    });

    const labels = allTs.map(ts => {
      try {
        const dt = new Date(ts);
        return _dashRange === 1
          ? dt.toLocaleTimeString('es-ES',  { hour: '2-digit', minute: '2-digit' })
          : dt.toLocaleDateString('es-ES',  { month: '2-digit', day: '2-digit' });
      } catch { return ts; }
    });

    const sub = document.getElementById('dashChartSubtitle');
    if (sub) {
      const total = targets.reduce((a, t) => a + (t.data || []).length, 0);
      sub.textContent = `${_dashRange === 1 ? 'hoy' : `últimos ${_dashRange} días`} · ${total} checks · ${targets.length} destinos`;
    }

    const maxTicks = _dashRange === 1 ? 8 : (_dashRange === 7 ? 7 : 10);
    dashChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: targets.length > 1, labels: { color: 'rgba(255,255,255,0.7)', font: { size: 10 } } },
          tooltip: {
            callbacks: {
              title: items => labels[items[0].dataIndex] || '',
              label: item  => item.dataset.type === 'scatter'
                ? 'Timeout'
                : `${item.dataset.label}: ${item.parsed.y != null ? item.parsed.y + 'ms' : 'N/A'}`,
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, maxRotation: 0, maxTicksLimit: maxTicks } },
          y: { suggestedMin: 0, grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, callback: v => v + 'ms' } }
        }
      }
    });
    dashChart.resize();
  }

  // Range selector
  $(document).on('click', '.dash-range-btn', function () {
    $('.dash-range-btn').removeClass('active');
    $(this).addClass('active');
    _dashRange = parseInt($(this).data('range')) || 1;
    loadDashboard();
  });

  $('#dashRefresh').on('click', loadDashboard);
  document.getElementById('dashboard-tab').addEventListener('shown.bs.tab', loadDashboard);
  setTimeout(loadDashboard, 500);
  setInterval(() => {
    if (document.getElementById('dashboardView')?.classList.contains('show')) loadDashboard();
  }, 60000);


  // ══════════════════════════════════════════════════════════
  //  LAYOUT — CSS Grid 12 columnas
  //
  //  Cada .dash-widget-wrap es hijo DIRECTO de #dashSortableContainer.
  //  El tamaño se controla exclusivamente con grid-column: span N.
  //
  //  Por qué esto funciona y el sistema anterior no:
  //  - Antes: cada widget vivía dentro de <div class="row"><div class="col-...">
  //    Bootstrap .row tiene margin: -12px que hace que el elemento desborde
  //    su flex-basis, rompiendo el flex-wrap. Solo el primer widget se veía bien.
  //  - Ahora: CSS Grid gestiona la colocación. span N = exactamente N/12 del ancho.
  //    No hay márgenes negativos, no hay cálculos de flex-basis, no hay bugs.
  //
  //  SortableJS reordena los nodos DOM. El grid reposiciona automáticamente.
  // ══════════════════════════════════════════════════════════

  const WIDGET_LABELS = {
    grafica:   '📈 Calidad de red',
    wol:       '⚡ Wake-on-LAN',
    kpis:      '📊 KPIs',
    servicios: '⚙️ Servicios',
    procesos:  '🖥️ Procesos',
    eventos:   '📋 Eventos',
    offline:   '🔴 Offline',
  };

  // Spans por defecto (de 12 columnas):
  // grafica(8) + wol(4)                        → fila 1
  // kpis(12)                                   → fila 2 (full)
  // servicios(4) + procesos(4) + eventos(4)    → fila 3
  // offline(4)                                 → fila 4
  const WIDGET_DEFAULT_COLS = {
    grafica:   8,
    wol:       4,
    kpis:      12,
    servicios: 4,
    procesos:  4,
    eventos:   4,
    offline:   4,
  };

  let _dashLayout = {};
  let _editMode   = false;

  async function loadDashLayout() {
    try {
      const res  = await fetch('/api/dashboard/layout');
      const d    = await res.json();
      const raw  = d.layout || '{}';
      _dashLayout = typeof raw === 'string' ? (JSON.parse(raw) || {}) : (raw || {});
    } catch { _dashLayout = {}; }
    applyDashLayout();
  }

  async function saveDashLayout() {
    const container = document.getElementById('dashSortableContainer');
    const order = container
      ? Array.from(container.querySelectorAll(':scope > .dash-widget-wrap[data-widget-id]'))
          .map(el => el.dataset.widgetId)
      : [];
    const payload = { ..._dashLayout };
    if (order.length) payload.widget_order = order;
    await fetch('/api/dashboard/layout', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: payload })
    });
  }

  function applyDashLayout() {
    document.querySelectorAll('#dashSortableContainer > .dash-widget-wrap[data-widget-id]')
      .forEach(el => {
        const key    = el.dataset.widgetId;
        const hidden = _dashLayout[key] === false;
        el.style.display = hidden ? 'none' : '';
        if (!hidden) {
          const cols = _dashLayout[`${key}_cols`] || WIDGET_DEFAULT_COLS[key] || 12;
          _applyWidgetCols(el, cols);
        }
      });
  }

  /**
   * Ajusta el ancho del widget cambiando grid-column: span N directamente en
   * el .dash-widget-wrap. El elemento ES el hijo del grid — sin parentElement.
   */
  function _applyWidgetCols(el, cols) {
    const c = Math.max(1, Math.min(12, parseInt(cols) || 12));
    el.style.gridColumn = `span ${c}`;
    el.dataset.cols = c;
    el.querySelectorAll('.dash-width-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.cols) === c);
    });
  }

  // ── Modo edición ──────────────────────────────────────────────────────────
  function renderWidgetToggles() {
    const wrap = document.getElementById('widgetToggles');
    if (!wrap) return;
    const hidden = Object.entries(WIDGET_LABELS).filter(([k]) => _dashLayout[k] === false);
    if (!hidden.length) {
      wrap.innerHTML = '<span class="small-muted" style="font-size:.75rem">Todos los widgets son visibles.</span>';
      return;
    }
    wrap.innerHTML = '<span class="small-muted me-1" style="font-size:.75rem">Ocultos:</span>';
    hidden.forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-secondary';
      btn.innerHTML = `<i class="bi bi-eye me-1"></i>${label}`;
      btn.addEventListener('click', async () => {
        _dashLayout[key] = true;
        applyDashLayout();
        renderWidgetToggles();
        await saveDashLayout();
      });
      wrap.appendChild(btn);
    });
  }

  // ── SortableJS sobre el grid container ────────────────────────────────────
  let _sortableInst = null;

  function _applyWidgetOrder(order) {
    if (!order?.length) return;
    const c = document.getElementById('dashSortableContainer');
    if (!c) return;
    order.forEach(id => {
      const el = c.querySelector(`:scope > .dash-widget-wrap[data-widget-id="${id}"]`);
      if (el) c.appendChild(el);
    });
  }

  function _initSortable() {
    const c = document.getElementById('dashSortableContainer');
    if (!c || typeof Sortable === 'undefined') return;
    if (_sortableInst) { _sortableInst.destroy(); _sortableInst = null; }
    _sortableInst = Sortable.create(c, {
      animation:  150,
      ghostClass: 'sortable-ghost',
      dragClass:  'sortable-drag',
      draggable:  '.dash-widget-wrap',
      handle:     '.dash-drag-icon',
      disabled:   true,
      onEnd: async () => {
        const order = Array.from(c.querySelectorAll(':scope > .dash-widget-wrap[data-widget-id]'))
          .map(el => el.dataset.widgetId).filter(Boolean);
        _dashLayout.widget_order = order;
        await saveDashLayout();
      }
    });
  }

  (async () => {
    try {
      const res    = await fetch('/api/dashboard/layout');
      const data   = await res.json();
      const raw    = data.layout || '{}';
      const layout = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(layout.widget_order)) _applyWidgetOrder(layout.widget_order);
    } catch { /* sin orden guardado, usar el del HTML */ }
    _initSortable();
  })();

  function enterEditMode() {
    _editMode = true;
    document.getElementById('dashSortableContainer')?.classList.add('dash-edit-mode');
    document.getElementById('dashCustomPanel').style.display = '';
    const btn = document.getElementById('dashCustomize');
    btn.classList.remove('btn-outline-secondary');
    btn.classList.add('btn-warning');
    renderWidgetToggles();
    _sortableInst?.option('disabled', false);
  }

  function exitEditMode() {
    _editMode = false;
    document.getElementById('dashSortableContainer')?.classList.remove('dash-edit-mode');
    document.getElementById('dashCustomPanel').style.display = 'none';
    const btn = document.getElementById('dashCustomize');
    btn.classList.remove('btn-warning');
    btn.classList.add('btn-outline-secondary');
    saveDashLayout();
    _sortableInst?.option('disabled', true);
  }

  document.getElementById('dashCustomize')?.addEventListener('click', function () {
    if (window.APP_CONFIG?.auth_enabled && !window.APP_CONFIG?.is_admin) {
      if (typeof window.openLoginModal === 'function') window.openLoginModal();
      else window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (_editMode) exitEditMode(); else enterEditMode();
  });
  document.getElementById('dashCustomizeDone')?.addEventListener('click', exitEditMode);

  $(document).on('click', '.dash-width-btn', function () {
    const key  = $(this).data('widget');
    const cols = parseInt($(this).data('cols'));
    _dashLayout[`${key}_cols`] = cols;
    const el = document.querySelector(`#dashSortableContainer > .dash-widget-wrap[data-widget-id="${key}"]`);
    if (el) _applyWidgetCols(el, cols);
  });

  $(document).on('click', '.dash-widget-hide-btn', async function () {
    const key = $(this).data('widget');
    _dashLayout[key] = false;
    applyDashLayout();
    renderWidgetToggles();
    await saveDashLayout();
  });

  document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', loadDashLayout);
  if (document.getElementById('dashboardView')?.classList.contains('show')) loadDashLayout();

  window._getDashLayout = () => _dashLayout;
  window._setDashLayout = l  => { _dashLayout = l; };


  // ══════════════════════════════════════════════════════════
  //  WIDGET PROCESOS — GET /api/scripts/status
  //  Devuelve array directo de scripts con:
  //    name, state (ok|error|missed|stalled|running|unknown),
  //    cfg_label, cfg_color, last_run, next_run, errors, exit_code
  // ══════════════════════════════════════════════════════════

  async function loadProcesosWidget() {
    const $list = $('#dProcesosList');
    $list.html('<div class="small-muted" style="font-size:.82rem">Cargando…</div>');
    try {
      const res = await fetch(`/api/scripts/status?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data    = await res.json();
      const scripts = Array.isArray(data) ? data : (data.scripts || data.statuses || []);

      if (!scripts.length) {
        document.getElementById('dProcesosBadge').innerHTML = '';
        $list.html('<div class="small-muted">Sin scripts configurados</div>');
        return;
      }

      const nErr = scripts.filter(s => ['error', 'missed', 'stalled'].includes(s.state)).length;
      document.getElementById('dProcesosBadge').innerHTML = nErr > 0
        ? `<span class="badge bg-danger ms-1">${nErr} error${nErr > 1 ? 'es' : ''}</span>`
        : `<span class="badge bg-success ms-1">OK</span>`;

      const STATE = {
        ok:      { dot: '#4dffb5', icon: 'bi-check-circle-fill',       cls: 'text-success' },
        success: { dot: '#4dffb5', icon: 'bi-check-circle-fill',       cls: 'text-success' },
        error:   { dot: '#ff6b6b', icon: 'bi-x-circle-fill',           cls: 'text-danger'  },
        failed:  { dot: '#ff6b6b', icon: 'bi-x-circle-fill',           cls: 'text-danger'  },
        missed:  { dot: '#ff6b6b', icon: 'bi-exclamation-circle-fill', cls: 'text-danger'  },
        stalled: { dot: '#ffc107', icon: 'bi-pause-circle-fill',       cls: 'text-warning' },
        running: { dot: '#ffc107', icon: 'bi-arrow-repeat',            cls: 'text-warning' },
        unknown: { dot: 'rgba(255,255,255,.25)', icon: 'bi-question-circle', cls: 'text-muted' },
      };

      $list.html(scripts.map(s => {
        const rawSt  = (s.state || 'unknown').toLowerCase();
        const st     = STATE[rawSt] || STATE.unknown;
        const label  = esc(s.cfg_label || s.label || s.name || '—');
        const color  = s.cfg_color || '';
        const exit   = s.exit_code != null
          ? `<span style="font-size:.63rem;opacity:.4;margin-left:2px">exit:${s.exit_code}</span>` : '';
        const ago    = s.last_run
          ? `<span class="ms-auto svc-latency" style="flex-shrink:0;font-size:.72rem">${_fmtAgo(s.last_run)}</span>` : '';
        const tip    = s.errors?.length ? ` title="${esc(s.errors[0].substring(0, 120))}"` : '';
        const dotBg  = color || st.dot;
        return `<div class="dash-svc-row"${tip}>
          <span style="width:7px;height:7px;border-radius:50%;background:${dotBg};flex-shrink:0;display:inline-block"></span>
          <i class="bi ${st.icon} ${st.cls}" style="font-size:.78rem;flex-shrink:0"></i>
          <span class="dash-svc-name" style="font-size:.83rem">${label}${exit}</span>
          ${ago}
        </div>`;
      }).join(''));
    } catch (e) {
      if (document.getElementById('dProcesosBadge'))
        document.getElementById('dProcesosBadge').innerHTML = '';
      $list.html(`<div class="small-muted" style="font-size:.78rem"><i class="bi bi-info-circle me-1"></i>No disponible</div>`);
      console.warn('[Procesos widget]', e.message);
    }
  }

  function _fmtAgo(isoStr) {
    try {
      const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
      if (s < 60)    return `${s}s`;
      if (s < 3600)  return `${Math.floor(s / 60)}m`;
      if (s < 86400) return `${Math.floor(s / 3600)}h`;
      return `${Math.floor(s / 86400)}d`;
    } catch { return '—'; }
  }

  $('#dashProcesosRefresh').on('click', loadProcesosWidget);
  document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', loadProcesosWidget);
  if (document.getElementById('dashboardView')?.classList.contains('show')) loadProcesosWidget();
  setInterval(() => {
    if (document.getElementById('dashboardView')?.classList.contains('show')) loadProcesosWidget();
  }, 30000);


  // ══════════════════════════════════════════════════════════
  //  WIDGET WAKE-ON-LAN
  // ══════════════════════════════════════════════════════════

  function _wolGetAlias(saved, ip) {
    if (!Array.isArray(saved)) return null;
    for (const e of saved) {
      if (typeof e === 'string' && e === ip) return null;
      if (e?.ip === ip) return e.alias || null;
    }
    return null;
  }
  function _wolGetIps(saved) {
    if (!Array.isArray(saved)) return null;
    return saved.map(e => typeof e === 'string' ? e : e.ip);
  }

  async function loadWolWidget() {
    const $list = $('#dashWolList');
    $list.html('<div class="small-muted" style="font-size:.82rem">Cargando…</div>');
    try {
      const hostsData  = await fetch('/api/hosts').then(r => r.json());
      const savedHosts = Array.isArray(_dashLayout.wol_hosts) ? _dashLayout.wol_hosts : null;
      const savedIps   = _wolGetIps(savedHosts);
      const NON_WOL    = ['router', 'switch', 'ap', 'access point', 'onu', 'módem', 'modem'];
      const allCands   = (hostsData.hosts || []).filter(h =>
        h.mac?.length >= 12 && !NON_WOL.some(t => (h.type_name || '').toLowerCase().includes(t))
      );
      const hosts = savedIps ? allCands.filter(h => savedIps.includes(h.ip)) : allCands;
      if (!hosts.length) {
        $list.html('<div class="small-muted" style="font-size:.82rem">Sin equipos. Pulsa <i class="bi bi-gear"></i> para configurar.</div>');
        return;
      }
      $list.html(hosts.map(h => {
        const alias  = _wolGetAlias(savedHosts, h.ip);
        const name   = esc(alias || h.manual_name || h.nmap_hostname || h.router_hostname || h.ip);
        const online = ['online', 'online_silent'].includes(h.status);
        const dot    = online ? '<span style="color:#4dffb5;font-size:.8rem">●</span>'
                              : '<span style="color:#ff6b6b;font-size:.8rem">●</span>';
        return `<div class="dash-svc-row">
          ${dot}
          <span class="dash-svc-name" style="font-size:.84rem">${name}</span>
          <span class="text-muted" style="font-size:.7rem;opacity:.4">${esc(h.ip)}</span>
          <button class="btn ${online ? 'btn-outline-secondary' : 'btn-outline-warning'} btn-sm py-0 px-2 ms-auto dash-wol-btn"
                  data-ip="${esc(h.ip)}" data-name="${name}" style="font-size:.7rem">
            <i class="bi bi-lightning-charge-fill"></i>
          </button>
        </div>`;
      }).join(''));
    } catch (e) {
      $list.html(`<div class="text-danger small">Error: ${esc(String(e))}</div>`);
    }
  }

  $(document).on('click', '.dash-wol-btn', async function () {
    const ip = $(this).data('ip'), name = $(this).data('name');
    const $msg = $('#dashWolMsg'), $btn = $(this);
    $btn.prop('disabled', true);
    $msg.text(`⚡ Enviando WoL a ${name}…`).css('color', 'var(--accent)');
    try {
      const data = await fetch(`/api/hosts/${encodeURIComponent(ip)}/wol`, { method: 'POST' }).then(r => r.json());
      $msg.text(data.ok ? `✓ WoL enviado a ${name} (${data.mac})` : `✗ ${data.error || 'Error'}`)
          .css('color', data.ok ? '#4dffb5' : '#ff6b6b');
    } catch (e) {
      $msg.text(`✗ ${e.message}`).css('color', '#ff6b6b');
    }
    setTimeout(() => { $btn.prop('disabled', false); $msg.text(''); }, 4000);
  });

  $('#dashWolRefresh').on('click', loadWolWidget);

  $('#dashWolConfig').on('click', async function () {
    if (window.APP_CONFIG?.auth_enabled && !window.APP_CONFIG?.is_admin) {
      if (typeof window.openLoginModal === 'function') window.openLoginModal();
      else window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const $body = $('#wolConfigList');
    $body.html('<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-info"></div></div>');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('wolConfigModal')).show();
    try {
      const [hostsData, layoutData] = await Promise.all([
        fetch('/api/hosts').then(r => r.json()),
        fetch('/api/dashboard/layout').then(r => r.json()),
      ]);
      const raw    = layoutData.layout || '{}';
      const layout = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const saved  = Array.isArray(layout.wol_hosts) ? layout.wol_hosts : [];
      const NON_WOL = ['router', 'switch', 'ap', 'access point', 'onu', 'módem', 'modem'];
      const cands   = (hostsData.hosts || []).filter(h =>
        h.mac?.length >= 12 && !NON_WOL.some(t => (h.type_name || '').toLowerCase().includes(t))
      );
      if (!cands.length) { $body.html('<div class="small-muted">No hay hosts WoL detectados.</div>'); return; }
      const savedIps = _wolGetIps(saved);
      $body.html(`
        <div class="d-flex gap-2 mb-2 pb-2" style="border-bottom:1px solid rgba(255,255,255,.1)">
          <button class="btn btn-outline-success btn-sm py-0 px-2" id="wolSelectAll" style="font-size:.78rem">
            <i class="bi bi-check-all me-1"></i>Todos</button>
          <button class="btn btn-outline-secondary btn-sm py-0 px-2" id="wolSelectNone" style="font-size:.78rem">
            <i class="bi bi-x me-1"></i>Ninguno</button>
          <span class="small-muted ms-2" style="font-size:.75rem;align-self:center">${cands.length} equipos</span>
        </div>
        ${cands.map(h => {
          const defName = h.manual_name || h.nmap_hostname || h.router_hostname || h.ip;
          const alias   = _wolGetAlias(saved, h.ip) || '';
          const checked = !saved.length || savedIps?.includes(h.ip) ? 'checked' : '';
          const dot     = ['online', 'online_silent'].includes(h.status) ? '🟢' : '🔴';
          return `<div class="py-2" style="border-bottom:1px solid rgba(255,255,255,.05)">
            <label class="d-flex align-items-center gap-2 mb-1" style="cursor:pointer">
              <input type="checkbox" class="form-check-input mt-0 wol-host-check" value="${esc(h.ip)}" ${checked}>
              ${dot} <span style="font-size:.85rem">${esc(defName)}</span>
              <span class="text-muted ms-auto" style="font-size:.7rem">${esc(h.ip)}</span>
            </label>
            <div class="ms-4 d-flex align-items-center gap-2">
              <span class="text-muted" style="font-size:.72rem;white-space:nowrap">Alias:</span>
              <input type="text" class="form-control form-control-sm wol-host-alias" data-ip="${esc(h.ip)}"
                     placeholder="${esc(defName)}" value="${esc(alias)}" style="font-size:.78rem;max-width:200px">
            </div>
          </div>`;
        }).join('')}`);
      $('#wolSelectAll').on('click',  () => $('.wol-host-check').prop('checked', true));
      $('#wolSelectNone').on('click', () => $('.wol-host-check').prop('checked', false));
    } catch (e) {
      $body.html(`<div class="text-danger small">Error: ${esc(String(e))}</div>`);
    }
  });

  $('#wolConfigSave').on('click', async function () {
    const selected = [];
    $('.wol-host-check:checked').each(function () {
      const ip = $(this).val(), alias = $(`.wol-host-alias[data-ip="${ip}"]`).val().trim();
      selected.push(alias ? { ip, alias } : { ip });
    });
    _dashLayout.wol_hosts = selected;
    await saveDashLayout();
    bootstrap.Modal.getInstance(document.getElementById('wolConfigModal'))?.hide();
    loadWolWidget();
  });

  document.getElementById('dashboard-tab')?.addEventListener('shown.bs.tab', loadWolWidget);
  if (document.getElementById('dashboardView')?.classList.contains('show')) loadWolWidget();

}); // end $(function)
