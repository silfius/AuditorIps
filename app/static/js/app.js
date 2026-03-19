// ════════════════════════════════════════════════════════
//  app.js — Auditor IPs · Bootstrap global
//  Globals: esc(), macValid(), DataTable IP sort
//  Init: hostsTable, loading/spinner, counters, filters,
//        auto-refresh, status polling bootstrap
// ════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  auditor.js — Auditor IPs
// ═══════════════════════════════════════════════════════════

// Aplicar tema guardado inmediatamente para evitar flash
(function() {
  const t = localStorage.getItem('auditor-theme') || 'dark';
  if (t === 'light') {
    document.documentElement.style.visibility = 'hidden';
    document.addEventListener('DOMContentLoaded', function() {
      document.getElementById('themeCSS').href =
        'https://cdn.jsdelivr.net/npm/bootswatch@5.3.3/dist/flatly/bootstrap.min.css';
      document.body.classList.add('light-mode');
      var icon = document.getElementById('themeIcon');
      if (icon) icon.className = 'bi bi-moon-stars-fill';
      document.documentElement.style.visibility = '';
    });
  }
})();

jQuery.extend(jQuery.fn.dataTableExt.oSort, {
  "ip-pre": function (a) {
    if (!a) return 0;
    const m = a.trim().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return 0;
    return (+m[1] << 24) + (+m[2] << 16) + (+m[3] << 8) + (+m[4]);
  },
  "ip-asc": function (a, b) { return a - b; },
  "ip-desc": function (a, b) { return b - a; }
});

