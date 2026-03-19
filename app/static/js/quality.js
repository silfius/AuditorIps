// ════════════════════════════════════════════════════════
//  quality.js — Auditor IPs · Calidad de conexión
//  Gráficas latencia, lossVLines plugin, export CSV
// ════════════════════════════════════════════════════════
$(function() {
  let _qualityRange = 1;
  let _qualityCharts = {};


// Plugin: líneas verticales rojas cuando hay pérdida de paquetes
const lossVLinesPlugin = {
  id: 'lossVLines',
  afterDatasetsDraw(chart, args, pluginOptions) {
    try {
      const lossIdx = (chart?.config?._lossIndexes) || [];
      if (!lossIdx.length) return;
      const ctx = chart.ctx;
      const x = chart.scales.x;
      const area = chart.chartArea;
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,107,107,0.95)';
      for (const i of lossIdx) {
        const xp = x.getPixelForValue(i);
        if (!isFinite(xp)) continue;
        ctx.beginPath();
        ctx.moveTo(xp, area.top);
        ctx.lineTo(xp, area.bottom);
        ctx.stroke();
      }
      ctx.restore();
    } catch(e) {
      console.error('lossVLinesPlugin', e);
    }
  }
};



  // ── Selector de interfaz para pings de calidad ───────────
  // Mostramos las redes configuradas (con sus nombres) en vez de interfaces del SO.
  // El usuario sabe qué red quiere probar; la interfaz física la gestiona el backend.
  async function loadQualityInterfaces(selectValue) {
    const $sel    = $('#qualityInterface');
    const $status = $('#qualityIfaceStatus');
    try {
      const [netRes, settRes] = await Promise.all([
        fetch('/api/config/networks').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);
      const nets           = (netRes.networks || []).filter(n => n.enabled);
      const s              = settRes.settings || {};
      const primaryLabel   = (s.primary_net_label || '').trim() || 'Red principal';
      const primaryIface   = (s.primary_net_interface || '').trim();
      const primaryCidrRaw = (s.scan_cidr || '').trim();

      $sel.html('<option value="">— automático (ruta por defecto) —</option>');

      // Red principal — siempre aparece como primera opción (si tiene CIDR configurado)
      if (primaryCidrRaw) {
        const cidrLabel = primaryCidrRaw.split(',')[0].trim(); // primer CIDR
        $sel.append(`<option value="${esc(primaryIface)}">${esc(primaryLabel)}  (${esc(cidrLabel)})</option>`);
        // Actualizar el mapa iface→label para que el ping log use el nombre correcto
        if (primaryIface) _ifaceToNetLabel[primaryIface] = primaryLabel;
      }

      // Redes secundarias
      for (const n of nets) {
        const label = n.label || n.cidr;
        const val   = n.interface || '';
        $sel.append(`<option value="${esc(val)}">${esc(label)}  (${esc(n.cidr)})</option>`);
      }

      if (selectValue) $sel.val(selectValue);

      const total = (primaryCidrRaw ? 1 : 0) + nets.length;
      $status.text(total ? `${total} red(es) disponible(s)` : 'No hay redes configuradas')
             .css('color', total ? 'var(--accent)' : 'rgba(255,255,255,0.4)');
    } catch(e) {
      $status.text('Error al cargar redes').css('color', '#ff6b6b');
    }
  }

  // Botón Detectar → refresca la lista de redes
  $('#qualityIfaceRefresh').on('click', async function() {
    const $icon = $(this).find('i');
    $icon.addClass('spin');
    $(this).prop('disabled', true);
    await loadQualityInterfaces($('#qualityInterface').val());
    $icon.removeClass('spin');
    $(this).prop('disabled', false);
  });


  // Mapa: nombre_interfaz → label_red (ej: "wlp2s0" → "Tecnocolor")
  let _ifaceToNetLabel = {};

  async function _loadNetworkLabels() {
    try {
      const [netRes, settRes] = await Promise.all([
        fetch('/api/config/networks').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);
      const map = {};
      // Redes secundarias con su interfaz y label
      for (const n of (netRes.networks || [])) {
        if (n.interface && n.label) map[n.interface] = n.label;
        if (n.interface && !n.label && n.cidr) map[n.interface] = n.cidr;
      }
      // Red principal: buscar interfaz en quality/interfaces y asignar label
      const primaryLabel = ((settRes.settings || {}).primary_net_label || '').trim() || 'Red principal';
      const primaryCidrs = ((settRes.settings || {}).scan_cidr || '').split(',').map(c => c.trim()).filter(Boolean);
      // Para la red principal no tenemos interfaz directa en settings,
      // así que la dejamos como fallback con "Red principal"
      _ifaceToNetLabel = map;
    } catch(e) {}
  }

  async function loadQualitySettings() {
    const res  = await fetch('/api/quality/settings');
    const data = await res.json();
    if (!data.ok) return;
    const s = data.settings;
    $('#qualityEnabled').prop('checked', !!s.enabled);
    $('#qualityThreshold').val(s.alert_threshold_pct || 200);
    $('#qualityCooldown').val(s.alert_cooldown_minutes || 30);
    $('#qualityQuietStart').val(s.quiet_start || '');
    $('#qualityQuietEnd').val(s.quiet_end || '');
    // Cargar mapa de labels de red e interfaces disponibles en paralelo
    await Promise.all([_loadNetworkLabels(), loadQualityInterfaces('')]);
    renderQualityTargets(data.targets);
  }

  function renderQualityTargets(targets) {
    const c = $('#qualityTargetsList');
    c.empty();
    if (!targets.length) {
      c.append('<span class="small-muted" style="font-size:.8rem">No hay destinos configurados. Añade uno arriba (ej: 8.8.8.8 = Google DNS, 1.1.1.1 = Cloudflare)</span>');
      return;
    }
    for (const t of targets) {
      // Mostrar nombre de red configurada si existe, si no la interfaz, si no "auto"
      const netLabel = t.interface ? (_ifaceToNetLabel[t.interface] || null) : null;
      const ifaceLabel = t.interface
        ? `<span style="font-size:.7rem;background:rgba(77,255,181,0.12);border:1px solid rgba(77,255,181,0.25);border-radius:4px;padding:1px 6px;color:var(--accent)"
                title="Interfaz: ${esc(t.interface)}">${esc(netLabel || t.interface)}</span>`
        : '<span style="font-size:.68rem;opacity:.35" title="Interfaz automática (ruta por defecto)">auto</span>';
      c.append(`
        <div class="quality-target-badge ${t.enabled?'':'disabled'}"
             style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;
                    background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,${t.enabled?'0.12':'0.06'})">
          <div class="quality-dot ${t.enabled?'ok':'warn'}" style="flex-shrink:0"></div>
          <div style="display:flex;flex-direction:column;line-height:1.2">
            <strong style="font-size:.82rem">${esc(t.name)}</strong>
            <span style="font-family:monospace;font-size:.75rem;opacity:.7">${esc(t.host)}</span>
          </div>
          ${ifaceLabel}
          <button class="btn btn-link p-0 ms-1 btn-quality-toggle" data-tid="${t.id}"
                  title="${t.enabled?'Deshabilitar':'Habilitar'}"
                  style="font-size:.75rem;color:${t.enabled?'#ffc107':'var(--accent)'}">
            ${t.enabled ? '⏸' : '▶'}
          </button>
          <button class="btn btn-link p-0 ms-1 btn-quality-del" data-tid="${t.id}"
                  style="font-size:.75rem;color:#ff6b6b" title="Eliminar">✕</button>
        </div>
      `);
    }
  }

  async function loadQualityHistory() {
    const res  = await fetch(`/api/quality/history?days=${_qualityRange}&_=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) return;
    const container = document.getElementById('qualityChartsContainer');

    // Update range info badge
    const rangeInfoEl = document.getElementById('qualityRangeInfo');
    if (rangeInfoEl) {
      const totalPoints = data.targets.reduce((s, t) => s + t.data.length, 0);
      const rangeLabel = _qualityRange === 1 ? 'Hoy' : `Últimos ${_qualityRange} días`;
      const fromDate = totalPoints > 0
        ? new Date(data.targets.flatMap(t=>t.data).sort((a,b)=>a.checked_at.localeCompare(b.checked_at))[0]?.checked_at).toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit'})
        : '—';
      rangeInfoEl.textContent = `${rangeLabel} · desde ${fromDate} · ${totalPoints} registros`;
    }

    if (!data.targets.length || data.targets.every(t => !t.data.length)) {
      container.innerHTML = '<div class="small-muted text-center py-4">Sin datos todavía. Activa la monitorización y espera el primer ping.</div>';
      return;
    }

    // Clear old charts
    for (const id in _qualityCharts) { try { _qualityCharts[id].destroy(); } catch(e){} }
    _qualityCharts = {};
    container.innerHTML = '';

    // Show active interface banner if non-default
    const activeIface = ($('#qualityInterface').val() || '').trim();
    if (activeIface) {
      const banner = document.createElement('div');
      banner.className = 'mb-3';
      banner.innerHTML = `<span style="font-size:.78rem;background:rgba(77,255,181,0.1);border:1px solid rgba(77,255,181,0.3);border-radius:6px;padding:3px 10px;color:var(--accent)">
        <i class="bi bi-ethernet me-1"></i>Pings enviados por interfaz: <strong>${esc(activeIface)}</strong>
      </span>`;
      container.appendChild(banner);
    }

    const dark = !document.body.classList.contains('light-mode');
    const textColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
    const gridColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    for (const t of data.targets) {
      if (!t.enabled && !t.data.length) continue;

      // Stats
      const lats = t.data.filter(d => d.latency_ms != null).map(d => d.latency_ms);
      const avgMs = lats.length ? Math.round(lats.reduce((a,b)=>a+b,0)/lats.length) : null;
      const minMs = lats.length ? Math.round(Math.min(...lats)) : null;
      const maxMs = lats.length ? Math.round(Math.max(...lats)) : null;
      const downCount = t.data.filter(d => d.status === 'down' || d.status === 'error').length;
      const upPct = t.data.length ? Math.round((t.data.length - downCount) / t.data.length * 100) : null;

      const div = document.createElement('div');
      div.className = 'quality-chart-card mb-3';
      div.innerHTML = `
        <div class="d-flex align-items-center gap-3 mb-2 flex-wrap">
          <strong>${esc(t.name)}</strong>
          <span class="small-muted">${esc(t.host)}</span>
          ${avgMs != null ? `<span class="quality-stat">⚡ Media: <strong>${avgMs}ms</strong></span>` : ''}
          ${minMs != null ? `<span class="quality-stat">↓ Min: ${minMs}ms</span>` : ''}
          ${maxMs != null ? `<span class="quality-stat">↑ Max: ${maxMs}ms</span>` : ''}
          ${upPct != null ? `<span class="quality-stat ms-auto">Disponibilidad: <strong style="color:${upPct>=95?'var(--accent)':upPct>=80?'#ffc107':'#ff6b6b'}">${upPct}%</strong></span>` : ''}
        </div>
        <canvas id="qchart_${t.id}" style="max-height:130px"></canvas>
      `;
      container.appendChild(div);

      if (!t.data.length) continue;

      // Build chart data
      const labels = t.data.map(d => {
        const dt = new Date(d.checked_at);
        if (_qualityRange === 1) return dt.toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
        if (_qualityRange === 7) return dt.toLocaleDateString('es-ES', {weekday:'short',day:'2-digit'}) + ' ' + dt.toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'});
        return dt.toLocaleDateString('es-ES', {day:'2-digit',month:'2-digit'});
      });
      const latData = t.data.map(d => d.latency_ms);
      const lossData = t.data.map(d => (d.packet_loss != null ? Number(d.packet_loss) : null));
      const bgColors = t.data.map(d => {
        if (d.status === 'down' || d.status === 'error') return 'rgba(255,107,107,0.9)';
        if (d.packet_loss != null && Number(d.packet_loss) > 0) return 'rgba(255,107,107,0.9)';
        if (d.latency_ms == null) return 'rgba(255,255,255,0.1)';
        if (avgMs && d.latency_ms > avgMs * 2) return 'rgba(255,193,7,0.8)';
        return accentColor(0.7);
      });

      const lossIndexes = [];
for (let i = 0; i < lossData.length; i++) {
  const v = lossData[i];
  if (v != null && v > 0) lossIndexes.push(i);
}

const ctx = document.getElementById(`qchart_${t.id}`).getContext('2d');

      _qualityCharts[t.id] = new Chart(ctx, {
        plugins: [lossVLinesPlugin],
        type: 'line',
        data: {
          labels,
          datasets: [
          {
            label: 'Latencia (ms)',
            data: latData,
            borderColor: accentColor(0.8),
            backgroundColor: accentColor(0.12),
            borderWidth: 1.5,
            fill: true,
            tension: 0.3,
            spanGaps: true,
            yAxisID: 'y',

            // ✅ Marcar pérdida de paquetes en el MISMO índice (sin desalinear)
            pointRadius: (ctx) => {
              const i = ctx.dataIndex;
              const loss = lossData[i];
              if (loss != null && loss > 0) return 5;
              return (t.data.length > 200) ? 0 : 3;
            },
            pointHoverRadius: 6,
            pointStyle: (ctx) => {
              const i = ctx.dataIndex;
              const loss = lossData[i];
              return 'circle';
            },
            pointBackgroundColor: (ctx) => {
              const i = ctx.dataIndex;
              const d = t.data[i];
              if (!d) return accentColor(0.7);
              if (d.status === 'down' || d.status === 'error') return 'rgba(255,107,107,0.95)';
              const loss = lossData[i];
              if (loss != null && loss > 0) return 'rgba(255,107,107,0.95)';
              if (d.latency_ms == null) return 'rgba(255,255,255,0.12)';
              if (avgMs && d.latency_ms > avgMs * 2) return 'rgba(255,193,7,0.9)';
              return accentColor(0.7);
            },
            pointBorderColor: (ctx) => {
              const i = ctx.dataIndex;
              const loss = lossData[i];
              return (loss != null && loss > 0) ? 'rgba(255,107,107,1)' : 'rgba(0,0,0,0)';
            },
            pointBorderWidth: (ctx) => {
              const i = ctx.dataIndex;
              const loss = lossData[i];
              return (loss != null && loss > 0) ? 1 : 0;
            },
          }
        ]
        },
        options: {
          responsive: true,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(20,24,30,0.95)',
              titleColor: '#fff',
              bodyColor: 'rgba(255,255,255,0.8)',
              borderColor: 'rgba(255,255,255,0.15)',
              borderWidth: 1,
              padding: 10,
              displayColors: false,
              callbacks: {
                title: (items) => items[0].label,
                label: (item) => {
                  const d = t.data[item.dataIndex];
                  if (!d) return 'Sin datos';
                  const lines = [];
                  if (d.latency_ms != null) lines.push(`⚡ Latencia: ${d.latency_ms.toFixed(1)} ms`);
                  else lines.push('📵 Sin respuesta');
                  if (d.packet_loss != null) lines.push(`📦 Pérdida paquetes: ${d.packet_loss}%`);
                  if (avgMs && d.latency_ms) {
                    const pct = Math.round((d.latency_ms / avgMs) * 100);
                    lines.push(`📊 vs media: ${pct}%`);
                  }
                  return lines;
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
              grid: { display: false }
            },
            y: {
              display: true,
              title: { display: true, text: 'ms', color: textColor, font: { size: 9 } },
              ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 4 },
              grid: { color: gridColor }
            }
          },
            y1: {
              position: 'right',
              display: false,
              suggestedMin: 0,
              suggestedMax: 100,
              title: { display: true, text: '% pérdida', color: textColor, font: { size: 9 } },
              ticks: { color: textColor, font: { size: 9 }, maxTicksLimit: 3, callback: (v)=> v + '%' },
              grid: { drawOnChartArea: false }
            }
        }
      });
      // Asignar loss indexes para el plugin de líneas verticales
      _qualityCharts[t.id].config._lossIndexes = lossIndexes;
    }

    const last = data.targets.flatMap(t => t.data).sort((a,b) => b.checked_at.localeCompare(a.checked_at))[0];
    if (last) $('#qualityLastUpdate').text('Último check: ' + new Date(last.checked_at).toLocaleTimeString('es-ES'));
  }

  // Quality tab events
  document.getElementById('quality-tab').addEventListener('shown.bs.tab', () => {
    loadQualitySettings();
    loadQualityHistory();
    if (typeof window.populateQualityExportTargets === 'function') {
      window.populateQualityExportTargets();
    }
    // Set default export dates if not set
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const fromEl = document.getElementById('qualityExportFrom');
    const toEl = document.getElementById('qualityExportTo');
    if (fromEl && !fromEl.value) { fromEl.value = weekAgo; }
    if (toEl && !toEl.value) { toEl.value = today; }
  });

  // Range selector
  $(document).on('click', '.quality-range-btn', function() {
    $('.quality-range-btn').removeClass('active');
    $(this).addClass('active');
    _qualityRange = parseInt($(this).data('range'));
    loadQualityHistory();
  });

  // Toggle monitoring
  $('#qualityEnabled').on('change', async function() {
    const enabled = this.checked;
    const threshold = parseFloat($('#qualityThreshold').val()) || 200;
    const cooldown = parseInt($('#qualityCooldown').val()) || 30;
    const qs = $('#qualityQuietStart').val();
    const qe = $('#qualityQuietEnd').val();
    await fetch('/api/quality/settings', {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ enabled, alert_threshold_pct: threshold, alert_cooldown_minutes: cooldown, quiet_start: qs, quiet_end: qe })
    });
  });

  $('#qualitySaveSettings').on('click', async function() {
    const payload = {
      enabled: $('#qualityEnabled').prop('checked'),
      alert_threshold_pct: parseFloat($('#qualityThreshold').val()) || 200,
      alert_cooldown_minutes: parseInt($('#qualityCooldown').val()) || 30,
      quiet_start: $('#qualityQuietStart').val(),
      quiet_end: $('#qualityQuietEnd').val(),
    };
    const res = await fetch('/api/quality/settings', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      const $btn = $(this);
      $btn.html('<i class="bi bi-check-lg"></i> Guardado').addClass('btn-success');
      setTimeout(() => $btn.html('<i class="bi bi-floppy-fill"></i> Guardar configuración'), 3000);
    }
  });

  // Add target — incluye la interfaz seleccionada para ese destino específico
  $('#qualityAddTarget').on('click', async function() {
    const name      = $('#qualityNewName').val().trim();
    const host      = $('#qualityNewHost').val().trim();
    const iface     = $('#qualityInterface').val() || '';
    if (!name || !host) {
      showToast('Nombre y Host son obligatorios', 'warning');
      return;
    }
    const res = await fetch('/api/quality/targets', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, host, interface: iface })
    });
    if ((await res.json()).ok) {
      $('#qualityNewName').val('');
      $('#qualityNewHost').val('');
      $('#qualityInterface').val(''); // reset selector tras añadir
      showToast(`Destino "${name}" (${host}) añadido${iface ? ' · vía ' + iface : ''}`, 'success');
      await loadQualitySettings();
    }
  });

  // Toggle/delete target
  $(document).on('click', '.btn-quality-toggle', async function(e) {
    e.stopPropagation();
    const tid = $(this).data('tid');
    await fetch(`/api/quality/targets/${tid}/toggle`, {method:'POST'});
    await loadQualitySettings();
  });
  $(document).on('click', '.btn-quality-del', async function(e) {
    e.stopPropagation();
    const tid = $(this).data('tid');
    if (!confirm('¿Eliminar este destino y su historial?')) return;
    await fetch(`/api/quality/targets/${tid}`, {method:'DELETE'});
    await loadQualitySettings();
    await loadQualityHistory();
  });

  // ── Ping bajo demanda — columnas por destino, 1 ping/seg ──────────────
  let _pingAborted  = false;
  let _pingRunning  = false;
  let _pingLogLines = [];          // para descarga
  let _pingColData  = {};          // { targetName: [{ts, lat, loss, status}] }
  const _PING_ROWS  = 6;           // filas visibles por columna

  function _pingSetRunning(running) {
    _pingRunning = running;
    if (running) {
      $('#qualityCheckNow').prop('disabled', true).html('<i class="bi bi-arrow-repeat spin-icon"></i> Pingando…');
      $('#qualityPingStop').show();
      $('#qualityPingDownload').hide();
      $('#qualityPingCycle').show();
    } else {
      $('#qualityCheckNow').prop('disabled', false).html('<i class="bi bi-play-fill"></i> Iniciar pings');
      $('#qualityPingStop').hide();
      $('#qualityPingCycle').hide().text('');
      if (_pingLogLines.length) $('#qualityPingDownload').show();
    }
  }

  function _renderPingColumns() {
    const $wrap = $('#qualityPingColumns');
    const names = Object.keys(_pingColData);
    if (!names.length) return;

    // Actualizar cada columna
    names.forEach(name => {
      const colId = 'pingcol_' + name.replace(/[^a-z0-9]/gi,'_');
      let $col = $(`#${colId}`);

      if (!$col.length) {
        // Primera vez: crear la columna
        $col = $(`<div id="${colId}" style="flex:1 1 180px;min-width:160px;max-width:280px">
          <div style="font-size:.75rem;font-weight:600;color:var(--accent);margin-bottom:4px;padding:2px 6px;
                      background:rgba(77,255,181,0.08);border-radius:4px;white-space:nowrap;overflow:hidden;
                      text-overflow:ellipsis">${esc(name)}</div>
          <div class="pingcol-rows"
               style="font-family:monospace;font-size:.73rem;background:rgba(0,0,0,0.2);
                      border:1px solid rgba(255,255,255,0.07);border-radius:5px;
                      padding:5px 7px;height:calc(${_PING_ROWS} * 1.55em + 10px);
                      overflow-y:auto;line-height:1.55"></div>
        </div>`);
        $wrap.append($col);
      }

      const rows  = _pingColData[name];
      const $rows = $col.find('.pingcol-rows');
      $rows.empty();
      rows.forEach(r => {
        const ok    = r.status === 'ok';
        const color = ok ? '#4dffb5' : (r.loss > 0 && r.loss < 100 ? '#ffc107' : '#ff6b6b');
        const lat   = r.lat != null ? `${r.lat.toFixed(1)}ms` : '—';
        const loss  = r.loss > 0 ? `<span style="color:#ffc107"> ${r.loss}%↓</span>` : '';
        const icon  = ok ? '✓' : '✗';
        $rows[0].insertAdjacentHTML('beforeend',
          `<div><span style="opacity:.45">${r.ts}</span> <span style="color:${color}">${icon} ${lat}</span>${loss}</div>`
        );
      });
      // Auto-scroll al fondo
      $rows[0].scrollTop = $rows[0].scrollHeight;
    });
  }

  $('#qualityCheckNow').on('click', async function() {
    if (_pingRunning) return;
    _pingAborted  = false;
    _pingLogLines = [];
    _pingColData  = {};
    $('#qualityPingColumns').empty().css('display', 'flex');
    _pingSetRunning(true);

    // Leer targets una sola vez al inicio
    let targets = [];
    try {
      const tr = await fetch('/api/quality/targets');
      const td = await tr.json();
      targets = (td.targets || []).filter(t => t.enabled);
    } catch(e) {}

    if (!targets.length) {
      $('#qualityPingColumns').html('<span class="small-muted">No hay destinos activos configurados.</span>');
      _pingSetRunning(false);
      return;
    }

    // Inicializar columnas vacías
    targets.forEach(t => { _pingColData[t.name] = []; });
    _renderPingColumns();

    let ciclo = 0;

    while (!_pingAborted) {
      ciclo++;
      $('#qualityPingCycle').text(`Ciclo ${ciclo}`);

      try {
        const res  = await fetch('/api/quality/ping-now', { method: 'POST' });
        const data = await res.json();

        if (!data.ok) break;

        const ts = new Date().toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
        for (const r of data.results) {
          if (_pingAborted) break;
          const netName = r.interface && r.interface !== 'auto' ? (_ifaceToNetLabel[r.interface] || r.interface) : null;
          if (!_pingColData[r.name]) _pingColData[r.name] = [];
          _pingColData[r.name].push({
            ts, lat: r.latency_ms, loss: r.packet_loss || 0, status: r.status
          });
          // Mantener solo las últimas N filas
          if (_pingColData[r.name].length > 50) _pingColData[r.name].shift();
          // Log para descarga
          const icon = r.status === 'ok' ? '✓' : '✗';
          const via  = netName ? ` vía ${netName}` : '';
          _pingLogLines.push(`[${ts}] ${icon} ${r.name} (${r.host}) → ${r.latency_ms != null ? r.latency_ms.toFixed(1)+'ms' : '—'}${r.packet_loss > 0 ? ' pérd:'+r.packet_loss+'%' : ''}${via} [${r.status}]`);
        }
        _renderPingColumns();
        loadQualityHistory();

      } catch(e) {
        break;
      }

      // Pausa de 1 segundo entre ciclos chequeando abort
      await new Promise(r => setTimeout(r, 1000));
    }

    _pingSetRunning(false);
  });

  $('#qualityPingStop').on('click', function() {
    _pingAborted = true;
    _pingLogAppend('── Cancelado por el usuario ──', '#ffc107');
    _pingSetRunning(false);
  });

  $('#qualityPingDownload').on('click', function() {
    const blob = new Blob([_pingLogLines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ping_log_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Auto-refresh calidad si pestaña activa
  setInterval(() => {
    if (document.getElementById('qualityView').classList.contains('active')) {
      loadQualityHistory();
    }
  }, 35000);

  // ══════════════════════════════════════════════════════════
  // QUALITY TABLE — load & export
  // ══════════════════════════════════════════════════════════
  window.populateQualityExportTargets = async function populateQualityExportTargets() {
    const res = await fetch('/api/quality/targets');
    const data = await res.json();
    const sel = document.getElementById('qualityExportTarget');
    sel.innerHTML = '<option value="0">Todos</option>';
    for (const t of (data.targets || [])) {
      sel.innerHTML += `<option value="${t.id}">${esc(t.name)} (${esc(t.host)})</option>`;
    }
  }

  window.loadQualityTable = async function loadQualityTable() {
    const from    = document.getElementById('qualityExportFrom').value;
    const to      = document.getElementById('qualityExportTo').value;
    const tid     = document.getElementById('qualityExportTarget').value;
    const params  = new URLSearchParams();
    if (from) params.set('date_from', from);
    if (to)   params.set('date_to', to);
    if (tid && tid !== '0') params.set('target_id', tid);
    // Load via the same CSV endpoint but parse JSON from history
    // Use history API with computed days
    let days = 30;
    if (from) {
      const diffMs = Date.now() - new Date(from).getTime();
      days = Math.max(1, Math.ceil(diffMs / 86400000) + 1);
    }
    const res  = await fetch(`/api/quality/history?days=${days}`);
    const data = await res.json();
    if (!data.ok) return;

    const fromDate = from ? new Date(from + 'T00:00:00') : null;
    const toDate   = to   ? new Date(to   + 'T23:59:59') : null;
    const targetId = tid && tid !== '0' ? parseInt(tid) : null;

    let rows = [];
    for (const t of data.targets) {
      if (targetId && t.id !== targetId) continue;
      for (const d of t.data) {
        const dt = new Date(d.checked_at);
        if (fromDate && dt < fromDate) continue;
        if (toDate   && dt > toDate)   continue;
        rows.push({ target: t.name, host: t.host, ...d });
      }
    }
    rows.sort((a,b) => b.checked_at.localeCompare(a.checked_at));

    const tbody = document.getElementById('qualityDataTbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center small-muted py-3">Sin datos para el rango seleccionado</td></tr>';
      document.getElementById('qualityTableStatus').textContent = '0 registros';
      return;
    }
    tbody.innerHTML = rows.slice(0, 2000).map(r => {
      const statusClass = r.status === 'ok' ? 'ok' : 'bad';
      const lat = r.latency_ms != null ? r.latency_ms.toFixed(1) + ' ms' : '—';
      const loss = r.packet_loss != null ? r.packet_loss + '%' : '—';
      return `<tr>
        <td>${esc(r.target)}</td>
        <td class="mono">${esc(r.host)}</td>
        <td class="mono">${new Date(r.checked_at).toLocaleString('es-ES')}</td>
        <td class="${statusClass}">${lat}</td>
        <td>${loss}</td>
        <td><span class="${statusClass}">${esc(r.status)}</span></td>
      </tr>`;
    }).join('');
    document.getElementById('qualityTableStatus').textContent =
      `${rows.length} registros${rows.length > 2000 ? ' (mostrando primeros 2000)' : ''}`;
  }

  $('#qualityLoadTable').on('click', loadQualityTable);

  $('#qualityExportCsv').on('click', function() {
  const from = $('#qualityExportFrom').val() || '';
  const to   = $('#qualityExportTo').val() || '';
  const tid  = parseInt($('#qualityExportTarget').val() || '0');
  const lossOnly = $('#qualityLossOnly').prop('checked') ? 1 : 0;
  const lossMin  = parseInt($('#qualityLossMin').val() || '1');

  const qs = new URLSearchParams();
  if (from) qs.set('date_from', from);
  if (to)   qs.set('date_to', to);
  if (tid)  qs.set('target_id', String(tid));
  if (lossOnly) {
    qs.set('loss_only', '1');
    qs.set('loss_min', String(lossMin));
  }
  // Abrir descarga
  window.open(`/api/quality/export.csv?${qs.toString()}`, '_blank');
});

  // (quality-tab listener merged into $(function block above)

  // ══════════════════════════════════════════════════════════
  // SCAN NOTES — inline editing in scans table
  // ══════════════════════════════════════════════════════════
  $(document).on('click', '.scan-note-btn', async function() {
    const scanId = $(this).data('id');
    const current = $(this).data('note') || '';
    const newNote = prompt(`Nota para scan #${scanId}:`, current);
    if (newNote === null) return;
    const res = await fetch(`/api/scans/${scanId}/notes`, {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({notes: newNote})
    });
    if ((await res.json()).ok) {
      $(this).data('note', newNote).attr('title', newNote || 'Sin nota')
        .toggleClass('text-warning', !!newNote)
        .find('span').text(newNote ? '💬' : '📝');
      if (typeof window.loadScans === 'function') window.loadScans();
    }
  });


}); // end $(function) — quality.js
