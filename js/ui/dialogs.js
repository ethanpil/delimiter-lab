/* Dialogs: operation picker, download, saved workflows, help. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var D = DL.dialogs = {};

  var CATEGORY_ORDER = ['Text', 'Dates', 'Rows', 'Columns', 'Quality', 'Advanced', 'Other'];

  /* ---------- Operation picker ---------- */
  D.pickOperation = function (opts, onPick) {
    var search = U.el('input', { type: 'search', class: 'form-control', placeholder: DL.t('picker.search'), autofocus: true });
    var list = U.el('div');
    var m;
    function build(q) {
      U.empty(list);
      q = (q || '').trim().toLowerCase();
      var groups = {};
      DL.ops.forEach(function (op) {
        var hay = (op.name + ' ' + op.description + ' ' + op.category + ' ' + (op.keywords || '')).toLowerCase();
        if (q && hay.indexOf(q) < 0) return;
        (groups[op.category] = groups[op.category] || []).push(op);
      });
      var rank = function (c) { var i = CATEGORY_ORDER.indexOf(c); return i < 0 ? CATEGORY_ORDER.length : i; }; // unknown groups go last
      var cats = Object.keys(groups).sort(function (a, b) { return rank(a) - rank(b) || a.localeCompare(b); });
      if (!cats.length) list.appendChild(U.el('div', { class: 'text-secondary p-3 text-center', text: DL.t('picker.noMatch', { q: q }) }));
      cats.forEach(function (cat) {
        list.appendChild(U.el('div', { class: 'op-category', text: cat }));
        var grid = U.el('div', { class: 'op-grid' });
        groups[cat].forEach(function (op) {
          grid.appendChild(U.el('button', { type: 'button', class: 'op-card', onclick: function () { m.close(); onPick(op.id); } }, [
            U.el('i', { class: 'bi ' + op.icon }),
            U.el('div', {}, [U.el('div', { class: 'op-name', text: op.name }), U.el('div', { class: 'op-desc', text: op.description })])
          ]));
        });
        list.appendChild(grid);
      });
    }
    build('');
    search.addEventListener('input', function () { build(search.value); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var first = list.querySelector('.op-card'); if (first) first.click(); }
      if (e.key === 'ArrowDown') { var f = list.querySelector('.op-card'); if (f) { e.preventDefault(); f.focus(); } }
    });
    // The arrow keys move between the cards; ArrowUp on the first card goes back to the search box.
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      var cards = Array.prototype.slice.call(list.querySelectorAll('.op-card'));
      var at = cards.indexOf(document.activeElement);
      if (at < 0) return;
      e.preventDefault();
      var next = at + (e.key === 'ArrowDown' ? 1 : -1);
      if (next < 0) search.focus(); else if (next < cards.length) cards[next].focus();
    });
    m = U.modal({
      title: opts && opts.title ? opts.title : DL.t('dialog.pickOperation'),
      size: 'lg',
      scrollable: true,
      body: [search, U.el('div', { class: 'mt-2' }, [list])]
    });
  };

  /* ---------- Download ---------- */
  D.download = function (opts, onDownload) {
    var formats = DL.outputFormats;
    var current = DL.outputFormatById(opts.lastFormat) || formats[0];
    var values = {};
    formats.forEach(function (f) { values[f.id] = Object.assign(DL.defaultFormatOptions(f), opts.lastOptions && opts.lastOptions[f.id] || {}); });
    var many = !!opts.files; // True when the workflow applies to many files. The name is then the name of the zip file.
    var name = U.el('input', { type: 'text', class: 'form-control', value: opts.baseName + (many ? '.zip' : current.extension) });
    var optionsBox = U.el('div');
    var fmt = U.select(formats.map(function (f) { return { value: f.id, label: f.label }; }), current.id, function (v) {
      var prev = current;
      current = DL.outputFormatById(v);
      if (!many) name.value = name.value.replace(new RegExp(DL.escapeRegExp(prev.extension) + '$', 'i'), '') + current.extension;
      renderOptions();
    }, { class: 'form-select' });
    function renderOptions() {
      U.empty(optionsBox);
      var rendered = DL.fields.renderAll(current.options, values[current.id], { columns: null, compact: true }, function (key, value) {
        values[current.id][key] = value;
      });
      rendered.grid.classList.add('mt-1');
      optionsBox.appendChild(rendered.grid);
    }
    renderOptions();
    var fileList = many ? U.el('ul', { class: 'file-list' }, opts.files.map(function (f) {
      return U.el('li', {}, [U.el('span', { text: f.name }), U.el('span', { class: 'text-secondary', text: U.fmtBytes(f.size) })]);
    })) : null;
    var body = U.el('div', { class: 'd-flex flex-column gap-3' }, [
      opts.note ? U.el('div', { class: 'alert alert-info py-2 mb-0', text: opts.note }) : null,
      fileList,
      U.el('div', {}, [U.el('label', { class: 'form-label mb-1', text: DL.t('dialog.format') }), fmt]),
      U.el('div', {}, [U.el('label', { class: 'form-label mb-1', text: DL.t('dialog.fileName') }), name]),
      optionsBox
    ]);
    var m = U.modal({
      title: many ? DL.t('dialog.batch', { files: DL.pluralize(opts.files.length, 'file') }) : DL.t('dialog.download'),
      enterSubmits: true,
      body: body,
      footer: [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: DL.t('common.cancel') }),
        U.el('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var problems = [];
          current.options.forEach(function (p) { problems = problems.concat(DL.paramTypes[p.type].validate(values[current.id][p.key], p, null)); });
          if (problems.length) { U.toast(problems[0], 'warning'); return; }
          m.close();
          var fileName = U.safeFileName(name.value);
          if (!many && !/\.[a-z0-9]{1,8}$/i.test(fileName)) fileName += current.extension;
          if (many && !/\.zip$/i.test(fileName)) fileName += '.zip';
          onDownload(Object.assign({ format: current.id }, values[current.id]), fileName, values);
        } }, [U.el('i', { class: 'bi bi-download' }), ' ' + DL.t(many ? 'dialog.applyDownload' : 'dialog.download')])
      ]
    });
  };

  // Shows what happened to each file of a batch: the result, the error and the notes.
  D.batchReport = function (items) {
    var failed = items.filter(function (it) { return it.error; });
    U.modal({
      title: failed.length ? DL.t('dialog.batchFailed', { failed: DL.pluralize(failed.length, 'file'), total: items.length }) : DL.t('dialog.batchDone', { files: DL.pluralize(items.length, 'file') }),
      scrollable: true,
      body: U.el('ul', { class: 'file-list report-list' }, items.map(function (it) {
        var icon = it.error ? 'bi-x-circle text-danger' : it.notes && it.notes.length ? 'bi-exclamation-triangle text-warning' : 'bi-check-circle text-success';
        return U.el('li', {}, [
          U.el('div', { class: 'd-flex gap-2' }, [
            U.el('i', { class: 'bi ' + icon }),
            U.el('span', { class: 'fw-semibold', text: it.name }),
            U.el('span', { class: 'text-secondary ms-auto', text: it.error ? '' : DL.pluralize(it.rowCount, 'row') })
          ]),
          it.error ? U.el('div', { class: 'small text-danger', text: (it.step ? DL.t('dialog.stepPrefix', { n: it.step }) : '') + it.error }) : null,
          it.notes && it.notes.length ? U.el('ul', { class: 'notes-list small text-secondary' }, it.notes.map(function (n) { return U.el('li', { text: n }); })) : null
        ]);
      })),
      footer: [U.el('button', { type: 'button', class: 'btn btn-primary', 'data-bs-dismiss': 'modal', text: DL.t('common.close') })]
    });
  };

  /* ---------- Saved workflows ---------- */
  D.workflows = function (opts, actions) {
    // opts: { currentColumns, currentId }, actions: { apply(wf), importFile(file) }
    var search = U.el('input', { type: 'search', class: 'form-control', placeholder: DL.t('wf.search'), autofocus: true });
    var list = U.el('div', { class: 'mt-3' });
    var m;
    var importInput = U.el('input', { type: 'file', accept: '.json,application/json', hidden: true });
    importInput.addEventListener('change', function () {
      if (importInput.files[0]) { actions.importFile(importInput.files[0]); m.close(); }
    });
    function build() {
      U.empty(list);
      var q = search.value.trim().toLowerCase();
      var all = DL.workflows.list();
      var items = all.filter(function (w) { return !q || (w.name + ' ' + w.steps.map(function (s) { var op = DL.getOp(s.opId); return op ? op.name : ''; }).join(' ')).toLowerCase().indexOf(q) >= 0; });
      var levels = {};
      items.forEach(function (w) { levels[w.id] = DL.workflows.matchLevel(w, opts.currentColumns); });
      var level = function (w) { return levels[w.id]; };
      var rank = { full: 0, partial: 1, unknown: 2, none: 3 };
      items.sort(function (a, b) {
        var d = rank[level(a)] - rank[level(b)];
        return d !== 0 ? d : (b.lastUsedAt || b.updatedAt) - (a.lastUsedAt || a.updatedAt);
      });
      if (!all.length) {
        list.appendChild(U.el('div', { class: 'text-center text-secondary p-4' }, [
          U.el('i', { class: 'bi bi-collection d-block fs-2 mb-2' }),
          DL.t('wf.empty')
        ]));
        return;
      }
      if (!items.length) list.appendChild(U.el('div', { class: 'text-secondary p-3 text-center', text: DL.t('wf.noMatch') }));
      items.forEach(function (w) {
        var lv = level(w);
        var badge = lv === 'full' ? U.el('span', { class: 'badge text-bg-success', text: DL.t('wf.fits') })
          : lv === 'partial' ? U.el('span', { class: 'badge text-bg-warning', text: DL.t('wf.someMissing') })
          : lv === 'none' ? U.el('span', { class: 'badge text-bg-light text-secondary', text: DL.t('wf.differentColumns') }) : null;
        var opsText = w.steps.map(function (s) { var op = DL.getOp(s.opId); return op ? op.name : s.opId; }).join(' → ');
        var item = U.el('div', { class: 'wf-item flex-wrap' + (lv === 'full' ? ' is-match' : '') }, [
          U.el('div', { class: 'flex-grow-1', style: 'min-width:0' }, [
            U.el('div', { class: 'd-flex align-items-center gap-2' }, [U.el('span', { class: 'wf-name', text: w.name }), badge, w.id === opts.currentId ? U.el('span', { class: 'badge text-bg-primary', text: DL.t('wf.openNow') }) : null]),
            U.el('div', { class: 'wf-meta text-truncate', title: opsText, text: DL.t('wf.stepsMeta', { steps: DL.pluralize(w.steps.length, 'step'), ops: opsText }) }),
            U.el('div', { class: 'wf-meta', text: DL.t('wf.savedMeta', { when: U.fmtTime(w.updatedAt) }) + (w.uses ? DL.t('wf.usedMeta', { times: DL.pluralize(w.uses, 'time') }) : '') })
          ]),
          U.el('div', { class: 'btn-group btn-group-sm' }, [
            U.el('button', { type: 'button', class: 'btn btn-primary', title: DL.t('dialog.useWorkflow'), onclick: function () { m.close(); actions.apply(w); } }, [U.el('i', { class: 'bi bi-play-fill' }), ' ' + DL.t('common.use')]),
            U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: DL.t('common.rename'), onclick: function () {
              // One dialog at a time: the list opens again after the prompt.
              m.closeThen(function () {
                U.prompt({ title: DL.t('dialog.renameWorkflow'), value: w.name }, function (v) { DL.workflows.rename(w.id, v); if (actions.renamed) actions.renamed(w.id, v); D.workflows(opts, actions); }, function () { D.workflows(opts, actions); });
              });
            } }, [U.el('i', { class: 'bi bi-pencil' })]),
            U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: DL.t('dialog.exportWorkflow'), onclick: function () {
              U.downloadBlob(new Blob([DL.workflows.toJSON(w)], { type: 'application/json' }), U.safeFileName(w.name) + '.workflow.json');
            } }, [U.el('i', { class: 'bi bi-download' }), ' ' + DL.t('wf.exportFile')]),
            U.el('button', { type: 'button', class: 'btn btn-outline-danger', title: DL.t('common.delete'), onclick: function () {
              m.closeThen(function () {
                U.confirm({ title: DL.t('dialog.deleteWorkflow'), message: DL.t('dialog.deleteConfirm', { name: w.name }), yes: DL.t('common.delete'), danger: true }, function () { DL.workflows.remove(w.id); if (actions.removed) actions.removed(w.id); D.workflows(opts, actions); }, function () { D.workflows(opts, actions); });
              });
            } }, [U.el('i', { class: 'bi bi-trash' })])
          ])
        ]);
        list.appendChild(item);
      });
    }
    search.addEventListener('input', build);
    search.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var b = list.querySelector('.btn-primary'); if (b) b.click(); } });
    build();
    m = U.modal({
      title: DL.t('dialog.savedWorkflows'),
      size: 'lg',
      scrollable: true,
      body: [
        U.el('div', { class: 'd-flex gap-2' }, [search, U.el('button', { type: 'button', class: 'btn btn-outline-secondary text-nowrap', onclick: function () { importInput.click(); } }, [U.el('i', { class: 'bi bi-upload' }), ' ' + DL.t('wf.importFile')]), importInput]),
        U.el('div', { class: 'form-text', text: DL.t('wf.kept') }),
        list
      ]
    });
  };

  /* ---------- Help ---------- */
  D.help = function () {
    var body = U.el('div', {}, [
      U.el('h6', { text: DL.t('help.howItWorks') }),
      U.el('ol', {}, [
        U.el('li', { text: DL.t('help.step1') }),
        U.el('li', { text: DL.t('help.step2') }),
        U.el('li', { text: DL.t('help.step3') }),
        U.el('li', { text: DL.t('help.step4') })
      ]),
      U.el('h6', { class: 'mt-3', text: DL.t('help.shortcuts') }),
      U.el('table', { class: 'table table-sm' }, [
        U.el('tbody', {}, [
          shortcut('Ctrl+Z / Ctrl+Y', DL.t('help.undoRedo')),
          shortcut('Ctrl+S', DL.t('help.saveWorkflow')),
          shortcut('Ctrl+D', DL.t('help.downloadStep')),
          shortcut('Ctrl+O', DL.t('help.openFile')),
          shortcut('Ctrl+F', DL.t('help.find')),
          shortcut('Insert', DL.t('help.addStep')),
          shortcut('Delete', DL.t('help.deleteStep')),
          shortcut('Alt+↑ / Alt+↓', DL.t('help.prevNextStep'))
        ])
      ]),
      U.el('h6', { class: 'mt-3', text: DL.t('help.tips') }),
      U.el('ul', {}, [
        U.el('li', { text: DL.t('help.tip1') }),
        U.el('li', { text: DL.t('help.tip2') }),
        U.el('li', { text: DL.t('help.tip3') }),
        U.el('li', { text: DL.t('help.tip4') }),
        U.el('li', { text: DL.t('help.tip5') }),
        U.el('li', { text: DL.t('help.tip6') }),
        U.el('li', { text: DL.t('help.tip7') }),
        U.el('li', { text: DL.t('help.tip8') }),
        U.el('li', { text: DL.t('help.tip9') })
      ]),
      U.el('p', { class: 'text-secondary small mb-0', text: DL.t('help.local') })
    ]);
    function shortcut(keys, what) {
      return U.el('tr', {}, [U.el('td', {}, [U.el('kbd', { text: keys })]), U.el('td', { text: what })]);
    }
    U.modal({ title: DL.t('dialog.help'), body: body, scrollable: true });
  };
})(typeof self !== 'undefined' ? self : this);