function esc(s) {
  return (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function macValid(mac) {
  if (!mac) return false;
  const m = String(mac).trim().toUpperCase().replaceAll("-", ":");
  return /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/.test(m);
}

$(function () {

  function safeId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = ((hash << 5) - hash) + str.charCodeAt(i); hash |= 0; }
    return 'g' + Math.abs(hash).toString(36);
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function accentColor(alpha) {
    const hex = cssVar('--accent');
    if (!hex || !hex.startsWith('#')) return `rgba(77,255,181,${alpha})`;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return alpha >= 1 ? hex : `rgba(${r},${g},${b},${alpha})`;
  }
  function accent2Color(alpha) {
    const hex = cssVar('--accent2');
    if (!hex || !hex.startsWith('#')) return `rgba(55,90,127,${alpha})`;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return alpha >= 1 ? hex : `rgba(${r},${g},${b},${alpha})`;
  }

  const hostModal = new bootstrap.Modal(document.getElementById('hostModal'));
  const confirmDeleteModal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));

  window.currentIp = null; let currentIp = window.currentIp;
  window.pendingDeleteIp = null;

  // ══════════════════════════════════════════════════
  // ✅ SISTEMA CENTRALIZADO DE LOADING / SPINNER
  // ══════════════════════════════════════════════════

  /**
   * Muestra/oculta la barra de progreso global (top shimmer)
   * + opcionalmente el overlay de la tabla con mensaje personalizado
   */
  function setLoading(active, msg) {
    const spinner = document.getElementById('globalSpinner');
    const overlay = document.getElementById('tableOverlay');
    const overlayMsg = document.getElementById('overlayMsg');

    if (active) {
      spinner.style.display = 'block';
      if (msg) {
        overlayMsg.textContent = msg;
        overlay.style.display = 'flex';
      }
    } else {
      spinner.style.display = 'none';
      overlay.style.display = 'none';
    }
  }

  /**
   * Añade/quita el spinner inline en un botón.
   * Guarda el HTML original para restaurarlo.
   */
  function setBtnLoading(btn, active) {
    const $b = $(btn);
    if (active) {
      if (!$b.data('orig-html')) $b.data('orig-html', $b.html());
      $b.addClass('btn-loading').html(`<span class="btn-label">${$b.data('orig-html')}</span>`);
    } else {
      $b.removeClass('btn-loading');
      if ($b.data('orig-html')) { $b.html($b.data('orig-html')); $b.removeData('orig-html'); }
    }
  }

  // Column index map:
  // 0 Estado, 1 IP, 2 MAC, 3 Nombre, 4 Tipo_sort(hidden), 5 ManualName(hidden), 6 Tipo, 7 Conocido, 8 Visto, 9 Último, 10 Acciones
  const hostsTable = $('#hosts').DataTable({
    pageLength: 50,
    order: [[1, 'desc'], [2, 'asc']],
    columnDefs: [
      { targets: 0, orderable: false, searchable: false, width: '30px' }, // checkbox
      { targets: 2, type: 'ip' },                          // IP
      { targets: 5, visible: false, searchable: true },    // Tipo_sort (oculta)
      { targets: 6, visible: false, searchable: true },    // ManualName (oculta)
      { targets: 7, visible: false, searchable: true },    // Tags (oculta)
      { targets: 8, orderData: [5] },                      // Tipo visible ordena por Tipo_sort
      { targets: 13, orderable: false }                    // Acciones
    ]
  });

  // Counters
  let total = 0, online = 0, offline = 0;
  $('#hosts tbody tr').each(function() {
    total++;
    const st = ($(this).find('td').first().text() || "").trim();
    if (st === "online") online++;
    else if (st === "offline") offline++;
  });
  $('#cntTotal').text(total);
  $('#cntOnline').text(online);
  $('#cntOffline').text(offline);
  $('#cntOnlineBadge').text(online);
  $('#cntOfflineBadge').text(offline);

  // Filtros (texto + tipo + estado + desconocidos)
  const textCols = [2,3,4,6]; // IP, MAC, Nombre, ManualName(hidden)
  // col 8=Latencia, 9=Visto, 10=Último
  window.statusFilter = ''; let statusFilter = ''; // 'online' | 'offline' | ''

  // Network filter — uses server-injected _primaryNetworks / _secondaryNetworks
  function _ipToInt(ip) {
    return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
  }
  function _ipInCidr(ip, cidr) {
    try {
      const [net, bits] = cidr.split('/');
      const mask = bits ? (~0 << (32 - parseInt(bits))) >>> 0 : 0xffffffff;
      return (_ipToInt(ip) & mask) === (_ipToInt(net) & mask);
    } catch { return false; }
  }
  let _networkFilter = ''; // 'primary:cidr' | 'secondary:cidr' | ''

  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    if (settings.nTable.id !== 'hosts') return true;

    const q    = ($('#hostFilter').val() || '').trim().toLowerCase();
    const type = ($('#typeFilter').val() || '').trim().toLowerCase();
    const tr   = settings.aoData[dataIndex].nTr;

    // Filtro de estado (data[1] = columna Estado; contiene HTML, extraemos texto plano)
    if (statusFilter) {
      const rawStatus = (data[1] || '').replace(/<[^>]+>/g, '').trim().toLowerCase();
      // 'silent' (online_silent) no coincide ni con online ni offline, tratar como offline para el filtro
      const rowStatus = rawStatus.includes('online') && !rawStatus.includes('silent') ? 'online'
                      : rawStatus.includes('offline') ? 'offline'
                      : 'offline'; // silent se trata como offline
      if (rowStatus !== statusFilter) return false;
    }

    // Filtro de tipo (data[5] = columna oculta type-sort con el nombre puro sin emoji)
    if (type) {
      const typeText = (data[5] || '').trim().toLowerCase();
      if (typeText !== type) return false;
    }

    // Filtro por red
    if (_networkFilter) {
      const ip  = (data[2] || '').replace(/<[^>]+>/g, '').trim();
      const [kind, cidr] = _networkFilter.split(':');
      if (!_ipInCidr(ip, cidr)) return false;
    }

    // Filtro desconocidos (ya gestionado por su propio push más abajo)

    // Filtro de texto
    if (!q) return true;
    return textCols.some(i => (data[i] || '').toLowerCase().includes(q));
  });

  $('#hostFilter').on('input', function(){
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });
  $('#typeFilter').on('change', function(){
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });
  $(document).on('change', '#networkFilter', function() {
    _networkFilter = $(this).val() || '';
    // Visual feedback — highlight select when active
    $(this).toggleClass('border-info', !!_networkFilter);
    hostsTable.draw();
  });

  // Botones Online / Offline
  $('#onlineFilter').on('click', function() {
    if (statusFilter === 'online') {
      statusFilter = '';
      $(this).removeClass('active-online');
    } else {
      statusFilter = 'online';
      $(this).addClass('active-online');
      $('#offlineFilter').removeClass('active-offline');
    }
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });

  $('#offlineFilter').on('click', function() {
    if (statusFilter === 'offline') {
      statusFilter = '';
      $(this).removeClass('active-offline');
    } else {
      statusFilter = 'offline';
      $(this).addClass('active-offline');
      $('#onlineFilter').removeClass('active-online');
    }
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });

  $('#clearFilter').on('click', function(){
    $('#hostFilter').val('');
    $('#typeFilter').val('');
    $('#networkFilter').val('').removeClass('border-info');
    _networkFilter = '';
    statusFilter = '';
    $('#onlineFilter').removeClass('active-online');
    $('#offlineFilter').removeClass('active-offline');
    showOnlyUnknown = false;
    $('#unknownFilter').removeClass('active-filter');
    $('#unknownFilter i').removeClass('bi-question-diamond-fill').addClass('bi-question-diamond');
    hostsTable.draw();
    if (typeof window._refreshSplitByNet === 'function') window._refreshSplitByNet();
  });

  // Scan
  $('#scanBtn').on('click', async () => {
    setBtnLoading('#scanBtn', true);
    setLoading(true, 'Escaneando red…');
    $('#scanStatus').text('');
    try {
      const res = await fetch('/scan', { method: 'POST' });
      const data = await res.json();
      if (res.status === 409) {
        $('#scanStatus').text('⏳ Scan ya en curso, espera a que termine…');
        setBtnLoading('#scanBtn', false);
        setLoading(false);
        return;
      }
      if (!data.ok) throw new Error(data.error || 'Error');
      $('#scanStatus').text('⏳ Escaneando en background…');
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const st = await fetch('/api/status').then(r => r.json());
          const fin = st.last_scan?.finished_at;
          if (fin && (Date.now() - new Date(fin).getTime()) < 20000) {
            clearInterval(poll);
            $('#scanStatus').text(`✓ online=${st.online} · offline=${st.offline} · nuevos=${st.last_scan?.new_hosts ?? 0}`);
            setTimeout(() => location.reload(), 900);
            return;
          }
        } catch(_) {}
        if (attempts >= 30) {
          clearInterval(poll);
          setBtnLoading('#scanBtn', false);
          setLoading(false);
          setTimeout(() => location.reload(), 1000);
        }
      }, 3000);
    } catch (e) {
      setLoading(false);
      setBtnLoading('#scanBtn', false);
      $('#scanStatus').text('Error: ' + e.message);
    }
  });

  // Scans tab
  const scansTable = $('#scans').DataTable({
    pageLength: 25,
    order: [[0,'desc']],
    columns: [
      null, null, null, null, null, null, null, null, null,
      null,  // cambios
      { orderable: false }  // notas
    ]
  });
  async function loadScans() {
    setLoading(true);
    $('#scanStatus').text('');
    try {
      const res = await fetch('/api/scans');
      const rows = await res.json();
      const tbody = [];
      for (const r of (rows || [])) {
        tbody.push([
          esc(r.id ?? ""),
          esc(r.started_at ?? ""),
          esc(r.finished_at ?? ""),
          esc(r.cidr ?? ""),
          esc(r.online_hosts ?? ""),
          esc(r.offline_hosts ?? ""),
          esc(r.new_hosts ?? ""),
          esc(r.events_sent ?? ""),
          (r.discord_sent ? "✅" : "—"),
          "—",  // Cambios (col 10) - vacío en la versión básica
          ""    // Notas (col 11) - vacío en la versión básica
        ]);
      }
      scansTable.clear();
      scansTable.rows.add(tbody).draw();
      setLoading(false);
      $('#scanStatus').text('');
      buildChart(rows || []);
    } catch (e) {
      setLoading(false);
      $('#scanStatus').text('Error cargando ejecuciones: ' + e.message);
    }
  }
  $('#refreshScans').on('click', loadScans);
  // scans-tab: uses loadScansWithDiff listener below (handles activity chart resize too)

  // Tipo inline (actualiza DB + columna oculta para orden inmediato)
  $(document).on('change', '.type-select', async function(e){
    e.preventDefault(); e.stopPropagation();
    const ip = $(this).data('ip');
    const type_id = $(this).val();
    const tr = $(this).closest('tr');
    const $sel = $(this);

    setLoading(true);
    $sel.prop('disabled', true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type_id })
      });
      const data = await res.json();
      setLoading(false);
      $sel.prop('disabled', false);
      if (!data.ok) throw new Error(data.error || 'Error');

      tr.find('td.type-sort').text($sel.find('option:selected').text());
      $('#scanStatus').text(`✓ Tipo actualizado para ${ip}`);
      hostsTable.draw(false);
    } catch (err) {
      setLoading(false);
      $sel.prop('disabled', false);
      $('#scanStatus').text('Error actualizando tipo: ' + err.message);
    }
  });

  // Host modal open — definido más abajo junto al resto de handlers de known/reset
  $(document).on('click', 'tr.host-row', function(e){
    if ($(e.target).closest('.no-row-click, button, a, input, textarea, select').length) return;
    openHost($(this).data('ip'));
  });
  $(document).on('click', '.btn-detail', function(e){
    e.preventDefault(); e.stopPropagation();
    openHost($(this).closest('tr').data('ip'));
  });

  // Save host (modal)
  $('#mSave').on('click', async function(){
    if (!currentIp) return;
    setBtnLoading(this, true);
    setLoading(true);
    $('#mMsg').text('');
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(currentIp)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual_name: $('#mManual').val(),
          notes: $('#mNotes').val(),
          type_id: $('#mType').val()
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      $('#mMsg').text('✓ Guardado');

      // Actualizar la celda de nombre en la tabla inmediatamente (sin esperar al reload)
      const newManual = ($('#mManual').val() || '').trim();
      const nmapHost = ($('#mHost').text() || '').trim();
      const dnsName  = ($('#mDns').text()  || '').trim();
      const row = $(`tr[data-ip="${CSS.escape(currentIp)}"]`);
      if (row.length) {
        const nameCell = row.find('td.host-name');
        const fallback = nmapHost || dnsName;
        const displayName = newManual || fallback || currentIp;
        let subHtml = '';
        if (newManual && fallback) {
          subHtml = `<div class="sub-name">${$('<span>').text(fallback).html()}</div>`;
        }
        nameCell.html($('<span>').text(displayName).html() + subHtml);
        // Actualizar también la columna oculta de búsqueda manual_name
        row.find('td.manual-name-hidden').text(newManual);
        hostsTable.draw(false);
      }

      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setBtnLoading(this, false);
      setLoading(false);
      $('#mMsg').text('Error: ' + e.message);
    }
  });

  // WOL
  async function doWol(ip, whereMsgSelector, triggerBtn) {
    if (triggerBtn) setBtnLoading(triggerBtn, true);
    setLoading(true);
    if (whereMsgSelector) $(whereMsgSelector).text('Enviando WOL…');
    $('#scanStatus').text(`⚡ Enviando WOL a ${ip}…`);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}/wol`, { method: 'POST' });
      const data = await res.json();
      setLoading(false);
      if (triggerBtn) setBtnLoading(triggerBtn, false);
      if (!data.ok) throw new Error(data.error || 'Error');
      const msg = `⚡ WOL OK · ${ip} · ${data.mac} → ${data.broadcast}:${data.port}`;
      $('#scanStatus').text(msg);
      if (whereMsgSelector) $(whereMsgSelector).text(msg);
    } catch (e) {
      setLoading(false);
      if (triggerBtn) setBtnLoading(triggerBtn, false);
      const msg = `WOL ERROR · ${ip}: ${e.message}`;
      $('#scanStatus').text(msg);
      if (whereMsgSelector) $(whereMsgSelector).text(msg);
    }
  }

  $(document).on('click', '.btn-wol', function(e){
    e.preventDefault(); e.stopPropagation();
    if ($(this).prop('disabled')) return;
    const ip = $(this).closest('tr').data('ip');
    doWol(ip, null, this);
  });

  $('#mWol').on('click', function(){
    if (!currentIp) return;
    if ($(this).prop('disabled')) return;
    doWol(currentIp, '#mMsg', this);
  });

  // Delete host
  function askDelete(ip){ pendingDeleteIp = ip; $('#dIp').text(ip); confirmDeleteModal.show(); }
  $(document).on('click', '.btn-delete', function(e){ e.preventDefault(); e.stopPropagation(); askDelete($(this).closest('tr').data('ip')); });
  $('#mDelete').on('click', function(){ if (currentIp) askDelete(currentIp); });

  $('#dConfirm').on('click', async function(){
    if (!pendingDeleteIp) return;
    setBtnLoading(this, true);
    setLoading(true);
    try {
      const res = await fetch(`/api/hosts/${encodeURIComponent(pendingDeleteIp)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      confirmDeleteModal.hide(); hostModal.hide();
      $('#scanStatus').text(`🗑 Eliminado ${pendingDeleteIp}. Se detectará como nuevo si reaparece.`);
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      setBtnLoading(this, false);
      setLoading(false);
      $('#scanStatus').text('Error eliminando: ' + e.message);
    }
  });

  // Types management
  async function reloadTypes() {
    const res = await fetch('/api/types');
    const data = await res.json();
    if (!data.ok) return;

    const tbody = $('#typesTable tbody');
    tbody.empty();
    for (const t of data.types) {
      const iconDisp = t.icon || '❓';
      tbody.append(`
        <tr data-type-id="${t.id}">
          <td class="mono">${t.id}</td>
          <td><input class="form-control form-control-sm type-name" value="${esc(t.name)}"></td>
          <td>
            <div class="emoji-picker-wrap">
              <button type="button" class="emoji-picker-btn type-icon-val" data-icon="${esc(t.icon||'')}">${iconDisp}</button>
              <input type="hidden" class="type-icon-hidden" value="${esc(t.icon||'')}">
              <div class="emoji-grid-popup"></div>
          </td>
          <td>
            <div class="d-flex gap-2">
              <button class="btn btn-outline-info btn-sm save-type"><i class="bi bi-save2"></i></button>
              <button class="btn btn-outline-danger btn-sm del-type"><i class="bi bi-trash3"></i></button>
            </div>
          </td>
        </tr>
      `);
    }

    const typeFilter = $('#typeFilter');
    const currentFilter = typeFilter.val();
    typeFilter.empty().append(`<option value="">(Todos)</option>`);
    for (const t of data.types) typeFilter.append(`<option value="${esc(t.name)}">${t.icon ? t.icon+' ' : ''}${esc(t.name)}</option>`);
    typeFilter.val(currentFilter || "");

    $('.type-select').each(function(){
      const sel = $(this);
      const current = sel.val();
      sel.empty();
      for (const t of data.types) sel.append(`<option value="${t.id}" data-icon="${esc(t.icon||'')}">${t.icon ? t.icon+' ' : ''}${esc(t.name)}</option>`);
      sel.val(current);

      // también actualiza la columna hidden (por si renombraste tipos)
      sel.closest('tr').find('td.type-sort').text(sel.find('option:selected').text());
    });

    const mType = $('#mType');
    const curM = mType.val();
    mType.empty();
    for (const t of data.types) mType.append(`<option value="${t.id}">${t.icon ? t.icon+' ' : ''}${esc(t.name)}</option>`);
    mType.val(curM || "");
  }

  $('#addType').on('click', async function(){
    const name = ($('#newTypeName').val() || '').trim();
    const newIco = ($('#newTypeIcon').val() || '').trim();
    if (!name) { $('#typesMsg').text('Nombre vacío'); return; }
    $('#typesMsg').text('Añadiendo…');
    const res = await fetch('/api/types', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon: newIco })
    });
    const data = await res.json();
    if (!data.ok) { $('#typesMsg').text(data.error || 'Error'); return; }
    $('#newTypeName').val('');
    $('#newTypeIcon').val('');
    $('#typesMsg').text('OK');
    await reloadTypes();
  });

  $(document).on('click', '.save-type', async function(){
    const tr = $(this).closest('tr');
    const id = tr.data('type-id');
    const name = (tr.find('.type-name').val() || '').trim();
    $('#typesMsg').text('Guardando…');
    const icon = (tr.find('.type-icon-hidden').val() || tr.find('.type-icon-val').data('icon') || '').trim();
    const res = await fetch(`/api/types/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon })
    });
    const data = await res.json();
    if (!data.ok) { $('#typesMsg').text(data.error || 'Error'); return; }
    $('#typesMsg').text('OK');
    await reloadTypes();
    hostsTable.draw(false);
  });

  $(document).on('click', '.del-type', async function(){
    const tr = $(this).closest('tr');
    const id = tr.data('type-id');
    const name = (tr.find('.type-name').val() || '').trim();
    if (!confirm(`¿Borrar el tipo "${name}"?\nLos hosts que lo usen pasarán a "Por defecto".`)) return;

    $('#typesMsg').text('Borrando…');
    const res = await fetch(`/api/types/${id}`, { method:'DELETE' });
    const data = await res.json();
    if (!data.ok) { $('#typesMsg').text(data.error || 'Error'); return; }
    $('#typesMsg').text('OK');
    await reloadTypes();
    hostsTable.draw(false);
  });


  // ══════════════════════════════════════════════════
  // ✅ AUTO-REFRESH — polling ligero vía /api/status
  // ══════════════════════════════════════════════════

  // ── Cross-module exports ──────────────────────────────
  window.hostsTable    = hostsTable;
  window.scansTable    = scansTable;
  window.hostModal     = hostModal;
  window.setLoading    = setLoading;
  window.setBtnLoading = setBtnLoading;
  window.accentColor   = accentColor;
  window.accent2Color  = accent2Color;
  window.cssVar        = cssVar;
  window.safeId        = safeId;
  window.loadScans      = loadScans;
  // showToast helper (used in multiple modules)
  window.esc = esc;
  window.macValid = macValid;
  window.reloadTypes = reloadTypes;
  window.askDelete = askDelete;
  window.doWol = doWol;
  // ── Abrir Config como Modal fullscreen (S17b) ────────────────
  window.openConfig = function() {
    const el = document.getElementById('configModal');
    if (!el) return;
    bootstrap.Modal.getOrCreateInstance(el).show();
  };

  window.loadScans = loadScans;
  window.showToast = function(msg, type) {
    const el = document.getElementById('toastBody');
    const toast = document.getElementById('notifToast');
    if (!el || !toast) return;
    el.textContent = msg;
    toast.className = toast.className.replace(/bg-\S+/, '');
    if (type === 'success') toast.classList.add('bg-success');
    else if (type === 'danger') toast.classList.add('bg-danger');
    else if (type === 'warning') toast.classList.add('bg-warning');
    bootstrap.Toast.getOrCreateInstance(toast).show();
  };


  // ── Magic bubble nav ──────────────────────────────────────────────────────
  function moveBubble(tabEl) {
    const ul = document.getElementById('viewTabs');
    if (!ul || !tabEl) return;
    const ulRect   = ul.getBoundingClientRect();
    const tabRect  = tabEl.getBoundingClientRect();
    const scrollLeft = ul.scrollLeft || 0;
    let bubble = ul.querySelector('.nav-bubble');
    if (!bubble) {
      bubble = document.createElement('span');
      bubble.className = 'nav-bubble';
      bubble.style.cssText = [
        'position:absolute',
        'top:4px',
        'height:calc(100% - 8px)',
        'border-radius:10px',
        'z-index:0',
        'pointer-events:none',
        'transition:left .32s cubic-bezier(.34,1.56,.64,1),width .32s cubic-bezier(.34,1.56,.64,1),background .3s ease,box-shadow .3s ease'
      ].join(';');
      ul.insertBefore(bubble, ul.firstChild);
    }
    const styles    = getComputedStyle(document.documentElement);
    const accent    = styles.getPropertyValue('--accent').trim()     || '#4dffb5';
    const accentRgb = styles.getPropertyValue('--accent-rgb').trim() || '77,255,181';
    bubble.style.left       = (tabRect.left - ulRect.left + scrollLeft) + 'px';
    bubble.style.width      = tabRect.width + 'px';
    bubble.style.background = accent;
    bubble.style.boxShadow  = `0 0 16px rgba(${accentRgb},.45),0 2px 8px rgba(0,0,0,.3)`;
  }
  window.moveBubble = moveBubble;

  // Init + event wiring
  setTimeout(() => {
    const active = document.querySelector('#viewTabs .nav-link.active');
    if (active) moveBubble(active);
  }, 80);

  document.getElementById('viewTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.nav-link');
    if (tab) setTimeout(() => moveBubble(tab), 10); // after Bootstrap adds .active
  });

  document.addEventListener('shown.bs.tab', e => {
    if (e.target.closest('#viewTabs')) {
      moveBubble(e.target);
      // ── Tab persistence: guardar tab activo en localStorage ──
      const tabId = e.target.id;
      if (tabId) localStorage.setItem('auditor-last-tab', tabId);
    }
  });

  // ── Tab persistence: restaurar tab al cargar ──────────────
  (function restoreLastTab() {
    // En móvil (< 768px) siempre arrancar en Dashboard — es la vista más útil
    if (window.innerWidth < 768) {
      const dashTab = document.getElementById('dashboard-tab');
      if (dashTab && !dashTab.classList.contains('active')) {
        try { bootstrap.Tab.getOrCreateInstance(dashTab).show(); } catch(_) {}
      }
      if (typeof window.syncFiltersBar === 'function') setTimeout(window.syncFiltersBar, 100);
      return;
    }
    const savedId = localStorage.getItem('auditor-last-tab');
    if (!savedId) return;
    const tabEl = document.getElementById(savedId);
    if (tabEl && !tabEl.classList.contains('active')) {
      try {
        bootstrap.Tab.getOrCreateInstance(tabEl).show();
      } catch (e) { /* ignora si Bootstrap no está listo aún */ }
    }
  })();

  window.addEventListener('resize', () => {
    const active = document.querySelector('#viewTabs .nav-link.active');
    if (active) moveBubble(active);
  });

  // ══════════════════════════════════════════════════
  // 🚀 PREFETCH ORQUESTADOR (S19)
  // Lanza todas las peticiones en paralelo al cargar.
  // Cada módulo consume window._prefetch[key] al abrir su tab
  // y renderiza instantáneamente sin spinner.
  // ══════════════════════════════════════════════════
  window._prefetch = {};
  (function prefetchAll() {
    const apis = [
      { key: 'scripts',  url: '/api/scripts/status' },
      { key: 'hosts',    url: '/api/hosts' },
      { key: 'scans',    url: '/api/scans' },
      { key: 'services', url: '/api/services' },
      { key: 'quality',  url: '/api/quality/targets' },
      { key: 'alerts',   url: '/api/alerts' },
      { key: 'dashboard',url: '/api/status' },
    ];
    apis.forEach(({ key, url }) => {
      fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) window._prefetch[key] = data; })
        .catch(() => {});  // silencioso: fallo no bloquea nada
    });
  })();

  // ══════════════════════════════════════════════════
  // 📱 MOBILE VIEW TOGGLE — Hosts: tarjeta ↔ tabla
  // ══════════════════════════════════════════════════
  (function initMobileViewToggle() {
    const STORAGE_KEY = 'auditor-mobile-view';
    const btn   = document.getElementById('mobileViewToggle');
    const icon  = document.getElementById('mobileViewIcon');
    const label = document.getElementById('mobileViewLabel');
    if (!btn) return;

    // Restaurar preferencia guardada
    const saved = localStorage.getItem(STORAGE_KEY) || 'card'; // default: tarjeta
    applyMobileView(saved, false);

    btn.addEventListener('click', function () {
      const current = document.body.classList.contains('mobile-table-view') ? 'table' : 'card';
      const next = current === 'card' ? 'table' : 'card';
      applyMobileView(next, true);
      localStorage.setItem(STORAGE_KEY, next);
    });

    function applyMobileView(mode, animate) {
      if (mode === 'table') {
        document.body.classList.add('mobile-table-view');
        icon.className  = 'bi bi-grid-3x3-gap';
        label.textContent = 'Fichas';
        if (animate) btn.classList.add('btn-info'); else btn.classList.remove('btn-info');
      } else {
        document.body.classList.remove('mobile-table-view');
        icon.className  = 'bi bi-table';
        label.textContent = 'Tabla';
        btn.classList.remove('btn-info');
      }
      // Forzar redraw de DataTable para que recalcule columnas
      if (window.hostsTable) {
        setTimeout(() => window.hostsTable.columns.adjust().draw(false), 50);
      }
    }
  })();


  // ══════════════════════════════════════════════════
  // Calidad — carga básica de settings + interfaz
  // ══════════════════════════════════════════════════
  (function initQualityConfig() {
    const ifaceSel = document.getElementById('qualityInterface');
    const detectBtn = document.getElementById('qualityDetectInterfaces');
    const saveBtn = document.getElementById('qualitySaveSettings');
    if (!ifaceSel || !saveBtn) return;

    async function loadInterfaces(selected = '') {
      try {
        const data = await fetch('/api/quality/interfaces').then(r => r.json());
        const items = data.interfaces || [];
        ifaceSel.innerHTML = '<option value="">— automática —</option>' + items.map(i => {
          const addrs = Array.isArray(i.addrs) && i.addrs.length ? ` (${i.addrs.join(', ')})` : '';
          const sel = selected && selected === i.name ? ' selected' : '';
          return `<option value="${i.name}"${sel}>${i.name}${addrs}</option>`;
        }).join('');
        if (selected && !items.find(i => i.name === selected)) {
          ifaceSel.insertAdjacentHTML('beforeend', `<option value="${selected}" selected>${selected}</option>`);
        }
      } catch (e) {
        console.error('quality loadInterfaces:', e);
      }
    }

    async function loadSettings() {
      try {
        const data = await fetch('/api/quality/settings').then(r => r.json());
        const s = data.settings || {};
        const enabled = !!Number(s.enabled ?? 0);
        const threshold = s.alert_threshold_pct ?? 200;
        const cooldown = s.alert_cooldown_minutes ?? 30;
        const quietStart = s.quiet_start || '';
        const quietEnd = s.quiet_end || '';
        const qualityInterface = s.quality_interface || '';

        const e1 = document.getElementById('qualityEnabled'); if (e1) e1.checked = enabled;
        const e2 = document.getElementById('qualityThreshold'); if (e2) e2.value = threshold;
        const e3 = document.getElementById('qualityCooldown'); if (e3) e3.value = cooldown;
        const e4 = document.getElementById('qualityQuietStart'); if (e4) e4.value = quietStart;
        const e5 = document.getElementById('qualityQuietEnd'); if (e5) e5.value = quietEnd;
        await loadInterfaces(qualityInterface);
      } catch (e) {
        console.error('quality loadSettings:', e);
      }
    }

    detectBtn?.addEventListener('click', async function() {
      const icon = this.querySelector('i');
      icon?.classList.add('spin');
      await loadInterfaces(ifaceSel.value || '');
      icon?.classList.remove('spin');
    });

    saveBtn.addEventListener('click', async function() {
      const payload = {
        enabled: document.getElementById('qualityEnabled')?.checked ? 1 : 0,
        alert_threshold_pct: Number(document.getElementById('qualityThreshold')?.value || 200),
        alert_cooldown_minutes: Number(document.getElementById('qualityCooldown')?.value || 30),
        quiet_start: document.getElementById('qualityQuietStart')?.value || '',
        quiet_end: document.getElementById('qualityQuietEnd')?.value || '',
        quality_interface: ifaceSel.value || '',
      };
      const oldHtml = this.innerHTML;
      this.disabled = true;
      this.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Guardando';
      try {
        const res = await fetch('/api/quality/settings', {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error guardando calidad');
      } catch (e) {
        console.error('quality save:', e);
      } finally {
        this.disabled = false;
        this.innerHTML = oldHtml;
      }
    });

    loadSettings();
  })();


});