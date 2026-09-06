/* Small helpers shared by the UI. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util = {};

  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  U.uid = function () {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  U.debounce = function (fn, ms) {
    var t = null;
    var wrapped = function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(self, args); }, ms);
    };
    wrapped.flush = function () { if (t) { clearTimeout(t); t = null; fn(); } };
    wrapped.cancel = function () { clearTimeout(t); t = null; };
    return wrapped;
  };

  U.fmtInt = function (n) {
    return (n == null || isNaN(n)) ? '' : Number(n).toLocaleString();
  };

  U.fmtBytes = function (b) {
    if (!(b >= 0)) return '';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  U.fmtTime = function (ts) {
    if (!(ts > 0)) return '';
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.round(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' h ago';
    return d.toLocaleDateString();
  };

  var idCounter = 0;
  U.domId = function (prefix) {
    return (prefix || 'dl') + '_' + (++idCounter);
  };

  // Builds an element: U.el('div', {class:'x', onclick: fn}, [children])
  U.el = function (tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { e.dataset[d] = v[d]; });
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      });
    }
    if (children != null) U.append(e, children);
    return e;
  };

  U.append = function (parent, children) {
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      if (typeof c === 'string') parent.appendChild(document.createTextNode(c));
      else parent.appendChild(c);
    });
    return parent;
  };

  U.empty = function (el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };

  // A <select> from [{ value, label }] options.
  U.select = function (options, value, onChange, attrs) {
    var sel = U.el('select', Object.assign({ class: 'form-select form-select-sm' }, attrs || {}));
    options.forEach(function (o) { sel.appendChild(U.el('option', { value: o.value, text: o.label })); });
    sel.value = value == null ? '' : value;
    if (onChange) sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  };

  // A checkbox with a label. Gives { el, input }.
  U.check = function (label, on, onChange, opts) {
    var id = U.domId('chk');
    var input = U.el('input', { type: 'checkbox', class: 'form-check-input', id: id, role: opts && opts.switch ? 'switch' : null });
    input.checked = !!on;
    if (onChange) input.addEventListener('change', function () { onChange(input.checked); });
    var lab = U.el('label', { class: 'form-check-label', for: id, text: label });
    if (opts && opts.help) lab.appendChild(U.helpIcon(opts.help));
    return { input: input, el: U.el('div', { class: 'form-check' + (opts && opts.switch ? ' form-switch' : '') + (opts && opts.class ? ' ' + opts.class : '') }, [input, lab]) };
  };

  U.helpIcon = function (text) {
    return U.el('i', { class: 'bi bi-info-circle help-icon ms-1', title: text, tabindex: '0' });
  };

  U.toast = function (message, kind) {
    var wrap = document.getElementById('toasts');
    var t = U.el('div', { class: 'toast align-items-center text-bg-' + (kind || 'dark') + ' border-0', role: kind === 'danger' ? 'alert' : 'status' }, [
      U.el('div', { class: 'd-flex' }, [
        U.el('div', { class: 'toast-body', text: message }),
        U.el('button', { type: 'button', class: 'btn-close btn-close-white me-2 m-auto', 'data-bs-dismiss': 'toast', 'aria-label': DL.t('common.close') })
      ])
    ]);
    wrap.appendChild(t);
    var inst = new bootstrap.Toast(t, { delay: kind === 'danger' ? 8000 : 3500 });
    t.addEventListener('hidden.bs.toast', function () { t.remove(); });
    inst.show();
  };

  // Opens a Bootstrap modal built from a body element. Returns { modal, el, close }.
  U.modal = function (opts) {
    var host = document.getElementById('modals');
    var el = U.el('div', { class: 'modal fade', tabindex: '-1', 'aria-hidden': 'true' }, [
      U.el('div', { class: 'modal-dialog ' + (opts.size ? 'modal-' + opts.size : '') + (opts.scrollable ? ' modal-dialog-scrollable' : '') }, [
        U.el('div', { class: 'modal-content' }, [
          U.el('div', { class: 'modal-header' }, [
            U.el('h5', { class: 'modal-title', text: opts.title || '' }),
            U.el('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'modal', 'aria-label': DL.t('common.close') })
          ]),
          U.el('div', { class: 'modal-body' }, opts.body),
          opts.footer ? U.el('div', { class: 'modal-footer' }, opts.footer) : null
        ])
      ])
    ]);
    host.appendChild(el);
    var modal = new bootstrap.Modal(el);
    var afterHidden = [];
    el.addEventListener('hidden.bs.modal', function () {
      modal.dispose();
      el.remove();
      if (opts.onHidden) opts.onHidden();
      afterHidden.forEach(function (fn) { fn(); });
    });
    el.addEventListener('shown.bs.modal', function () {
      var f = el.querySelector('[autofocus], input:not([type=hidden]), button.btn-primary');
      if (f) f.focus();
      if (opts.onShown) opts.onShown(el);
    });
    // Enter activates the main button in small dialogs (not while typing in a text area).
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || !opts.enterSubmits) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'button' || tag === 'a') return;
      var btn = el.querySelector('.modal-footer .btn-primary, .modal-footer .btn-danger');
      if (btn) { e.preventDefault(); btn.click(); }
    });
    modal.show();
    return {
      modal: modal,
      el: el,
      close: function () { modal.hide(); },
      // Closes the dialog and runs fn when it is gone, so the next dialog does not open over it.
      closeThen: function (fn) { afterHidden.push(fn); modal.hide(); }
    };
  };

  // Confirm dialog. Calls onYes for the main button, onAlt for the second button when opts.alt gives
  // its text, and onCancel when the dialog closes in another way. A callback runs after the dialog is
  // gone, so it can open the next dialog.
  U.confirm = function (opts, onYes, onCancel, onAlt) {
    var m;
    var chosen = false;
    var buttons = [U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: DL.t('common.cancel') })];
    if (opts.alt) {
      buttons.push(U.el('button', { type: 'button', class: 'btn btn-outline-primary', text: opts.alt, onclick: function () { chosen = true; m.closeThen(function () { if (onAlt) onAlt(); }); } }));
    }
    buttons.push(U.el('button', { type: 'button', class: 'btn btn-' + (opts.danger ? 'danger' : 'primary'), text: opts.yes || DL.t('common.ok'), autofocus: true, onclick: function () { chosen = true; m.closeThen(function () { if (onYes) onYes(); }); } }));
    m = U.modal({
      onHidden: function () { if (!chosen && onCancel) onCancel(); },
      enterSubmits: true,
      title: opts.title || DL.t('common.sure'),
      body: U.el('p', { class: 'mb-0', text: opts.message || '' }),
      footer: buttons
    });
  };

  // Text prompt dialog. Calls onValue(text) when the user submits a value, onCancel when the dialog closes without one.
  U.prompt = function (opts, onValue, onCancel) {
    var input = U.el('input', { type: 'text', class: 'form-control', value: opts.value || '', placeholder: opts.placeholder || '', maxlength: '80', autofocus: true });
    var m;
    var chosen = false;
    var submit = function () {
      var v = input.value.trim();
      if (!v) { input.classList.add('is-invalid'); return; }
      chosen = true;
      m.closeThen(function () { onValue(v); });
    };
    m = U.modal({
      onHidden: function () { if (!chosen && onCancel) onCancel(); },
      enterSubmits: true,
      title: opts.title || '',
      body: [opts.message ? U.el('p', { text: opts.message }) : null, input],
      footer: [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: DL.t('common.cancel') }),
        U.el('button', { type: 'button', class: 'btn btn-primary', text: opts.yes || DL.t('common.ok'), onclick: submit })
      ],
      onShown: function () { input.focus(); input.select(); }
    });
  };

  // One tooltip handler per container. Elements inside can be added and removed at any time.
  // Bootstrap moves "title" to "data-bs-original-title" when it shows a tooltip, so both are matched.
  U.tooltips = function (container) {
    if (bootstrap.Tooltip.getInstance(container)) return;
    new bootstrap.Tooltip(container, { selector: '[title]:not(.no-tip), [data-bs-original-title]:not(.no-tip)', delay: { show: 500, hide: 0 }, trigger: 'hover focus' });
  };

  // Removes every tooltip that is on screen. Use it when another panel takes the place of the tooltip.
  U.hideTooltips = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tooltip'), function (tip) { tip.remove(); });
  };

  // Removes the tooltips whose element is no longer in the page. Views call this after they rebuild their content.
  U.hideOrphanTooltips = function () {
    Array.prototype.forEach.call(document.querySelectorAll('.tooltip.show'), function (tip) {
      var owner = document.querySelector('[aria-describedby="' + tip.id + '"]');
      if (!owner || !owner.isConnected) tip.remove();
    });
  };

  U.downloadBlob = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = U.el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 2000);
  };

  U.baseName = function (fileName) {
    return String(fileName || 'data').replace(/\.[^.]+$/, '');
  };

  // Makes a file name that every file system accepts. A long name is cut before its extension.
  U.safeFileName = function (s) {
    var clean = String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    if (clean.length > 100) {
      var m = /\.[a-z0-9]{1,8}$/i.exec(clean);
      var ext = m ? m[0] : '';
      clean = clean.slice(0, 100 - ext.length).trim() + ext;
    }
    return clean || 'output';
  };

  // Estimates the number of cells that this browser can hold without a slow user interface.
  U.cellBudget = function () {
    var gb = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
    var cells = Math.round(gb * 2.5e6);
    return Math.max(4e6, Math.min(30e6, cells));
  };
})(typeof self !== 'undefined' ? self : this);
