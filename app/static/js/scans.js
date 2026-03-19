// ════════════════════════════════════════════════════════
//  scans.js — Auditor IPs · Ejecuciones (Scans)
//  Tabla scans, diff visual, notas inline, scan manual
// ════════════════════════════════════════════════════════
$(function() {
  // ══════════════════════════════════════════════════════════
  // SCAN DIFF — enriquecer tabla de scans con diff visual
  // ══════════════════════════════════════════════════════════
  const _origLoadScans = loadScans;
  window.loadScansWithDiff = async function loadScansWithDiff() {
    setLoading(true);
    $('#scanStatus').text('');
    try {
      const res  = await fetch('/api/scans');
      const rows = await res.json();
      const tbody = [];
      for (const r of (rows || [])) {
        const appeared    = (r.appeared    || []).map(h => `<span class="diff-badge new">+${esc(h.name||h.ip)}</span>`).join(' ');
        const disappeared = (r.disappeared || []).map(h => `<span class="diff-badge gone">-${esc(h.name||h.ip)}</span>`).join(' ');
        const diffCell = [appeared, disappeared].filter(Boolean).join(' ') || '—';
        const hasNote  = r.notes && r.notes.trim();
        const noteBtn  = `<button class="btn btn-sm scan-note-btn ${hasNote ? 'text-warning' : 'text-muted'}" data-id="${r.id}" data-note="${esc(r.notes||'')}" title="${esc(r.notes||'Sin nota — click para añadir')}"><span>${hasNote ? '💬' : '📝'}</span></button>`;
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
          diffCell,
          noteBtn,
        ]);
      }
      scansTable.clear();
      scansTable.rows.add(tbody).draw();
      setLoading(false);
      $('#scanStatus').text('');
      if (typeof buildChart === 'function') buildChart(rows || []);
    } catch (e) {
      setLoading(false);
      $('#scanStatus').text('Error cargando ejecuciones: ' + e.message);
    }
  }
  // Override global loadScans
  window.loadScans = loadScansWithDiff;
  document.getElementById('scans-tab').removeEventListener('shown.bs.tab', _origLoadScans);
  document.getElementById('scans-tab').addEventListener('shown.bs.tab', async function() {
    await loadScansWithDiff();
    setTimeout(() => { if (window._activityChart) window._activityChart.resize(); }, 100);
  });
  $('#refreshScans').off('click').on('click', loadScansWithDiff);

  // ══════════════════════════════════════════════════════════
  // TEMA DE COLOR (accent swatches)
  // ══════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════
  // INLINE HOST NAME EDITING — double-click on name cell
  // ══════════════════════════════════════════════════════════
  $(document).on('dblclick', '.host-name-editable', function(e) {
    e.stopPropagation();
    const $el  = $(this);
    const ip   = $el.data('ip');
    if ($el.hasClass('editing')) return;
    // Usar data-manual como fuente de verdad (puede ser '' si no tiene nombre manual)
    const currentManual = $el.data('manual') !== undefined ? String($el.data('manual')) : '';
    $el.addClass('editing').attr('contenteditable', 'true')
       .attr('placeholder', 'Escribir nombre…').text(currentManual).focus();
    const range = document.createRange();
    range.selectNodeContents(this);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    async function saveInline() {
      const newName = $el.text().trim();
      $el.removeClass('editing').removeAttr('contenteditable').removeAttr('placeholder');
      if (newName === currentManual) {
        if (!currentManual) {
          const fallback = $el.closest('tr').find('.sub-name').text() || ip;
          $el.text(fallback);
        }
        return;
      }
      try {
        const det = await (await fetch(`/api/hosts/${encodeURIComponent(ip)}/detail`)).json();
        if (!det.ok) { showToast('Error al obtener datos del host', 'danger'); return; }
        const h = det.host;
        const res = await fetch(`/api/hosts/${encodeURIComponent(ip)}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ manual_name: newName, type_id: h.type_id || null, notes: h.notes || '' })
        });
        if ((await res.json()).ok) {
          const fallback = h.nmap_hostname || h.dns_name || '';
          const displayName = newName || fallback || ip;
          $el.data('manual', newName).text(displayName);
          const $td = $el.closest('td');
          $td.find('.sub-name').remove();
          if (newName && fallback) $td.append(`<div class="sub-name">${$('<span>').text(fallback).html()}</div>`);
          $el.closest('tr').find('td.manual-name-hidden').text(newName);
          if (hostsTable) hostsTable.draw(false);
          showToast(`✏️ Nombre actualizado: ${newName || '(borrado)'}`, 'success');
        } else {
          $el.text(currentManual || h.nmap_hostname || h.dns_name || ip);
        }
      } catch(err) {
        $el.text(currentManual);
        showToast('Error al guardar nombre', 'danger');
      }
    }

    $el.on('blur.inline', function() {
      $el.off('blur.inline keydown.inline');
      saveInline();
    }).on('keydown.inline', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); this.blur(); }
      if (ev.key === 'Escape') {
        $el.off('blur.inline keydown.inline').removeClass('editing').removeAttr('contenteditable').removeAttr('placeholder');
        $el.text(currentManual || $el.closest('tr').find('td.manual-name-hidden').text() || ip);
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // IP RANGE SEARCH
  // ══════════════════════════════════════════════════════════

}); // end $(function) — scans.js
