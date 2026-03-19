/**
 * i18n.js — Auditor IPs · Sesión 26 (fix)
 * Diccionarios incrustados — sin fetch, sin 404.
 */
(function () {
  'use strict';

  const _DICTS = {
    es: {
      "tab.dashboard":"Dashboard","tab.hosts":"Hosts","tab.scans":"Ejecuciones",
      "tab.services":"Servicios","tab.map":"Mapa","tab.quality":"Calidad",
      "tab.groups":"Grupos","tab.alerts":"Alertas","tab.scripts":"Procesos",
      "topbar.scan_now":"Escanear ahora","topbar.config":"Configuración",
      "topbar.cross_check":"Verificación cruzada",
      "nav.scanner":"Escáner","nav.notifications":"Notificaciones",
      "nav.appearance":"Apariencia","nav.interface":"Interfaz",
      "nav.router":"Router SSH","nav.ai":"IA","nav.scripts":"Procesos",
      "nav.networks":"Redes","nav.backup":"Backup / BD",
      "nav.exports":"Exportar / Importar","nav.auth":"Seguridad","nav.audit":"Audit log",
      "cfg.save":"Guardar","cfg.discard":"Descartar","cfg.apply":"Aplicar",
      "cfg.test":"Probar conexión","cfg.send_test":"Enviar test","cfg.refresh":"Recargar",
      "status.online":"Online","status.offline":"Offline","status.unknown":"Desconocido",
      "status.loading":"Cargando…","status.saving":"Guardando…",
      "status.saved":"✓ Guardado","status.error":"✗ Error","status.sent":"✓ Enviado",
      "host.known":"Conocido","host.unknown":"Desconocido","host.new":"Nuevo",
      "host.scan_now":"Escanear ahora","host.wol":"Wake on LAN",
      "quality.start":"Iniciar pings","quality.stop":"Parar",
      "quality.latency":"Latencia","quality.loss":"Pérdida",
      "services.up":"Activo","services.down":"Caído","services.timeout":"Timeout",
      "alerts.enabled":"Activada","alerts.disabled":"Desactivada",
      "alerts.new_host":"Nuevo host detectado","alerts.offline":"Host se pone offline",
      "alerts.online":"Host vuelve online","alerts.mac_change":"Cambio de MAC"
    },
    en: {
      "tab.dashboard":"Dashboard","tab.hosts":"Hosts","tab.scans":"Runs",
      "tab.services":"Services","tab.map":"Map","tab.quality":"Quality",
      "tab.groups":"Groups","tab.alerts":"Alerts","tab.scripts":"Processes",
      "topbar.scan_now":"Scan now","topbar.config":"Settings",
      "topbar.cross_check":"Cross-check",
      "nav.scanner":"Scanner","nav.notifications":"Notifications",
      "nav.appearance":"Appearance","nav.interface":"Interface",
      "nav.router":"Router SSH","nav.ai":"AI","nav.scripts":"Processes",
      "nav.networks":"Networks","nav.backup":"Backup / DB",
      "nav.exports":"Export / Import","nav.auth":"Security","nav.audit":"Audit log",
      "cfg.save":"Save","cfg.discard":"Discard","cfg.apply":"Apply",
      "cfg.test":"Test connection","cfg.send_test":"Send test","cfg.refresh":"Refresh",
      "status.online":"Online","status.offline":"Offline","status.unknown":"Unknown",
      "status.loading":"Loading…","status.saving":"Saving…",
      "status.saved":"✓ Saved","status.error":"✗ Error","status.sent":"✓ Sent",
      "host.known":"Known","host.unknown":"Unknown","host.new":"New",
      "host.scan_now":"Scan now","host.wol":"Wake on LAN",
      "quality.start":"Start pings","quality.stop":"Stop",
      "quality.latency":"Latency","quality.loss":"Loss",
      "services.up":"Up","services.down":"Down","services.timeout":"Timeout",
      "alerts.enabled":"Enabled","alerts.disabled":"Disabled",
      "alerts.new_host":"New host detected","alerts.offline":"Host went offline",
      "alerts.online":"Host came online","alerts.mac_change":"MAC address changed"
    },
    ca: {
      "tab.dashboard":"Dashboard","tab.hosts":"Hosts","tab.scans":"Execucions",
      "tab.services":"Serveis","tab.map":"Mapa","tab.quality":"Qualitat",
      "tab.groups":"Grups","tab.alerts":"Alertes","tab.scripts":"Processos",
      "topbar.scan_now":"Escanejar ara","topbar.config":"Configuració",
      "topbar.cross_check":"Verificació creuada",
      "nav.scanner":"Escàner","nav.notifications":"Notificacions",
      "nav.appearance":"Aparença","nav.interface":"Interfície",
      "nav.router":"Router SSH","nav.ai":"IA","nav.scripts":"Processos",
      "nav.networks":"Xarxes","nav.backup":"Còpia de seguretat",
      "nav.exports":"Exportar / Importar","nav.auth":"Seguretat","nav.audit":"Registre d'auditoria",
      "cfg.save":"Desar","cfg.discard":"Descartar","cfg.apply":"Aplicar",
      "cfg.test":"Provar connexió","cfg.send_test":"Enviar prova","cfg.refresh":"Recarregar",
      "status.online":"En línia","status.offline":"Fora de línia","status.unknown":"Desconegut",
      "status.loading":"Carregant…","status.saving":"Desant…",
      "status.saved":"✓ Desat","status.error":"✗ Error","status.sent":"✓ Enviat",
      "host.known":"Conegut","host.unknown":"Desconegut","host.new":"Nou",
      "host.scan_now":"Escanejar ara","host.wol":"Despertar per xarxa",
      "quality.start":"Iniciar pings","quality.stop":"Aturar",
      "quality.latency":"Latència","quality.loss":"Pèrdua",
      "services.up":"Actiu","services.down":"Caigut","services.timeout":"Temps esgotat",
      "alerts.enabled":"Activada","alerts.disabled":"Desactivada",
      "alerts.new_host":"Nou host detectat","alerts.offline":"Host s'ha desconnectat",
      "alerts.online":"Host s'ha connectat","alerts.mac_change":"Canvi de MAC"
    }
  };

  let _active = 'es';

  window.t = function(key) {
    return (_DICTS[_active] && _DICTS[_active][key] !== undefined)
      ? _DICTS[_active][key]
      : ((_DICTS.es && _DICTS.es[key]) || key);
  };

  window.getLang = function() { return _active; };

  window.setLang = async function(lang) {
    if (!_DICTS[lang]) return;
    _active = lang;
    localStorage.setItem('auditor_lang', lang);
    _applyDOM();
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ui_lang: lang }),
      });
    } catch(_) {}
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  };

  window.applyI18n = function(root) {
    (root || document).querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      const val = window.t(key);
      if (attr) { el.setAttribute(attr, val); }
      else {
        // Actualiza solo el TextNode, preservando iconos/badges hijos
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.textContent = val; return;
          }
        }
        el.appendChild(document.createTextNode(val));
      }
    });
  };

  // Llamado desde config.js tras cargar settings desde BD
  window._i18nApplyFromSettings = function(lang) {
    if (lang && _DICTS[lang] && lang !== _active) {
      _active = lang;
      localStorage.setItem('auditor_lang', lang);
      _applyDOM();
    }
  };

  function _applyDOM() {
    window.applyI18n(document);
    const sel = document.getElementById('cfgLangSelect');
    if (sel) sel.value = _active;
  }

  function _init() {
    const saved = localStorage.getItem('auditor_lang');
    if (saved && _DICTS[saved]) _active = saved;
    _applyDOM();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
