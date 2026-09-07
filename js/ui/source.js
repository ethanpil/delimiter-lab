/* Source panel: choose a file and set how it is read. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  var SAMPLE_CSV = 'Full Name,Email,City,Amount,Signup Date,Status\n' +
    'dr. john a. smith jr.,John.Smith@example.com,new york,"1,250.50",2024-01-15,active\n' +
    '"Doe, Jane",jane@example.com,  Boston ,89,02/03/2024,Active\n' +
    'maría garcía,maria@example,Madrid,"2.300,75",2023-12-01,inactive\n' +
    'Ludwig van Beethoven,ludwig@example.org,Bonn,,1827-03-26,active\n' +
    'dr. john a. smith jr.,John.Smith@example.com,new york,"1,250.50",2024-01-15,active\n' +
    'Li Wei,li.wei@example.cn,Shanghai,15000,2024-05-20,pending\n' +
    'Amara Okafor,amara@example.com,Lagos,-45,2024-06-30,active\n' +
    'Sam O\'Neil,sam@example.com,Dublin,120,not a date,ACTIVE\n';

  function SourceView(container, store, actions) {
    this.el = container;
    this.store = store;
    this.actions = actions; // { openFile(file), reload(), loadSample() }
  }

  SourceView.prototype.render = function () {
    var st = this.store.state;
    var src = st.source;
    var self = this;
    // While the user types in an option, the reload must not rebuild the form under the cursor.
    var active = document.activeElement;
    if (active && this.el.contains(active) && active.tagName.toLowerCase() === 'input' && src.file) {
      this.pendingRender = true;
      var onBlur = function () { active.removeEventListener('blur', onBlur); if (self.pendingRender) { self.pendingRender = false; self.render(); } };
      active.addEventListener('blur', onBlur);
      return;
    }
    this.pendingRender = false;
    var el = U.empty(this.el);

    el.appendChild(U.el('div', { class: 'config-head' }, [
      U.el('div', {}, [
        U.el('h5', {}, [U.el('i', { class: 'bi bi-file-earmark-text text-primary' }), DL.t('preview.sourceFile')]),
        U.el('p', { class: 'config-desc', text: DL.t('source.intro') })
      ])
    ]));

    var fileInput = U.el('input', { type: 'file', accept: DL.acceptedExtensions().join(','), multiple: true, hidden: true });
    fileInput.addEventListener('change', function () { self.actions.openFiles(Array.from(fileInput.files)); fileInput.value = ''; });
    el.appendChild(fileInput);

    var drop = U.el('div', { class: 'dropzone', tabindex: '0', role: 'button' }, [
      U.el('i', { class: 'bi bi-cloud-arrow-up' }),
      src.file ? U.el('div', {}, [U.el('strong', { text: src.file.name }), ' · ' + U.fmtBytes(src.file.size), U.el('div', { class: 'small', text: DL.t('source.dropAnother') })])
        : U.el('div', {}, [U.el('strong', { text: DL.t('source.dropHere') }), DL.t('source.orClick'), U.el('div', { class: 'small mt-1', text: DL.t('source.formats', { types: DL.acceptedExtensions().map(function (e) { return e.slice(1).toUpperCase(); }).join(', ') }) })])
    ]);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation(); // the page-level drop handler must not open the file a second time
      drop.classList.remove('is-over');
      if (e.dataTransfer.files) self.actions.openFiles(Array.from(e.dataTransfer.files));
    });
    el.appendChild(drop);

    if (!src.file) {
      el.appendChild(U.el('div', { class: 'mt-2 small' }, [
        DL.t('source.noFile'),
        U.el('a', { href: '#', text: DL.t('source.trySample'), onclick: function (e) { e.preventDefault(); self.actions.loadSample(); } }),
        DL.t('source.sampleSuffix')
      ]));
    }

    if (src.status === 'error') {
      el.appendChild(U.el('div', { class: 'alert alert-danger mt-3 mb-0' }, [U.el('i', { class: 'bi bi-exclamation-triangle me-1' }), src.error || DL.t('msg.fileNotRead')]));
    }

    if (src.files.length > 1 || (src.file && stacking(st))) el.appendChild(this.fileList());
    if (src.file) el.appendChild(this.optionsForm());

    if (src.status === 'ready' && src.info) {
      var info = src.info;
      var bits = [DL.rowsAndColumns(info.rowCount, info.columns.length)];
      if (info.encoding) bits.push(DL.t('source.encoding', { name: info.encoding.toUpperCase() }));
      if (info.delimiter) bits.push(DL.t('source.separator', { name: describeDelimiter(info.delimiter) }));
      if (info.sheet) bits.push(DL.t('source.sheet', { name: info.sheet }));
      bits.push(DL.t('source.readIn', { s: (info.ms / 1000).toFixed(1) }));
      var box = U.el('div', { class: 'alert alert-light border mt-3 mb-0 py-2' }, [
        U.el('div', {}, [U.el('i', { class: 'bi bi-check-circle text-success me-1' }), bits.join(' · ')])
      ]);
      if (info.notes.length) {
        box.appendChild(U.el('ul', { class: 'notes-list mt-1 mb-0 text-warning-emphasis' }, info.notes.map(function (n) { return U.el('li', { text: n }); })));
      }
      el.appendChild(box);
    }
  };

  function stacking(st) { return st.source.options.multiFile === 'stack'; }

  // The files of the source, with the rows that each one gave and a way to take one out.
  SourceView.prototype.fileList = function () {
    var self = this;
    var st = this.store.state;
    var files = st.source.files;
    var info = st.source.info;
    var rowsOf = {};
    if (info && info.files) info.files.forEach(function (f) { rowsOf[f.name + ':' + f.size] = f.rowCount; });
    var items = files.map(function (f, i) {
      var rows = rowsOf[f.name + ':' + f.size];
      return U.el('li', { class: 'source-file' }, [
        U.el('i', { class: 'bi bi-file-earmark-text me-2 text-secondary' }),
        U.el('span', { class: 'source-file-name', text: f.name }),
        U.el('span', { class: 'text-secondary ms-2 small', text: U.fmtBytes(f.size) + (rows === undefined ? '' : ' · ' + DL.pluralize(rows, 'row')) }),
        U.el('button', {
          type: 'button', class: 'btn btn-sm btn-link text-danger ms-auto p-0',
          title: DL.t('source.removeFile'), 'aria-label': DL.t('source.removeFile'),
          onclick: function () { self.actions.removeFile(i); }
        }, [U.el('i', { class: 'bi bi-x-lg' })])
      ]);
    });
    var add = U.el('input', { type: 'file', multiple: true, accept: DL.acceptedExtensions().join(','), hidden: true });
    add.addEventListener('change', function () {
      var picked = Array.prototype.slice.call(add.files);
      add.value = '';
      if (picked.length) self.actions.addFiles(picked);
    });
    return U.el('div', { class: 'mt-3' }, [
      U.el('div', { class: 'field-label', text: DL.t('source.files') }),
      U.el('ul', { class: 'source-file-list' }, items),
      U.el('div', { class: 'd-flex align-items-center gap-2 mt-2' }, [
        U.el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: function () { add.click(); } },
          [U.el('i', { class: 'bi bi-plus-lg me-1' }), DL.t('source.addFiles')]),
        U.el('span', { class: 'text-secondary small', text: DL.t('source.stackHint') }),
        add
      ])
    ]);
  };

  function describeDelimiter(d) {
    if (d === '\t') return DL.t('source.tab');
    if (d === ',') return DL.t('source.comma');
    if (d === ';') return DL.t('source.semicolon');
    if (d === '|') return DL.t('source.pipe');
    return '"' + d + '"';
  }

  SourceView.prototype.optionsForm = function () {
    var self = this;
    var st = this.store.state;
    var o = st.source.options;
    var format = DL.inputFormatFor(st.source.file.name);
    var apply = U.debounce(function () { self.actions.reload(); }, 400);

    var params = format.options;
    // Typed values (merge) reload after a pause; switches and choices reload at once.
    var rendered = DL.fields.renderAll(params, o, { columns: null, compact: false }, function (key, value, opts) {
      var patch = {};
      patch[key] = value;
      self.store.setSourceOptions(patch);
      DL.fields.updateVisibility(params, self.store.state.source.options, rendered.els);
      if (opts && opts.merge) apply();
      else { apply.cancel(); self.actions.reload(); }
    });
    DL.fields.updateVisibility(params, o, rendered.els);
    var grid = rendered.grid;
    grid.classList.add('mt-3');

    if (format.hasSheets) {
      var sheets = st.source.sheets || [];
      var options = sheets.length ? sheets.map(function (s) { return { value: s, label: s }; }) : [{ value: '', label: DL.t('source.readingSheets') }];
      var current = o.sheet || (st.source.info && st.source.info.sheet) || sheets[0] || '';
      var sheetSel = U.select(options, current, function (v) { self.store.setSourceOptions({ sheet: v }); apply.cancel(); self.actions.reload(); });
      grid.insertBefore(U.el('div', { class: 'field' }, [U.el('label', { class: 'field-label', text: DL.t('source.sheetLabel') }), sheetSel]), grid.firstChild);
    }
    return grid;
  };

  SourceView.sampleFile = function () {
    return new File([SAMPLE_CSV], 'sample-contacts.csv', { type: 'text/csv' });
  };

  DL.SourceView = SourceView;
})(typeof self !== 'undefined' ? self : this);
