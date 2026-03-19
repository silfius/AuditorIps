// ════════════════════════════════════════════════════════
//  hosts.js — Auditor IPs · Hosts
//  Tabla hosts, modal edición, WoL, ping, uptime, latencia,
//  tags, mapa de red, grupos, timeline, inline edit
// ════════════════════════════════════════════════════════
$(function() {
  const AUTO_REFRESH_INTERVAL = 30000; // ms
  let autoRefreshTimer = null;
  let lastScanFinished = null;
  let knownUnknownCount = 0;
  let _scanInterval = 900; // segundos, se actualiza desde /api/status
  let _nextScanCountdown = null;
  window._currentTagIp = null; let _currentTagIp = window._currentTagIp;  // shared
  window._currentTags = []; let _currentTags = window._currentTags;  // shared (same array ref)
  window._mUptimeDays = 30; let _mUptimeDays = window._mUptimeDays;  // shared
  window.showOnlyUnknown = false; // shared global
  const notifToast = new bootstrap.Toast(document.getElementById('notifToast'));

  window.updateConnectionDot = function updateConnectionDot(ok) {
    const dot = document.getElementById('connectionDot');
    dot.className = 'online ms-2';
    dot.classList.replace('online', ok ? 'online' : 'offline');
    dot.title = ok ? 'Conectado' : 'Sin conexión con el servidor';
  }

  // Cuenta atrás hasta el próximo scan
  window.startNextScanCountdown = function startNextScanCountdown(scanIntervalSecs, lastFinishedIso) {
    if (_nextScanCountdown) clearInterval(_nextScanCountdown);
    const widget = document.getElementById('lastScanWidget');
    const ageEl  = document.getElementById('lastScanAge');
    if (!lastFinishedIso) return;

    _nextScanCountdown = setInterval(() => {
      const lastMs   = new Date(lastFinishedIso).getTime();
      const nextMs   = lastMs + scanIntervalSecs * 1000;
      const nowMs    = Date.now();
      const sinceMs  = nowMs - lastMs;
      const untilMs  = nextMs - nowMs;

      const sinceMin = Math.floor(sinceMs / 60000);
      let sinceLabel;
      if (sinceMin < 1)       sinceLabel = 'hace un momento';
      else if (sinceMin < 60) sinceLabel = `hace ${sinceMin} min`;
      else                    sinceLabel = `hace ${Math.floor(sinceMin/60)}h ${sinceMin%60}m`;

      let nextLabel = '';
      if (untilMs > 0) {
        const untilSec = Math.ceil(untilMs / 1000);
        const untilMin = Math.floor(untilSec / 60);
        const untilS   = untilSec % 60;
        nextLabel = untilMin > 0
          ? ` · próximo en ${untilMin}m ${untilS}s`
          : ` · próximo en ${untilS}s`;
      }

      ageEl.textContent = sinceLabel + nextLabel;
      const stale = sinceMin > scanIntervalSecs / 60 + 2;
      widget.className = 'ms-2 small-muted' + (stale ? ' stale' : '');
      widget.title = `Último scan: ${new Date(lastFinishedIso).toLocaleString('es-ES')} · Intervalo: ${scanIntervalSecs}s`;
    }, 1000);
  }

  window.pollStatus = async function pollStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error('API error');

      updateConnectionDot(true);

      // Actualizar contadores en tiempo real
      $('#cntOnline').text(data.online);
      $('#cntOffline').text(data.offline);
      $('#cntTotal').text(data.total);
      $('#cntUnknown').text(data.unknown_online);
      $('#cntOnlineBadge').text(data.online);
      $('#cntOfflineBadge').text(data.offline);

      // Actualizar intervalo y countdown
      if (data.scan_interval) {
        _scanInterval = parseInt(data.scan_interval) || 900;
      }
      const newFinished = data.last_scan?.finished_at;
      if (newFinished) startNextScanCountdown(_scanInterval, newFinished);

      // ── Ha habido un scan nuevo desde la última vez ──
      if (lastScanFinished && newFinished && newFinished !== lastScanFinished) {
        if (data.last_scan?.new_hosts > 0 || data.recent_new?.length > 0) {
          const names = (data.recent_new || []).map(h =>
            h.manual_name || h.nmap_hostname || h.ip
          ).slice(0, 3).join(', ');
          document.getElementById('toastBody').textContent =
            `🆕 Nuevo dispositivo: ${names || 'desconocido'}`;
          notifToast.show();
          if (Notification.permission === 'granted') {
            new Notification('Auditor IPs — Nuevo host', {
              body: names || 'Dispositivo desconocido detectado en la red',
              icon: '/static/icon-192.png',
              badge: '/static/icon-192.png',
            });
          }
        }

        // ── Recargar SOLO si el usuario no está haciendo nada ──
        const anyModalOpen   = document.querySelector('.modal.show');
        const anyEditing     = document.querySelector('.svc-edit-form.open, textarea:focus, input:focus:not([readonly])');
        const activeTab      = document.querySelector('.nav-link.active');
        const onHostsTab     = !activeTab || activeTab.id === 'tab-hosts' || activeTab.getAttribute('data-bs-target') === '#tabHosts';

        if (!anyModalOpen && !anyEditing && onHostsTab) {
          // Está en la pestaña de Hosts sin modal → recargar normalmente
          setTimeout(() => location.reload(), 1200);
        } else if (!anyModalOpen && !anyEditing) {
          // Está en otra pestaña → marcar que hay datos nuevos sin recargar
          const badge = document.getElementById('hostTabNewBadge');
          if (badge) badge.style.display = 'inline';
        }
        // Si hay modal abierto → no hacer nada, el usuario está trabajando
      }
      lastScanFinished = newFinished;

    } catch (e) {
      updateConnectionDot(false);
    }
  }

  window.startAutoRefresh = function startAutoRefresh() {
    if (autoRefreshTimer) return;
    pollStatus(); // primera llamada inmediata
    autoRefreshTimer = setInterval(pollStatus, AUTO_REFRESH_INTERVAL);
  }

  window.stopAutoRefresh = function stopAutoRefresh() {
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
  }

  // Arrancar según estado del toggle
  if (document.getElementById('autoRefreshToggle').checked) startAutoRefresh();

  document.getElementById('autoRefreshToggle').addEventListener('change', function() {
    this.checked ? startAutoRefresh() : stopAutoRefresh();
  });

  // Al volver a la pestaña Hosts con datos nuevos pendientes → recargar
  document.getElementById('tab-hosts').addEventListener('click', function() {
    const badge = document.getElementById('hostTabNewBadge');
    if (badge && badge.style.display !== 'none') {
      badge.style.display = 'none';
      location.reload();
    }
  });

  // Inicializar lastScanFinished en primera carga
  fetch('/api/status').then(r => r.json()).then(d => {
    lastScanFinished = d.last_scan?.finished_at || null;
    $('#cntUnknown').text(d.unknown_online || 0);
  }).catch(() => {});

  // ══════════════════════════════════════════════════
  // ✅ FILTRO DESCONOCIDOS
  // ══════════════════════════════════════════════════
  // (showOnlyUnknown declared at top to avoid TDZ)

  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    if (settings.nTable.id !== 'hosts') return true;
    if (!showOnlyUnknown) return true;
    const tr = settings.aoData[dataIndex].nTr;
    // Busca el badge dentro de la fila
    const badge = $(tr).find('.badge-unknown');
    return badge.length > 0;
  });

  $('#unknownFilter').on('click', function() {
    window.showOnlyUnknown = !window.showOnlyUnknown;
    $(this).toggleClass('active-filter', showOnlyUnknown);
    $(this).find('i').toggleClass('bi-question-diamond', !showOnlyUnknown)
                     .toggleClass('bi-question-diamond-fill', showOnlyUnknown);
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });

  // clearFilter unificado arriba — incluye statusFilter y showOnlyUnknown

  // ══════════════════════════════════════════════════
  // ✅ NOTIFICACIONES PUSH — solicitar permiso
  // ══════════════════════════════════════════════════
  if ('Notification' in window && Notification.permission === 'default') {
    // Solo pedir permiso si el usuario lleva un rato (no al instante)
    setTimeout(() => {
      Notification.requestPermission();
    }, 8000);
  }

  // ══════════════════════════════════════════════════
  // ✅ PWA — Service Worker + Install (HTTP-compatible)
  // ══════════════════════════════════════════════════
  let pwaInstallEvent = null;
  const pwaModal = new bootstrap.Modal(document.getElementById('pwaModal'));

  // Detectar plataforma para mostrar instrucciones correctas
  const isIos = /ipad|iphone|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            // Nueva versión lista — forzar activación inmediata y recargar
            nw.postMessage('skipWaiting');
          }
          if (nw.state === 'activated') {
            // SW nuevo activado → recargar para usar ficheros frescos
            window.location.reload();
          }
        });
      });
    }).catch(err => console.warn('SW:', err));

    // Si el SW toma el control mientras la página está abierta → recargar
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }

  // Capturar beforeinstallprompt (solo funciona en HTTPS o localhost)
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    pwaInstallEvent = e;
    // Mostrar sección de instalación automática en el modal
    document.getElementById('pwaPromptAvail').style.display = 'block';
  });

  // Botón instalar automático (dentro del modal)
  document.getElementById('pwaInstallBtn').addEventListener('click', async () => {
    if (!pwaInstallEvent) return;
    pwaInstallEvent.prompt();
    const { outcome } = await pwaInstallEvent.userChoice;
    pwaInstallEvent = null;
    if (outcome === 'accepted') pwaModal.hide();
  });

  // Abrir modal desde topbar
  document.getElementById('pwaOpenModal').addEventListener('click', () => {
    const isDesktop = !('ontouchstart' in window) && !isIos;
    // Mostrar instrucciones según plataforma
    document.getElementById('pwaAndroid').style.display = (!isIos && !isDesktop) ? 'block' : 'none';
    document.getElementById('pwaIos').style.display    = isIos ? 'block' : 'none';
    document.getElementById('pwaDesktop').style.display = isDesktop ? 'block' : 'none';
    // Si ya está instalada como PWA
    if (isStandalone) {
      ['pwaAndroid','pwaIos','pwaDesktop'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const done = document.createElement('div');
      done.className = 'alert alert-success p-2 mb-0';
      done.innerHTML = '<i class="bi bi-check-circle-fill"></i> <strong>¡Ya está instalada</strong> como app en este dispositivo!';
      document.querySelector('#pwaModal .modal-body').prepend(done);
    }
    pwaModal.show();
  });

  // Ocultar botón si ya está corriendo como standalone
  if (isStandalone) {
    const btn = document.getElementById('pwaOpenModal');
    if (btn) btn.style.display = 'none';
  }

  // ── Known badge helpers ──
  function renderKnownBadge(known) {
    if (known) {
      return '<span class="badge badge-known"><i class="bi bi-check-circle-fill"></i> Conocido</span>';
    }
    return '<span class="badge badge-unknown"><i class="bi bi-question-circle"></i> Desconocido</span>';
  }

  let currentKnown = false;

  // Actualizar badge en modal al abrir
  let _openHostBusy = false;
  window.openHostModal = window.openHost = async function openHost(ip) {

    if (_openHostBusy) { console.warn("openHost: reentry blocked for", ip); return; }
    _openHostBusy = true;
    setTimeout(() => { _openHostBusy = false; }, 2000); // reset after 2s
    window.currentIp = currentIp = ip;
    $('#mMsg').text('');
    $('#mEvents').html('<tr><td colspan="4" class="small-muted">Cargando…</td></tr>');
    setLoading(true);

    const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}/detail`);
    const data = await res.json();
    if (!data.ok) { setLoading(false); $('#scanStatus').text('Error: ' + (data.error || 'detalle')); return; }

    const h = data.host;
    currentKnown = !!h.known;
    $('#mIp').text(h.ip || '');
    $('#mStatus').text(h.status || '');
    $('#mMac').text(h.mac || '');
    $('#mVendor').text(h.vendor || '');
    $('#mHost').text(h.nmap_hostname || '');
    $('#mDns').text(h.dns_name || '');
    // Router SSH data
    if (h.router_seen) {
      $('#mRouterInfo').show();
      $('#mRouterHostname').text(h.router_hostname || '—');
      const assignMap = { dhcp: '<span class="badge bg-info text-dark">DHCP</span>', static: '<span class="badge bg-secondary">Static</span>' };
      $('#mIpAssignment').html(assignMap[h.ip_assignment] || `<span class="badge bg-secondary">${h.ip_assignment || '?'}</span>`);
      if (h.dhcp_lease_expires) {
        const secsLeft = Math.max(0, Math.round((new Date(h.dhcp_lease_expires) - Date.now()) / 1000));
        const h2 = Math.floor(secsLeft / 3600), m2 = Math.floor((secsLeft % 3600) / 60);
        $('#mLeaseExpires').text(secsLeft > 0 ? `${h2}h ${m2}m` : 'Expirado');
      } else {
        $('#mLeaseExpires').text('—');
      }
    } else {
      $('#mRouterInfo').hide();
    }
    $('#mFirst').text(h.first_seen_local || '');
    $('#mLast').text(h.last_seen_local || '');
    $('#mLastChange').text(h.last_change_local || '');
    $('#mSeenAgo').text(h.seen_ago || '');
    $('#mManual').val(h.manual_name || '');
    $('#mNotes').val(h.notes || '');
    // Populate tags
    window._currentTagIp = h.ip;
    _currentTags  = (h.tags || '').split(',').map(t=>t.trim()).filter(Boolean);
    renderTagWrap();
    $('#mType').val(h.type_id || '');
    $('#mKnownBadge').html(renderKnownBadge(currentKnown));
    $('#mToggleKnown').text(currentKnown ? 'Marcar desconocido' : 'Marcar conocido');

    // #23 Contador días en estado actual
    if (h.last_change) {
      const lastChange = new Date(h.last_change);
      const now = new Date();
      const diffMs = now - lastChange;
      const diffDays  = Math.floor(diffMs / 86400000);
      const diffHours = Math.floor((diffMs % 86400000) / 3600000);
      const diffMins  = Math.floor((diffMs % 3600000)  / 60000);
      let durStr = '';
      if (diffDays > 0) durStr = `${diffDays}d ${diffHours}h`;
      else if (diffHours > 0) durStr = `${diffHours}h ${diffMins}m`;
      else durStr = `${diffMins}m`;
      const statusEmoji = h.status === 'online' ? '🟢' : '🔴';
      $('#mStatusDuration').text(`${statusEmoji} Lleva ${durStr} ${h.status}`);
    } else {
      $('#mStatusDuration').text('');
    }

    setLoading(false);

    // Cargar uptime, latencia histórica e historial scans
    // Reset uptime range to default 30D on each modal open
    _mUptimeDays = 30;
    $('.uptime-range-btn').removeClass('active').filter('[data-days="30"]').addClass('active');
    $('.uptime-view-btn').removeClass('active').filter('[data-view="chart"]').addClass('active');
    $('#mUptimeChartView').show(); $('#mUptimeGridView').hide();
    try { loadUptime(ip, 30); } catch(e) { console.warn("loadUptime:", e); }
    try { loadLatencyChart(ip); } catch(e) { console.warn("loadLatencyChart:", e); }
    try { loadScanHistory(ip, 10); } catch(e) { console.warn("loadScanHistory:", e); }
    // Reset timeline controls
    setTlBtn('day');
    $('#mHostDatePicker').val('');
    try { loadHostTimeline(ip, 'day'); } catch(e) { console.warn("loadHostTimeline:", e); }
    $('#hostModal').data('current-ip', ip);
    $('#btnScanHistory').show();

    const ok = macValid(h.mac || '');
    $('#mWol').prop('disabled', !ok);
    $('#mWol').attr('title', ok ? 'Wake-on-LAN' : 'WOL requiere MAC válida');

    // ── Historial de IPs (eventos ip_change + new) ──
    const ipEvents = (data.events || []).filter(e =>
      e.event_type === 'ip_change' || e.event_type === 'ip_change_arrived' || e.event_type === 'new'
    );
    if (ipEvents.length > 0) {
      const ipItems = ipEvents.map((e, i) => {
        const isCurrent = i === 0;
        const addr = e.event_type === 'new'
          ? (e.new_value?.replace('mac=', '') ? h.ip : h.ip)
          : (e.new_value || h.ip);
        const displayIp = e.event_type === 'ip_change' ? `${esc(e.old_value)} → ${esc(e.new_value)}`
                        : e.event_type === 'new' ? `Primera vez: ${esc(h.ip)}`
                        : esc(e.new_value || h.ip);
        return `<li>
          <div class="ip-dot ${isCurrent ? '' : 'old'}"></div>
          <div>
            <div class="ip-addr">${displayIp}</div>
            <div class="ip-date">${esc(e.at_local || '')}</div>
          </div>
        </li>`;
      });
      $('#mIpTimeline').html(ipItems.join(''));
      $('#mIpHistoryCard').show();
    } else {
      $('#mIpHistoryCard').hide();
    }

    // ── Historial de eventos completo ──
    const rows = (data.events || []).map(e => `
      <tr>
        <td class="mono">${esc(e.at_local || '')}</td>
        <td class="mono">${esc(e.event_type || '')}</td>
        <td>${esc(e.old_value || '')}</td>
        <td>${esc(e.new_value || '')}</td>
      </tr>`).join('');
    $('#mEvents').html(rows || '<tr><td colspan="4" class="small-muted">Sin eventos</td></tr>');

    // ── Cleanup stray backdrops before opening (prevents modal-blocking bug) ──
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
    document.body.style.removeProperty('overflow');
    window.hostModal.show();
  }

  // Toggle known desde modal
  $('#mToggleKnown').on('click', async function() {
    if (!currentIp) return;
    const newKnown = !currentKnown;
    setBtnLoading(this, true);
    setLoading(true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(currentIp)}/known`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ known: newKnown })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      currentKnown = newKnown;
      $('#mKnownBadge').html(renderKnownBadge(currentKnown));
      $('#mToggleKnown').text(currentKnown ? 'Marcar desconocido' : 'Marcar conocido');
      $('#mMsg').text(newKnown ? '✓ Conocido' : '? Desconocido');
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setBtnLoading(this, false);
      setLoading(false);
      $('#mMsg').text('Error: ' + e.message);
    }
  });

  // Toggle known desde tabla
  $(document).on('click', '.btn-toggle-known', async function(e) {
    e.preventDefault(); e.stopPropagation();
    const ip = $(this).data('ip');
    const wasKnown = $(this).data('known') === true || $(this).data('known') === 'true';
    const newKnown = !wasKnown;
    setBtnLoading(this, true);
    setLoading(true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}/known`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ known: newKnown })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      $('#scanStatus').text(`${ip} → ${newKnown ? 'conocido ✓' : 'desconocido ?'}`);
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      setBtnLoading(this, false);
      setLoading(false);
      $('#scanStatus').text('Error: ' + err.message);
    }
  });

  // ── WOL fijo (botones de encendido rápido) ──
  $(document).on('click', '.btn-wol-fixed', async function(e) {
    e.preventDefault();
    const ip = $(this).data('ip');
    const label = $(this).data('label');
    const $btn = $(this);

    // Cerrar el dropdown manualmente
    $btn.closest('.dropdown').find('.dropdown-toggle').dropdown('hide');

    setBtnLoading($btn[0], true);
    setLoading(true);
    $('#scanStatus').text(`⚡ Enviando WOL a ${label}…`);

    try {
      const detRes = await fetch(`/api/hosts/${encodeURIComponent(ip)}/detail`);
      const detData = await detRes.json();
      const mac = detData.ok ? (detData.host.mac || '') : '';

      if (!mac || !macValid(mac)) {
        setLoading(false);
        setBtnLoading($btn[0], false);
        $('#scanStatus').text(`⚠️ WOL ${label}: MAC no disponible. Lanza un scan primero.`);
        return;
      }

      const res = await fetch('/api/wol/fixed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac, label })
      });
      const data = await res.json();
      setLoading(false);
      setBtnLoading($btn[0], false);
      if (!data.ok) throw new Error(data.error || 'Error');
      $('#scanStatus').text(`⚡ WOL OK · ${label} · ${data.mac} → ${data.broadcast}:${data.port}`);
    } catch (err) {
      setLoading(false);
      setBtnLoading($btn[0], false);
      $('#scanStatus').text(`WOL ERROR · ${label}: ${err.message}`);
    }
  });

  // ── Reset BBDD ──
  const resetDbModal = new bootstrap.Modal(document.getElementById('resetDbModal'));
  $('#resetDbBtn').on('click', function() { resetDbModal.show(); });
  $('#resetDbConfirm').on('click', async function() {
    setBtnLoading(this, true);
    try {
      const res = await fetch('/api/db/reset', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      resetDbModal.hide();
      setLoading(true, 'Reseteando BBDD y escaneando…');
      $('#scanStatus').text('✅ BBDD reseteada. Escaneando…');
      setTimeout(async () => {
        await fetch('/scan', { method: 'POST' });
        setTimeout(() => location.reload(), 1200);
      }, 400);
    } catch (e) {
      setBtnLoading(this, false);
      setLoading(false);
      $('#scanStatus').text('Error reset: ' + e.message);
    }
  });


  // ══════════════════════════════════════════════════
  // ✅ #22 TEMA CLARO/OSCURO
  // ══════════════════════════════════════════════════
  window.applyTheme = function applyTheme(theme, save) {
    const body = document.body;
    const icon = document.getElementById('themeIcon');
    const css  = document.getElementById('themeCSS');
    if (theme === 'light') {
      body.classList.add('light-mode');
      css.href = 'https://cdn.jsdelivr.net/npm/bootswatch@5.3.3/dist/flatly/bootstrap.min.css';
      if (icon) { icon.className = 'bi bi-moon-stars-fill'; }
    const lbl2 = document.getElementById('themeLabel');
    if (lbl2) lbl2.textContent = 'Oscuro';
    } else {
      body.classList.remove('light-mode');
      css.href = 'https://cdn.jsdelivr.net/npm/bootswatch@5.3.3/dist/darkly/bootstrap.min.css';
      if (icon) { icon.className = 'bi bi-sun-fill'; }
    const lbl1 = document.getElementById('themeLabel');
    if (lbl1) lbl1.textContent = 'Claro';
    }
    if (save) localStorage.setItem('auditor-theme', theme);
    // Actualizar gráfica si existe
    if (window._activityChart) {
      const isDark = theme === 'dark';
      window._activityChart.options.scales.x.ticks.color = isDark ? '#aaa' : '#555';
      window._activityChart.options.scales.y.ticks.color = isDark ? '#aaa' : '#555';
      window._activityChart.options.scales.x.grid.color  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      window._activityChart.options.scales.y.grid.color  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      window._activityChart.update();
    }
  
    // Refresh bubble color after theme change
    setTimeout(() => { if (typeof window.moveBubble === 'function') { const a = document.querySelector('#viewTabs .nav-link.active'); if (a) window.moveBubble(a); } }, 50);
  }

  document.getElementById('themeToggle').addEventListener('click', function() {
    const current = localStorage.getItem('auditor-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark', true);
  });

  // ══════════════════════════════════════════════════
  // ✅ #19 GRÁFICA DE CALIDAD (Chart.js)
  // ══════════════════════════════════════════════════
  let activityChart = null;

  window.buildChart = function buildChart(scansData) {
    const sorted = [...scansData].reverse().slice(-120);
    if (sorted.length === 0) return;

    const labels = sorted.map(r => {
      if (!r.finished_at) return '';
      const d = new Date(r.finished_at);
      return d.toLocaleString('es-ES', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
    });

    const onlineData  = sorted.map(r => r.online_hosts  || 0);
    const offlineData = sorted.map(r => r.offline_hosts || 0);
    const newHostsData = sorted.map(r => r.new_hosts || 0);

    const maxOnline = Math.max(...onlineData, 1);
    const avgOnline = Math.round(onlineData.reduce((a,b)=>a+b,0) / Math.max(1, onlineData.length));
    const totalNew  = newHostsData.reduce((a,b)=>a+b,0);
    $('#chartSubtitle').text(`${sorted.length} ejecuciones · media ${avgOnline} online · ${totalNew} nuevos detectados`);

    const isDark = !document.body.classList.contains('light-mode');
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const tickColor = isDark ? '#aaa' : '#555';

    const el = document.getElementById('activityChart');
    if (!el) return;
    const ctx = el.getContext('2d');
    if (activityChart) { activityChart.destroy(); activityChart = null; }

    activityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Online',
            data: onlineData,
            borderColor: accentColor(1),
            backgroundColor: accentColor(0.08),
            borderWidth: 2,
            pointRadius: sorted.length > 60 ? 0 : 2,
            tension: 0.25,
            fill: false,
            yAxisID: 'y',
          },
          {
            label: 'Offline',
            data: offlineData,
            borderColor: 'rgba(255,107,107,0.9)',
            backgroundColor: 'rgba(255,107,107,0.06)',
            borderWidth: 1.5,
            pointRadius: sorted.length > 60 ? 0 : 2,
            tension: 0.25,
            fill: false,
            yAxisID: 'y',
          },
          {
            label: 'Nuevos',
            data: newHostsData,
            borderColor: 'rgba(255,193,7,0.9)',
            backgroundColor: 'rgba(255,193,7,0.08)',
            borderWidth: 1.5,
            pointRadius: (ctx) => newHostsData[ctx.dataIndex] > 0 ? 4 : 0,
            tension: 0.2,
            fill: false,
            yAxisID: 'y',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: { color: tickColor, boxWidth: 12, font: { size: 10 }, padding: 10 }
          },
          tooltip: {
            backgroundColor: isDark ? 'rgba(20,24,30,0.95)' : '#fff',
            titleColor: tickColor,
            bodyColor: tickColor,
            borderColor: gridColor,
            borderWidth: 1,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`
            }
          }
        },
        scales: {
          x: { ticks: { color: tickColor, maxRotation: 0, maxTicksLimit: 8 }, grid: { display: false } },
          y: {
            suggestedMin: 0,
            ticks: { color: tickColor, precision: 0 },
            grid: { color: gridColor },
            title: { display: true, text: 'Hosts', color: tickColor, font: { size: 9 } }
          }
        }
      }
    });
    window._activityChart = activityChart;
    setTimeout(() => { if (activityChart) activityChart.resize(); }, 50);
  }


  // ══════════════════════════════════════════════════
  // ✅ #21 ICONOS POR TIPO — actualizar icono al cambiar tipo
  // ══════════════════════════════════════════════════
  $(document).on('change', '.type-select', function() {
    const selectedOpt = $(this).find('option:selected');
    const icon = selectedOpt.data('icon') || '';
    $(this).closest('td').find('.type-icon-display').text(icon);
  });


  // ══════════════════════════════════════════════════
  // FIX: EMOJI PICKER para tipos
  // ══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  // EMOJI PICKER — 300+ emojis, categorías, búsqueda
  // ═══════════════════════════════════════════════════════════
  const EMOJI_CATS = [
    {n:"💻 Dispositivos",e:["🖥️","💻","🖨️","📱","📲","⌚","🖱️","⌨️","🖲️","💾","💿","📀","📺","📻","📟","📠","📡","🛜","🕹️","🎮","🎧","🎤","🔊","📢","📣","🔋","🔌","📷","📹","🎥","🔭","🔬","🖆","🖧"]},
    {n:"🗄️ Servidores / Red",e:["🗄️","☁️","⛅","🌩️","🌐","🛰️","🚀","📦","📁","📂","🗂️","🗃️","📊","📈","📉","📋","🔗","⚙️","🔧","🔨","🛠️","🪛","🔩","⛽","🏭","🏗️","📐","📏","🧮","💡","🔦","⚡","🔁","🔄"]},
    {n:"🏠 Hogar",e:["🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏨","🏪","🏫","🏭","🏗️","🚪","🪟","💡","🔦","🕯️","🛋️","🪑","🛏️","🛁","🚿","🧺","🧹","🪣","🏘️","🏚️","🏰","🏯","🗺️","🧭","🪴","🌳","🌿"]},
    {n:"🛡️ Seguridad",e:["🛡️","🔒","🔓","🔐","🔑","🗝️","⚠️","🚨","🚧","🔥","🚫","✅","❌","⛔","🟢","🟡","🔴","🟠","🔵","🟣","👁️","🕵️","🚔","🚒","🚑","⚡","💥","🎯","🧯","🪝","🔍","🔎","💣"]},
    {n:"👤 Usuarios / Roles",e:["👤","👥","👨‍💻","👩‍💻","🧑‍💻","👨‍🔧","🧑‍🔧","👨‍🏭","🧑‍🏭","🧑‍🎓","👑","🤖","👾","🧑‍🍳","🧑‍🚀","👮","🕵️","🧙","🦸","🧑‍🎨","🧑‍🏫","🧑‍⚕️","🧑‍🔬","🧑‍🌾","🧑‍🚒","🧑‍✈️","🧑‍⚖️","🎅","🧑‍💼","🤵"]},
    {n:"🌍 Internet / Cloud",e:["🌍","🌎","🌏","🌐","☁️","🌩️","🌈","🌊","🌀","📡","🛰️","🚀","🌟","⭐","✨","💫","🔮","🧿","💎","🔗","📎","🖇️","📌","📍","🗺️","🧭","🌞","🌙","⏰","⏱️","📅","📆","🗓️"]},
    {n:"🎮 Entretenimiento",e:["🎮","🕹️","🎯","🎲","🎴","🃏","🎪","🎨","🖌️","🎭","🎬","🎵","🎶","🎸","🎹","🎺","🎻","🥁","🎤","🎧","📺","📻","🎙️","📽️","🎞️","🎠","🎡","🎢","🧸","🪀","🏆","🥇","🎖️"]},
    {n:"🌡️ IoT / Sensores",e:["🌡️","💧","❄️","🔥","💨","🌬️","⚡","🔋","🔌","💡","🕯️","🌞","🌙","⏰","⏱️","⌚","🔔","🔕","📳","🚗","🚕","🚌","✈️","🚂","🚢","🛵","🚲","🛴","🚁","🛺","⛵","🏎️"]},
    {n:"⭐ Misc",e:["⭐","🌟","✨","💥","🎯","🏷️","🔖","📌","📍","🗂️","🏆","🥇","🥈","🥉","🏅","🎖️","🎗️","🎀","🎁","🎊","❓","‼️","⁉️","🆕","🆙","🆒","🆓","🔴","🟠","🟡","🔵","🟤","⚫","⚪"]}
  ];

  function buildPickerHTML() {
    let h = '<input type="text" class="emoji-picker-search" placeholder="🔍 Buscar…" autocomplete="off">';
    h += '<div class="emoji-grid" style="margin-bottom:6px"><button class="emoji-opt emoji-clear" data-emoji="">✕ Sin icono</button></div>';
    h += '<div class="emoji-picker-body">';
    for (const cat of EMOJI_CATS) {
      h += '<div class="emoji-cat-label">' + cat.n + '</div><div class="emoji-grid">';
      for (const e of cat.e) h += '<button class="emoji-opt" data-emoji="' + e + '" title="' + e + '">' + e + '</button>';
      h += '</div>';
    }
    return h + '</div>';
  }

  window.openEmojiPicker = function openEmojiPicker(triggerBtn) {
    document.querySelectorAll('.emoji-grid-popup.open').forEach(p => p.classList.remove('open'));
    const wrap  = triggerBtn.closest ? triggerBtn.closest('.emoji-picker-wrap') : $(triggerBtn).closest('.emoji-picker-wrap')[0];
    const popup = wrap ? wrap.querySelector('.emoji-grid-popup') : null;
    if (!popup) return;
    // Llenar con contenido si está vacío o es el popup inline de tabla
    if (!popup.querySelector('.emoji-picker-search')) popup.innerHTML = buildPickerHTML();
    // Posicionar fixed para evitar clipping
    const r = triggerBtn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.left = Math.min(r.left, window.innerWidth - 330) + 'px';
    popup.style.top  = Math.min(r.bottom + 6, window.innerHeight - 340) + 'px';
    popup.classList.add('open');
    const srch = popup.querySelector('.emoji-picker-search');
    if (srch) setTimeout(() => srch.focus(), 40);
  }

  // Búsqueda en tiempo real
  $(document).on('input', '.emoji-picker-search', function() {
    const q = this.value.trim().toLowerCase();
    const popup = $(this).closest('.emoji-grid-popup');
    const body  = popup.find('.emoji-picker-body');
    if (!q) {
      body.find('.emoji-cat-label, .emoji-grid').show();
      body.find('.emoji-opt').show();
      return;
    }
    body.find('.emoji-cat-label').hide();
    body.find('.emoji-grid').each(function() {
      let any = false;
      $(this).find('.emoji-opt').each(function() {
        const m = ($(this).data('emoji') || '').includes(q);
        $(this).toggle(m);
        if (m) any = true;
      });
      $(this).toggle(any);
    });
  });

  $(document).on('click', '.emoji-picker-btn', function(e) {
    e.stopPropagation();
    openEmojiPicker(this);
  });

  // Seleccionar emoji en una fila de tipo existente
  $(document).on('click', '.emoji-opt', function(e) {
    e.stopPropagation();
    const emoji = $(this).data('emoji');
    const popup = $(this).closest('.emoji-grid-popup');
    const wrap  = popup.closest('.emoji-picker-wrap');

    // Actualizar el botón display y el hidden input
    const btn = wrap.find('.type-icon-val, .emoji-picker-btn, .cfg-type-icon-val').first();
    btn.text(emoji || '❓').data('icon', emoji);
    wrap.find('.type-icon-hidden, .cfg-type-icon-hidden').val(emoji);

    // Si es el picker del nuevo tipo (topbar original)
    if (btn.attr('id') === 'newTypeIconBtn') {
      $('#newTypeIcon').val(emoji);
    }
    // Si es el picker del nuevo tipo en config panel
    if (btn.attr('id') === 'cfgNewTypeIconBtn') {
      $('#cfgNewTypeIcon').val(emoji);
    }

    popup.removeClass('open');
  });

  // Cerrar popup al hacer click fuera
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.emoji-picker-wrap').length) {
      $('.emoji-grid-popup').removeClass('open');
    }
  });

  // ── Actualizar save-type para leer el emoji del hidden input ──
  // (el handler ya existe pero necesita leer de .type-icon-hidden en lugar de .type-icon)

  // ══════════════════════════════════════════════════
  // FIX: TOGGLE VISTA MÓVIL (ficha ↔ tabla)
  // ══════════════════════════════════════════════════
  let mobileTableView = localStorage.getItem('auditor-mobile-view') === 'table';

  window.applyMobileView = function applyMobileView(isTable, save) {
    if (isTable) {
      document.body.classList.add('mobile-table-view');
      $('#mobileViewIcon').attr('class', 'bi bi-card-list');
      $('#mobileViewLabel').text('Ficha');
    } else {
      document.body.classList.remove('mobile-table-view');
      $('#mobileViewIcon').attr('class', 'bi bi-table');
      $('#mobileViewLabel').text('Tabla');
    }
    if (save) localStorage.setItem('auditor-mobile-view', isTable ? 'table' : 'card');
    // Forzar redibujado de DataTables
    if (window.innerWidth <= 768) { hostsTable.columns.adjust().draw(false); }
  }

  applyMobileView(mobileTableView, false);

  $('#mobileViewToggle').on('click', function() {
    mobileTableView = !mobileTableView;
    applyMobileView(mobileTableView, true);
  });



  // ══════════════════════════════════════════════════
  // #24 ALERTAS PROGRAMABLES
  // ══════════════════════════════════════════════════
  let _mUptimeChart = null;
  let _mUptimeCurrentIp = null;
  // (_mUptimeDays declared at top of $(function) to avoid TDZ)

  window.loadUptime = async function loadUptime(ip, days) {
    days = days || _mUptimeDays;
    _mUptimeDays = days;
    _mUptimeCurrentIp = ip;
    $('#mUptimePct').text('…');
    $('#mUptimeBar').css('width','0%');
    $('#mUptimeDays').empty();
    $('#mUptimeOnlineH').text('…');
    $('#mUptimeOfflineH').text('…');
    $('#mUptimeRangeLabel').text('');

    try {
      const res  = await fetch(`/api/hosts/${encodeURIComponent(ip)}/uptime?days=${days}`);
      const data = await res.json();
      if (!data.ok) { $('#mUptimePct').text('Sin datos'); return; }

      // ── Header stats ──
      const pct = data.uptime_pct;
      if (pct === null) {
        $('#mUptimePct').text('Sin datos').css('color','');
        $('#mUptimeBar').css('width','0%');
      } else {
        const color = pct >= 90 ? 'var(--accent)' : pct >= 70 ? '#ffc107' : '#ff6b6b';
        $('#mUptimePct').text(`${pct}%`).css('color', color);
        $('#mUptimeBar').css({'width': pct+'%', 'background': `linear-gradient(90deg,${color}66,${color})`});
      }
      $('#mUptimeOnlineH').text(data.total_online_h);
      $('#mUptimeOfflineH').text(data.total_offline_h);
      $('#mUptimeRangeLabel').text(`últimos ${days} días`);

      // ── Build day map ──
      const dayMap = {};
      for (const d of data.daily) dayMap[d.date] = d;

      // ── Build date sequence ──
      const today = new Date();
      const chartLabels = [], onlineData = [], offlineData = [], tooltipData = [];

      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = d.toISOString().slice(0,10);
        const dd  = dayMap[key];
        const labelStr = days <= 30
          ? d.toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'})
          : d.toLocaleDateString('es-ES', {day:'2-digit', month:'2-digit'});
        chartLabels.push(labelStr);
        if (dd) {
          onlineData.push(parseFloat(dd.online_h.toFixed(1)));
          offlineData.push(parseFloat(dd.offline_h.toFixed(1)));
          tooltipData.push({ date: key, pct: dd.pct, online_h: dd.online_h, offline_h: dd.offline_h });
        } else {
          onlineData.push(null);
          offlineData.push(null);
          tooltipData.push({ date: key, pct: null });
        }
      }

      // ── Grid (calendar) ──
      const grid = $('#mUptimeDays').empty();
      for (let i = 0; i < tooltipData.length; i++) {
        const td = tooltipData[i];
        const p  = td.pct;
        let cls = 'no-data';
        if (p !== null && p !== undefined) {
          cls = p >= 95 ? 'online-100' : p >= 75 ? 'online-75' : p >= 50 ? 'online-50' : p >= 25 ? 'online-25' : 'online-0';
        }
        const tip = p !== null && p !== undefined
          ? `${td.date}: ${p}% online (${td.online_h?.toFixed(1)}h / ${td.offline_h?.toFixed(1)}h offline)`
          : `${td.date}: sin datos`;
        grid.append(`<div class="uptime-day ${cls}" title="${tip}"></div>`);
      }

      // ── Stacked bar chart ──
      const ctx  = document.getElementById('mUptimeChart').getContext('2d');
      const dark = !document.body.classList.contains('light-mode');
      const gridColor  = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
      const tickColor  = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
      const maxTicks   = days <= 7 ? 7 : days <= 30 ? 10 : 12;

      if (_mUptimeChart) { _mUptimeChart.destroy(); _mUptimeChart = null; }

      _mUptimeChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: chartLabels,
          datasets: [
            {
              label: 'Online',
              data: onlineData,
              backgroundColor: 'rgba(46,204,113,0.75)',
              borderRadius: { topLeft:3, topRight:3 },
              borderSkipped: 'bottom',
              stack: 'uptime',
              barPercentage: 0.85,
              categoryPercentage: 1.0,
              minBarLength: 2,
            },
            {
              label: 'Offline',
              data: offlineData,
              backgroundColor: 'rgba(255,107,107,0.65)',
              borderRadius: { topLeft:3, topRight:3 },
              borderSkipped: 'bottom',
              stack: 'uptime',
              barPercentage: 0.85,
              categoryPercentage: 1.0,
              minBarLength: 2,
            }
          ]
        },
        options: {
          responsive: true,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                boxWidth: 10, boxHeight: 10,
                padding: 8,
                color: tickColor,
                font: { size: 10 },
                usePointStyle: true,
                pointStyle: 'rect',
              }
            },
            tooltip: {
              backgroundColor: 'rgba(20,24,30,0.95)',
              titleColor: '#fff',
              bodyColor: 'rgba(255,255,255,0.75)',
              borderColor: 'rgba(255,255,255,0.12)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                title: (items) => {
                  const idx = items[0].dataIndex;
                  return tooltipData[idx]?.date || items[0].label;
                },
                label: (item) => {
                  const idx = item.dataIndex;
                  const td  = tooltipData[idx];
                  if (!td || td.pct === null) return 'Sin datos';
                  if (item.dataset.label === 'Online')
                    return `🟢 Online:  ${item.raw?.toFixed(1)}h  (${td.pct}%)`;
                  if (item.dataset.label === 'Offline')
                    return `🔴 Offline: ${item.raw?.toFixed(1)}h`;
                  return '';
                },
                afterBody: (items) => {
                  const idx = items[0].dataIndex;
                  const td  = tooltipData[idx];
                  if (!td || td.pct === null) return '';
                  const total = (td.online_h + td.offline_h).toFixed(1);
                  return [`── Total registrado: ${total}h`];
                }
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: tickColor, font: { size: 9 }, maxTicksLimit: maxTicks, maxRotation: 0 },
              grid: { display: false }
            },
            y: {
              stacked: true,
              min: 0, max: 24,
              ticks: {
                color: tickColor, font: { size: 9 },
                maxTicksLimit: 5,
                callback: v => v === 24 ? '24h' : v === 0 ? '' : v+'h'
              },
              grid: { color: gridColor }
            }
          }
        }
      });

    } catch(e) {
      console.error('loadUptime error:', e);
      $('#mUptimePct').text('Error');
    }
  }

  // Range selector
  $(document).on('click', '.uptime-range-btn', function() {
    if (!_mUptimeCurrentIp) return;
    $('.uptime-range-btn').removeClass('active');
    $(this).addClass('active');
    const days = parseInt($(this).data('days'));
    loadUptime(_mUptimeCurrentIp, days);
  });

  // View toggle (chart ↔ grid)
  $(document).on('click', '.uptime-view-btn', function() {
    const view = $(this).data('view');
    $('.uptime-view-btn').removeClass('active');
    $(this).addClass('active');
    if (view === 'chart') {
      $('#mUptimeGridView').hide();
      $('#mUptimeChartView').show();
    } else {
      $('#mUptimeGridView').show();
      $('#mUptimeChartView').hide();
    }
  });



  // ══════════════════════════════════════════════════
  // #26 MONITORIZACIÓN DE SERVICIOS
  // ══════════════════════════════════════════════════
  let selectedIps = new Set();

  function updateBulkBar() {
    const bar = document.getElementById('bulkBar');
    const cnt = document.getElementById('bulkCount');
    if (selectedIps.size > 0) {
      bar.classList.add('active');
      cnt.textContent = selectedIps.size + ' host' + (selectedIps.size > 1 ? 's' : '') + ' seleccionado' + (selectedIps.size > 1 ? 's' : '');
    } else {
      bar.classList.remove('active');
    }
  }

  // Checkbox cabecera
  $('#selectAll').on('change', function() {
    const checked = this.checked;
    $('#hosts tbody .row-check').each(function() {
      this.checked = checked;
      const ip = this.value;
      if (checked) selectedIps.add(ip);
      else selectedIps.delete(ip);
      $(this).closest('tr').toggleClass('row-selected', checked);
    });
    updateBulkBar();
  });

  // Checkbox fila
  $(document).on('change', '#hosts tbody .row-check', function() {
    const ip = this.value;
    if (this.checked) { selectedIps.add(ip); $(this).closest('tr').addClass('row-selected'); }
    else              { selectedIps.delete(ip); $(this).closest('tr').removeClass('row-selected'); }
    updateBulkBar();
  });

  // Limpiar selección
  $('#bulkClear').on('click', function() {
    selectedIps.clear();
    $('#hosts tbody .row-check').prop('checked', false);
    $('#hosts tbody tr').removeClass('row-selected');
    $('#selectAll').prop('checked', false);
    updateBulkBar();
  });

  // Cambiar tipo a seleccionados
  $('#bulkSetType').on('click', async function() {
    const typeId = $('#bulkTypeSelect').val();
    if (!typeId || !selectedIps.size) return;
    if (!confirm(`¿Cambiar tipo de ${selectedIps.size} hosts?`)) return;
    setBtnLoading(this, true);
    const promises = [...selectedIps].map(ip =>
      fetch(`/api/hosts/${encodeURIComponent(ip)}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ type_id: parseInt(typeId) })
      })
    );
    await Promise.all(promises);
    setBtnLoading(this, false);
    location.reload();
  });

  // Marcar conocidos
  $('#bulkSetKnown').on('click', async function() {
    if (!selectedIps.size) return;
    setBtnLoading(this, true);
    const promises = [...selectedIps].map(ip =>
      fetch(`/api/hosts/${encodeURIComponent(ip)}/known`, { method:'POST' })
    );
    await Promise.all(promises);
    setBtnLoading(this, false);
    location.reload();
  });

  // Borrar seleccionados
  $('#bulkDelete').on('click', async function() {
    if (!selectedIps.size) return;
    if (!confirm(`¿Eliminar ${selectedIps.size} hosts? Esta acción no se puede deshacer.`)) return;
    setBtnLoading(this, true);
    const promises = [...selectedIps].map(ip =>
      fetch(`/api/hosts/${encodeURIComponent(ip)}`, { method:'DELETE' })
    );
    await Promise.all(promises);
    setBtnLoading(this, false);
    location.reload();
  });

  // ══════════════════════════════════════════════════════════
  // GRÁFICA LATENCIA HISTÓRICA en modal
  // ══════════════════════════════════════════════════════════
  let latencyChart = null;

  window.loadLatencyChart = async function loadLatencyChart(ip) {
    const res  = await fetch(`/api/hosts/${encodeURIComponent(ip)}/latency?limit=50`);
    const data = await res.json();
    if (!data.ok || !data.history || !data.history.length) {
      document.getElementById('mLatencyStats').textContent = 'Sin datos de latencia aún.';
      $('#mLatency').text('—').attr('class', 'mono fw-bold');
      return;
    }
    const hist   = data.history;
    // Also update the current latency badge (avoids a second API call)
    const lastMs = data.last_latency_ms;
    if (lastMs != null) {
      const txt = lastMs < 10 ? `${lastMs}ms ⚡` : lastMs < 50 ? `${lastMs}ms` : `${lastMs}ms ⚠`;
      const cls = lastMs < 10 ? 'latency-ok' : lastMs < 50 ? 'latency-warn' : 'latency-bad';
      $('#mLatency').text(txt).attr('class', 'mono fw-bold ' + cls);
    }
    const labels = hist.map(h => new Date(h.at).toLocaleTimeString('es-ES', {hour:'2-digit',minute:'2-digit'}));
    const vals   = hist.map(h => h.ms);
    const avg    = vals.reduce((a,b) => a+b, 0) / vals.length;
    const mx     = Math.max(...vals);
    const mn     = Math.min(...vals);
    document.getElementById('mLatencyStats').textContent =
      `Min: ${mn}ms · Avg: ${avg.toFixed(1)}ms · Max: ${mx}ms · ${hist.length} muestras`;

    const ctx = document.getElementById('mLatencyChart');
    if (!ctx) return;
    if (latencyChart) latencyChart.destroy();
    latencyChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: vals,
          borderColor: '#a855f7',
          backgroundColor: 'rgba(168,85,247,0.15)',
          borderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20,24,30,0.95)',
            titleColor: '#fff',
            bodyColor: 'rgba(255,255,255,0.8)',
            borderColor: 'rgba(255,255,255,0.15)',
            borderWidth: 1,
            padding: 9,
            displayColors: false,
            callbacks: {
              title: ctx => ctx[0].label,
              label: ctx => `⚡ ${ctx.raw != null ? ctx.raw + ' ms' : '—'}`
            }
          }
        },
        scales: {
          x: { display: false },
          y: { grid: { color:'rgba(255,255,255,0.06)' }, ticks: { color:'rgba(255,255,255,0.5)', font:{size:10} }, beginAtZero:true }
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // HISTORIAL DE SCANS por host en modal
  // ══════════════════════════════════════════════════════════
  window.loadScanHistory = async function loadScanHistory(ip, limit) {
    limit = limit || 10;
    const res  = await fetch(`/api/hosts/${encodeURIComponent(ip)}/scan-history?limit=${limit}`);
    const data = await res.json();
    const el   = document.getElementById('mScanHistory');
    if (!data.ok || !data.intervals.length) {
      el.innerHTML = '<div class="small-muted">Sin historial disponible</div>';
      return;
    }
    el.innerHTML = data.intervals.map(i => `
      <div class="interval-row ${i.status}">
        <i class="bi bi-circle-fill" style="font-size:.5rem;color:${i.status==='online'?'var(--accent)':'#ff6b6b'}"></i>
        <span class="fw-semibold" style="min-width:55px">${i.status === 'online' ? '🟢 Online' : '🔴 Offline'}</span>
        <span class="small-muted mono" style="font-size:.78rem">${i.from_local}</span>
        <span class="small-muted">→</span>
        <span class="small-muted mono" style="font-size:.78rem">${i.to_local}</span>
        <span class="svc-latency ms-auto">${i.duration}</span>
      </div>`).join('');
  }

  // Botón ver todo
  $(document).on('click', '#btnScanHistory', function() {
    const ip = $('#hostModal').data('current-ip');
    if (!ip) return;
    loadScanHistory(ip, 200);
    $(this).hide();
  });

  // ══════════════════════════════════════════════════════════
  // GRÁFICA TIMELINE ONLINE/OFFLINE POR HOST
  // ══════════════════════════════════════════════════════════
  let hostTimelineChart = null;
  let _tlCurrentIp = null;
  let _tlCurrentRange = 'day';

  window.loadHostTimeline = async function loadHostTimeline(ip, range, specificDate) {
    _tlCurrentIp = ip;
    _tlCurrentRange = range || 'day';
    const limit = range === 'day' ? 100 : range === 'week' ? 500 : 1000;
    try {
      const res  = await fetch(`/api/hosts/${encodeURIComponent(ip)}/scan-history?limit=${limit}`);
      const data = await res.json();
      const canvas = document.getElementById('mTimelineChart');
      const statsEl = document.getElementById('mTimelineStats');
      if (!canvas) return;

      if (!data.ok || !data.intervals || !data.intervals.length) {
        if (statsEl) statsEl.textContent = 'Sin datos de historial aún.';
        if (hostTimelineChart) { hostTimelineChart.destroy(); hostTimelineChart = null; }
        return;
      }

      // Determine time window
      const now = new Date();
      let windowStart, windowEnd;
      if (specificDate) {
        // Show the specific day
        windowStart = new Date(specificDate + 'T00:00:00');
        windowEnd   = new Date(specificDate + 'T23:59:59');
        _tlCurrentRange = 'date';
      } else if (range === 'day') {
        windowEnd   = now;
        windowStart = new Date(now.getTime() - 24*3600*1000);
      } else if (range === 'week') {
        windowEnd   = now;
        windowStart = new Date(now.getTime() - 7*24*3600*1000);
      } else {
        windowEnd   = now;
        windowStart = new Date(now.getTime() - 30*24*3600*1000);
      }

      // Build time series: sample every N minutes
      const spanMs   = windowEnd - windowStart;
      const points   = Math.min(120, Math.max(48, Math.round(spanMs / 60000 / 15)));
      const stepMs   = spanMs / points;
      const intervals = data.intervals;

      // Helper: get status at a given time
      function statusAt(t) {
        for (const iv of intervals) {
          const from = new Date(iv.from);
          const to   = iv.to ? new Date(iv.to) : now;
          if (t >= from && t <= to) return iv.status === 'online' ? 1 : 0;
        }
        return null;
      }

      const labels = [], vals = [], bgColors = [];
      let onlineMs = 0, offlineMs = 0;
      for (let i = 0; i <= points; i++) {
        const t   = new Date(windowStart.getTime() + i * stepMs);
        const st  = statusAt(t);
        const fmt = t.toLocaleString('es-ES', {
          day:'2-digit', month:'2-digit',
          hour:'2-digit', minute:'2-digit'
        });
        labels.push(fmt);
        vals.push(st !== null ? (st === 1 ? 1 : 0.3) : null);
        bgColors.push(st === 1 ? accentColor(0.8) : st === 0 ? 'rgba(255,107,107,0.7)' : 'rgba(255,255,255,0.1)');
        if (st === 1) onlineMs  += stepMs;
        if (st === 0) offlineMs += stepMs;
      }

      const fmtH = ms => {
        const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
      };
      if (statsEl) {
        const pct = onlineMs + offlineMs > 0 ? Math.round(onlineMs/(onlineMs+offlineMs)*100) : 0;
        statsEl.textContent = `🟢 Online: ${fmtH(onlineMs)} · 🔴 Offline: ${fmtH(offlineMs)} · Disponibilidad: ${pct}%`;
      }

      const ctx = canvas.getContext('2d');
      if (hostTimelineChart) hostTimelineChart.destroy();
      hostTimelineChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: vals,
            backgroundColor: bgColors,
            borderRadius: 1,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
            minBarLength: 4,
          }]
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
              padding: 9,
              displayColors: false,
              callbacks: {
                title: ctx => ctx[0].label,
                label: ctx => {
                  const v = ctx.raw;
                  return v === 1 ? '🟢 Online' : v === 0.3 ? '🔴 Offline' : '⬜ Sin datos';
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              ticks: {
                color: 'rgba(255,255,255,0.35)',
                font: { size: 9 },
                maxTicksLimit: range === 'day' ? 6 : range === 'week' ? 7 : 10,
                maxRotation: 0,
              },
              grid: { display: false }
            },
            y: {
              display: false,
              min: 0, max: 1.1,
            }
          }
        }
      });
    } catch(e) { console.error('loadHostTimeline:', e); }
  }

  // Timeline range buttons
  $('#tlBtnDay').on('click', function() {
    setTlBtn('day');
    const ip = $('#hostModal').data('current-ip');
    if (ip) loadHostTimeline(ip, 'day');
  });
  $('#tlBtnWeek').on('click', function() {
    setTlBtn('week');
    const ip = $('#hostModal').data('current-ip');
    if (ip) loadHostTimeline(ip, 'week');
  });
  $('#tlBtnMonth').on('click', function() {
    setTlBtn('month');
    const ip = $('#hostModal').data('current-ip');
    if (ip) loadHostTimeline(ip, 'month');
  });
  $('#tlBtnDateGo').on('click', function() {
    const d  = $('#mHostDatePicker').val();
    const ip = $('#hostModal').data('current-ip');
    if (!d || !ip) return;
    setTlBtn('date');
    loadHostTimeline(ip, 'date', d);
  });
  function setTlBtn(active) {
    ['Day','Week','Month'].forEach(r => $(`#tlBtn${r}`).removeClass('active'));
    if (active === 'day') $('#tlBtnDay').addClass('active');
    else if (active === 'week') $('#tlBtnWeek').addClass('active');
    else if (active === 'month') $('#tlBtnMonth').addClass('active');
  }


  // ══════════════════════════════════════════════════════════
  // EDICIÓN INLINE DE SERVICIOS
  // ══════════════════════════════════════════════════════════
  let _pingIp = '';
  $('#mPing').on('click', async function() {
    _pingIp = $('#mIp').text().trim();
    if (!_pingIp) return;
    setBtnLoading(this, true);
    $('#mPingResult').show();
    $('#mPingLines').html('<span class="small-muted">Enviando 3 pings…</span>');
    try {
      const res  = await fetch(`/api/hosts/${encodeURIComponent(_pingIp)}/ping`, { method:'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (!data.ok) { $('#mPingLines').html(`<span class="ping-dead">Error: ${esc(data.error)}</span>`); return; }
      let html = '';
      if (data.alive) {
        html += `<div class="ping-result-line ping-alive">✅ Host alcanzable</div>`;
        if (data.avg_ms != null) html += `<div class="ping-result-line ping-alive">⚡ Latencia media: ${data.avg_ms.toFixed(1)} ms</div>`;
        if (data.loss_pct > 0) html += `<div class="ping-result-line" style="color:#ffc107">⚠ Pérdida de paquetes: ${data.loss_pct}%</div>`;
      } else {
        html += `<div class="ping-result-line ping-dead">❌ Host no alcanzable (${data.loss_pct}% packet loss)</div>`;
      }
      $('#mPingLines').html(html);
    } catch(e) {
      setBtnLoading(this, false);
      $('#mPingLines').html(`<span class="ping-dead">Error de red: ${esc(String(e))}</span>`);
    }
  });

  // Show vendor in modal
  $(document).on('hidden.bs.modal', '#hostModal', function() {
    _openHostBusy = false;
  });

  $(document).on('shown.bs.modal', '#hostModal', function() {
    $('#mPingResult').hide();
    $('#mPingLines').html('');
    $('#mFpResult').hide();
    $('#mFpContent').html('');
  });

  // ── FINGERPRINT / IDENTIFICAR ──
  $('#mFingerprint').on('click', async function() {
    const ip = $('#mIp').text().trim();
    if (!ip) return;
    setBtnLoading(this, true);
    $('#mFpResult').show();
    $('#mFpContent').html('<span class="small-muted"><span class="spinner-border spinner-border-sm me-1"></span>Escaneando puertos y servicios… (puede tardar 15-30s)</span>');
    try {
      const res  = await fetch(`/api/hosts/${encodeURIComponent(ip)}/fingerprint`, { method:'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (!data.ok) {
        $('#mFpContent').html(`<span class="ping-dead">❌ ${esc(data.error)}</span>`);
        return;
      }
      let html = '';

      // Vendor update
      if (data.vendor) {
        $('#mVendor').text(data.vendor);
        html += `<div class="ping-result-line" style="color:var(--accent)">🏷️ Fabricante: <strong>${esc(data.vendor)}</strong>${data.vendor_updated ? ' <span class="badge bg-success" style="font-size:.6rem">actualizado</span>' : ''}</div>`;
      }

      // OS
      if (data.os_guess) html += `<div class="ping-result-line">🖥️ SO detectado: ${esc(data.os_guess)}</div>`;
      if (data.device_type) html += `<div class="ping-result-line">📦 Tipo: ${esc(data.device_type)}</div>`;
      if (data.hostname) html += `<div class="ping-result-line">🌐 Hostname: ${esc(data.hostname)}</div>`;

      // Port clues
      if (data.port_clues && data.port_clues.length) {
        html += `<div class="ping-result-line">💡 Pistas: ${data.port_clues.map(c => `<span class="badge badge-soft me-1">${esc(c)}</span>`).join('')}</div>`;
      }

      // Open ports summary
      if (data.open_ports && data.open_ports.length) {
        const ps = data.open_ports.slice(0,20).join(', ') + (data.open_ports.length > 20 ? '…' : '');
        html += `<div class="ping-result-line" style="font-family:monospace;font-size:.75rem">🔓 Puertos abiertos: ${esc(ps)}</div>`;
      }

      // Services table
      if (data.services && data.services.length) {
        html += `<div class="mt-2" style="font-size:.75rem">
          <table class="table table-sm table-borderless" style="font-size:.73rem;margin:0">
            <thead><tr><th style="padding:1px 6px">Puerto</th><th>Servicio</th><th>Versión</th></tr></thead>
            <tbody>
              ${data.services.slice(0,15).map(s =>
                `<tr><td class="mono" style="padding:1px 6px;color:var(--accent)">${s.port}/${s.proto}</td><td>${esc(s.name)}</td><td style="opacity:.6">${esc(s.version||'')}</td></tr>`
              ).join('')}
            </tbody>
          </table>
        </div>`;
      }

      if (!html) html = '<span class="small-muted">Sin resultados significativos (host puede tener firewall)</span>';
      $('#mFpContent').html(html);

    } catch(e) {
      setBtnLoading(this, false);
      $('#mFpContent').html(`<span class="ping-dead">Error: ${esc(String(e))}</span>`);
    }
  });

  // ══════════════════════════════════════════════════════════
  // MAPA DE RED
  // ══════════════════════════════════════════════════════════
  let _mapNodes = [], _mapDragging = null, _mapOffset = {x:0,y:0}, _mapScale = 1, _mapPan = {x:0,y:0};
  let _mapPanning = false, _mapPanStart = {x:0,y:0}, _mapPanOrigin = {x:0,y:0};
  let _mapFilter = 'all';

  function renderMap() {
    const canvas = document.getElementById('networkCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth;
    canvas.width  = W;
    canvas.height = Math.max(520, W * 0.55);
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const dark = !document.body.classList.contains('light-mode');
    const bgColor    = dark ? '#1a1f26' : '#f5f5f5';
    const lineColor  = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const textColor  = dark ? 'rgba(255,255,255,0.85)' : '#333';
    const subColor   = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)';
    const groupColor = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(_mapPan.x, _mapPan.y);
    ctx.scale(_mapScale, _mapScale);

    const cssAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4dffb5';
    const visNodes = _mapNodes.filter(n => _mapFilter === 'all' || n.status === _mapFilter);

    // Draw group backgrounds if grouped
    if (_mapGroups && _mapGroups.length > 0) {
      for (const g of _mapGroups) {
        const gNodes = visNodes.filter(n => g.members.includes(n.ip));
        if (!gNodes.length) continue;
        // Bounding box
        const xs = gNodes.map(n=>n.x), ys = gNodes.map(n=>n.y);
        const pad = 40;
        const gx = Math.min(...xs)-pad, gy = Math.min(...ys)-pad;
        const gw = Math.max(...xs)-Math.min(...xs)+pad*2, gh = Math.max(...ys)-Math.min(...ys)+pad*2;
        ctx.beginPath();
        // roundRect polyfill
        if (ctx.roundRect) {
          ctx.roundRect(gx, gy, gw, gh, 14);
        } else {
          ctx.rect(gx, gy, gw, gh);
        }
        ctx.fillStyle = groupColor;
        ctx.fill();
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Group label
        ctx.font = 'bold 10px sans-serif';
        ctx.fillStyle = subColor;
        ctx.textAlign = 'left';
        ctx.fillText(g.label, gx+8, gy+14);
      }
    }

    // Draw gateway at center
    const cx = W / 2 / _mapScale, cy = H / 2 / _mapScale;

    // Draw lines from gateway to nodes
    visNodes.forEach(n => {
      const nodeColor = n.status === 'online' ? cssAccent : n.mac ? '#ff6b6b' : '#666';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(n.x, n.y);
      ctx.strokeStyle = n.status === 'online' ? 'rgba(77,255,181,0.12)' : lineColor;
      ctx.lineWidth = n.status === 'online' ? 1.5 : 1;
      ctx.setLineDash(n.status === 'offline' ? [4, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw gateway node
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = dark ? '#2a3040' : '#ddd';
    ctx.fill();
    ctx.strokeStyle = cssAccent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = textColor;
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🌐', cx, cy + 6);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = subColor;
    ctx.fillText('Gateway', cx, cy + 36);

    // Draw host nodes
    visNodes.forEach(n => {
      const r = 20;
      const nodeColor = n.status === 'online' ? cssAccent : n.mac ? '#ff6b6b' : '#666';

      // Shadow for online nodes
      if (n.status === 'online') {
        ctx.shadowColor = cssAccent;
        ctx.shadowBlur = 8;
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor + '22';
      ctx.fill();
      ctx.strokeStyle = nodeColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Latency badge
      if (n.status === 'online' && n.latency != null) {
        const latText = `${Math.round(n.latency)}ms`;
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = cssAccent;
        ctx.fillText(latText, n.x, n.y - r - 4);
      }

      // Icon
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = textColor;
      ctx.fillText(n.icon || '💻', n.x, n.y + 5);

      // IP
      const label = n.name || n.ip;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = textColor;
      ctx.fillText(label.length > 14 ? label.slice(0,13)+'…' : label, n.x, n.y + r + 14);

      // Vendor/IP sub-label
      const sub = n.vendor || n.ip;
      if (sub && sub !== label) {
        ctx.font = '8px sans-serif';
        ctx.fillStyle = subColor;
        const sl = sub.length > 14 ? sub.slice(0,13)+'…' : sub;
        ctx.fillText(sl, n.x, n.y + r + 24);
      }
    });

    ctx.restore();

    // Update stats
    const onlineCount = visNodes.filter(n => n.status === 'online').length;
    const offlineCount = visNodes.filter(n => n.status === 'offline').length;
    document.getElementById('mapStats').textContent =
      `${onlineCount} online · ${offlineCount} offline · Total: ${visNodes.length}`;
  }

  let _mapGroups = [];
  let _mapGroupBy = 'flat';

  function layoutMapNodes(hosts) {
    const canvas = document.getElementById('networkCanvas');
    if (!canvas) return;
    const W = canvas.offsetWidth || 800;
    const H = Math.max(520, W * 0.55);
    const cx = W / 2, cy = H / 2;
    const total = hosts.length;

    _mapGroups = [];

    if (_mapGroupBy === 'subnet') {
      // Group by /24 subnet
      const subnets = {};
      for (const h of hosts) {
        const parts = h.ip.split('.');
        const key = parts.slice(0,3).join('.');
        if (!subnets[key]) subnets[key] = [];
        subnets[key].push(h);
      }
      const keys = Object.keys(subnets);
      const numGroups = keys.length;
      let allNodes = [];
      keys.forEach((key, gi) => {
        const groupHosts = subnets[key];
        const groupAngle = (gi / numGroups) * Math.PI * 2 - Math.PI / 2;
        const groupRadius = Math.min(W, H) * 0.3;
        const gcx = cx + Math.cos(groupAngle) * groupRadius;
        const gcy = cy + Math.sin(groupAngle) * groupRadius;
        const innerRadius = Math.min(60, groupHosts.length * 15);
        const members = [];
        groupHosts.forEach((h, i) => {
          const angle = (i / groupHosts.length) * Math.PI * 2;
          const r = groupHosts.length === 1 ? 0 : Math.max(40, groupHosts.length * 12);
          const node = {
            ip: h.ip, status: h.status, mac: h.mac,
            vendor: h.vendor || '', latency: h.last_latency_ms,
            name: h.manual_name || h.nmap_hostname || h.dns_name || h.ip,
            icon: h.type_icon || '💻',
            x: gcx + Math.cos(angle) * r,
            y: gcy + Math.sin(angle) * r,
          };
          allNodes.push(node);
          members.push(h.ip);
        });
        _mapGroups.push({ label: key + '.0/24', members });
      });
      _mapNodes = allNodes;
    } else if (_mapGroupBy === 'type') {
      const types = {};
      for (const h of hosts) {
        const key = h.type_name || 'Sin tipo';
        if (!types[key]) types[key] = [];
        types[key].push(h);
      }
      const keys = Object.keys(types);
      const numGroups = keys.length;
      let allNodes = [];
      keys.forEach((key, gi) => {
        const groupHosts = types[key];
        const groupAngle = (gi / numGroups) * Math.PI * 2 - Math.PI / 2;
        const groupRadius = Math.min(W, H) * 0.3;
        const gcx = cx + Math.cos(groupAngle) * groupRadius;
        const gcy = cy + Math.sin(groupAngle) * groupRadius;
        const members = [];
        groupHosts.forEach((h, i) => {
          const angle = (i / groupHosts.length) * Math.PI * 2;
          const r = groupHosts.length === 1 ? 0 : Math.max(40, groupHosts.length * 12);
          const node = {
            ip: h.ip, status: h.status, mac: h.mac,
            vendor: h.vendor || '', latency: h.last_latency_ms,
            name: h.manual_name || h.nmap_hostname || h.dns_name || h.ip,
            icon: h.type_icon || '💻',
            x: gcx + Math.cos(angle) * r,
            y: gcy + Math.sin(angle) * r,
          };
          allNodes.push(node);
          members.push(h.ip);
        });
        _mapGroups.push({ label: key, members });
      });
      _mapNodes = allNodes;
    } else {
      // Flat layout
      _mapGroups = [];
      _mapNodes = hosts.map((h, i) => {
        const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        const radius = Math.min(W, H) * 0.35;
        return {
          ip: h.ip, status: h.status, mac: h.mac,
          vendor: h.vendor || '', latency: h.last_latency_ms,
          name: h.manual_name || h.nmap_hostname || h.dns_name || h.ip,
          icon: h.type_icon || '💻',
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        };
      });
    }
  }

  window.loadMap = async function loadMap() {
    // Reuse the hosts data from template if available, else fetch
    const hostsData = window._hostsData || [];
    layoutMapNodes(hostsData);
    renderMap();
  }

  // Mouse events for map
  const _mc = () => document.getElementById('networkCanvas');

  function getMapCoords(e) {
    const rect = _mc().getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - _mapPan.x) / _mapScale,
      y: (e.clientY - rect.top  - _mapPan.y) / _mapScale,
    };
  }

  $(document).on('mousedown', '#networkCanvas', function(e) {
    const pos = getMapCoords(e);
    const hit = _mapNodes.find(n => {
      const dx = n.x - pos.x, dy = n.y - pos.y;
      return Math.sqrt(dx*dx + dy*dy) < 22;
    });
    if (hit) {
      _mapDragging = hit;
      _mapOffset = { x: pos.x - hit.x, y: pos.y - hit.y };
    } else {
      _mapPanning = true;
      _mapPanStart = { x: e.clientX, y: e.clientY };
      _mapPanOrigin = { ..._mapPan };
    }
  });

  $(document).on('mousemove', function(e) {
    if (_mapDragging) {
      const pos = getMapCoords(e);
      _mapDragging.x = pos.x - _mapOffset.x;
      _mapDragging.y = pos.y - _mapOffset.y;
      renderMap();
    } else if (_mapPanning) {
      _mapPan.x = _mapPanOrigin.x + (e.clientX - _mapPanStart.x);
      _mapPan.y = _mapPanOrigin.y + (e.clientY - _mapPanStart.y);
      renderMap();
    }
  });

  $(document).on('mouseup', function() { _mapDragging = null; _mapPanning = false; });

  $(document).on('wheel', '#networkCanvas', function(e) {
    e.preventDefault();
    const delta = e.originalEvent.deltaY > 0 ? 0.9 : 1.1;
    _mapScale = Math.min(4, Math.max(0.3, _mapScale * delta));
    renderMap();
  });

  // Click on node to open host modal
  $(document).on('click', '#networkCanvas', function(e) {
    if (_mapDragging) return;
    const pos = getMapCoords(e);
    const hit = _mapNodes.find(n => {
      const dx = n.x - pos.x, dy = n.y - pos.y;
      return Math.sqrt(dx*dx + dy*dy) < 22;
    });
    if (hit) openHostModal(hit.ip);
  });

  $('#mapFilter').on('change', function() { _mapFilter = $(this).val(); renderMap(); });
  $('#mapGroupBy').on('change', function() { _mapGroupBy = $(this).val(); loadMap(); });
  $('#mapReset').on('click', function() { _mapScale = 1; _mapPan = {x:0,y:0}; loadMap(); });

  document.getElementById('map-tab').addEventListener('shown.bs.tab', loadMap);

  // ══════════════════════════════════════════════════════════
  // GRUPOS DE HOSTS
  // ══════════════════════════════════════════════════════════
  let _groupBy = 'type';

  window.renderGroups = function renderGroups(hostsData, search) {
    search = (search || '').toLowerCase();
    const filtered = hostsData.filter(h => {
      if (!search) return true;
      return [h.ip, h.manual_name, h.nmap_hostname, h.dns_name, h.vendor, h.type_name]
        .some(v => v && v.toLowerCase().includes(search));
    });

    // Build groups
    const groups = {};
    for (const h of filtered) {
      let key;
      if (_groupBy === 'type')   key = (h.type_icon || '') + ' ' + (h.type_name || 'Sin tipo');
      if (_groupBy === 'vendor') key = h.vendor || '(Fabricante desconocido)';
      if (_groupBy === 'status') key = h.status === 'online' ? '🟢 Online' : '🔴 Offline';
      if (_groupBy === 'subnet') {
        const parts = h.ip.split('.');
        const cidr24 = parts.length >= 3 ? parts.slice(0,3).join('.') + '.0/24' : h.ip;
        let netName = null;
        for (const pn of (window._primaryNetworks || [])) {
          const pp = (pn.cidr || '').split('.');
          if (pp.length >= 3 && pp.slice(0,3).join('.')+'.0/24' === cidr24) { netName = pn.label || 'Red principal'; break; }
        }
        if (!netName) for (const sn of (window._secondaryNetworks || [])) {
          const sp = (sn.cidr || '').split('.');
          if (sp.length >= 3 && sp.slice(0,3).join('.')+'.0/24' === cidr24) { netName = sn.label || sn.cidr; break; }
        }
        key = netName ? `${netName}  (${cidr24})` : cidr24;
      }
      if (_groupBy === 'network') {
        // Agrupar por red configurada exacta — usa _ipInCidr para precisión
        key = '— Sin red asignada —';
        const allNets = [
          ...(window._primaryNetworks  || []).map(n => ({...n, _type: 'primary'})),
          ...(window._secondaryNetworks || []).map(n => ({...n, _type: 'secondary'})),
        ];
        for (const net of allNets) {
          if (net.cidr && _ipInCidr(h.ip, net.cidr)) {
            key = (net.label || net.cidr) + '||' + net.cidr + '||' + net._type;
            break;
          }
        }
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(h);
    }

    const sortedKeys = Object.keys(groups).sort((a,b) => {
      if (_groupBy === 'status') return a.includes('Online') ? -1 : 1;
      if (_groupBy === 'network') {
        // Primarias primero, luego secundarias, luego sin asignar
        const typeOf = k => k.includes('||primary') ? 0 : k.includes('||secondary') ? 1 : 2;
        return typeOf(a) - typeOf(b);
      }
      return groups[b].length - groups[a].length;
    });

    const container = document.getElementById('groupsContainer');
    container.innerHTML = '';
    for (const key of sortedKeys) {
      const hosts = groups[key];
      const onlineCount = hosts.filter(h => h.status === 'online').length;
      const card = document.createElement('div');
      card.className = 'group-card';
      // Para el modo 'network', parsear el key compuesto
      let displayKey = key;
      let netCidr = '';
      let netType = '';
      if (_groupBy === 'network' && key.includes('||')) {
        const parts = key.split('||');
        displayKey = parts[0];
        netCidr    = parts[1];
        netType    = parts[2];
      }

      const netTypeIcon = netType === 'primary'
        ? '<i class="bi bi-house-fill me-1" style="color:var(--accent);font-size:.75rem"></i>'
        : netType === 'secondary'
          ? '<i class="bi bi-diagram-3-fill me-1" style="color:#74b9ff;font-size:.75rem"></i>'
          : '';
      const netCidrBadge = netCidr
        ? `<code style="font-size:.7rem;opacity:.6;margin-left:6px">${esc(netCidr)}</code>` : '';

      card.innerHTML = `
        <div class="group-header" data-bs-toggle="collapse" data-bs-target="#grp_${safeId(key)}">
          <i class="bi bi-chevron-down" style="transition:transform .2s;font-size:.75rem"></i>
          <h6>${netTypeIcon}${esc(displayKey)}${netCidrBadge}</h6>
          <span class="group-count">${hosts.length} hosts</span>
          <span class="group-count ms-1" style="color:var(--accent)">${onlineCount} online</span>
          <div class="ms-auto">
            <div class="uptime-bar-wrap" style="width:80px;height:6px">
              <div class="uptime-bar-fill" style="width:${Math.round(onlineCount/hosts.length*100)}%"></div>
            </div>
          </div>
        </div>
        <div class="collapse show group-body" id="grp_${safeId(key)}">
          ${hosts.map(h => {
            const name = esc(h.manual_name || h.nmap_hostname || h.dns_name || h.ip);
            const sub = esc(h.ip + (h.vendor ? ' · ' + h.vendor : ''));
            return `<div class="group-host-item" data-ip="${esc(h.ip)}">
              <div class="group-host-dot ${h.status}"></div>
              <div>
                <div class="group-host-name">${name}</div>
                <div class="group-host-sub">${sub}</div>
              </div>
              ${h.vendor ? '' : ''}
              <span class="ms-auto small-muted mono" style="font-size:.75rem">${h.status === 'online' && h.last_latency_ms ? h.last_latency_ms.toFixed(1)+'ms' : ''}</span>
            </div>`;
          }).join('')}
        </div>`;
      container.appendChild(card);
    }

    // Rotate chevrons on collapse
    container.querySelectorAll('[data-bs-toggle="collapse"]').forEach(hdr => {
      const target = document.querySelector(hdr.dataset.bsTarget);
      if (target) {
        target.addEventListener('hide.bs.collapse', () => hdr.querySelector('i').style.transform = 'rotate(-90deg)');
        target.addEventListener('show.bs.collapse', () => hdr.querySelector('i').style.transform = '');
      }
    });
  }

  // Click on group host item
  $(document).on('click', '.group-host-item', function() {
    openHostModal($(this).data('ip'));
  });

  window.loadGroups = async function loadGroups() {
    let hostsData = window._hostsData || [];
    // If data is empty (e.g. page just loaded and template injection failed), fetch from API
    if (!hostsData.length) {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        // Re-fetch full hosts list via existing page reload... 
        // Actually just use the status data for basic info
      } catch(e) {}
    }
    renderGroups(hostsData, $('#groupSearch').val());
  }

  document.getElementById('groups-tab').addEventListener('shown.bs.tab', loadGroups);

  // Group by buttons
  $('.btn-group .btn[data-by]').on('click', function() {
    $('.btn-group .btn[data-by]').removeClass('active');
    $(this).addClass('active');
    _groupBy = $(this).data('by');
    // Botón Red: color especial cuando está activo
    if (_groupBy === 'network') {
      $('#groupByNetwork').addClass('active btn-info').removeClass('btn-outline-info');
    } else {
      $('#groupByNetwork').removeClass('active btn-info').addClass('btn-outline-info');
    }
    loadGroups();
  });

  $('#groupSearch').on('input', loadGroups);

  $('#mNotesTabEdit').on('click', function() {
    $(this).addClass('active'); $('#mNotesTabPreview').removeClass('active');
    $('#mNotes').show(); $('#mNotesPreview').hide();
  });
  $('#mNotesTabPreview').on('click', function() {
    $(this).addClass('active'); $('#mNotesTabEdit').removeClass('active');
    const md = $('#mNotes').val();
    if (typeof marked !== 'undefined') {
      $('#mNotesPreview').html(marked.parse(md || '*Sin notas*'));
    } else {
      $('#mNotesPreview').text(md || '(sin notas)');
    }
    $('#mNotes').hide(); $('#mNotesPreview').show();
  });
  // Reset tabs when modal opens
  $(document).on('show.bs.modal', '#hostModal', function() {
    $('#mNotesTabEdit').addClass('active'); $('#mNotesTabPreview').removeClass('active');
    $('#mNotes').show(); $('#mNotesPreview').hide();
  });

  // ══════════════════════════════════════════════════════════
  // LIMPIAR MAC — botón en modal de host
  // ══════════════════════════════════════════════════════════
  $('#mClearMac').on('click', async function() {
    if (!currentIp) return;
    const mac = $('#mMac').text().trim();
    if (!mac || mac === '—') { showToast('Este host ya no tiene MAC asignada', 'info'); return; }
    if (!confirm(`¿Borrar la MAC ${mac} del host ${currentIp}?\n\nEl dispositivo podrá ser detectado como nuevo la próxima vez que aparezca.`)) return;
    setBtnLoading(this, true);
    try {
      const res  = await fetch(`/api/hosts/${encodeURIComponent(currentIp)}/clear-mac`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      $('#mMac').text('—'); $('#mVendor').text('—');
      showToast(`🧹 MAC eliminada (${mac})`, 'success');
      const row = $(`tr[data-ip="${CSS.escape(currentIp)}"]`);
      if (row.length) row.find('td.mono').eq(1).text('—');
    } catch(e) { showToast('Error: ' + e.message, 'danger'); }
    setBtnLoading(this, false);
  });

  // ══════════════════════════════════════════════════════════
  // PUSH CONFIG LOAD/SAVE (en cfg form)
  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  // BACKUP — UI en pestaña Config
  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  // TAGS en modal — poblar al abrir host
  // ══════════════════════════════════════════════════════════
  // Hook into hostsData to get tags when modal opens
  // The existing openHostModal code sets h.* fields; we extend it:
  const _origOpenModal = window.openHostModal;

  // Override mSave to also save tags
  $('#mSave').off('click').on('click', async function() {
    const ip = $('#mIp').text();
    if (!ip) return;
    const $btn = $(this);
    setBtnLoading($btn[0], true);
    $('#mMsg').text('');
    const rawTypeId = $('#mType').val();
    const body = {
      manual_name: $('#mManual').val().trim(),
      notes:       $('#mNotes').val(),
      type_id:     rawTypeId ? parseInt(rawTypeId) : null,
      known:       null,
    };
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error al guardar');
      await fetch(`/api/hosts/${encodeURIComponent(ip)}/tags`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ tags: _currentTags.join(',') })
      });
      $('#mMsg').html('<span class="text-success">✓ Guardado</span>');
      // Actualizar celda en tabla sin esperar reload
      const newManual = body.manual_name;
      const nmapHost  = ($('#mHost').text() || '').trim();
      const dnsName   = ($('#mDns').text()  || '').trim();
      const row = $(`tr[data-ip="${CSS.escape(ip)}"]`);
      if (row.length) {
        const fallback = nmapHost || dnsName;
        const displayName = newManual || fallback || ip;
        let subHtml = '';
        if (newManual && fallback) subHtml = `<div class="sub-name">${$('<span>').text(fallback).html()}</div>`;
        row.find('td.host-name .host-name-editable').data('manual', newManual).text(displayName);
        row.find('td.manual-name-hidden').text(newManual);
        if (hostsTable) hostsTable.draw(false);
      }
      setTimeout(() => location.reload(), 1200);
    } catch(e) {
      setBtnLoading($btn[0], false);
      $('#mMsg').html(`<span class="text-danger">Error: ${e.message}</span>`);
    }
  });

  // ══════════════════════════════════════════════════════════
  // EDITAR ALERTAS
  // ══════════════════════════════════════════════════════════
  function parseIpToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  }

  function ipInRange(ip, rangeStr) {
    // Formats: "192.168.1.1-50", "192.168.1.1-192.168.1.50", "192.168.1.0/24"
    rangeStr = rangeStr.trim();
    if (!rangeStr) return true;
    try {
      if (rangeStr.includes('/')) {
        const [net, bits] = rangeStr.split('/');
        const mask  = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
        const netInt = parseIpToInt(net) & mask;
        return (parseIpToInt(ip) & mask) === netInt;
      }
      if (rangeStr.includes('-')) {
        const [start, end] = rangeStr.split('-');
        const startInt = parseIpToInt(start.trim());
        let endInt;
        if (end.trim().includes('.')) {
          endInt = parseIpToInt(end.trim());
        } else {
          // Short form: last octet only
          const prefix = start.trim().split('.').slice(0,3).join('.');
          endInt = parseIpToInt(prefix + '.' + end.trim());
        }
        const ipInt = parseIpToInt(ip);
        return ipInt >= Math.min(startInt,endInt) && ipInt <= Math.max(startInt,endInt);
      }
      return ip.startsWith(rangeStr);
    } catch { return true; }
  }

  let _ipRangeActive = '';

  $.fn.dataTable.ext.search.push(function(settings, data) {
    if (!_ipRangeActive || settings.nTable.id !== 'hosts') return true;
    const ip = data[2] || ''; // IP column index 2
    return ipInRange(ip, _ipRangeActive);
  });

  $('#ipRangeSearch').on('click', function() {
    const val = $('#ipRangeInput').val().trim();
    _ipRangeActive = val;
    $('#ipRangeClear').toggle(!!val);
    if (typeof hostsTable !== 'undefined') hostsTable.draw();
  });

  $('#ipRangeInput').on('keydown', function(e) {
    if (e.key === 'Enter') $('#ipRangeSearch').click();
  });

  $('#ipRangeClear').on('click', function() {
    _ipRangeActive = '';
    $('#ipRangeInput').val('');
    $(this).hide();
    if (typeof hostsTable !== 'undefined') hostsTable.draw();
  });

  // ══════════════════════════════════════════════════════════
  // WIDGET ÚLTIMO SCAN — update age every 30s
  // ══════════════════════════════════════════════════════════
  // Countdown se actualiza via startNextScanCountdown() llamado desde pollStatus()
  // (reemplaza al antiguo updateLastScanWidget)

  // ══════════════════════════════════════════════════════════
  // VAPID — auto-generate if missing when push panel visible
  // ══════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════
  // COLOR DE RED — resalta hosts por red secundaria
  // ══════════════════════════════════════════════════════════

  const NET_COLORS = [
    { bg: 'rgba(124,111,255,0.13)', border: '#7c6fff', text: '#b3adff' },
    { bg: 'rgba(255,159,67,0.13)',  border: '#ff9f43', text: '#ffca8a' },
    { bg: 'rgba(255,107,157,0.13)', border: '#ff6b9d', text: '#ffb3cf' },
    { bg: 'rgba(0,210,211,0.13)',   border: '#00d2d3', text: '#80e8e9' },
  ];

  function _ipToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
  }

  function _ipInCidr(ip, cidr) {
    try {
      const [net, bits] = cidr.split('/');
      const mask = bits ? (~0 << (32 - parseInt(bits))) >>> 0 : 0xffffffff;
      return (_ipToInt(ip) & mask) === (_ipToInt(net) & mask);
    } catch { return false; }
  }

  async function applyNetworkColors() {
    const secondaryNets = window._secondaryNetworks || [];
    const primaryNets   = window._primaryNetworks   || [];
    // Only color-code when there are secondary networks (otherwise it adds no info)
    if (!secondaryNets.length) return;

    $('#hosts tbody tr.host-row').each(function() {
      const ip = $(this).data('ip') || '';
      if (!ip) return;
      $(this).removeClass('net-primary net-secondary-0 net-secondary-1 net-secondary-2 net-secondary-3');
      $(this).css({ 'border-left': '', 'background': '' });
      $(this).find('.net-badge').remove();

      // Check secondary networks first
      let matched = false;
      for (let i = 0; i < secondaryNets.length; i++) {
        if (_ipInCidr(ip, secondaryNets[i].cidr)) {
          const col = NET_COLORS[i % NET_COLORS.length];
          $(this).addClass(`net-secondary-${i % 4}`);
          $(this).css('background', col.bg);
          const label = secondaryNets[i].label || secondaryNets[i].cidr;
          $(this).find('td[data-label="IP"]').append(
            `<span class="net-badge" style="background:${col.border}22;color:${col.text};border:1px solid ${col.border}55">${esc(label)}</span>`
          );
          matched = true;
          break;
        }
      }
      // Primary network badge (only if user gave it a custom name)
      if (!matched) {
        for (const pnet of primaryNets) {
          if (_ipInCidr(ip, pnet.cidr)) {
            $(this).addClass('net-primary');
            if (pnet.label) {
              $(this).find('td[data-label="IP"]').append(
                `<span class="net-badge" style="background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.45);border:1px solid rgba(255,255,255,0.15)">${esc(pnet.label)}</span>`
              );
            }
            break;
          }
        }
      }
    });
  }

  // Apply after table renders, and re-apply after DataTable draw
  setTimeout(applyNetworkColors, 500);
  if (typeof hostsTable !== 'undefined') {
    hostsTable.on('draw', function() { setTimeout(applyNetworkColors, 50); });
  }


  // ════════════════════════════════════════════════════════════
  //  Análisis Router — modal bajo demanda
  // ════════════════════════════════════════════════════════════

  // Mostrar botón solo si router está habilitado
  if (window.APP_CONFIG && window.APP_CONFIG.router_enabled) {
    $('#routerAnalysisBtn').show();
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function loadRouterAnalysis() {
    const $body = $('#routerAnalysisBody');
    $body.html('<div class="text-center py-4"><div class="spinner-border text-info"></div><div class="mt-2 small-muted">Consultando router SSH…</div></div>');

    try {
      const data = await fetch('/api/router-analysis').then(r => r.json());

      if (!data.ok) {
        $body.html(`<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>${esc(data.error || 'Error desconocido')}</div>`);
        return;
      }

      const { router_cidr, total_router, total_nmap, discrepancias, solo_router, en_comun, router_error } = data;
      let html = '';

      // Cabecera resumen
      html += `<div class="d-flex gap-3 flex-wrap mb-3">
        <div class="cardish text-center px-3 py-2" style="min-width:110px">
          <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">${total_nmap}</div>
          <div class="small-muted">nmap detecta</div>
        </div>
        <div class="cardish text-center px-3 py-2" style="min-width:110px">
          <div style="font-size:1.4rem;font-weight:700;color:#74b9ff">${total_router}</div>
          <div class="small-muted">router ve</div>
        </div>
        <div class="cardish text-center px-3 py-2" style="min-width:110px">
          <div style="font-size:1.4rem;font-weight:700;color:${discrepancias.length ? '#ffc107' : '#4dffb5'}">${discrepancias.length}</div>
          <div class="small-muted">discrepancias</div>
        </div>
        <div class="cardish text-center px-3 py-2" style="min-width:110px">
          <div style="font-size:1.4rem;font-weight:700;color:rgba(255,255,255,0.5)">${solo_router.length}</div>
          <div class="small-muted">solo en router</div>
        </div>
        ${router_cidr ? `<div class="align-self-center small-muted">CIDR router: <code>${esc(router_cidr)}</code></div>` : ''}
        ${router_error ? `<div class="align-self-center"><span class="badge bg-warning text-dark"><i class="bi bi-exclamation-triangle me-1"></i>${esc(router_error)}</span></div>` : ''}
      </div>`;

      // ── Discrepancias ── nmap ve, router NO ve
      if (discrepancias.length) {
        html += `<div class="mb-4">
          <h6 style="color:#ffc107;font-size:.85rem;border-bottom:1px solid rgba(255,193,7,0.3);padding-bottom:4px;margin-bottom:8px">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>
            Hosts que nmap detecta pero el router NO reporta (${discrepancias.length})
          </h6>
          <div class="small-muted mb-2" style="font-size:.72rem">
            Pueden ser: dispositivos con MAC aleatoria, IPs estáticas fuera del DHCP, intrusos, o falsos positivos del ARP.
          </div>
          <table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
            <thead><tr><th>IP</th><th>MAC</th><th>Nombre nmap</th><th>Fabricante</th><th>Estado</th></tr></thead>
            <tbody>`;
        for (const r of discrepancias) {
          html += `<tr style="background:rgba(255,193,7,0.07)">
            <td><strong>${esc(r.ip)}</strong></td>
            <td style="font-family:monospace;font-size:.71rem">${esc(r.mac)||'—'}</td>
            <td>${esc(r.name)||'—'}</td>
            <td style="opacity:.6">${esc(r.vendor)||'—'}</td>
            <td><span class="badge ${r.status==='online'?'bg-success':r.status==='offline'?'bg-secondary':'bg-warning text-dark'}">${esc(r.status||'?')}</span></td>
          </tr>`;
        }
        html += `</tbody></table></div>`;
      }

      // ── Solo en router ── router ve, nmap no detectó
      if (solo_router.length) {
        html += `<div class="mb-4">
          <h6 style="color:#74b9ff;font-size:.85rem;border-bottom:1px solid rgba(116,185,255,0.3);padding-bottom:4px;margin-bottom:8px">
            <i class="bi bi-router me-2"></i>
            Hosts que el router ve pero nmap NO detectó (${solo_router.length})
          </h6>
          <div class="small-muted mb-2" style="font-size:.72rem">
            Dispositivos en el DHCP/ARP del router que no respondieron al ping nmap. Normal en dispositivos offline o con firewall ICMP.
          </div>
          <table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
            <thead><tr><th>IP</th><th>MAC router</th><th>Hostname router</th><th>Asignación</th><th>En BD nmap</th></tr></thead>
            <tbody>`;
        for (const r of solo_router) {
          html += `<tr style="background:rgba(116,185,255,0.05)">
            <td><strong>${esc(r.ip)}</strong></td>
            <td style="font-family:monospace;font-size:.71rem">${esc(r.mac)||'—'}</td>
            <td>${esc(r.router_hostname)||'—'}</td>
            <td><span class="badge ${r.ip_assignment==='static'?'bg-info text-dark':'bg-secondary'}">${esc(r.ip_assignment||'dhcp')}</span></td>
            <td>${r.nmap_known ? `<span class="badge bg-secondary">${esc(r.nmap_status)}</span>` : '<span class="badge bg-dark" style="opacity:.5">desconocido</span>'}</td>
          </tr>`;
        }
        html += `</tbody></table></div>`;
      }

      // ── En común ── los que ambos ven (con posibles discrepancias de MAC)
      const mac_discs = en_comun.filter(r => r.mac_discrepancy);
      const en_comun_ok = en_comun.filter(r => !r.mac_discrepancy);

      if (mac_discs.length) {
        html += `<div class="mb-4">
          <h6 style="color:#fd79a8;font-size:.85rem;border-bottom:1px solid rgba(253,121,168,0.3);padding-bottom:4px;margin-bottom:8px">
            <i class="bi bi-shuffle me-2"></i>
            Discrepancias de MAC — misma IP, MAC diferente (${mac_discs.length})
          </h6>
          <div class="small-muted mb-2" style="font-size:.72rem">
            Puede indicar ARP spoofing, dispositivo reemplazado, o randomización de MAC.
          </div>
          <table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
            <thead><tr><th>IP</th><th>MAC nmap</th><th>MAC router</th><th>Nombre</th></tr></thead>
            <tbody>`;
        for (const r of mac_discs) {
          html += `<tr style="background:rgba(253,121,168,0.07)">
            <td><strong>${esc(r.ip)}</strong></td>
            <td style="font-family:monospace;font-size:.71rem;color:#fd79a8">${esc(r.mac_nmap)||'—'}</td>
            <td style="font-family:monospace;font-size:.71rem;color:#74b9ff">${esc(r.mac_router)||'—'}</td>
            <td>${esc(r.name_nmap||r.name_router||'—')}</td>
          </tr>`;
        }
        html += `</tbody></table></div>`;
      }

      // Hosts en común sin problemas (colapsable)
      if (en_comun_ok.length) {
        html += `<details class="mt-2">
          <summary style="cursor:pointer;font-size:.82rem;color:var(--accent);user-select:none">
            <i class="bi bi-check-circle me-1"></i>
            ${en_comun_ok.length} hosts coinciden en nmap y router (sin problemas)
          </summary>
          <table class="table table-sm table-hover align-middle mt-2 mb-0" style="font-size:.76rem">
            <thead><tr><th>IP</th><th>MAC</th><th>Nombre nmap</th><th>Hostname router</th><th>Asignación</th><th>Estado</th></tr></thead>
            <tbody>`;
        for (const r of en_comun_ok) {
          html += `<tr>
            <td>${esc(r.ip)}</td>
            <td style="font-family:monospace;font-size:.69rem">${esc(r.mac_nmap||r.mac_router||'—')}</td>
            <td>${esc(r.name_nmap||'—')}</td>
            <td>${esc(r.name_router||'—')}</td>
            <td><span class="badge ${r.ip_assignment==='static'?'bg-info text-dark':'bg-secondary'}" style="font-size:.65rem">${esc(r.ip_assignment||'dhcp')}</span></td>
            <td><span class="badge ${r.status==='online'?'bg-success':r.status==='offline'?'bg-secondary':'bg-warning text-dark'}" style="font-size:.65rem">${esc(r.status||'?')}</span></td>
          </tr>`;
        }
        html += `</tbody></table></details>`;
      }

      if (!discrepancias.length && !solo_router.length && !mac_discs.length) {
        html += `<div class="alert alert-success"><i class="bi bi-check-circle-fill me-2"></i>Todo coincide. No hay discrepancias entre nmap y el router.</div>`;
      }

      // Mostrar último informe IA si existe
      try {
        const aiRes = await fetch('/api/scan/ai-reports/latest').then(r => r.json());
        if (aiRes.ok && aiRes.report) {
          const r = aiRes.report;
          const ts = (r.generated_at || '').replace('T',' ').slice(0,16);
          html += `<div class="mt-3 p-3" style="background:rgba(77,255,181,0.05);border:1px solid rgba(77,255,181,0.2);border-radius:8px">
            <div class="d-flex align-items-center gap-2 mb-2">
              <i class="bi bi-robot" style="color:var(--accent)"></i>
              <strong style="font-size:.85rem">Último informe IA</strong>
              <span class="small-muted ms-auto" style="font-size:.72rem">${esc(ts)} · ${esc(r.source||'nmap')} · ${r.discrepancy_count} discrepancias</span>
              <button class="btn btn-outline-info btn-sm" id="aiAnalyzeNowBtn" style="font-size:.72rem">
                <i class="bi bi-robot"></i> Analizar ahora
              </button>
            </div>
            <div class="ai-report-body markdown-body" style="font-size:.8rem;line-height:1.5">${typeof marked !== 'undefined' ? marked.parse(r.report_text||'') : esc(r.report_text||'')}</div>
          </div>`;
        } else {
          html += `<div class="mt-3 p-2 d-flex align-items-center gap-2" style="background:rgba(255,255,255,0.04);border-radius:6px">
            <i class="bi bi-robot" style="opacity:.4"></i>
            <span class="small-muted" style="font-size:.78rem">Sin informes IA. Activa el análisis IA en Config → Escáner → Motor de detección.</span>
            <button class="btn btn-outline-info btn-sm ms-auto" id="aiAnalyzeNowBtn" style="font-size:.72rem">
              <i class="bi bi-robot"></i> Analizar ahora
            </button>
          </div>`;
        }
      } catch(e) {}

      $body.html(html);
    } catch(e) {
      $body.html(`<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>Error: ${esc(e.message)}</div>`);
    }
  }

  // Abrir modal al pulsar el botón
  $(document).on('click', '#routerAnalysisBtn', function() {
    const modal = new bootstrap.Modal(document.getElementById('routerAnalysisModal'));
    modal.show();
    loadRouterAnalysis();
  });

  // Botón Actualizar dentro del modal
  $(document).on('click', '#routerAnalysisRefresh', loadRouterAnalysis);

  // Botón Analizar ahora con IA
  $(document).on('click', '#aiAnalyzeNowBtn', async function() {
    const $btn = $(this);
    $btn.prop('disabled', true).html('<i class="bi bi-robot spin"></i> Analizando…');
    try {
      const res  = await fetch('/api/scan/ai-analyze-now', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        // Recargar el modal para mostrar el nuevo informe
        loadRouterAnalysis();
      } else {
        // Mostrar error inline bajo el botón
        const errMsg = data.error || 'Error desconocido';
        $btn.closest('div').after(
          `<div class="alert alert-danger alert-sm mt-2 py-1 px-2" style="font-size:.78rem">
            <i class="bi bi-exclamation-triangle me-1"></i>${esc(errMsg)}
          </div>`
        );
      }
    } catch(e) {
      alert('Error de red: ' + e.message);
    } finally {
      $btn.prop('disabled', false).html('<i class="bi bi-robot"></i> Analizar ahora');
    }
  });


  // ════════════════════════════════════════════════════════════════
  //  Subdivisión de hosts por red — botón "Por red"
  // ════════════════════════════════════════════════════════════════

  let _splitByNet = false;

  function _buildNetSections(hostsData) {
    const allNets = [
      ...(window._primaryNetworks  || []).map(n => ({...n, _type: 'primary'})),
      ...(window._secondaryNetworks || []).map(n => ({...n, _type: 'secondary'})),
    ];

    if (!allNets.length) {
      return '<div class="small-muted p-3">No hay redes configuradas. Añádelas en Config → Redes.</div>';
    }

    // Agrupar hosts por red
    const buckets = {};    // key = label||cidr
    const unassigned = [];
    allNets.forEach(n => { buckets[n.cidr] = { net: n, hosts: [] }; });

    for (const h of hostsData) {
      let assigned = false;
      for (const n of allNets) {
        if (n.cidr && _ipInCidr(h.ip, n.cidr)) {
          buckets[n.cidr].hosts.push(h);
          assigned = true;
          break;
        }
      }
      if (!assigned) unassigned.push(h);
    }

    let html = '';
    for (const n of allNets) {
      const bucket = buckets[n.cidr];
      const hosts  = bucket.hosts;
      const online = hosts.filter(h => h.status === 'online' || h.status === 'online_silent').length;
      const isPrimary = n._type === 'primary';
      const accentColor = isPrimary ? 'var(--accent)' : '#74b9ff';
      const typeIcon = isPrimary
        ? '<i class="bi bi-house-fill me-2" style="font-size:.85rem"></i>'
        : '<i class="bi bi-diagram-3-fill me-2" style="font-size:.85rem"></i>';

      html += `<div class="mb-4">
        <div class="d-flex align-items-center gap-2 mb-2 px-1"
             style="border-left:3px solid ${accentColor};padding-left:8px!important">
          <span style="color:${accentColor};font-weight:600;font-size:.9rem">${typeIcon}${esc(n.label || n.cidr)}</span>
          <code style="font-size:.72rem;opacity:.55">${esc(n.cidr)}</code>
          <span class="badge ms-1" style="background:${accentColor}22;color:${accentColor};font-size:.7rem">
            ${online} online / ${hosts.length} total
          </span>
          <div class="ms-auto" style="width:80px;height:5px;background:rgba(255,255,255,0.08);border-radius:3px">
            <div style="width:${hosts.length ? Math.round(online/hosts.length*100) : 0}%;height:100%;background:${accentColor};border-radius:3px;transition:width .3s"></div>
          </div>
        </div>`;

      if (!hosts.length) {
        html += `<div class="small-muted px-3 py-2" style="font-size:.78rem;opacity:.5">
          <i class="bi bi-inbox me-1"></i>Sin hosts detectados en esta red
        </div>`;
      } else {
        html += `<div class="table-responsive">
          <table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
            <thead style="opacity:.6">
              <tr>
                <th style="width:16px"></th>
                <th>IP</th>
                <th>Nombre</th>
                <th>MAC</th>
                <th>Fabricante</th>
                <th>Estado</th>
                <th>Visto</th>
              </tr>
            </thead>
            <tbody>`;
        // Ordenar: online primero, luego por IP
        const sorted = [...hosts].sort((a,b) => {
          const sa = (a.status === 'online' || a.status === 'online_silent') ? 0 : 1;
          const sb = (b.status === 'online' || b.status === 'online_silent') ? 0 : 1;
          if (sa !== sb) return sa - sb;
          return a.ip.split('.').map(Number).join('').localeCompare(
                 b.ip.split('.').map(Number).join(''), undefined, {numeric:true});
        });
        for (const h of sorted) {
          const name    = esc(h.manual_name || h.nmap_hostname || h.router_hostname || h.dns_name || '—');
          const mac     = esc(h.mac || '—');
          const vendor  = esc(h.vendor || '—');
          const online  = h.status === 'online' || h.status === 'online_silent';
          const silent  = h.status === 'online_silent';
          const dot     = online
            ? `<span style="color:${silent?'#ffc107':'#4dffb5'};font-size:.9rem">●</span>`
            : `<span style="color:#ff6b6b;font-size:.9rem">●</span>`;
          const statBadge = online
            ? `<span class="badge" style="background:rgba(77,255,181,0.15);color:#4dffb5;font-size:.68rem">${silent?'silent':'online'}</span>`
            : `<span class="badge bg-secondary" style="font-size:.68rem">offline</span>`;
          const seen    = esc(h.seen_ago || '—');
          html += `<tr class="net-host-row" data-ip="${esc(h.ip)}" style="cursor:pointer">
            <td>${dot}</td>
            <td class="mono" style="font-size:.75rem">${esc(h.ip)}</td>
            <td>${name}</td>
            <td class="mono" style="font-size:.7rem;opacity:.7">${mac}</td>
            <td style="opacity:.6">${vendor}</td>
            <td>${statBadge}</td>
            <td style="opacity:.55;font-size:.72rem">${seen}</td>
          </tr>`;
        }
        html += `</tbody></table></div>`;
      }
      html += `</div>`;
    }

    // Hosts sin red asignada
    if (unassigned.length) {
      html += `<div class="mb-4">
        <div class="d-flex align-items-center gap-2 mb-2 px-1"
             style="border-left:3px solid rgba(255,255,255,0.2);padding-left:8px!important">
          <span style="color:rgba(255,255,255,0.45);font-weight:600;font-size:.9rem">
            <i class="bi bi-question-circle me-2"></i>Sin red asignada
          </span>
          <span class="badge ms-1" style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.5);font-size:.7rem">
            ${unassigned.length} hosts
          </span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
            <tbody>`;
      for (const h of unassigned) {
        const name = esc(h.manual_name || h.nmap_hostname || h.router_hostname || h.dns_name || '—');
        const online = h.status === 'online' || h.status === 'online_silent';
        const dot  = online ? '<span style="color:#4dffb5">●</span>' : '<span style="color:#ff6b6b">●</span>';
        html += `<tr class="net-host-row" data-ip="${esc(h.ip)}" style="cursor:pointer">
          <td>${dot}</td>
          <td class="mono" style="font-size:.75rem">${esc(h.ip)}</td>
          <td>${name}</td>
          <td class="mono" style="font-size:.7rem;opacity:.7">${esc(h.mac||'—')}</td>
          <td style="opacity:.6">${esc(h.vendor||'—')}</td>
          <td></td><td style="opacity:.55;font-size:.72rem">${esc(h.seen_ago||'—')}</td>
        </tr>`;
      }
      html += `</tbody></table></div></div>`;
    }

    return html;
  }

  function _applySplitByNet() {
    const $container = $('#hostsByNetContainer');
    const $tableWrap  = $('#hostsTableWrap');
    const $btn        = $('#splitByNetBtn');
    const allNets = [...(window._primaryNetworks||[]), ...(window._secondaryNetworks||[])];

    if (_splitByNet && allNets.length > 0) {
      // Aplicar filtros activos a los datos antes de renderizar
      const hostsData = _applyFiltersToHosts(window._hostsData || []);
      $container.html(_buildNetSections(hostsData)).show();
      $tableWrap.hide();
      $btn.addClass('active btn-info').removeClass('btn-outline-secondary');
    } else {
      $container.hide().html('');
      $tableWrap.show();
      $btn.removeClass('active btn-info').addClass('btn-outline-secondary');
    }
  }

  // Filtra el array de hosts según los filtros activos de la UI
  function _applyFiltersToHosts(hosts) {
    const text       = ($('#hostFilter').val() || '').trim().toLowerCase();
    const typeVal    = ($('#typeFilter').val() || '').trim().toLowerCase();
    const statusF    = window.statusFilter || '';
    const showUnknown = window.showOnlyUnknown || false;

    return hosts.filter(h => {
      // Filtro de estado
      if (statusF) {
        const st = (h.status || '').toLowerCase();
        const isOnline = st === 'online' || st === 'online_silent';
        if (statusF === 'online'  && !isOnline) return false;
        if (statusF === 'offline' && isOnline)  return false;
      }
      // Solo desconocidos
      if (showUnknown && h.known) return false;
      // Filtro de tipo
      if (typeVal) {
        const typeName = (h.type_name || '').toLowerCase();
        if (typeName !== typeVal) return false;
      }
      // Filtro de texto (IP, MAC, nombre, DNS)
      if (text) {
        const fields = [h.ip, h.mac, h.manual_name, h.nmap_hostname, h.dns_name, h.router_hostname];
        if (!fields.some(f => f && f.toLowerCase().includes(text))) return false;
      }
      return true;
    });
  }

  // Mostrar botón solo si hay redes configuradas
  function _initSplitByNetBtn() {
    const allNets = [...(window._primaryNetworks||[]), ...(window._secondaryNetworks||[])];
    if (allNets.length > 1) {
      $('#splitByNetBtn').show();
    }
  }
  _initSplitByNetBtn();

  // Click en el botón toggle
  $(document).on('click', '#splitByNetBtn', function() {
    _splitByNet = !_splitByNet;
    _applySplitByNet();
    localStorage.setItem('auditor-split-by-net', _splitByNet ? '1' : '0');
  });

  // Restaurar estado del toggle desde localStorage
  if (localStorage.getItem('auditor-split-by-net') === '1') {
    _splitByNet = true;
    setTimeout(_applySplitByNet, 300); // esperar a que cargue la tabla
  }

  // Click en fila de la vista por red → abrir modal host
  $(document).on('click', '.net-host-row', function() {
    openHostModal($(this).data('ip'));
  });

  // Exponer para que app.js pueda re-renderizar cuando cambian los filtros
  window._refreshSplitByNet = function() {
    if (_splitByNet) _applySplitByNet();
  };

  // Re-renderizar cuando se actualizan los hosts
  const _origLoadHosts = window.loadHosts;
  if (typeof _origLoadHosts === 'function') {
    window.loadHosts = async function(...args) {
      const result = await _origLoadHosts.apply(this, args);
      if (_splitByNet) setTimeout(_applySplitByNet, 100);
      return result;
    };
  }

}); // end $(function) — hosts.js
