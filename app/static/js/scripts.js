/**
 * scripts.js — Pestaña Procesos Programados
 * Sesión 12: vista fichas/tabla, log en vivo, docs integradas
 * Sesión 13: botón "Analizar con IA" con Ollama
 * Sesión 14: proveedor IA desde Config · fix campos reales .status.json · duración legible
 * Sesión 19: prefetch cache — muestra datos inmediatamente si ya fueron precargados
 */

$(function () {

  // ─────────────────────────────────────────────────
  // Estado
  // ─────────────────────────────────────────────────
  let spData         = [];
  let spViewMode     = 'cards';
  let spRefreshTimer = null;
  let spLogTimer     = null;
  let ollamaReady    = null;

  // ─────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────

  /** Convierte segundos en texto legible: 13840 → "3h 50m" */
  function humanDuration(secs) {
    if (secs == null || secs === '' || isNaN(secs)) return '—';
    secs = parseInt(secs, 10);
    if (secs < 60)   return secs + 's';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    let r = h + 'h';
    if (m) r += ' ' + m + 'm';
    if (s && h < 10) r += ' ' + s + 's';
    return r;
  }

  /** Formatea fecha/hora local desde string "YYYY-MM-DD HH:MM:SS" o ISO */
  function fmtDate(val) {
    if (!val || val === '—') return '—';
    try {
      // El formato del .status.json es "2026-03-10 02:00:01" (sin T, sin Z → hora local)
      const d = new Date(val.replace(' ', 'T'));
      if (isNaN(d)) return val;
      return d.toLocaleString('es-ES', {
        day:'2-digit', month:'2-digit', year:'2-digit',
        hour:'2-digit', minute:'2-digit'
      });
    } catch(_) { return val; }
  }

  function spStateBadge(state) {
    const map = {
      ok:      '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>OK</span>',
      running: '<span class="badge bg-primary"><i class="bi bi-arrow-repeat sp-spin me-1"></i>Ejecutando</span>',
      error:   '<span class="badge bg-danger"><i class="bi bi-exclamation-triangle me-1"></i>Error</span>',
      stalled: '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>Stalled</span>',
      missed:  '<span class="badge bg-warning text-dark"><i class="bi bi-clock-history me-1"></i>Missed</span>',
    };
    return map[state] || '<span class="badge bg-secondary">Desconocido</span>';
  }

  function spAIBtn(name, state, tableMode) {
    const disabled = ollamaReady === false;
    const title    = disabled ? 'IA no disponible' : 'Analizar con IA';
    if (tableMode) {
      return `<button class="btn btn-sm btn-outline-info sp-btn-ai" data-name="${name}"
                      title="${title}" ${disabled ? 'disabled' : ''}>
                <i class="bi bi-robot"></i>
              </button>`;
    }
    return `<button class="btn btn-sm btn-outline-info sp-btn-ai" data-name="${name}"
                    title="${title}" ${disabled ? 'disabled' : ''}>
              <i class="bi bi-robot me-1"></i>Analizar con IA
            </button>`;
  }

  // ─────────────────────────────────────────────────
  // Init al activar la pestaña
  // ─────────────────────────────────────────────────
  $(document).on('shown.bs.tab', 'button[data-bs-target="#scriptsView"]', function () {
    spLoad();
    spCheckOllama();
    spStartRefresh();
  });
  $(document).on('hidden.bs.tab', 'button[data-bs-target="#scriptsView"]', function () {
    spStopRefresh();
    spStopLog();
  });

  // ─────────────────────────────────────────────────
  // Carga de datos
  // ─────────────────────────────────────────────────
  function spLoad() {
    // ── Prefetch cache: si el orquestador ya tiene datos, renderizar inmediatamente ──
    const cached = window._prefetch?.scripts;
    if (cached) {
      spData = cached;
      spRenderKPIs(spData);
      spViewMode === 'cards' ? spRenderCards(spData) : spRenderTable(spData);
      $('#sp-last-refresh').text(new Date().toLocaleTimeString('es-ES'));
      $('#sp-error-banner').addClass('d-none');
      // Limpiar cache y refrescar en background para tener dato fresco
      delete window._prefetch.scripts;
      $.getJSON('/api/scripts/status').done(function(data) {
        spData = data || [];
        spRenderKPIs(spData);
        spViewMode === 'cards' ? spRenderCards(spData) : spRenderTable(spData);
        $('#sp-last-refresh').text(new Date().toLocaleTimeString('es-ES'));
      });
      return;
    }
    $.getJSON('/api/scripts/status')
      .done(function (data) {
        spData = data || [];
        spRenderKPIs(spData);
        spViewMode === 'cards' ? spRenderCards(spData) : spRenderTable(spData);
        $('#sp-last-refresh').text(new Date().toLocaleTimeString('es-ES'));
        $('#sp-error-banner').addClass('d-none');
      })
      .fail(function (xhr) {
        $('#sp-error-msg').text(xhr.statusText || 'Error desconocido');
        $('#sp-error-banner').removeClass('d-none');
      });
  }

  function spStartRefresh() {
    spStopRefresh();
    spRefreshTimer = setInterval(function () {
      if ($('#sp-ai-modal').hasClass('show')) return;
      spLoad();
    }, 30000);
  }
  function spStopRefresh() {
    if (spRefreshTimer) { clearInterval(spRefreshTimer); spRefreshTimer = null; }
  }

  // ─────────────────────────────────────────────────
  // KPIs
  // ─────────────────────────────────────────────────
  function spRenderKPIs(data) {
    $('#sp-kpi-total').text(data.length);
    $('#sp-kpi-ok').text(data.filter(s => s.state === 'ok').length);
    $('#sp-kpi-running').text(data.filter(s => s.state === 'running').length);
    const errCount = data.filter(s => s.state === 'error').length;
    $('#sp-kpi-errors').text(errCount);
    $('#sp-kpi-errors-card').toggleClass('border-danger', errCount > 0);
    $('#sp-kpi-missed').text(data.filter(s => s.state === 'stalled' || s.state === 'missed').length);
  }

  // ─────────────────────────────────────────────────
  // Vista fichas
  // ─────────────────────────────────────────────────
  function spRenderCards(data) {
    if (!data.length) {
      $('#sp-cards').html('<div class="col-12"><div class="alert alert-info">No se encontraron scripts monitorizados.</div></div>');
      return;
    }
    let html = '';
    data.forEach(function (s) {
      const lastRun  = fmtDate(s.start_time || s.last_run);
      const endTime  = fmtDate(s.end_time);
      const nextRun  = fmtDate(s.next_run);
      const duration = humanDuration(s.duration_seconds);
      const step     = s.step_label  || '';
      const progress = s.progress_pct != null ? s.progress_pct : null;
      const errors   = (s.errors || s.error_messages || []);
      const errHtml  = errors.length
        ? `<div class="alert alert-danger py-1 px-2 small mb-0 mt-1">${errors.join('<br>')}</div>` : '';

      // Color y etiqueta desde Config → Procesos
      const cfgColor  = s.cfg_color  || '';
      const cfgLabel  = s.cfg_label  || s.name;
      const accentStyle = cfgColor ? `border-left:4px solid ${cfgColor};` : '';
      const dotHtml   = cfgColor
        ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cfgColor};margin-right:5px;flex-shrink:0"></span>` : '';

      // Barra de progreso (solo si running o hay progress)
      let progressHtml = '';
      if (progress !== null) {
        const pct  = Math.min(100, Math.max(0, progress));
        const barColor = cfgColor && s.state !== 'error' ? cfgColor : (s.state === 'error' ? '' : '');
        const cls  = s.state === 'error' ? 'bg-danger' : (pct === 100 ? 'bg-success' : 'bg-primary');
        const barStyle = cfgColor && s.state !== 'error' ? `style="width:${pct}%;background:${cfgColor}"` : `style="width:${pct}%"`;
        progressHtml = `
          <div class="mt-1">
            <div class="d-flex justify-content-between small text-muted mb-1">
              <span>${step}</span><span>${pct}%</span>
            </div>
            <div class="progress" style="height:5px">
              <div class="progress-bar ${s.state === 'error' ? 'bg-danger' : ''}" ${barStyle}></div>
            </div>
          </div>`;
      }

      html += `
      <div class="col-12 col-md-6 col-xl-4 mb-3">
        <div class="card border-0 shadow-sm h-100" style="${accentStyle}">
          <div class="card-body d-flex flex-column gap-2">
            <div class="d-flex justify-content-between align-items-start gap-2">
              <h6 class="card-title mb-0 text-truncate font-monospace d-flex align-items-center" title="${s.name}">
                ${dotHtml}<i class="bi bi-terminal me-1"></i>${cfgLabel !== s.name ? cfgLabel : s.name}
              </h6>
              ${spStateBadge(s.state)}
            </div>
            <div class="small text-muted lh-lg">
              <div><i class="bi bi-play-circle me-1"></i>Inicio: <strong>${lastRun}</strong></div>
              <div><i class="bi bi-stop-circle me-1"></i>Fin: <strong>${endTime}</strong></div>
              <div><i class="bi bi-stopwatch me-1"></i>Duración: <strong>${duration}</strong></div>
              <div><i class="bi bi-clock me-1"></i>Próxima: <strong>${nextRun}</strong></div>
            </div>
            ${progressHtml}
            ${errHtml}
            <div class="d-flex gap-2 mt-auto flex-wrap">
              <button class="btn btn-sm btn-outline-secondary sp-btn-log" data-name="${s.name}">
                <i class="bi bi-file-text me-1"></i>Log
              </button>
              ${spAIBtn(s.name, s.state, false)}
            </div>
          </div>
        </div>
      </div>`;
    });
    $('#sp-cards').html(html);
  }

  // ─────────────────────────────────────────────────
  // Vista tabla
  // ─────────────────────────────────────────────────
  function spRenderTable(data) {
    if (!data.length) {
      $('#sp-cards').html('<div class="col-12"><div class="alert alert-info">No se encontraron scripts monitorizados.</div></div>');
      return;
    }
    let rows = '';
    data.forEach(function (s) {
      const lastRun  = fmtDate(s.start_time || s.last_run);
      const endTime  = fmtDate(s.end_time);
      const nextRun  = fmtDate(s.next_run);
      const duration = humanDuration(s.duration_seconds);
      const step     = s.step_label ? `<span class="text-muted" style="font-size:.75rem">${s.step_label}</span>` : '';
      const pct      = s.progress_pct != null ? `<span class="badge bg-secondary ms-1">${s.progress_pct}%</span>` : '';
      const cfgColor = s.cfg_color || '';
      const cfgLabel = s.cfg_label || s.name;
      const dotHtml  = cfgColor
        ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${cfgColor};margin-right:5px;flex-shrink:0;vertical-align:middle"></span>` : '';
      const rowStyle = cfgColor ? `style="border-left:3px solid ${cfgColor}"` : '';

      rows += `<tr ${rowStyle}>
        <td class="font-monospace small">${dotHtml}${cfgLabel !== s.name ? `<span title="${s.name}">${cfgLabel}</span>` : s.name}</td>
        <td>${spStateBadge(s.state)} ${step}${pct}</td>
        <td class="small">${lastRun}</td>
        <td class="small">${endTime}</td>
        <td class="small fw-semibold">${duration}</td>
        <td class="small">${nextRun}</td>
        <td>
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-outline-secondary sp-btn-log" data-name="${s.name}" title="Ver log">
              <i class="bi bi-file-text"></i>
            </button>
            ${spAIBtn(s.name, s.state, true)}
          </div>
        </td>
      </tr>`;
    });
    $('#sp-cards').html(`
      <div class="col-12">
        <div class="table-responsive">
          <table class="table table-hover align-middle small" id="spTable">
            <thead><tr>
              <th>Script</th><th>Estado</th><th>Inicio</th><th>Fin</th>
              <th>Duración</th><th>Próxima</th><th>Acciones</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`);
  }

  // ─────────────────────────────────────────────────
  // Toggle vista
  // ─────────────────────────────────────────────────
  $(document).on('click', '#sp-btn-cards', function () {
    spViewMode = 'cards';
    $('#sp-btn-cards').addClass('active');
    $('#sp-btn-table').removeClass('active');
    spRenderCards(spData);
  });
  $(document).on('click', '#sp-btn-table', function () {
    spViewMode = 'table';
    $('#sp-btn-table').addClass('active');
    $('#sp-btn-cards').removeClass('active');
    spRenderTable(spData);
  });
  $(document).on('click', '#sp-btn-refresh', function () {
    spLoad();
    spCheckOllama();
  });

  // ─────────────────────────────────────────────────
  // Log en vivo
  // ─────────────────────────────────────────────────
  $(document).on('click', '.sp-btn-log', function () {
    spOpenLog($(this).data('name'));
  });

  function spOpenLog(name) {
    spStopLog();
    $('#sp-livelog-title').text(name);
    $('#sp-livelog-status').html('');
    $('#sp-livelog-body').text('Cargando…');
    $('#sp-livelog-panel').removeClass('d-none');
    spFetchLog(name);

    const script = spData.find(s => s.name === name);
    if (script && script.state === 'running') {
      $('#sp-livelog-status').html(' <span class="badge bg-primary"><i class="bi bi-circle-fill" style="font-size:.5rem"></i> vivo</span>');
      spLogTimer = setInterval(function () { spFetchLog(name); }, 5000);
    }
  }

  function spFetchLog(name) {
    // Primero intentar usar last_log_lines del status (ya cargado en memoria)
    const script = spData.find(s => s.name === name);
    if (script && script.last_log_lines && script.last_log_lines.length) {
      const el = document.getElementById('sp-livelog-body');
      el.textContent = script.last_log_lines.join('\n');
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Si no, pedir al backend
    $.getJSON('/api/scripts/log/' + encodeURIComponent(name) + '?lines=100')
      .done(function (data) {
        const el = document.getElementById('sp-livelog-body');
        el.textContent = data.lines || '(log vacío)';
        el.scrollTop = el.scrollHeight;
        if (script && script.state !== 'running') spStopLog();
      })
      .fail(function () {
        $('#sp-livelog-body').text('Error al cargar el log.');
        spStopLog();
      });
  }

  $(document).on('click', '#sp-livelog-close', function () {
    spStopLog();
    $('#sp-livelog-panel').addClass('d-none');
  });

  function spStopLog() {
    if (spLogTimer) { clearInterval(spLogTimer); spLogTimer = null; }
    $('#sp-livelog-status').html('');
  }

  // ─────────────────────────────────────────────────
  // Ollama/IA — badge de estado
  // ─────────────────────────────────────────────────
  function spCheckOllama() {
    $.getJSON('/api/scripts/ollama/status')
      .done(function (data) {
        ollamaReady = data.available && data.model_ready;
        spUpdateOllamaBadge(data);
      })
      .fail(function () {
        ollamaReady = false;
        spUpdateOllamaBadge({ available: false });
      });
  }

  function spUpdateOllamaBadge(data) {
    let html;
    const provider = (data.provider || 'ia').toUpperCase();
    if (data.available && data.model_ready) {
      html = `<span class="badge bg-success" title="${data.model}"><i class="bi bi-robot me-1"></i>${provider} lista</span>`;
    } else if (data.available && !data.model_ready) {
      html = `<span class="badge bg-warning text-dark"><i class="bi bi-robot me-1"></i>Modelo no cargado</span>`;
    } else {
      html = `<span class="badge bg-secondary" title="${data.error || ''}"><i class="bi bi-robot me-1"></i>IA no disponible</span>`;
    }
    $('#sp-ollama-badge').html(html);
  }

  // ─────────────────────────────────────────────────
  // Análisis IA
  // ─────────────────────────────────────────────────
  $(document).on('click', '.sp-btn-ai', function () {
    spOpenAIModal($(this).data('name'));
  });

  function spOpenAIModal(name) {
    $('#sp-ai-script-name').text(name);
    $('#sp-ai-loading').removeClass('d-none');
    $('#sp-ai-result').addClass('d-none').html('');
    $('#sp-ai-error').addClass('d-none');
    $('#sp-ai-error-msg').text('');
    $('#sp-ai-footer').text('');

    new bootstrap.Modal(document.getElementById('sp-ai-modal')).show();

    $.ajax({
      url:     '/api/scripts/analyze/' + encodeURIComponent(name),
      method:  'POST',
      timeout: 135000,
    })
    .done(function (data) {
      $('#sp-ai-loading').addClass('d-none');
      $('#sp-ai-result').removeClass('d-none').html(spRenderMD(data.analysis || '(Sin respuesta)'));
      const ts = data.analyzed_at ? new Date(data.analyzed_at).toLocaleString('es-ES') : '';
      const prov = (data.provider || '').toUpperCase();
      $('#sp-ai-footer').text(`${prov} · ${data.model} · ${ts}`);
    })
    .fail(function (xhr) {
      $('#sp-ai-loading').addClass('d-none');
      let msg = 'Error al conectar con el análisis IA.';
      try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (_) {}
      $('#sp-ai-error-msg').text(msg);
      $('#sp-ai-error').removeClass('d-none');
    });
  }

  function spRenderMD(text) {
    text = text.replace(/^## (.+)$/gm, '<h6 class="ai-section-title">$1</h6>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text.split(/\n\n+/)
      .map(p => p.trim()).filter(Boolean)
      .map(p => p.startsWith('<h6') ? p : '<p class="mb-2">' + p.replace(/\n/g, '<br>') + '</p>')
      .join('');
  }

  // ─────────────────────────────────────────────────
  // Modal Ayuda
  // ─────────────────────────────────────────────────
  $(document).on('click', '#sp-btn-help', function () {
    spLoadDocs();
    new bootstrap.Modal(document.getElementById('sp-help-modal')).show();
  });

  function spLoadDocs() {
    $('#sp-help-tabs').html('<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>');
    $('#sp-help-panes').html('');
    $.getJSON('/api/scripts/docs')
      .done(function (docs) {
        if (!docs.length) {
          $('#sp-help-tabs').html('<div class="text-muted small px-2">Sin docs.</div>');
          return;
        }
        let tabs = '', panes = '';
        docs.forEach(function (doc, i) {
          const active = i === 0 ? 'active' : '';
          const show   = i === 0 ? 'show active' : '';
          const id     = 'sp-doc-' + i;
          tabs  += `<button class="nav-link ${active} text-start" data-bs-toggle="tab"
                            data-bs-target="#${id}" type="button"
                            style="font-size:.82rem">${doc.name}</button>`;
          panes += `<div class="tab-pane fade ${show} p-3" id="${id}">
                      <div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></div>
                    </div>`;
        });
        $('#sp-help-tabs').html(tabs);
        $('#sp-help-panes').html(panes);
        spLoadDoc(docs[0].name, '#sp-doc-0');
        docs.forEach(function (doc, i) {
          if (i === 0) return;
          $('[data-bs-target="#sp-doc-' + i + '"]').one('click', function () {
            spLoadDoc(doc.name, '#sp-doc-' + i);
          });
        });
      });
  }

  function spLoadDoc(filename, paneId) {
    $.getJSON('/api/scripts/doc/' + encodeURIComponent(filename))
      .done(function (data) {
        $(paneId).html('<div class="small lh-lg">' + spRenderMD(data.content || '') + '</div>');
      })
      .fail(function () {
        $(paneId).html('<div class="alert alert-warning">Error cargando documento.</div>');
      });
  }


  // ─────────────────────────────────────────────────────────────────────────
  // Informe Diario IA de Red
  // ─────────────────────────────────────────────────────────────────────────

  $(document).on('click', '#sp-btn-daily-report', function () {
    const modal = new bootstrap.Modal(document.getElementById('sp-daily-report-modal'));
    modal.show();
    spDailyReportLoad();
    spDailyReportLoadHistory();
  });

  $(document).on('click', '#sp-dr-btn-generate', function () {
    spDailyReportGenerate(null);
  });

  $(document).on('change', '#sp-dr-history-select', function () {
    const date = $(this).val();
    if (date) spDailyReportLoadDate(date);
  });

  function spDailyReportLoad() {
    $.getJSON('/api/daily-report/latest')
      .done(function (data) {
        if (data.analysis) {
          spDailyReportRender(data);
        } else {
          $('#sp-dr-empty').removeClass('d-none');
          $('#sp-dr-content').addClass('d-none');
          $('#sp-dr-meta').addClass('d-none');
          $('#sp-dr-date').text('—');
        }
      })
      .fail(function () {
        $('#sp-dr-empty').removeClass('d-none');
      });
  }

  function spDailyReportLoadDate(date) {
    $('#sp-dr-empty').addClass('d-none');
    $('#sp-dr-content').addClass('d-none');
    $('#sp-dr-loading').removeClass('d-none');
    $.getJSON('/api/daily-report/history?days=90')
      .done(function (history) {
        // fetch the full report for this date
        $.ajax({
          url: '/api/daily-report/generate',
          method: 'POST',
          contentType: 'application/json',
          data: JSON.stringify({ date: date }),
          timeout: 120000,
        })
        .done(function (data) {
          spDailyReportRender(data);
        })
        .fail(function (xhr) {
          $('#sp-dr-loading').addClass('d-none');
          $('#sp-dr-empty').removeClass('d-none');
        });
      });
  }

  function spDailyReportGenerate(date) {
    $('#sp-dr-empty').addClass('d-none');
    $('#sp-dr-content').addClass('d-none');
    $('#sp-dr-meta').addClass('d-none');
    $('#sp-dr-loading').removeClass('d-none');
    setBtnLoading('#sp-dr-btn-generate', true);

    $.ajax({
      url: '/api/daily-report/generate' + (date ? '?date=' + date : ''),
      method: 'POST',
      timeout: 120000,
    })
    .done(function (data) {
      spDailyReportRender(data);
      spDailyReportLoadHistory();
    })
    .fail(function (xhr) {
      $('#sp-dr-loading').addClass('d-none');
      const msg = xhr.responseJSON ? (xhr.responseJSON.detail || 'Error desconocido') : 'Error generando informe';
      $('#sp-dr-empty').removeClass('d-none').find('small').text(msg);
    })
    .always(function () {
      setBtnLoading('#sp-dr-btn-generate', false);
    });
  }

  function spDailyReportRender(data) {
    $('#sp-dr-loading').addClass('d-none');
    $('#sp-dr-empty').addClass('d-none');
    $('#sp-dr-date').text(data.report_date || '—');

    // Meta KPIs
    const meta = data.meta || {};
    if (Object.keys(meta).length) {
      const scriptsOk    = meta.scripts_ok    != null ? meta.scripts_ok    : '?';
      const scriptsTotal = meta.scripts_count != null ? meta.scripts_count : '?';
      const scriptsColor = (meta.scripts_ok === meta.scripts_count && meta.scripts_count > 0)
                           ? 'text-success' : 'text-warning';
      $('#sp-dr-online').text(meta.online_today_count != null ? meta.online_today_count : '?');
      $('#sp-dr-scans').text(meta.scans_count != null ? meta.scans_count : '?');
      $('#sp-dr-new').text(meta.new_devices != null ? meta.new_devices : '0');
      $('#sp-dr-scripts')
        .text(scriptsOk + ' / ' + scriptsTotal)
        .removeClass('text-success text-warning text-danger')
        .addClass(scriptsColor);
      $('#sp-dr-meta').removeClass('d-none');
    }

    // Análisis
    $('#sp-dr-analysis').html(spRenderMD(data.analysis || '(Sin análisis)'));
    $('#sp-dr-content').removeClass('d-none');

    // Footer
    const genAt  = data.generated_at ? new Date(data.generated_at).toLocaleString('es-ES') : '';
    const prov   = (data.provider || '') + (data.model ? ' · ' + data.model : '');
    $('#sp-dr-footer').text((prov ? prov + ' · ' : '') + (genAt ? 'Generado ' + genAt : ''));
  }

  function spDailyReportLoadHistory() {
    $.getJSON('/api/daily-report/history?days=14')
      .done(function (history) {
        const $sel = $('#sp-dr-history-select');
        $sel.find('option:not(:first)').remove();
        history.forEach(function (r) {
          const meta    = r.meta || {};
          const label   = r.report_date + ' (' + (meta.online_today_count || '?') + ' online)';
          $sel.append($('<option>').val(r.report_date).text(label));
        });
      });
  }


});