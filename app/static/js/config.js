// ════════════════════════════════════════════════════════
//  config.js — Auditor IPs · Configuración
//  Settings, multi-CIDR chips, backup, tipos, router SSH,
//  push notifications, búsqueda global, acento color, VAPID
// ════════════════════════════════════════════════════════
$(function() {

  // ══════════════════════════════════════════════════════════
  // MULTI-CIDR CHIP UI
  // ══════════════════════════════════════════════════════════
  let _cidrList = [];

  function _isValidCidr(v) {
    return /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v.trim());
  }

  function _renderCidrChips(list) {
    _cidrList = list.filter(Boolean);
    const wrap = document.getElementById('cidrChipsList');
    if (!wrap) return;
    wrap.innerHTML = '';
    _cidrList.forEach((cidr, i) => {
      const chip = document.createElement('span');
      chip.className = 'cidr-chip ' + (_isValidCidr(cidr) ? 'valid' : 'invalid');
      chip.innerHTML = `${cidr} <span class="remove-chip" data-i="${i}" title="Eliminar">×</span>`;
      wrap.appendChild(chip);
    });
  }

  function _getCidrValue() {
    return _cidrList.join(',');
  }

  function _addCidrChip(val) {
    const parts = val.split(',').map(x => x.trim()).filter(Boolean);
    parts.forEach(p => { if (p && !_cidrList.includes(p)) _cidrList.push(p); });
    _renderCidrChips(_cidrList);
    const msg = document.getElementById('cidrValidationMsg');
    if (msg) {
      const invalid = _cidrList.filter(c => !_isValidCidr(c));
      msg.textContent = invalid.length ? `⚠️ CIDR inválido: ${invalid.join(', ')}` : '';
      msg.style.color = invalid.length ? '#ff7878' : '#4dffb5';
    }
  }

  // Chip: Enter or comma adds
  $(document).on('keydown', '#cidrNewInput', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = $(this).val().trim().replace(/,$/, '');
      if (val) { _addCidrChip(val); $(this).val(''); }
    } else if (e.key === 'Backspace' && !$(this).val() && _cidrList.length) {
      _cidrList.pop();
      _renderCidrChips(_cidrList);
    }
  });

  // Chip: paste handling
  $(document).on('paste', '#cidrNewInput', function(e) {
    setTimeout(() => {
      const val = $(this).val().trim();
      if (val) { _addCidrChip(val); $(this).val(''); }
    }, 10);
  });

  // Chip: remove button
  $(document).on('click', '.remove-chip', function(e) {
    e.stopPropagation();
    const i = parseInt($(this).data('i'));
    _cidrList.splice(i, 1);
    _renderCidrChips(_cidrList);
  });

  let _cfgData = {};
  let _netAutosaveTimer = null;

  function _renderTopbarRanges(primaryList = [], secondaryList = []) {
    // El topbarCidrPill lo renderiza Jinja2 — no sobreescribir si ya tiene contenido
    const el = document.getElementById('topbarCidrPill');
    if (!el) return;
    if (el.querySelector('div')) return; // ya tiene chips Jinja2, no tocar
    // Fallback solo si el pill estaba vacío (primer arranque sin recarga)
    const ranges = [...primaryList.filter(Boolean), ...secondaryList.filter(Boolean)];
    if (!ranges.length) return;
    el.innerHTML = ranges.map(r =>
      `<div style="display:flex;align-items:center;gap:5px;white-space:nowrap">` +
      `<i class="bi bi-broadcast" style="color:var(--accent);font-size:.75rem;flex-shrink:0"></i>` +
      `<span class="mono" style="font-size:.78rem;font-weight:600">${_esc(r)}</span></div>`
    ).join('');
  }

  function _refreshTopbarRangesFromState(extraSecondary = null) {
    const primary = _getCidrValue().split(',').map(x => x.trim()).filter(Boolean);
    const secondary = Array.isArray(extraSecondary)
      ? extraSecondary
      : $('#cfgNetTbody .net-cidr-inp').map((_, el) => ($(el).val() || '').trim()).get().filter(Boolean);
    _renderTopbarRanges(primary, secondary);
  }

  // Humanize seconds
  window.humanSeconds = function humanSeconds(s) {
    s = parseInt(s) || 0;
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s/60) + ' min';
    return (s/3600).toFixed(1).replace('.0','') + ' h';
  }

  // Load settings from API and populate form
  window.loadCfg = async function loadCfg() {
    try {
      const [settRes, netRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/config/networks').then(r => r.json()).catch(() => ({networks:[]}))
      ]);
      if (!settRes.ok) {
        console.error('[loadCfg] HTTP error:', settRes.status);
        if (typeof showToast === 'function') showToast('Error cargando configuración (' + settRes.status + ')', 'danger');
        return;
      }
      const data = await settRes.json();
      if (!data.ok) {
        console.error('[loadCfg] API error:', data);
        if (typeof showToast === 'function') showToast('Error en API de configuración', 'danger');
        return;
      }
      _cfgData = data.settings;
      populateCfgForm(_cfgData);
      applyHiddenTabs(_cfgData.hidden_tabs || '');
      // Show secondary networks in scanner panel
      const nets = (netRes.networks || []).filter(n => n.enabled && n.cidr);
      const row  = document.getElementById('scannerSecNetsRow');
      const list = document.getElementById('scannerSecNetsList');
      if (row && list) {
        if (nets.length) {
          list.innerHTML = nets.map(n =>
            `<span style="background:rgba(77,255,181,0.12);border:1px solid rgba(77,255,181,0.3);border-radius:6px;padding:2px 8px;font-size:.82rem;font-family:monospace">${_esc(n.cidr)}${n.label ? ` <span style="opacity:.6">${_esc(n.label)}</span>` : ''}</span>`
          ).join('');
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      }
    } catch(e) { console.error('loadCfg:', e); }
  }

  function populateCfgForm(s) {
    // Multi-CIDR chip UI
    _renderCidrChips((s.scan_cidr || '').split(',').map(x => x.trim()).filter(Boolean));
    $('#cfgInterval').val(s.scan_interval || 900);
    $('#cfgIntervalHuman').text(humanSeconds(s.scan_interval));
    $('#cfgDns').val(s.dns_server || '');
    $('#cfgDiscord').val(s.discord_webhook || '');
    $('#cfgRetention').val(s.retention_days || 14);
    $('#cfgWolPort').val(s.wol_port || 9);
    $('#cfgWolBroadcast').val(s.wol_broadcast || '');
    $('#cfgTitle').val(s.page_title || 'Auditor IPs');
    $('#cfgTz').val(s.app_tz || 'Europe/Madrid');
    // Notificaciones Discord — default '1' si no está en BD
    const _notifyDef = (val, def1) => (val == null || val === '') ? def1 : val;
    $('#cfgNotifyNew').prop('checked',     _notifyDef(s.notify_new,          '1') === '1');
    $('#cfgNotifyOnline').prop('checked',  _notifyDef(s.notify_online,       '1') === '1');
    $('#cfgNotifyOffline').prop('checked', _notifyDef(s.notify_offline,      '1') === '1');
    $('#cfgNotifyMac').prop('checked',     _notifyDef(s.notify_mac_change,   '1') === '1');
    $('#cfgNotifySvcDown').prop('checked', _notifyDef(s.notify_service_down, '1') === '1');
    // Push event filters — defaults del backend
    $('#cfgPushNew').prop('checked',     (_notifyDef(s.push_new,          '1')) === '1');
    $('#cfgPushOnline').prop('checked',  (_notifyDef(s.push_online,       '0')) === '1');
    $('#cfgPushOffline').prop('checked', (_notifyDef(s.push_offline,      '1')) === '1');
    $('#cfgPushMac').prop('checked',     (_notifyDef(s.push_mac_change,   '1')) === '1');
    $('#cfgPushSvcDown').prop('checked', (_notifyDef(s.push_service_down, '1')) === '1');
    // Backup
    $('#cfgBackupEnabled').prop('checked', (s.backup_enabled ?? '1') === '1');
    $('#cfgBackupKeep').val(s.backup_keep || 7);
    // Router SSH
    $('#cfgRouterEnabled').prop('checked', s.router_enabled === '1');
    $('#cfgRouterHost').val(s.router_ssh_host || '192.168.1.1');
    $('#cfgRouterPort').val(s.router_ssh_port || '22');
    $('#cfgRouterUser').val(s.router_ssh_user || '');
    $('#cfgRouterKey').val(s.router_ssh_key  || '');
    // IA
    $('#cfgAiProvider').val(s.ai_provider || 'gemini');
    $('#cfgAiGeminiKey').val(s.ai_gemini_key || '');
    $('#cfgAiGeminiModel').val(s.ai_gemini_model || 'gemini-2.0-flash');
    $('#cfgAiMistralKey').val(s.ai_mistral_key || '');
    $('#cfgAiMistralModel').val(s.ai_mistral_model || 'mistral-small-latest');
    _toggleAiFields(s.ai_provider || 'gemini');
    _refreshTopbarRangesFromState();
    // Pestañas ocultas
    const hidden = (s.hidden_tabs || '').split(',').map(x => x.trim()).filter(Boolean);
    document.querySelectorAll('.cfg-tab-toggle').forEach(cb => {
      cb.checked = !hidden.includes(cb.dataset.tab);
    });
    // SMTP
    $('#cfgSmtpEnabled').prop('checked', s.smtp_enabled === '1');
    $('#cfgSmtpHost').val(s.smtp_host || '');
    $('#cfgSmtpPort').val(s.smtp_port || '587');
    $('#cfgSmtpTls').val(s.smtp_tls  || 'starttls');
    $('#cfgSmtpUser').val(s.smtp_user || '');
    $('#cfgSmtpPass').val(s.smtp_pass || '');
    $('#cfgSmtpTo').val(s.smtp_to    || '');
    $('#cfgSmtpFrom').val(s.smtp_from || '');
    // Idioma
    const lang = s.ui_lang || localStorage.getItem('auditor_lang') || 'es';
    $('#cfgLangSelect').val(lang);
    if (typeof _updateLangBtns === 'function') _updateLangBtns(lang);
    // Sincronizar motor i18n con el valor de BD (puede diferir del localStorage)
    if (typeof window._i18nApplyFromSettings === 'function') {
      window._i18nApplyFromSettings(lang);
    }
    // WoL público
    $('#cfgWolPublic').prop('checked', s.wol_public === '1');
  }

  // Live humanize interval
  $('#cfgInterval').on('input', function() {
    $('#cfgIntervalHuman').text(humanSeconds($(this).val()));
  });

  // Toggle webhook visibility
  $('#cfgDiscordToggle').on('click', function() {
    const inp = $('#cfgDiscord');
    const isPass = inp.attr('type') === 'password';
    inp.attr('type', isPass ? 'text' : 'password');
    $(this).find('i').toggleClass('bi-eye bi-eye-slash');
  });

  // Test Discord
  $('#cfgDiscordTest').on('click', async function() {
    // Save webhook first so test uses latest value
    const webhook = $('#cfgDiscord').val().trim();
    await fetch('/api/settings', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ discord_webhook: webhook })
    });
    setBtnLoading(this, true);
    const res = await fetch('/api/settings/test-discord', { method:'POST' });
    const data = await res.json();
    setBtnLoading(this, false);
    const el = $('#cfgDiscordTestResult');
    el.show().attr('class', 'cfg-status ' + (data.ok ? 'ok' : 'err'))
      .text(data.ok ? '✓ Mensaje enviado' : '✗ ' + (data.error || 'Error'));
    setTimeout(() => el.hide(), 4000);
  });

  // ── Router SSH: Probar conexión ──
  $('#cfgRouterTest').on('click', async function() {
    // Guardar config actual primero
    await fetch('/api/settings', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        router_ssh_host: $('#cfgRouterHost').val().trim(),
        router_ssh_port: $('#cfgRouterPort').val().trim() || '22',
        router_ssh_user: $('#cfgRouterUser').val().trim(),
        router_ssh_key:  $('#cfgRouterKey').val().trim(),
      })
    });
    setBtnLoading(this, true);
    const el     = $('#cfgRouterTestResult');
    const detail = $('#cfgRouterTestDetail');
    el.show().attr('class','cfg-status').text('Conectando…');
    try {
      const res  = await fetch('/api/router/test', { method:'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) {
        el.attr('class','cfg-status ok').text(`✓ ${data.hosts_found} hosts detectados`);
        const rows = data.hosts.map(h => `
          <tr>
            <td class="mono">${h.ip}</td>
            <td class="mono" style="opacity:.65">${h.mac}</td>
            <td>${h.router_hostname || '<span style="opacity:.4">—</span>'}</td>
            <td><span class="badge badge-soft text-light" style="font-size:.7rem">${h.ip_assignment || '?'}</span></td>
            <td class="mono">${h.dhcp_lease_secs != null ? Math.round(h.dhcp_lease_secs/3600)+'h' : '—'}</td>
          </tr>`).join('');
        const diagHtml = (data.diagnostics||[]).map(d => `<div style="font-size:.75rem;opacity:.7">${esc(d)}</div>`).join('');
        $('#cfgRouterTestTable').html(`
          ${diagHtml ? `<div class="mb-2">${diagHtml}</div>` : ''}
          <table class="table table-sm table-dark table-bordered mb-0">
            <thead><tr><th>IP</th><th>MAC</th><th>Hostname DHCP</th><th>Asignación</th><th>Lease</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="small-muted text-center">Sin hosts</td></tr>'}</tbody>
          </table>`);
        detail.show();
      } else {
        el.attr('class','cfg-status err').text('✗ ' + (data.error || 'Error de conexión'));
        // Mostrar diagnóstico y sugerencias detalladas
        const diagLines = [...(data.diagnostics||[]), ...(data.verbose||[])];
        if (diagLines.length) {
          const diagHtml = diagLines.map(d => {
            const color = d.startsWith('✅') ? '#2ecc71' : d.startsWith('❌') ? '#ff6b6b' : d.startsWith('⚠') ? '#f39c12' : d.startsWith('💡') ? '#3498db' : 'rgba(255,255,255,0.6)';
            return `<div style="font-size:.78rem;color:${color};padding:1px 0;font-family:monospace">${esc(d)}</div>`;
          }).join('');
          detail.show();
          $('#cfgRouterTestTable').html(`
            <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px 12px">
              <div style="font-size:.8rem;font-weight:600;margin-bottom:6px;color:rgba(255,255,255,0.7)">Diagnóstico</div>
              ${diagHtml}
            </div>`);
        } else {
          detail.hide();
        }
      }
    } catch(e) {
      setBtnLoading(this, false);
      el.attr('class','cfg-status err').text('✗ ' + e.message);
      detail.hide();
    }
    setTimeout(() => el.hide(), 30000);
  });

  // ── Router SSH: Scan ahora ──
  $('#cfgRouterScanNow').on('click', async function() {
    setBtnLoading(this, true);
    const el = $('#cfgRouterTestResult');
    el.show().attr('class','cfg-status').text('Escaneando router…');
    try {
      const res  = await fetch('/api/router/scan', { method:'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) {
        el.attr('class','cfg-status ok').text(`✓ ${data.hosts_found} hosts · ${data.silent_new} silent nuevos`);
        if (data.silent_new > 0) setTimeout(() => location.reload(), 1500);
      } else {
        el.attr('class','cfg-status err').text('✗ ' + (data.error || 'Error'));
      }
    } catch(e) {
      setBtnLoading(this, false);
      el.attr('class','cfg-status err').text('✗ ' + e.message);
    }
    setTimeout(() => el.hide(), 6000);
  });

  // Save settings
  $('#cfgSave').on('click', async function() {
    const payload = {
      scan_cidr:          _getCidrValue(),
      scan_interval:      $('#cfgInterval').val(),
      dns_server:         $('#cfgDns').val().trim(),
      discord_webhook:    $('#cfgDiscord').val().trim(),
      notify_new:         $('#cfgNotifyNew').is(':checked') ? '1' : '0',
      notify_online:      $('#cfgNotifyOnline').is(':checked') ? '1' : '0',
      notify_offline:     $('#cfgNotifyOffline').is(':checked') ? '1' : '0',
      notify_mac_change:  $('#cfgNotifyMac').is(':checked') ? '1' : '0',
      notify_service_down:$('#cfgNotifySvcDown').is(':checked') ? '1' : '0',
      push_new:           $('#cfgPushNew').is(':checked')     ? '1' : '0',
      push_online:        $('#cfgPushOnline').is(':checked')  ? '1' : '0',
      push_offline:       $('#cfgPushOffline').is(':checked') ? '1' : '0',
      push_mac_change:    $('#cfgPushMac').is(':checked')     ? '1' : '0',
      push_service_down:  $('#cfgPushSvcDown').is(':checked') ? '1' : '0',
      backup_enabled:     $('#cfgBackupEnabled').is(':checked') ? '1' : '0',
      backup_keep:        $('#cfgBackupKeep').val() || '7',
      retention_days:     $('#cfgRetention').val(),
      wol_port:           $('#cfgWolPort').val(),
      wol_broadcast:      $('#cfgWolBroadcast').val().trim(),
      app_tz:             $('#cfgTz').val(),
      page_title:         $('#cfgTitle').val().trim() || 'Auditor IPs',
      router_enabled:     $('#cfgRouterEnabled').is(':checked') ? '1' : '0',
      router_ssh_host:    $('#cfgRouterHost').val().trim(),
      router_ssh_port:    $('#cfgRouterPort').val().trim() || '22',
      router_ssh_user:    $('#cfgRouterUser').val().trim(),
      router_ssh_key:     $('#cfgRouterKey').val().trim(),
      auth_sections:      (window._cfgAuthSectionsValue ? window._cfgAuthSectionsValue() : ''),
      // IA
      ai_provider:        $('#cfgAiProvider').val(),
      ai_gemini_key:      $('#cfgAiGeminiKey').val().trim(),
      ai_gemini_model:    $('#cfgAiGeminiModel').val().trim() || 'gemini-2.0-flash',
      // SMTP
      smtp_enabled:       $('#cfgSmtpEnabled').is(':checked') ? '1' : '0',
      smtp_host:          $('#cfgSmtpHost').val().trim(),
      smtp_port:          $('#cfgSmtpPort').val().trim() || '587',
      smtp_tls:           $('#cfgSmtpTls').val(),
      smtp_user:          $('#cfgSmtpUser').val().trim(),
      smtp_pass:          $('#cfgSmtpPass').val(),
      smtp_to:            $('#cfgSmtpTo').val().trim(),
      smtp_from:          $('#cfgSmtpFrom').val().trim(),
    };
    setBtnLoading(this, true);
    const el = $('#cfgSaveStatus');
    try {
      const res  = await fetch('/api/settings', {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) {
        el.show().attr('class','cfg-status ok').text('✓ Guardado');
        _cfgData = {..._cfgData, ...payload};
        document.title = payload.page_title;
        setTimeout(() => el.hide(), 3000);
      } else {
        el.show().attr('class','cfg-status err').text('✗ Error al guardar');
      }
    } catch(e) {
      setBtnLoading(this, false);
      el.show().attr('class','cfg-status err').text('✗ Error de red');
    }
  });

  // ── WoL público ───────────────────────────────────────────────────────────
  $(document).on('click', '#cfgWolPublicSave', async function() {
    const val = $('#cfgWolPublic').is(':checked') ? '1' : '0';
    const $msg = $('#cfgWolPublicMsg');
    try {
      const res  = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wol_public: val }),
      });
      const data = await res.json();
      $msg.show().attr('class', 'cfg-status ' + (data.ok ? 'ok' : 'err'))
          .text(data.ok ? '✓ Guardado' : '✗ Error');
      setTimeout(() => $msg.hide(), 2500);
    } catch(e) {
      $msg.show().attr('class', 'cfg-status err').text('✗ Error de red');
    }
  });

  // ── Selector de idioma (botones con bandera) ────────────────────────────────
  function _updateLangBtns(lang) {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    // Actualizar input oculto
    const hidden = document.getElementById('cfgLangSelect');
    if (hidden) hidden.value = lang;
  }

  $(document).on('click', '.lang-btn', function() {
    const lang = $(this).data('lang');
    _updateLangBtns(lang);
    if (typeof setLang === 'function') setLang(lang);
  });

  // Sincronizar botones cuando se carga config desde BD
  const _origI18nApply = window._i18nApplyFromSettings;
  window._i18nApplyFromSettings = function(lang) {
    if (typeof _origI18nApply === 'function') _origI18nApply(lang);
    _updateLangBtns(lang);
  };

  // Marcar botón activo al abrir el panel de Apariencia
  $(document).on('click', '.cfg-nav-btn[data-section="appearance"]', function() {
    _updateLangBtns(typeof getLang === 'function' ? getLang() : 'es');
  });

  // Discard — reload from server
  $('#cfgDiscard').on('click', () => loadCfg());

  // ── SMTP: toggle contraseña ──
  $('#cfgSmtpPassToggle').on('click', function() {
    const inp = $('#cfgSmtpPass');
    const isPass = inp.attr('type') === 'password';
    inp.attr('type', isPass ? 'text' : 'password');
    $(this).find('i').toggleClass('bi-eye bi-eye-slash');
  });

  // ── SMTP: test ──
  $('#cfgSmtpTest').on('click', async function() {
    // Guardar config SMTP primero
    await fetch('/api/settings', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        smtp_enabled: $('#cfgSmtpEnabled').is(':checked') ? '1' : '0',
        smtp_host:    $('#cfgSmtpHost').val().trim(),
        smtp_port:    $('#cfgSmtpPort').val().trim() || '587',
        smtp_tls:     $('#cfgSmtpTls').val(),
        smtp_user:    $('#cfgSmtpUser').val().trim(),
        smtp_pass:    $('#cfgSmtpPass').val(),
        smtp_to:      $('#cfgSmtpTo').val().trim(),
        smtp_from:    $('#cfgSmtpFrom').val().trim(),
      })
    });
    setBtnLoading(this, true);
    const el = $('#cfgSmtpTestResult');
    el.show().attr('class', 'cfg-status').text('Enviando…');
    try {
      const res  = await fetch('/api/settings/test-smtp', { method: 'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      el.attr('class', 'cfg-status ' + (data.ok ? 'ok' : 'err'))
        .text(data.ok ? '✓ Email enviado' : '✗ ' + (data.error || 'Error'));
      setTimeout(() => el.hide(), 5000);
    } catch(e) {
      setBtnLoading(this, false);
      el.attr('class', 'cfg-status err').text('✗ Error de red');
    }
  });


  // ── Pestañas ocultables ─────────────────────────────────────────────────────

  /**
   * Aplica visibilidad de pestañas según el CSV de IDs ocultos.
   * Las pestañas dashboard, hosts y scans son fijas y nunca se ocultan.
   * Si la pestaña activa queda oculta, redirige al Dashboard.
   */
  window.applyHiddenTabs = function applyHiddenTabs(hiddenCsv) {
    const hidden = (hiddenCsv || '').split(',').map(x => x.trim()).filter(Boolean);
    const fixed  = new Set(['dashboard', 'hosts', 'scans']);
    let activeIsHidden = false;

    document.querySelectorAll('#viewTabs li[data-tab-id]').forEach(li => {
      const id = li.dataset.tabId;
      if (fixed.has(id)) return; // nunca se ocultan
      const shouldHide = hidden.includes(id);
      li.style.display = shouldHide ? 'none' : '';
      if (shouldHide && li.querySelector('.nav-link.active')) {
        activeIsHidden = true;
      }
    });

    if (activeIsHidden) {
      // Redirigir al Dashboard
      const dashBtn = document.getElementById('dashboard-tab');
      if (dashBtn) dashBtn.click();
    }
  };

  // Botón "Aplicar" del panel Interfaz — guarda hidden_tabs y aplica al instante
  $(document).on('click', '#cfgTabTogglesSave', async function () {
    const hidden = [];
    document.querySelectorAll('.cfg-tab-toggle').forEach(cb => {
      if (!cb.checked) hidden.push(cb.dataset.tab);
    });
    const hiddenCsv = hidden.join(',');
    const el = $('#cfgTabTogglesStatus');
    try {
      const res  = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_tabs: hiddenCsv }),
      });
      const data = await res.json();
      if (data.ok) {
        el.show().attr('class', 'cfg-status ok').text('✓ Guardado');
        if (_cfgData) _cfgData.hidden_tabs = hiddenCsv;
        applyHiddenTabs(hiddenCsv);
        setTimeout(() => el.hide(), 2500);
      } else {
        el.show().attr('class', 'cfg-status err').text('✗ Error al guardar');
      }
    } catch (e) {
      el.show().attr('class', 'cfg-status err').text('✗ Error de red');
    }
  });


  // ── TIPOS EN CONFIGURACIÓN ──
  window.loadCfgTypes = async function loadCfgTypes() {
    try {
      const res  = await fetch('/api/status');
      const data = await res.json();
      const tbody = document.getElementById('cfgTypesTbody');
      tbody.innerHTML = '';
      for (const t of (data.types || [])) {
        const isDefault = t.name === 'Por defecto';
        tbody.insertAdjacentHTML('beforeend', `
          <tr data-type-id="${t.id}">
            <td style="width:40px">
              <div class="emoji-picker-wrap">
                <button type="button" class="emoji-picker-btn cfg-type-icon-val" data-icon="${esc(t.icon||'')}" style="font-size:1.1rem;min-width:36px">${t.icon||'❓'}</button>
                <input type="hidden" class="cfg-type-icon-hidden" value="${esc(t.icon||'')}">
                <div class="emoji-grid-popup"></div>
              </div>
            </td>
            <td><input class="form-control form-control-sm cfg-type-name" value="${esc(t.name)}" ${isDefault?'disabled':''}></td>
            <td class="text-end">
              <div class="d-flex gap-1 justify-content-end">
                <button class="btn btn-outline-info btn-sm btn-ico cfg-save-type" data-id="${t.id}" title="Guardar"><i class="bi bi-save2"></i></button>
                ${!isDefault ? `<button class="btn btn-outline-danger btn-sm btn-ico cfg-del-type" data-id="${t.id}" title="Eliminar"><i class="bi bi-trash3"></i></button>` : ''}
              </div>
            </td>
          </tr>`);
      }
    } catch(e) { console.error('loadCfgTypes:', e); }
  }

  // Save type from config panel
  $(document).on('click', '.cfg-save-type', async function() {
    const id  = $(this).data('id');
    const tr  = $(this).closest('tr');
    const name = tr.find('.cfg-type-name').val().trim();
    const icon = tr.find('.cfg-type-icon-hidden').val();
    setBtnLoading(this, true);
    const res  = await fetch(`/api/types/${id}`, {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon })
    });
    setBtnLoading(this, false);
    const data = await res.json();
    if (data.ok) loadCfgTypes();
  });

  // Delete type from config panel
  $(document).on('click', '.cfg-del-type', async function() {
    if (!confirm('¿Eliminar este tipo? Los hosts pasarán a "Por defecto".')) return;
    const id = $(this).data('id');
    const res = await fetch(`/api/types/${id}`, { method:'DELETE' });
    const data = await res.json();
    if (data.ok) loadCfgTypes();
  });

  // Add new type from config panel
  $('#cfgAddType').on('click', async function() {
    const name = $('#cfgNewTypeName').val().trim();
    const icon = $('#cfgNewTypeIcon').val();
    if (!name) { $('#cfgTypeMsg').text('⚠ Escribe un nombre'); return; }
    setBtnLoading(this, true);
    const res  = await fetch('/api/types', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, icon })
    });
    const data = await res.json();
    setBtnLoading(this, false);
    if (data.ok) {
      $('#cfgNewTypeName').val('');
      $('#cfgNewTypeIcon').val('');
      $('#cfgNewTypeIconBtn').text('❓');
      $('#cfgTypeMsg').text('');
      loadCfgTypes();
    } else {
      $('#cfgTypeMsg').text('Error: ' + (data.error || '?'));
    }
  });

  // Wire cfgNewTypeIconBtn to emoji picker
  $(document).on('click', '#cfgNewTypeIconBtn', function(e) {
    e.stopPropagation();
    openEmojiPicker(this);
  });

  // Restore DB from config panel
  $('#cfgRestoreFile').on('change', async function() {
    const file = this.files[0];
    if (!file) return;
    if (!confirm('¿Restaurar esta base de datos? Se perderán los datos actuales.')) { this.value=''; return; }
    const fd = new FormData();
    fd.append('file', file);
    const res  = await fetch('/api/db/restore', { method:'POST', body: fd });
    const data = await res.json();
    alert(data.ok ? '✓ Base de datos restaurada. Recarga la página.' : '✗ Error: ' + (data.error||'?'));
    this.value = '';
  });

  // Reset DB from config panel
  $('#cfgResetDb').on('click', async function() {
    if (!confirm('¿Resetear todos los hosts y eventos? Esta acción no se puede deshacer.')) return;
    setBtnLoading(this, true);
    const res  = await fetch('/api/db/reset', { method:'POST' });
    const data = await res.json();
    setBtnLoading(this, false);
    alert(data.ok ? '✓ Base de datos reseteada.' : '✗ Error');
  });

  // Cerrar picker al hacer click fuera
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.emoji-picker-wrap').length) {
      $('.emoji-grid-popup.open').removeClass('open');
    }
  });

  // ══════════════════════════════════════════════════════════
  // PING MANUAL
  // ══════════════════════════════════════════════════════════
  function applyAccent(color, color2) {
    // Parse hex to rgb components
    function hexToRgb(hex) {
      const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
      return `${r},${g},${b}`;
    }
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(color));
    if (color2) {
      document.documentElement.style.setProperty('--accent2', color2);
      document.documentElement.style.setProperty('--accent2-rgb', hexToRgb(color2));
    }
    $('#cfgAccentLabel').text(color);
    $('.accent-swatch').removeClass('active');
    $(`.accent-swatch[data-accent="${color}"]`).addClass('active');
  }

  // Load saved accent on start
  function loadAccent() {
    const saved = localStorage.getItem('accent_color');
    const saved2 = localStorage.getItem('accent_color2');
    if (saved) applyAccent(saved, saved2 || undefined);
  }
  loadAccent();

  $(document).on('click', '.accent-swatch', function() {
    const color  = $(this).data('accent');
    const color2 = $(this).data('accent2');
    applyAccent(color, color2);
    localStorage.setItem('accent_color', color);
    if (color2) localStorage.setItem('accent_color2', color2);
  });

  $('#cfgAccentCustom').on('input', function() {
    applyAccent($(this).val());
    localStorage.setItem('accent_color', $(this).val());
  });

  // Mark active swatch cuando se abre el Config — consolidado en listener único abajo

  // ══════════════════════════════════════════════════════════
  // PUSH NOTIFICATIONS (PWA)
  // ══════════════════════════════════════════════════════════
  let _pushSub = null;

  async function initPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      $('#pushStatus').text('Tu navegador no soporta notificaciones push.');
      $('#btnPushEnable').prop('disabled', true);
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    _pushSub = await reg.pushManager.getSubscription();
    updatePushUI();
  }

  function updatePushUI() {
    if (_pushSub) {
      $('#pushStatus').html('<span class="cfg-status ok">✓ Notificaciones activadas</span>');
      $('#btnPushEnable').hide();
      $('#btnPushDisable').show();
    } else {
      $('#pushStatus').html('<span class="cfg-status" style="background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.5)">Sin suscripción activa</span>');
      $('#btnPushEnable').show();
      $('#btnPushDisable').hide();
    }
  }

  $('#btnPushEnable').on('click', async function() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { alert('Permiso denegado por el navegador.'); return; }
      const reg = await navigator.serviceWorker.ready;
      // Use a dummy VAPID key for self-hosted (no VAPID server needed for basic push)
      _pushSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: null,
      }).catch(async () => {
        // Without VAPID key subscribe may fail — fallback: just store intent
        return null;
      });
      if (_pushSub) {
        const subJson = _pushSub.toJSON();
        await fetch('/api/push/subscribe', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh || '', auth: subJson.keys?.auth || '' })
        });
      } else {
        // Store local notification intent only
        localStorage.setItem('pushEnabled', '1');
        // Show a test notification
        new Notification('🔔 Auditor IPs', { body: 'Notificaciones locales activadas.' });
      }
      updatePushUI();
    } catch(e) {
      alert('Error al activar notificaciones: ' + e.message);
    }
  });

  $('#btnPushDisable').on('click', async function() {
    if (_pushSub) {
      await _pushSub.unsubscribe();
      await fetch('/api/push/unsubscribe', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ endpoint: _pushSub.endpoint })
      });
      _pushSub = null;
    }
    localStorage.removeItem('pushEnabled');
    updatePushUI();
  });

  // ══════════════════════════════════════════════════════════
  // MARKDOWN NOTES PREVIEW
  // ══════════════════════════════════════════════════════════
  window.loadBackupList = async function loadBackupList() {
    const res  = await fetch('/api/backup/list');
    const data = await res.json();
    const tbody = $('#backupTbody');
    tbody.empty();
    if (!data.ok || !data.backups.length) {
      tbody.append('<tr><td colspan="4" class="small-muted text-center py-2">Sin backups todavía</td></tr>');
      return;
    }
    for (const b of data.backups) {
      tbody.append(`
        <tr class="backup-row">
          <td class="mono">${esc(b.filename)}</td>
          <td>${esc(b.created)}</td>
          <td>${b.size_kb} KB</td>
          <td class="d-flex gap-1">
            <a href="/api/backup/download/${encodeURIComponent(b.filename)}" class="btn btn-outline-secondary btn-sm btn-ico" title="Descargar"><i class="bi bi-download"></i></a>
            <button class="btn btn-outline-danger btn-sm btn-ico btn-backup-del" data-file="${esc(b.filename)}" title="Eliminar"><i class="bi bi-trash3"></i></button>
          </td>
        </tr>
      `);
    }
  }

  $(document).on('click', '.btn-backup-del', async function() {
    const file = $(this).data('file');
    if (!confirm(`¿Eliminar backup ${file}?`)) return;
    const res = await fetch(`/api/backup/${encodeURIComponent(file)}`, { method: 'DELETE' });
    if ((await res.json()).ok) { showToast('Backup eliminado', 'success'); loadBackupList(); }
  });

  $('#btnBackupNow').on('click', async function() {
    setBtnLoading(this, true);
    const res  = await fetch('/api/backup/run', { method: 'POST' });
    const data = await res.json();
    setBtnLoading(this, false);
    if (data.ok && !data.skipped) {
      showToast(`💾 Backup creado: ${data.size_kb} KB`, 'success');
      loadBackupList();
    } else if (data.skipped) {
      showToast('Backup desactivado en configuración', 'warning');
    } else {
      showToast('Error: ' + (data.error || '?'), 'danger');
    }
  });

  // loadBackupList consolidado en listener único abajo

  // ══════════════════════════════════════════════════════════
  // BULK CLEAR MACs — Config
  // ══════════════════════════════════════════════════════════
  $('#btnBulkClearMac').on('click', async function() {
    const days = parseInt($('#cfgMacClearDays').val()) || 30;
    if (!confirm(`¿Borrar la MAC de todos los hosts OFFLINE que llevan más de ${days} días sin verse?\n\nPodrán ser detectados como nuevos dispositivos la próxima vez.`)) return;
    setBtnLoading(this, true);
    try {
      const res  = await fetch('/api/hosts/bulk-clear-mac', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ days })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error');
      showToast(`🧹 MACs limpiadas: ${data.count} host${data.count !== 1 ? 's' : ''}`, 'success');
    } catch(e) { showToast('Error: ' + e.message, 'danger'); }
    setBtnLoading(this, false);
  });

  // window._hostsData is set by index.html (Jinja2 template)

  // ══════════════════════════════════════════════════════════
  // BÚSQUEDA GLOBAL
  // ══════════════════════════════════════════════════════════
  let _gsTimer = null;
  const _gsInput = document.getElementById('globalSearchInput');
  const _gsDrop  = document.getElementById('globalSearchDrop');

  function gsClose() { _gsDrop.style.display = 'none'; }
  function gsOpen()  { _gsDrop.style.display = 'block'; }

  _gsInput && _gsInput.addEventListener('input', function() {
    clearTimeout(_gsTimer);
    const q = this.value.trim();
    if (q.length < 2) { gsClose(); return; }
    _gsTimer = setTimeout(async () => {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      _gsDrop.innerHTML = '';
      if (!data.results || !data.results.length) {
        _gsDrop.innerHTML = '<div class="gs-empty">Sin resultados para "' + esc(q) + '"</div>';
        gsOpen(); return;
      }
      for (const r of data.results) {
        const dotCls = r.status === 'online' || r.status === 'up' ? 'online' : r.status === 'offline' || r.status === 'down' ? 'offline' : '';
        const div = document.createElement('div');
        div.className = 'gs-item';
        div.innerHTML = `
          <span class="gs-icon">${esc(r.icon)}</span>
          <div style="flex:1;min-width:0">
            <div class="gs-title">${esc(r.title)}</div>
            <div class="gs-sub">${esc(r.subtitle)}</div>
          </div>
          ${dotCls ? `<div class="gs-status-dot ${dotCls}"></div>` : ''}`;
        div.addEventListener('click', () => {
          gsClose(); _gsInput.value = '';
          const act = r.action || '';
          if (act.startsWith('openHost:')) {
            const ip = act.split(':')[1];
            const row = document.querySelector(`.host-row[data-ip="${ip}"]`);
            if (row) {
              // Switch to hosts tab first
              document.getElementById('tab-hosts').click();
              setTimeout(() => row.click(), 200);
            }
          } else if (act.startsWith('openTab:')) {
            const tabMap = { servicios:'servicios-tab', ejecuciones:'scans-tab' };
            const tabId = tabMap[act.split(':')[1]];
            if (tabId) document.getElementById(tabId)?.click();
          }
        });
        _gsDrop.appendChild(div);
      }
      gsOpen();
    }, 280);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#globalSearchWrap')) gsClose();
  });
  _gsInput && _gsInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { gsClose(); _gsInput.value = ''; }
  });


  // ══════════════════════════════════════════════════════════
  // ETIQUETAS (TAGS) — widget en modal de host
  // ══════════════════════════════════════════════════════════
  // (_currentTagIp and _currentTags declared at top of $(function) to avoid TDZ error)

  window.renderTagWrap = function renderTagWrap() {
    const wrap = document.getElementById('mTagWrap');
    if (!wrap) return;
    // Keep only the input
    Array.from(wrap.children).forEach(c => { if (c.id !== 'mTagInput') c.remove(); });
    for (const t of _currentTags) {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.innerHTML = `${esc(t)} <span class="tag-remove" data-tag="${esc(t)}">×</span>`;
      wrap.insertBefore(badge, document.getElementById('mTagInput'));
    }
  }

  window.addTag = function addTag(val) {
    const t = val.trim().toLowerCase().replace(/,/g,'').slice(0,30);
    if (t && !_currentTags.includes(t)) {
      _currentTags.push(t);
      _currentTags.sort();
      renderTagWrap();
    }
  }

  $(document).on('keydown', '#mTagInput', function(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(this.value); this.value = '';
    } else if (e.key === 'Backspace' && !this.value && _currentTags.length) {
      _currentTags.pop(); renderTagWrap();
    }
  });
  $(document).on('blur', '#mTagInput', function() {
    if (this.value.trim()) { addTag(this.value); this.value = ''; }
  });
  $(document).on('click', '.tag-remove', function() {
    const t = $(this).data('tag');
    _currentTags = _currentTags.filter(x => x !== t);
    renderTagWrap();
  });
  $(document).on('click', '#mTagWrap', function(e) {
    if (e.target === this || e.target.classList.contains('tag-badge')) {
      document.getElementById('mTagInput').focus();
    }
  });

  // Populate tags when modal opens (hook into existing mSave logic)
  const _origSave = window._mSaveHook;

  // Tag filter strip
  let _activeTagFilter = null;

  window.loadTagFilterBar = async function loadTagFilterBar() {
    const res  = await fetch('/api/tags');
    const data = await res.json();
    const strip = document.getElementById('tagFilterBadges');
    if (!strip || !data.ok) return;
    strip.innerHTML = '';
    for (const tag of data.tags) {
      const b = document.createElement('span');
      b.className = 'tag-badge' + (_activeTagFilter === tag ? ' active' : '');
      b.style.cursor = 'pointer';
      b.textContent = tag;
      b.dataset.tag = tag;
      b.addEventListener('click', () => {
        _activeTagFilter = _activeTagFilter === tag ? null : tag;
        document.getElementById('clearTagFilter').style.display = _activeTagFilter ? '' : 'none';
        hostsTable.draw();
        loadTagFilterBar();
      });
      strip.appendChild(b);
    }
  }

  document.getElementById('clearTagFilter')?.addEventListener('click', () => {
    _activeTagFilter = null;
    document.getElementById('clearTagFilter').style.display = 'none';
    hostsTable.draw();
    loadTagFilterBar();
  });

  // DataTables custom search for tag filter
  $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
    if (!_activeTagFilter) return true;
    const tags = (data[7] || '').split(',').map(t => t.trim());
    return tags.includes(_activeTagFilter);
  });

  loadTagFilterBar();


  // ══════════════════════════════════════════════════════════
  // ALERTAS — mostrar campo min_down cuando trigger=offline_for
  // ══════════════════════════════════════════════════════════
  async function ensureVapidKeys() {
    const res  = await fetch('/api/push/vapid-key');
    const data = await res.json();
    if (!data.key) {
      // Generate
      const gen = await fetch('/api/push/generate-vapid', {method:'POST'});
      const gd  = await gen.json();
      if (gd.ok) {
        console.log('[VAPID] Keys generated:', gd.public_key?.substring(0,20) + '...');
        return gd.public_key;
      }
    }
    return data.key;
  }

  // Call on page load to ensure keys exist
  ensureVapidKeys().catch(()=>{});


  // ══════════════════════════════════════════════════════════
  // EXPORTACIÓN PROGRAMADA A EXCEL
  // ══════════════════════════════════════════════════════════

  function loadExportConfig() {
    $.ajax({
      url: "/api/export/xlsx/config",
      method: "GET",
      timeout: 8000,
      success: function(d) {
        $("#exportEnabled").prop("checked", d.enabled);
        $("#exportPath").val(d.path || "/data/exports");
        $("#exportFrequency").val(d.frequency || "weekly");
        $("#exportHour").val(d.hour !== undefined ? d.hour : 6);
        _updateExportDayUI(d.frequency || "weekly", d.day !== undefined ? d.day : 0);
        _updateExportStatus(d);
        _toggleExportFields(d.enabled);
      },
      error: function() {
        $("#exportStatus").html('<span class="text-danger small">Error cargando configuración</span>');
      }
    });
  }

  function _updateExportDayUI(freq, day) {
    var $dayWrap  = $("#exportDayWrap");
    var $wdayWrap = $("#exportWeekdayWrap");
    if (freq === "weekly") {
      $dayWrap.hide();
      $wdayWrap.show();
      $("#exportWeekday").val(day);
    } else if (freq === "monthly") {
      $wdayWrap.hide();
      $dayWrap.show();
      $("#exportMonthDay").val(day || 1);
    } else {
      // daily
      $dayWrap.hide();
      $wdayWrap.hide();
    }
  }

  function _updateExportStatus(d) {
    var $s = $("#exportStatus");
    if (!d.enabled) {
      $s.html('<span class="text-muted small">Desactivada</span>');
      return;
    }
    var html = '<span class="text-success small"><i class="bi bi-check-circle me-1"></i>Activa</span>';
    if (d.last_run) {
      html += ' &nbsp;·&nbsp; <span class="text-muted small">Última: '
            + esc(d.last_run.replace("T"," ").substring(0,16)) + '</span>';
    }
    if (d.last_file) {
      html += ' &nbsp;·&nbsp; <span class="text-muted small">'
            + '<i class="bi bi-file-earmark-excel me-1 text-success"></i>'
            + esc(d.last_file) + '</span>';
    }
    $s.html(html);
  }

  function _toggleExportFields(enabled) {
    enabled ? $("#exportFieldsWrap").show() : $("#exportFieldsWrap").hide();
  }

  function saveExportConfig() {
    var freq = $("#exportFrequency").val();
    var day  = freq === "weekly"  ? parseInt($("#exportWeekday").val())  :
               freq === "monthly" ? parseInt($("#exportMonthDay").val()) : 0;
    var payload = {
      enabled:   $("#exportEnabled").prop("checked"),
      path:      $("#exportPath").val().trim(),
      frequency: freq,
      day:       isNaN(day) ? 0 : day,
      hour:      parseInt($("#exportHour").val()) || 6,
    };
    if (!payload.path) {
      showToast("Indica una ruta de destino", "warning");
      return;
    }
    $.ajax({
      url: "/api/export/xlsx/config",
      method: "PUT",
      contentType: "application/json",
      data: JSON.stringify(payload),
      timeout: 8000,
      success: function() {
        showToast("Configuración de exportación guardada", "success");
        loadExportConfig();
      },
      error: function(xhr) {
        var msg = (xhr.responseJSON && xhr.responseJSON.error) || "Error guardando";
        showToast(msg, "danger");
      }
    });
  }

  function exportNow() {
    var $btn = $("#exportNowBtn");
    setBtnLoading($btn, true);
    $.ajax({
      url: "/api/export/xlsx/now",
      method: "POST",
      timeout: 30000,
      success: function(d) {
        setBtnLoading($btn, false);
        if (d.ok) {
          showToast("Exportado: " + d.file, "success");
          loadExportConfig();
        } else {
          showToast(d.error || "Error en exportación", "danger");
        }
      },
      error: function(xhr) {
        setBtnLoading($btn, false);
        var msg = (xhr.responseJSON && xhr.responseJSON.error) || "Error en exportación";
        showToast(msg, "danger");
      }
    });
  }

  // Eventos
  $("#exportEnabled").on("change", function() {
    _toggleExportFields($(this).prop("checked"));
  });
  $("#exportFrequency").on("change", function() {
    var day = parseInt($("#exportWeekday").val() || $("#exportMonthDay").val() || 0);
    _updateExportDayUI($(this).val(), day);
  });
  $(document).on("click", "#exportSaveBtn", saveExportConfig);
  $(document).on("click", "#exportNowBtn",  exportNow);

  // Cargar config al activar el panel Exportar (navegación lateral de Config)
  $(document).on("click", ".cfg-nav-btn[data-section='exports']", function() {
    setTimeout(loadExportConfig, 80);
  });

  // ══════════════════════════════════════════════════════════
  // ✅ PANEL: Procesos — Scripts monitorizados (S17)
  // ══════════════════════════════════════════════════════════

  let _scriptAvailable = [];  // cache de .status.json disponibles en el volumen

  async function loadScriptsConfig() {
    const $tbody = $('#cfgScriptTbody');
    const $count = $('#cfgScriptCount');
    const $note  = $('#cfgScriptNote');
    $tbody.html('<tr><td colspan="7" class="text-center text-muted py-2"><i class="bi bi-hourglass-split"></i> Cargando…</td></tr>');
    try {
      const [resScripts, resAvail] = await Promise.all([
        fetch('/api/config/scripts').then(r => r.json()),
        fetch('/api/config/scripts/available').then(r => r.json())
      ]);

      _scriptAvailable = resAvail.files || [];
      const scripts    = resScripts.scripts || [];
      const configured = new Set(scripts.map(s => s.script_name));

      // ── Dropdown de autocompletar ──────────────────────
      const $pickList = $('#cfgScriptPickList');
      if (_scriptAvailable.length === 0) {
        $pickList.html('<li><span class="dropdown-item text-muted small"><i class="bi bi-exclamation-triangle me-1"></i>No hay .status.json en el directorio</span></li>');
      } else {
        $pickList.html(_scriptAvailable.map(f =>
          `<li><a class="dropdown-item small cfg-script-pick" href="#" data-name="${esc(f)}">${esc(f)}</a></li>`
        ).join(''));
      }

      // ── Scripts disponibles NO configurados todavía ────
      const pending = _scriptAvailable.filter(f => !configured.has(f));
      const $pendingSection = $('#cfgScriptPendingSection');
      if (pending.length > 0) {
        $('#cfgScriptPendingCount').text(pending.length);
        $('#cfgScriptPendingList').html(pending.map(f =>
          `<button class="btn btn-outline-warning btn-sm cfg-script-quick-add" data-name="${esc(f)}" style="font-size:.78rem">` +
          `<i class="bi bi-plus-circle me-1"></i>${esc(f)}</button>`
        ).join(''));
        $pendingSection.show();
      } else {
        $pendingSection.hide();
      }

      // ── Contador y nota ────────────────────────────────
      $count.text(scripts.length);
      if (scripts.length === 0) {
        $note.html('<i class="bi bi-info-circle me-1"></i>Lista vacía: se mostrarán todos los scripts del directorio');
        $tbody.html('<tr><td colspan="7" class="text-center text-muted py-3"><i class="bi bi-info-circle me-1"></i>Sin scripts configurados — se muestran todos</td></tr>');
        return;
      }
      $note.html(`<span class="text-success"><i class="bi bi-check-circle me-1"></i>Filtrando ${scripts.length} script(s)</span>`);

      // ── Tabla de configurados ──────────────────────────
      $tbody.html(scripts.map((s, idx) => `
        <tr data-script-id="${s.id}">
          <td class="text-muted small">${idx + 1}</td>
          <td><input class="form-control form-control-sm cfg-script-field" style="min-width:130px"
                     data-field="script_name" value="${esc(s.script_name)}"></td>
          <td><input class="form-control form-control-sm cfg-script-field" style="min-width:100px"
                     data-field="label" value="${esc(s.label)}" placeholder="(igual que nombre)"></td>
          <td><input class="form-control form-control-sm cfg-script-field"
                     data-field="description" value="${esc(s.description)}" placeholder="Descripción…"></td>
          <td><input type="color" class="form-control form-control-color form-control-sm cfg-script-field"
                     data-field="color" value="${s.color || '#4dffb5'}" style="width:36px;padding:2px"></td>
          <td class="text-center">
            <div class="form-check form-switch mb-0 d-flex justify-content-center">
              <input class="form-check-input cfg-script-active" type="checkbox"
                     ${s.active ? 'checked' : ''} title="${s.active ? 'Activo' : 'Inactivo'}">
            </div>
          </td>
          <td>
            <div class="d-flex gap-1">
              <button class="btn btn-outline-info btn-sm cfg-script-save" title="Guardar cambios"><i class="bi bi-save2"></i></button>
              <button class="btn btn-outline-danger btn-sm cfg-script-del" title="Eliminar"><i class="bi bi-trash3"></i></button>
            </div>
          </td>
        </tr>
      `).join(''));

    } catch (e) {
      $tbody.html(`<tr><td colspan="7" class="text-danger small p-2">Error: ${esc(e.message)}</td></tr>`);
    }
  }

  // Activar panel → cargar datos
  $(document).on("click", ".cfg-nav-btn[data-section='scripts']", function() {
    setTimeout(loadScriptsConfig, 80);
  });

  // ── Quick-add desde pill de pendientes ────────────────
  $(document).on('click', '.cfg-script-quick-add', async function() {
    const name  = $(this).data('name');
    const label = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    setBtnLoading(this, true);
    try {
      const res  = await fetch('/api/config/scripts', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ script_name: name, label, description: '', color: '', active: 1 })
      });
      const data = await res.json();
      if (data.ok) await loadScriptsConfig();
      else window.showToast('Error: ' + (data.error || ''), 'danger');
    } catch (e) {
      window.showToast('Error: ' + e.message, 'danger');
    }
  });

  // ── Importar todos del directorio ─────────────────────
  $(document).on('click', '#cfgScriptImportAllBtn', async function() {
    const $msg = $('#cfgScriptAddMsg');
    if (!confirm('¿Importar todos los scripts del directorio a la lista de Procesos?')) return;
    setBtnLoading(this, true);
    $msg.attr('class', 'small text-muted').text('Importando…');
    try {
      const res  = await fetch('/api/config/scripts/import-all', { method: 'POST' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (!data.ok) { $msg.attr('class', 'small text-danger').text('✗ ' + (data.error || 'Error')); return; }
      $msg.attr('class', 'small text-success')
          .text(`✓ ${data.added} añadidos, ${data.skipped} ya existían (${data.total} total)`);
      await loadScriptsConfig();
    } catch (e) {
      setBtnLoading(this, false);
      $msg.attr('class', 'small text-danger').text('✗ ' + e.message);
    }
    setTimeout(() => $msg.text(''), 5000);
  });

  // Seleccionar script del dropdown de disponibles
  $(document).on('click', '.cfg-script-pick', function(e) {
    e.preventDefault();
    const name = $(this).data('name');
    $('#cfgScriptName').val(name);
    // Si no hay etiqueta, sugiere el nombre limpio capitalizado
    if (!$('#cfgScriptLabel').val()) {
      $('#cfgScriptLabel').val(name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
    }
  });

  // Añadir nuevo script
  $(document).on('click', '#cfgScriptAddBtn', async function() {
    const $msg = $('#cfgScriptAddMsg');
    const name  = $('#cfgScriptName').val().trim();
    const label = $('#cfgScriptLabel').val().trim();
    const desc  = $('#cfgScriptDesc').val().trim();
    const color = $('#cfgScriptColor').val().trim();
    if (!name) { $msg.attr('class', 'small text-danger').text('El nombre del script es obligatorio'); return; }

    setBtnLoading(this, true);
    $msg.attr('class', 'small text-muted').text('Añadiendo…');
    try {
      const res  = await fetch('/api/config/scripts', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ script_name: name, label, description: desc, color, active: 1 })
      });
      const data = await res.json();
      setBtnLoading(this, false);
      if (!data.ok) { $msg.attr('class', 'small text-danger').text('✗ ' + (data.error || 'Error')); return; }
      $msg.attr('class', 'small text-success').text('✓ Script añadido');
      $('#cfgScriptName').val('');
      $('#cfgScriptLabel').val('');
      $('#cfgScriptDesc').val('');
      $('#cfgScriptColor').val('#4dffb5');
      await loadScriptsConfig();
    } catch (e) {
      setBtnLoading(this, false);
      $msg.attr('class', 'small text-danger').text('✗ ' + e.message);
    }
    setTimeout(() => $msg.text(''), 4000);
  });

  // Guardar cambios de una fila
  $(document).on('click', '.cfg-script-save', async function() {
    const $tr   = $(this).closest('tr');
    const id    = $tr.data('script-id');
    const payload = { active: $tr.find('.cfg-script-active').is(':checked') ? 1 : 0 };
    $tr.find('.cfg-script-field').each(function() {
      payload[$(this).data('field')] = $(this).val();
    });
    setBtnLoading(this, true);
    try {
      const res  = await fetch(`/api/config/scripts/${id}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) {
        $tr.addClass('table-success');
        setTimeout(() => $tr.removeClass('table-success'), 1200);
      } else {
        window.showToast('Error al guardar: ' + (data.error || ''), 'danger');
      }
    } catch (e) {
      setBtnLoading(this, false);
      window.showToast('Error: ' + e.message, 'danger');
    }
  });

  // Eliminar script
  $(document).on('click', '.cfg-script-del', async function() {
    const $tr = $(this).closest('tr');
    const id  = $tr.data('script-id');
    const name = $tr.find('input[data-field="script_name"]').val() || `#${id}`;
    if (!confirm(`¿Eliminar "${name}" de la lista de procesos monitorizados?`)) return;
    setBtnLoading(this, true);
    try {
      const res  = await fetch(`/api/config/scripts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) await loadScriptsConfig();
      else window.showToast('Error: ' + (data.error || ''), 'danger');
    } catch (e) {
      setBtnLoading(this, false);
      window.showToast('Error: ' + e.message, 'danger');
    }
  });

  // ── IA — helpers ──────────────────────────────────────────────────────────
  function _toggleAiFields(provider) {
    $('#cfgAiGeminiFields').toggle(provider === 'gemini');
    $('#cfgAiMistralFields').toggle(provider === 'mistral');
  }

  // Toggle visibilidad API key Mistral
  $(document).on('click', '#cfgAiMistralKeyToggle', function() {
    const inp = $('#cfgAiMistralKey');
    const isPass = inp.attr('type') === 'password';
    inp.attr('type', isPass ? 'text' : 'password');
    $(this).find('i').toggleClass('bi-eye bi-eye-slash');
  });

  $(document).on('change', '#cfgAiProvider', function() {
    _toggleAiFields($(this).val());
  });

  // Toggle visibilidad API key
  $(document).on('click', '#cfgAiKeyToggle', function() {
    const inp = $('#cfgAiGeminiKey');
    const isPass = inp.attr('type') === 'password';
    inp.attr('type', isPass ? 'text' : 'password');
    $(this).find('i').toggleClass('bi-eye bi-eye-slash');
  });

  // Guardar sección IA
  $(document).on('click', '#cfgAiSave', async function() {
    const payload = {
      ai_provider:      $('#cfgAiProvider').val(),
      ai_gemini_key:    $('#cfgAiGeminiKey').val().trim(),
      ai_gemini_model:  $('#cfgAiGeminiModel').val().trim() || 'gemini-2.0-flash',
      ai_mistral_key:   $('#cfgAiMistralKey').val().trim(),
      ai_mistral_model: $('#cfgAiMistralModel').val().trim() || 'mistral-small-latest',
    };
    setBtnLoading(this, true);
    const el = $('#cfgAiTestResult');
    try {
      const res  = await fetch('/api/settings', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.ok) {
        el.show().attr('class', 'cfg-status ok').text('✓ Guardado');
        _cfgData = {..._cfgData, ...payload};
      } else {
        el.show().attr('class', 'cfg-status err').text('✗ Error al guardar');
      }
    } catch(e) {
      setBtnLoading(this, false);
      el.show().attr('class', 'cfg-status err').text('✗ ' + e.message);
    }
    setTimeout(() => el.hide(), 3500);
  });

  // Probar conexión IA — guarda primero, luego prueba el proveedor seleccionado
  $(document).on('click', '#cfgAiTest', async function() {
    const provider = $('#cfgAiProvider').val();
    const payload = {
      ai_provider:      provider,
      ai_gemini_key:    $('#cfgAiGeminiKey').val().trim(),
      ai_gemini_model:  $('#cfgAiGeminiModel').val().trim() || 'gemini-2.0-flash',
      ai_mistral_key:   $('#cfgAiMistralKey').val().trim(),
      ai_mistral_model: $('#cfgAiMistralModel').val().trim() || 'mistral-small-latest',
    };
    // Guardar en BD antes de probar para que cfg() tenga los valores actuales
    await fetch('/api/settings', {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    _cfgData = {..._cfgData, ...payload};

    setBtnLoading(this, true);
    const el = $('#cfgAiTestResult');
    el.show().attr('class', 'cfg-status').text('Probando…');
    try {
      const res  = await fetch('/api/scripts/ollama/status?test=true');
      const data = await res.json();
      setBtnLoading(this, false);
      if (data.available && data.model_ready) {
        const prov = (data.provider || provider).toUpperCase();
        el.attr('class', 'cfg-status ok')
          .text(`✓ ${prov} OK · ${data.model}`);
      } else {
        const err = data.error || 'No disponible';
        el.attr('class', 'cfg-status err').text(`✗ ${err}`);
      }
    } catch(e) {
      setBtnLoading(this, false);
      el.attr('class', 'cfg-status err').text('✗ ' + e.message);
    }
    setTimeout(() => el.hide(), 6000);
  });


  // ══════════════════════════════════════════════════════════
  // REDES SECUNDARIAS (Sesión 21)
  // ══════════════════════════════════════════════════════════

  let _netIfaces = [];  // cache de interfaces detectadas

  async function loadNetworks() {
    try {
      const [netRes, ifaceRes] = await Promise.all([
        fetch('/api/config/networks').then(r => r.json()),
        fetch('/api/config/network/interfaces').then(r => r.json()).catch(() => ({interfaces:[]}))
      ]);

      _netIfaces = (ifaceRes.interfaces || []);

      // Renderizar tabla primero
      const nets = netRes.networks || [];
      $('#cfgNetCount').text(nets.length);
      _renderTopbarRanges(_getCidrValue().split(',').map(x => x.trim()).filter(Boolean), nets.map(n => (n.cidr || '').trim()).filter(Boolean));
      const $tbody = $('#cfgNetTbody');
      if (!nets.length) {
        $tbody.html('<tr><td colspan="5" class="text-center text-muted py-3"><i class="bi bi-info-circle me-1"></i>No hay redes secundarias configuradas</td></tr>');
      } else {
        $tbody.html(nets.map(n => `
          <tr data-net-id="${n.id}">
            <td><input type="text" class="form-control form-control-sm net-label-inp" value="${_esc(n.label)}" placeholder="Etiqueta" style="min-width:100px"></td>
            <td><input type="text" class="form-control form-control-sm net-cidr-inp" value="${_esc(n.cidr)}" placeholder="192.168.x.0/24" style="min-width:130px"></td>
            <td>
              <select class="form-select form-select-sm net-iface-sel" style="min-width:120px">
                <option value="">— auto —</option>
                ${_netIfaces.map(i => `<option value="${i.name}" ${n.interface === i.name ? 'selected' : ''}>${i.name}${i.addrs && i.addrs.length ? ' (' + i.addrs[0] + ')' : ''}</option>`).join('')}
                ${n.interface && !_netIfaces.find(i => i.name === n.interface)
                  ? `<option value="${n.interface}" selected>${n.interface}</option>` : ''}
              </select>
            </td>
            <td>
              <div class="form-check form-switch mb-0">
                <input class="form-check-input net-enabled-chk" type="checkbox" ${n.enabled ? 'checked' : ''}>
              </div>
            </td>
            <td class="text-end">
              <button class="btn btn-outline-primary btn-sm net-save-btn me-1" title="Guardar"><i class="bi bi-check-lg"></i></button>
              <button class="btn btn-outline-danger btn-sm net-del-btn" title="Eliminar"><i class="bi bi-trash3"></i></button>
            </td>
          </tr>
        `).join(''));
      }

      // Refrescar selector "Añadir red" DESPUÉS de renderizar el tbody
      _refreshIfaceSelectors();

    } catch(e) {
      console.error('loadNetworks:', e);
    }
  }

  function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _renderIfaceOptions(selectedValue = '') {
    const opts = ['<option value="">— automático —</option>'];
    _netIfaces.forEach(iface => {
      const addrs = iface.addrs.length ? ` (${iface.addrs.join(', ')})` : '';
      opts.push(`<option value="${iface.name}" ${selectedValue === iface.name ? 'selected' : ''}>${iface.name}${addrs}</option>`);
    });
    if (selectedValue && !_netIfaces.find(i => i.name === selectedValue)) {
      opts.push(`<option value="${selectedValue}" selected>${selectedValue}</option>`);
    }
    return opts.join('');
  }

  function _refreshIfaceSelectors() {
    // Refresh the "add new" interface selector
    const addVal = $('#cfgNetIface').val() || '';
    $('#cfgNetIface').html(_renderIfaceOptions(addVal));
    // Refresh selectors in each existing row (preserve selected value)
    $('#cfgNetTbody .net-iface-sel').each(function() {
      const val = $(this).val() || $(this).find('option:selected').val() || '';
      $(this).html(_renderIfaceOptions(val));
      if (val) $(this).val(val);
    });
  }

  async function _detectHostInterfaces() {
    const data = await fetch('/api/config/network/interfaces').then(r => r.json());
    _netIfaces = data.interfaces || [];
    _refreshIfaceSelectors();
    return _netIfaces;
  }

  // Detectar interfaces
  $('#cfgNetDetectBtn').on('click', async function() {
    const $btn = $(this);
    $btn.prop('disabled', true).find('i').addClass('spin');
    const $msg = $('#cfgNetAddMsg');
    $msg.attr('class', 'text-muted').text('Detectando interfaces de red…');
    try {
      const data   = await fetch('/api/config/network/interfaces').then(r => r.json());
      _netIfaces   = data.interfaces || [];
      _refreshIfaceSelectors();
      if (_netIfaces.length) {
        const names = _netIfaces.map(i => {
          const addr = i.addrs && i.addrs.length ? ` (${i.addrs[0]})` : '';
          return `<strong>${i.name}</strong>${addr}`;
        }).join(', ');
        $msg.attr('class', 'text-success').html(`✓ Detectadas: ${names}`);
      } else {
        $msg.attr('class', 'text-warning').text('⚠ No se detectaron interfaces activas. Prueba escribiendo el nombre manualmente (ej: eth0, wlp2s0).');
      }
    } catch(e) {
      $msg.attr('class', 'text-danger').text('✗ Error: ' + e.message);
    }
    $btn.prop('disabled', false).find('i').removeClass('spin');
    setTimeout(() => $msg.text(''), 6000);
  });

  // Toggle manual interface input
  $(document).on('click', '#cfgNetIfaceToggle', function() {
    const $sel = $('#cfgNetIface');
    const $inp = $('#cfgNetIfaceManual');
    const manual = $inp.is(':visible');
    $sel.toggle(manual);
    $inp.toggle(!manual);
    $(this).text(manual ? '✎' : '✕').attr('title', manual ? 'Escribir manualmente' : 'Usar selector');
    if (!manual) $inp.focus();
  });

  // Get interface value from whichever input is active
  function _getNetIfaceValue() {
    const $inp = $('#cfgNetIfaceManual');
    if ($inp.is(':visible')) return $inp.val().trim();
    return $('#cfgNetIface').val() || '';
  }

  // Añadir red secundaria
  $(document).on('click', '#cfgNetAdd', async function() {
    const cidr  = $('#cfgNetCidr').val().trim();
    const label = $('#cfgNetLabel').val().trim();
    const iface = _getNetIfaceValue();
    const $msg  = $('#cfgNetAddMsg');
    if (!cidr) { $msg.attr('class','text-danger').text('El CIDR es obligatorio'); return; }
    try {
      const res = await fetch('/api/config/networks', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ cidr, label, interface: iface, enabled: 1 })
      });
      const data = await res.json();
      if (data.ok) {
        $msg.attr('class','text-success').text('✓ Red añadida');
        $('#cfgNetCidr').val(''); $('#cfgNetLabel').val('');
        await loadNetworks();
      } else {
        $msg.attr('class','text-danger').text('✗ ' + (data.error || 'Error'));
      }
    } catch(e) {
      $msg.attr('class','text-danger').text('✗ Error de red');
    }
    setTimeout(() => $msg.text(''), 3000);
  });

  async function _saveNetworkRow($tr, $btn = null) {
    const id = $tr.data('net-id');
    const payload = {
      label:     $tr.find('.net-label-inp').val().trim(),
      cidr:      $tr.find('.net-cidr-inp').val().trim(),
      interface: $tr.find('.net-iface-sel').val(),
      enabled:   $tr.find('.net-enabled-chk').is(':checked') ? 1 : 0,
    };
    if (!payload.cidr) return false;
    await fetch(`/api/config/networks/${id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    $tr.attr('data-dirty', '0');
    _refreshTopbarRangesFromState();
    if ($btn && $btn.length) {
      $btn.removeClass('btn-outline-primary').addClass('btn-success');
      setTimeout(() => $btn.removeClass('btn-success').addClass('btn-outline-primary'), 1500);
    }
    return true;
  }

  function _queueNetworkAutosave($tr) {
    $tr.attr('data-dirty', '1');
    clearTimeout(_netAutosaveTimer);
    _netAutosaveTimer = setTimeout(() => {
      _saveNetworkRow($tr).catch(err => console.error('autosave network:', err));
    }, 500);
  }

  $(document).on('input change', '.net-label-inp, .net-cidr-inp, .net-iface-sel, .net-enabled-chk', function() {
    const $tr = $(this).closest('tr');
    _queueNetworkAutosave($tr);
  });

  $(document).on('blur', '.net-label-inp, .net-cidr-inp', function() {
    const $tr = $(this).closest('tr');
    _saveNetworkRow($tr).catch(err => console.error('blur save network:', err));
  });

  // Guardar fila
  $(document).on('click', '.net-save-btn', async function() {
    const $tr  = $(this).closest('tr');
    try {
      await _saveNetworkRow($tr, $(this));
    } catch(e) { console.error(e); }
  });

  // Eliminar fila
  $(document).on('click', '.net-del-btn', async function() {
    if (!confirm('¿Eliminar esta red secundaria?')) return;
    const id = $(this).closest('tr').data('net-id');
    try {
      await fetch(`/api/config/networks/${id}`, { method: 'DELETE' });
      await loadNetworks();
    } catch(e) { console.error(e); }
  });

  // loadNetworks consolidado en listener único abajo
  // También al hacer click en la nav de Redes
  $(document).on('click', '.cfg-nav-btn[data-section="networks"]', function() {
    loadNetworks().catch(() => {});
    // Cargar nombre e interfaz de red principal + poblar selector
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (!d.ok) return;
      $('#cfgPrimaryNetLabel').val(d.settings.primary_net_label || '');
      _loadPrimaryIfaceSelector(d.settings.primary_net_interface || '');
    }).catch(() => {});
  });

  // Poblar selector de interfaz de la red principal con las interfaces detectadas
  async function _loadPrimaryIfaceSelector(selectedIface) {
    const $sel = $('#cfgPrimaryNetIface');
    try {
      const data = await fetch('/api/config/network/interfaces').then(r => r.json());
      $sel.html('<option value="">— automático —</option>');
      for (const iface of (data.interfaces || [])) {
        const ip  = iface.addrs && iface.addrs.length ? ` (${iface.addrs[0]})` : '';
        $sel.append(`<option value="${iface.name}">${iface.name}${ip}</option>`);
      }
      if (selectedIface) $sel.val(selectedIface);
    } catch(e) {}
  }

  // Botón refrescar interfaces de la red principal
  $(document).on('click', '#cfgPrimaryIfaceRefresh', async function() {
    const $btn = $(this);
    $btn.prop('disabled', true).find('i').addClass('spin');
    await _loadPrimaryIfaceSelector($('#cfgPrimaryNetIface').val());
    $btn.prop('disabled', false).find('i').removeClass('spin');
  });

  // Guardar nombre + interfaz red principal
  $(document).on('click', '#cfgPrimaryNetSave', async function() {
    const label = $('#cfgPrimaryNetLabel').val().trim();
    const iface = $('#cfgPrimaryNetIface').val() || '';
    const $msg  = $('#cfgPrimaryNetMsg');
    try {
      const res  = await fetch('/api/settings', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ primary_net_label: label, primary_net_interface: iface })
      });
      const data = await res.json();
      if (data.ok) {
        $msg.attr('class', 'small text-success').text('✓ Guardado');
        if (typeof window._primaryNetworks !== 'undefined' && window._primaryNetworks) {
          window._primaryNetworks.forEach(n => n.interface = iface);
        }
        if (typeof applyNetworkColors === 'function') applyNetworkColors();
      } else {
        $msg.attr('class', 'small text-danger').text('✗ Error');
      }
    } catch(e) {
      $msg.attr('class', 'small text-danger').text('✗ ' + e.message);
    }
    setTimeout(() => $msg.text(''), 3000);
  });

  // ════════════════════════════════════════════════════════════════
  //  Discrepancias nmap / router
  // ════════════════════════════════════════════════════════════════

  async function loadDiscrepancies() {
    const $wrap = $('#discTableWrap');
    const $badge = $('#discBadge');
    const $acceptAll = $('#discAcceptAllBtn');
    $wrap.html('<div class="small-muted" style="font-size:.8rem">Cargando…</div>');
    try {
      const data = await fetch('/api/scan/discrepancies').then(r => r.json());
      if (!data.ok) { $wrap.html('<span class="text-danger">Error al cargar</span>'); return; }

      const rows = data.discrepancies || [];
      const pending = rows.filter(r => !r.accepted);

      // Badge
      if (pending.length) {
        $badge.text(pending.length).show();
        $acceptAll.show();
      } else {
        $badge.hide();
        $acceptAll.hide();
      }

      if (!rows.length) {
        $wrap.html('<div class="small-muted" style="font-size:.8rem"><i class="bi bi-check-circle text-success me-1"></i>Sin discrepancias detectadas.</div>');
        return;
      }

      let html = `<table class="table table-sm table-hover align-middle mb-0" style="font-size:.78rem">
        <thead><tr>
          <th>IP</th><th>MAC</th><th>Nombre</th><th>Veces</th><th>Última vez</th><th>Estado</th><th></th>
        </tr></thead><tbody>`;

      for (const r of rows) {
        const name    = r.manual_name || r.nmap_hostname || r.router_hostname || '—';
        const vendor  = r.vendor ? `<br><span style="opacity:.5;font-size:.7rem">${esc(r.vendor)}</span>` : '';
        const mac     = r.mac || '—';
        const ts      = r.last_seen ? r.last_seen.replace('T',' ').slice(0,16) : '—';
        const status  = r.accepted
          ? `<span class="badge bg-success">✓ Válida</span>${r.note ? `<br><span style="opacity:.6;font-size:.7rem">${esc(r.note)}</span>` : ''}`
          : `<span class="badge bg-warning text-dark">⚠ Pendiente</span>`;
        const actions = r.accepted
          ? `<button class="btn btn-outline-danger btn-sm disc-delete" data-id="${r.id}" title="Eliminar del registro"><i class="bi bi-trash"></i></button>`
          : `<button class="btn btn-outline-success btn-sm disc-accept" data-id="${r.id}" title="Marcar como válida"><i class="bi bi-check-lg"></i></button>
             <button class="btn btn-outline-danger btn-sm disc-delete ms-1" data-id="${r.id}" title="Eliminar"><i class="bi bi-trash"></i></button>`;
        html += `<tr class="${r.accepted ? 'opacity-50' : ''}">
          <td><strong>${esc(r.ip)}</strong></td>
          <td style="font-family:monospace;font-size:.72rem">${esc(mac)}${vendor}</td>
          <td>${esc(name)}</td>
          <td>${r.times_seen}</td>
          <td>${ts}</td>
          <td>${status}</td>
          <td style="white-space:nowrap">${actions}</td>
        </tr>`;
      }
      html += '</tbody></table>';
      $wrap.html(html);
    } catch(e) {
      $wrap.html(`<span class="text-danger">Error: ${e.message}</span>`);
    }
  }

  // Refrescar al abrir el panel scanner
  $(document).on('click', '.cfg-nav-btn[data-section="scanner"]', function() {
    loadDiscrepancies();
  });

  $(document).on('click', '#discRefreshBtn', () => loadDiscrepancies());

  // Scan nmap manual bajo demanda
  $(document).on('click', '#discNmapNowBtn', async function() {
    const $btn = $(this);
    $btn.prop('disabled', true).html('<i class="bi bi-radar spin"></i> Escaneando…');
    try {
      const res  = await fetch('/api/scan/nmap-now', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        // Esperar ~15s y luego recargar discrepancias
        setTimeout(() => {
          loadDiscrepancies();
          $btn.prop('disabled', false).html('<i class="bi bi-radar"></i> Scan nmap ahora');
        }, 15000);
        // Feedback inmediato
        $btn.html('<i class="bi bi-radar spin"></i> Escaneando (15s)…');
      } else {
        alert('Error: ' + (data.error || 'desconocido'));
        $btn.prop('disabled', false).html('<i class="bi bi-radar"></i> Scan nmap ahora');
      }
    } catch(e) {
      alert('Error de red: ' + e.message);
      $btn.prop('disabled', false).html('<i class="bi bi-radar"></i> Scan nmap ahora');
    }
  });

  $(document).on('click', '#discAcceptAllBtn', async function() {
    await fetch('/api/scan/discrepancies/accept-all', { method: 'POST' });
    loadDiscrepancies();
  });

  // Aceptar una discrepancia (con nota opcional)
  $(document).on('click', '.disc-accept', async function() {
    const id   = $(this).data('id');
    const note = prompt('Nota opcional (ej: "Mi móvil de trabajo", "Dispositivo conocido"):') || '';
    await fetch(`/api/scan/discrepancies/${id}/accept`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ note })
    });
    loadDiscrepancies();
  });

  // Eliminar una discrepancia
  $(document).on('click', '.disc-delete', async function() {
    const id = $(this).data('id');
    if (!confirm('¿Eliminar este registro de discrepancia?')) return;
    await fetch(`/api/scan/discrepancies/${id}`, { method: 'DELETE' });
    loadDiscrepancies();
  });

  // Polling del badge de discrepancias en el topbar (cada 5 min o tras scan)
  window.refreshDiscrepancyBadge = async function() {
    try {
      const data = await fetch('/api/scan/discrepancies').then(r => r.json());
      if (!data.ok) return;
      const pending = (data.discrepancies || []).filter(r => !r.accepted).length;
      if (pending > 0) {
        $('#discTopbarBtn').show();
        $('#discTopbarCount').text(pending);
      } else {
        $('#discTopbarBtn').hide();
      }
    } catch(e) {}
  };

  // Llamar al inicio y cada 5 minutos
  $(function() {
    setTimeout(window.refreshDiscrepancyBadge, 4000); // 4s tras carga inicial
    setInterval(window.refreshDiscrepancyBadge, 5 * 60 * 1000);
  });


  // ════════════════════════════════════════════════════════════════
  //  Motor de detección — Config→Escáner
  // ════════════════════════════════════════════════════════════════

  async function loadDetectionMotor() {
    try {
      const [settRes, routerCheck] = await Promise.all([
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
      ]);
      if (!settRes.ok) return;
      const s = settRes.settings || {};
      const routerEnabled = s.router_enabled === '1' || s.router_enabled === true;

      // Radio fuente primaria
      const primary = s.scan_primary_source || (routerEnabled ? 'router' : 'nmap');
      $(`#scanPrimary${primary.charAt(0).toUpperCase()+primary.slice(1)}`).prop('checked', true);

      // Si no hay router, deshabilitar opción router y mostrar aviso
      if (!routerEnabled) {
        $('#scanPrimaryRouter').prop('disabled', true);
        $('#scanPrimaryNmap').prop('checked', true);
        $('#scanPrimaryRouterDisabled').show();
      } else {
        $('#scanPrimaryRouter').prop('disabled', false);
        $('#scanPrimaryRouterDisabled').hide();
      }

      // Fuente secundaria y su intervalo
      const secondary = s.scan_secondary_source || 'none';
      $('#cfgSecondarySource').val(secondary);
      const hours = s.nmap_complement_hours || '2';
      $('#cfgSecondaryInterval').val(hours);
      const aiEnabled = s.scan_secondary_ai === '1' || s.scan_secondary_ai === true;
      $('#cfgSecondaryAiEnabled').prop('checked', aiEnabled);

      _updateSecondaryVisibility(secondary);
    } catch(e) {}
  }

  function _updateSecondaryVisibility(val) {
    if (val && val !== 'none') {
      $('#cfgSecondaryIntervalWrap').css('display', 'flex');
      $('#cfgSecondaryAiWrap').show();
    } else {
      $('#cfgSecondaryIntervalWrap').css('display', 'none');
      $('#cfgSecondaryAiWrap').hide();
    }
  }

  // Actualizar visibilidad cuando cambia el selector de fuente secundaria
  $(document).on('change', '#cfgSecondarySource', function() {
    _updateSecondaryVisibility($(this).val());
  });

  // Guardar configuración del motor
  $(document).on('click', '#cfgDetectionSave', async function() {
    const $msg = $('#cfgDetectionMsg');
    const primary   = $('input[name="scanPrimary"]:checked').val() || 'nmap';
    const secondary = $('#cfgSecondarySource').val() || 'none';
    const hours     = $('#cfgSecondaryInterval').val() || '2';
    const aiEnabled = $('#cfgSecondaryAiEnabled').is(':checked') ? '1' : '0';
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          scan_primary_source:   primary,
          scan_secondary_source: secondary,
          nmap_complement_hours: hours,
          scan_secondary_ai:     aiEnabled,
        })
      });
      const data = await res.json();
      if (data.ok) {
        $msg.attr('class', 'small text-success').text('✓ Guardado — se aplica en el próximo scan');
        // Notificar al backend para re-registrar el job secundario
        await fetch('/api/scan/reconfigure-jobs', { method: 'POST' }).catch(() => {});
      } else {
        $msg.attr('class', 'small text-danger').text('✗ Error al guardar');
      }
    } catch(e) {
      $msg.attr('class', 'small text-danger').text('✗ ' + e.message);
    }
    setTimeout(() => $msg.text(''), 4000);
  });

  // Cargar motor al abrir el panel Escáner
  $(document).on('click', '.cfg-nav-btn[data-section="scanner"]', function() {
    loadDetectionMotor();
    loadDiscrepancies();
    loadAiReports();
  });

  // ── Listener único configModal — carga todos los datos al abrir ────────────
  // Consolidado aquí para garantizar que se registra UNA sola vez y que todos
  // los datos se cargan en el orden correcto sin race conditions.
  (function() {
    const modal = document.getElementById('configModal');
    if (!modal) { console.warn('[config] configModal no encontrado en DOM'); return; }
    modal.addEventListener('show.bs.modal', function() {
      // 1. Settings principales
      loadCfg();
      // 2. Tipos de dispositivo
      if (typeof loadCfgTypes === 'function') loadCfgTypes();
      // 3. Backup list
      if (typeof loadBackupList === 'function') loadBackupList();
      // 4. Redes secundarias
      loadNetworks().catch(() => {});
      // 5. Push
      if (typeof initPush === 'function') initPush();
      // 6. Acento guardado
      const saved = localStorage.getItem('accent_color');
      if (saved) {
        $('.accent-swatch').removeClass('active');
        $(`.accent-swatch[data-accent="${saved}"]`).addClass('active');
        $('#cfgAccentCustom').val(saved);
      }
    });
  })();


  // ── Alertas por script ──────────────────────────────────────────────────────

  async function loadScriptAlertRules() {
    const $wrap = $('#cfgScriptAlertsList');
    try {
      const [rulesRes, scriptsRes] = await Promise.all([
        fetch('/api/scripts/alert-rules').then(r => r.json()),
        fetch('/api/scripts/status').then(r => r.json()),
      ]);

      // Construir mapa de reglas existentes
      const rulesMap = {};
      (rulesRes.rules || []).forEach(r => { rulesMap[r.script_name] = r; });

      // Lista de scripts conocidos (del status + de la BD de monitored)
      const scripts = Array.isArray(scriptsRes) ? scriptsRes : [];

      if (!scripts.length) {
        $wrap.html('<div class="text-muted small">No hay scripts monitorizados todavía.</div>');
        return;
      }

      const rows = scripts.map(s => {
        const name  = s.name;
        const label = _esc(s.cfg_label || name);
        const rule  = rulesMap[name] || {};
        const chkMissed  = rule.alert_missed !== 0 ? 'checked' : '';
        const chkError   = rule.alert_error  !== 0 ? 'checked' : '';
        const maxHours   = rule.max_hours   ?? 25;
        const cooldown   = rule.cooldown_min ?? 60;
        const hasRule    = !!rulesMap[name];
        const lastFired  = rule.last_fired
          ? `<span class="text-muted small ms-2" title="Última alerta disparada">⏱ ${_esc(rule.last_fired.slice(0,16).replace('T',' '))}</span>`
          : '';

        return `
          <div class="cfg-script-alert-row p-2 rounded" data-script="${_esc(name)}"
               style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08)">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-1">
              <strong style="font-size:.88rem">${label}</strong>
              <div class="d-flex gap-1 align-items-center">
                ${lastFired}
                ${hasRule
                  ? `<button class="btn btn-outline-danger btn-xs cfg-script-alert-del py-0 px-2"
                       data-script="${_esc(name)}" title="Eliminar regla" style="font-size:.75rem">
                       <i class="bi bi-trash"></i>
                     </button>`
                  : ''}
              </div>
            </div>
            <div class="d-flex flex-wrap gap-3 align-items-center" style="font-size:.82rem">
              <label class="d-flex align-items-center gap-1" style="cursor:pointer">
                <input type="checkbox" class="form-check-input mt-0 sar-missed" ${chkMissed}>
                Sin ejecutarse más de
                <input type="number" class="form-control form-control-sm sar-hours d-inline-block"
                       value="${maxHours}" min="1" max="9999" step="0.5"
                       style="width:5rem;font-size:.82rem">
                h
              </label>
              <label class="d-flex align-items-center gap-1" style="cursor:pointer">
                <input type="checkbox" class="form-check-input mt-0 sar-error" ${chkError}>
                Si falla (exit_code ≠ 0)
              </label>
              <label class="d-flex align-items-center gap-1">
                Cooldown
                <input type="number" class="form-control form-control-sm sar-cooldown d-inline-block"
                       value="${cooldown}" min="5" max="10080" step="5"
                       style="width:4.5rem;font-size:.82rem">
                min
              </label>
              <button class="btn btn-sm btn-primary cfg-script-alert-save py-0 px-2"
                      data-script="${_esc(name)}" style="font-size:.8rem">
                <i class="bi bi-floppy2 me-1"></i>Guardar
              </button>
              <span class="sar-status cfg-status" style="display:none"></span>
            </div>
          </div>`;
      });

      $wrap.html(rows.join(''));
    } catch(e) {
      $wrap.html(`<div class="text-danger small">Error cargando reglas: ${_esc(String(e))}</div>`);
    }
  }

  // Guardar regla
  $(document).on('click', '.cfg-script-alert-save', async function() {
    const $row      = $(this).closest('.cfg-script-alert-row');
    const name      = $(this).data('script');
    const $status   = $row.find('.sar-status');
    const payload = {
      alert_missed: $row.find('.sar-missed').is(':checked'),
      max_hours:    parseFloat($row.find('.sar-hours').val()) || 25,
      alert_error:  $row.find('.sar-error').is(':checked'),
      cooldown_min: parseInt($row.find('.sar-cooldown').val()) || 60,
    };
    try {
      const res  = await fetch(`/api/scripts/alert-rules/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      $status.show().attr('class', 'sar-status cfg-status ' + (data.ok ? 'ok' : 'err'))
             .text(data.ok ? '✓ Guardado' : '✗ Error');
      if (data.ok) setTimeout(() => { $status.hide(); loadScriptAlertRules(); }, 1500);
    } catch(e) {
      $status.show().attr('class', 'sar-status cfg-status err').text('✗ Error de red');
    }
  });

  // Eliminar regla
  $(document).on('click', '.cfg-script-alert-del', async function() {
    const name = $(this).data('script');
    if (!confirm(`¿Eliminar la regla de alerta para "${name}"?`)) return;
    await fetch(`/api/scripts/alert-rules/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadScriptAlertRules();
  });

  // ── Historial de informes IA de red ────────────────────────────────────────

  async function loadAiReports() {
    const $wrap = $('#aiReportsListWrap');
    $wrap.html('<div class="small-muted" style="font-size:.8rem">Cargando…</div>');
    try {
      const res  = await fetch('/api/scan/ai-reports?limit=20');
      const data = await res.json();
      if (!data.ok || !data.reports.length) {
        $wrap.html('<div class="small-muted" style="font-size:.8rem">No hay informes generados todavía.</div>');
        return;
      }

      const rows = data.reports.map(r => {
        const dt      = (r.generated_at || '').slice(0, 16).replace('T', ' ');
        const disc    = r.discrepancy_count != null
          ? `<span class="badge ${r.discrepancy_count > 0 ? 'bg-warning text-dark' : 'bg-success'} ms-1"
                  style="font-size:.68rem">${r.discrepancy_count} discrepancia${r.discrepancy_count !== 1 ? 's' : ''}</span>`
          : '';
        const src     = r.source
          ? `<span class="badge bg-secondary ms-1" style="font-size:.65rem">${_esc(r.source)}</span>`
          : '';
        const preview = _esc((r.preview || '').replace(/#+\s*/g, '').slice(0, 120));

        return `
          <div class="ai-report-row d-flex align-items-start gap-2 py-2"
               style="border-bottom:1px solid rgba(255,255,255,0.06);cursor:pointer"
               data-report-id="${r.id}">
            <i class="bi bi-file-text mt-1" style="opacity:.5;flex-shrink:0"></i>
            <div style="min-width:0">
              <div class="d-flex align-items-center gap-1 flex-wrap">
                <span class="mono" style="font-size:.8rem">${dt}</span>
                ${disc}${src}
              </div>
              <div class="small-muted mt-1" style="font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${preview}…
              </div>
            </div>
            <button class="btn btn-outline-info btn-sm ms-auto ai-report-open flex-shrink-0"
                    data-report-id="${r.id}" style="font-size:.75rem;white-space:nowrap">
              <i class="bi bi-eye"></i> Ver
            </button>
          </div>`;
      });

      $wrap.html(`<div style="max-height:340px;overflow-y:auto">${rows.join('')}</div>`);
    } catch(e) {
      $wrap.html(`<div class="text-danger small">Error: ${_esc(String(e))}</div>`);
    }
  }

  // Refrescar al pulsar botón
  $(document).on('click', '#aiReportsRefreshBtn', () => loadAiReports());

  // Abrir modal de detalle al pulsar "Ver" o la fila
  $(document).on('click', '.ai-report-open, .ai-report-row', async function(e) {
    // Evitar doble disparo cuando se hace clic en el botón dentro de la fila
    if ($(e.target).closest('.ai-report-open').length && $(this).hasClass('ai-report-row')) return;
    const id   = $(this).data('report-id') || $(this).closest('[data-report-id]').data('report-id');
    if (!id) return;

    const $body = $('#aiReportDetailBody');
    const $meta = $('#aiReportDetailMeta');
    $body.html('<div class="text-center py-4"><div class="spinner-border text-info" role="status"></div></div>');
    $meta.text('');

    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('aiReportDetailModal'));
    modal.show();

    try {
      const res  = await fetch(`/api/scan/ai-reports/${id}`);
      const data = await res.json();
      if (!data.ok || !data.report) {
        $body.html('<div class="text-danger">Informe no encontrado.</div>');
        return;
      }
      const r  = data.report;
      const dt = (r.generated_at || '').slice(0, 16).replace('T', ' ');
      $meta.text(`${dt} · ${r.discrepancy_count ?? 0} discrepancia(s) · ${r.source || ''}`);
      const html = typeof marked !== 'undefined'
        ? marked.parse(r.report_text || '')
        : `<pre style="white-space:pre-wrap;font-size:.82rem">${_esc(r.report_text || '')}</pre>`;
      $body.html(`<div class="markdown-body" style="font-size:.88rem">${html}</div>`);
    } catch(e) {
      $body.html(`<div class="text-danger small">Error: ${_esc(String(e))}</div>`);
    }
  });

  // Cargar al abrir el panel Escáner
  $(document).on('click', '.cfg-nav-btn[data-section="scanner"]', function() {
    loadAiReports();
  });


  // ── Exportación histórica ───────────────────────────────────────────────────

  $(document).on('click', '.cfg-nav-btn[data-section="exports"]', function() {
    if (!$('#histExportFrom').val()) {
      const now  = new Date();
      const to   = now.toISOString().slice(0, 10);
      const from = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
      $('#histExportFrom').val(from);
      $('#histExportTo').val(to);
    }
  });

  $(document).on('click', '#histExportBtn', function() {
    const from = $('#histExportFrom').val();
    const to   = $('#histExportTo').val();
    const $msg = $('#histExportMsg');
    if (!from || !to) {
      $msg.text('Selecciona ambas fechas.').css('color','#f87171'); return;
    }
    if (from > to) {
      $msg.text('La fecha de inicio debe ser anterior al fin.').css('color','#f87171'); return;
    }
    $msg.text('Generando…').css('color','var(--accent)');
    setBtnLoading(this, true);
    const url = `/api/export/history?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`;
    fetch(url)
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Error servidor'); });
        return res.blob();
      })
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `auditor_historico_${from}_${to}.xlsx`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(a.href);
        $msg.text('✓ Descarga iniciada').css('color','#4ade80');
        setTimeout(() => $msg.text(''), 3000);
      })
      .catch(e => $msg.text('✗ ' + e.message).css('color','#f87171'))
      .finally(() => setBtnLoading(document.getElementById('histExportBtn'), false));
  });

}); // end $(function) — config.js
