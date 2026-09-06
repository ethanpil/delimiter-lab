/* Dialogs: operation picker, download, saved workflows, help. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var D = DL.dialogs = {};

  var CATEGORY_ORDER = ['Text', 'Dates', 'Rows', 'Columns', 'Quality', 'Advanced', 'Other'];

  /* ---------- Operation picker ---------- */
  D.pickOperation = function (opts, onPick) {
    var search = U.el('input', { type: 'search', class: 'form-control', placeholder: 'Search operations… (for example "trim" or "duplicates")', autofocus: true });
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
      var cats = Object.keys(groups).sort(function (a, b) { return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b); });
      if (!cats.length) list.appendChild(U.el('div', { class: 'text-secondary p-3 text-center', text: 'No operation matches "' + q + '".' }));
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
    m = U.modal({
      title: opts && opts.title ? opts.title : 'Add a step',
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
    var many = !!opts.files; // apply the workflow to many files: the name is the name of the zip file
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
      U.el('div', {}, [U.el('label', { class: 'form-label mb-1', text: 'Format' }), fmt]),
      U.el('div', {}, [U.el('label', { class: 'form-label mb-1', text: 'File name' }), name]),
      optionsBox
    ]);
    var m = U.modal({
      title: many ? 'Apply the workflow to ' + DL.pluralize(opts.files.length, 'file') : 'Download',
      enterSubmits: true,
      body: body,
      footer: [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', 'data-bs-dismiss': 'modal', text: 'Cancel' }),
        U.el('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var problems = [];
          current.options.forEach(function (p) { problems = problems.concat(DL.paramTypes[p.type].validate(values[current.id][p.key], p, null)); });
          if (problems.length) { U.toast(problems[0], 'warning'); return; }
          m.close();
          onDownload(Object.assign({ format: current.id }, values[current.id]), U.safeFileName(name.value), values);
        } }, [U.el('i', { class: 'bi bi-download' }), many ? ' Apply and download' : ' Download'])
      ]
    });
  };

  // Shows what happened to each file of a batch: the result, the error and the notes.
  D.batchReport = function (items) {
    var failed = items.filter(function (it) { return it.error; });
    U.modal({
      title: failed.length ? DL.pluralize(failed.length, 'file') + ' of ' + items.length + ' failed' : 'All ' + DL.pluralize(items.length, 'file') + ' done',
      scrollable: true,
      body: U.el('ul', { class: 'file-list report-list' }, items.map(function (it) {
        var icon = it.error ? 'bi-x-circle text-danger' : it.notes && it.notes.length ? 'bi-exclamation-triangle text-warning' : 'bi-check-circle text-success';
        return U.el('li', {}, [
          U.el('div', { class: 'd-flex gap-2' }, [
            U.el('i', { class: 'bi ' + icon }),
            U.el('span', { class: 'fw-semibold', text: it.name }),
            U.el('span', { class: 'text-secondary ms-auto', text: it.error ? '' : DL.pluralize(it.rowCount, 'row') })
          ]),
          it.error ? U.el('div', { class: 'small text-danger', text: (it.step ? 'Step ' + it.step + ': ' : '') + it.error }) : null,
          it.notes && it.notes.length ? U.el('ul', { class: 'notes-list small text-secondary' }, it.notes.map(function (n) { return U.el('li', { text: n }); })) : null
        ]);
      })),
      footer: [U.el('button', { type: 'button', class: 'btn btn-primary', 'data-bs-dismiss': 'modal', text: 'Close' })]
    });
  };

  /* ---------- Saved workflows ---------- */
  D.workflows = function (opts, actions) {
    // opts: { currentColumns, currentId }, actions: { apply(wf), importFile(file) }
    var search = U.el('input', { type: 'search', class: 'form-control', placeholder: 'Search saved workflows…', autofocus: true });
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
      var level = function (w) { return DL.workflows.matchLevel(w, opts.currentColumns); };
      var rank = { full: 0, partial: 1, unknown: 2, none: 3 };
      items.sort(function (a, b) {
        var d = rank[level(a)] - rank[level(b)];
        return d !== 0 ? d : (b.lastUsedAt || b.updatedAt) - (a.lastUsedAt || a.updatedAt);
      });
      if (!all.length) {
        list.appendChild(U.el('div', { class: 'text-center text-secondary p-4' }, [
          U.el('i', { class: 'bi bi-collection d-block fs-2 mb-2' }),
          'No saved workflows yet. Build some steps, then click "Save" to keep them for the next file.'
        ]));
        return;
      }
      if (!items.length) list.appendChild(U.el('div', { class: 'text-secondary p-3 text-center', text: 'Nothing matches your search.' }));
      items.forEach(function (w) {
        var lv = level(w);
        var badge = lv === 'full' ? U.el('span', { class: 'badge text-bg-success', text: 'Fits this file' })
          : lv === 'partial' ? U.el('span', { class: 'badge text-bg-warning', text: 'Some columns missing' })
          : lv === 'none' ? U.el('span', { class: 'badge text-bg-light text-secondary', text: 'Different columns' }) : null;
        var opsText = w.steps.map(function (s) { var op = DL.getOp(s.opId); return op ? op.name : s.opId; }).join(' → ');
        var item = U.el('div', { class: 'wf-item' + (lv === 'full' ? ' is-match' : '') }, [
          U.el('div', { class: 'flex-grow-1', style: 'min-width:0' }, [
            U.el('div', { class: 'd-flex align-items-center gap-2' }, [U.el('span', { class: 'wf-name', text: w.name }), badge, w.id === opts.currentId ? U.el('span', { class: 'badge text-bg-primary', text: 'Open now' }) : null]),
            U.el('div', { class: 'wf-meta text-truncate', title: opsText, text: DL.pluralize(w.steps.length, 'step') + ' · ' + opsText }),
            U.el('div', { class: 'wf-meta', text: 'Saved ' + U.fmtTime(w.updatedAt) + (w.uses ? ' · used ' + DL.pluralize(w.uses, 'time') : '') })
          ]),
          U.el('div', { class: 'btn-group btn-group-sm' }, [
            U.el('button', { type: 'button', class: 'btn btn-primary', title: 'Use this workflow', onclick: function () { m.close(); actions.apply(w); } }, [U.el('i', { class: 'bi bi-play-fill' }), ' Use']),
            U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: 'Rename', onclick: function () {
              U.prompt({ title: 'Rename workflow', value: w.name }, function (v) { DL.workflows.rename(w.id, v); build(); if (actions.renamed) actions.renamed(w.id, v); });
            } }, [U.el('i', { class: 'bi bi-pencil' })]),
            U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: 'Export as a file to share or back up', onclick: function () {
              U.downloadBlob(new Blob([DL.workflows.toJSON(w)], { type: 'application/json' }), U.safeFileName(w.name) + '.workflow.json');
            } }, [U.el('i', { class: 'bi bi-box-arrow-up' })]),
            U.el('button', { type: 'button', class: 'btn btn-outline-danger', title: 'Delete', onclick: function () {
              U.confirm({ title: 'Delete workflow', message: 'Delete "' + w.name + '"? This cannot be undone.', yes: 'Delete', danger: true }, function () { DL.workflows.remove(w.id); build(); if (actions.removed) actions.removed(w.id); });
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
      title: 'Saved workflows',
      size: 'lg',
      scrollable: true,
      body: [
        U.el('div', { class: 'd-flex gap-2' }, [search, U.el('button', { type: 'button', class: 'btn btn-outline-secondary text-nowrap', onclick: function () { importInput.click(); } }, [U.el('i', { class: 'bi bi-box-arrow-in-down' }), ' Import file']), importInput]),
        U.el('div', { class: 'form-text', text: 'Workflows are kept in this browser. Export a workflow to move it to another computer or share it.' }),
        list
      ]
    });
  };

  /* ---------- Help ---------- */
  D.help = function () {
    var body = U.el('div', {}, [
      U.el('h6', { text: 'How it works' }),
      U.el('ol', {}, [
        U.el('li', { text: 'Open a CSV, TSV, text or Excel file. It stays on your computer.' }),
        U.el('li', { text: 'Add steps. Each step changes the data that comes out of the step before it.' }),
        U.el('li', { text: 'Click any step to see its result in the preview. Download the result of any step.' }),
        U.el('li', { text: 'Save the workflow to reuse it on the next file with the same columns.' })
      ]),
      U.el('h6', { class: 'mt-3', text: 'Keyboard shortcuts' }),
      U.el('table', { class: 'table table-sm' }, [
        U.el('tbody', {}, [
          shortcut('Ctrl+Z / Ctrl+Y', 'Undo / redo'),
          shortcut('Ctrl+S', 'Save workflow'),
          shortcut('Ctrl+D', 'Download the selected step'),
          shortcut('Ctrl+O', 'Open a file'),
          shortcut('Ctrl+F', 'Find in the preview'),
          shortcut('Insert', 'Add a step'),
          shortcut('Delete', 'Delete the selected step'),
          shortcut('Alt+↑ / Alt+↓', 'Select the previous / next step')
        ])
      ]),
      U.el('h6', { class: 'mt-3', text: 'Tips' }),
      U.el('ul', {}, [
        U.el('li', { text: 'Drag steps in the list to change their order.' }),
        U.el('li', { text: 'Turn a step off to see the result without it.' }),
        U.el('li', { text: 'Use "Compare" above the preview to see a step\'s input and output side by side.' }),
        U.el('li', { text: 'Your steps are kept in the browser, so you can reload the page and carry on. Files are never stored.' })
      ]),
      U.el('p', { class: 'text-secondary small mb-0', text: 'Delimiter Lab runs fully in your browser. No data is sent anywhere.' })
    ]);
    function shortcut(keys, what) {
      return U.el('tr', {}, [U.el('td', {}, [U.el('kbd', { text: keys })]), U.el('td', { text: what })]);
    }
    U.modal({ title: 'Help', body: body, scrollable: true });
  };
})(typeof self !== 'undefined' ? self : this);
