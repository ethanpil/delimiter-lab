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
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  };

  U.fmtTime = function (ts) {
    var d = new Date(ts);
    var diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.round(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' h ago';
    return d.toLocaleDateString();
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
        else if (k === 'html') e.innerHTML = v;
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

  U.toast = function (message, kind) {
    var wrap = document.getElementById('toasts');
    var t = U.el('div', { class: 'toast align-items-center text-bg-' + (kind || 'dark') + ' border-0', role: 'status' }, [
      U.el('div', { class: 'd-flex' }, [
        U.el('div', { class: 'toast-body', text: message }),
        U.el('button', { type: 'button', class: 'btn-close btn-close-white me-2 m-auto', 'data-bs-dismiss': 'toast', 'aria-label': 'Close' })
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
            U.el('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'modal', 'aria-label': 'Close' })
          ]),
          U.el('div', { class: 'modal-body' }, opts.body),
          opts.footer ? U.el('div', { class: 'modal-footer' }, opts.footer) : null
        ])
      ])
    ]);
    host.appendChild(el);
    var modal = new bootstrap.Modal(el, { backdrop: opts.static ? 'static' : true });
    el.addEventListener('hidden.bs.modal', function () { modal.dispose(); el.remove(); if (opts.onClose) opts.onClose(); });
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
    return { modal: modal, el: el, close: function () { modal.hide(); } };
  };

  // Simple confirm dialog. Calls onYes when confirmed.
  U.confirm = function (opts, onYes) {
    var m;
    m = U.modal({
      enterSubmits: true,
      title: opts.title || 'Are you sure?',
      body: U.el('p', { class: 'mb-0', text: opts.message || '' }),
      footer: [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: 'Cancel' }),
        U.el('button', { type: 'button', class: 'btn btn-' + (opts.danger ? 'danger' : 'primary'), text: opts.yes || 'OK', autofocus: true, onclick: function () { m.close(); onYes(); } })
      ]
    });
  };

  // Text prompt dialog. Calls onValue(text) when submitted with a non-empty value.
  U.prompt = function (opts, onValue) {
    var input = U.el('input', { type: 'text', class: 'form-control', value: opts.value || '', placeholder: opts.placeholder || '', maxlength: '80', autofocus: true });
    var m;
    var submit = function () {
      var v = input.value.trim();
      if (!v) { input.classList.add('is-invalid'); return; }
      m.close();
      onValue(v);
    };
    m = U.modal({
      enterSubmits: true,
      title: opts.title || '',
      body: [opts.message ? U.el('p', { text: opts.message }) : null, input],
      footer: [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: 'Cancel' }),
        U.el('button', { type: 'button', class: 'btn btn-primary', text: opts.yes || 'OK', onclick: submit })
      ],
      onShown: function () { input.focus(); input.select(); }
    });
  };

  U.initTooltips = function (scope) {
    var els = (scope || document).querySelectorAll('[data-bs-toggle="tooltip"], [title]:not(.no-tip)');
    els.forEach(function (e) {
      if (bootstrap.Tooltip.getInstance(e)) return;
      new bootstrap.Tooltip(e, { delay: { show: 500, hide: 0 }, trigger: 'hover' });
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

  U.safeFileName = function (s) {
    return String(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'output';
  };

  // Estimates how many cells this browser can hold comfortably.
  U.cellBudget = function () {
    var gb = (typeof navigator !== 'undefined' && navigator.deviceMemory) ? navigator.deviceMemory : 4;
    var cells = Math.round(gb * 2.5e6);
    return Math.max(4e6, Math.min(30e6, cells));
  };
})(typeof self !== 'undefined' ? self : this);
