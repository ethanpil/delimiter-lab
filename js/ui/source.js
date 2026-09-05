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
    var el = U.empty(this.el);
    var self = this;

    el.appendChild(U.el('div', { class: 'config-head' }, [
      U.el('div', {}, [
        U.el('h5', {}, [U.el('i', { class: 'bi bi-file-earmark-text text-primary' }), 'Source file']),
        U.el('p', { class: 'config-desc', text: 'Open a CSV, TSV, text or Excel file. Nothing leaves your computer: the file is read inside your browser.' })
      ])
    ]));

    var fileInput = U.el('input', { type: 'file', accept: DL.acceptedExtensions().join(','), hidden: true });
    fileInput.addEventListener('change', function () { if (fileInput.files[0]) self.actions.openFile(fileInput.files[0]); fileInput.value = ''; });
    el.appendChild(fileInput);

    var drop = U.el('div', { class: 'dropzone', tabindex: '0', role: 'button' }, [
      U.el('i', { class: 'bi bi-cloud-arrow-up' }),
      src.file ? U.el('div', {}, [U.el('strong', { text: src.file.name }), ' · ' + U.fmtBytes(src.file.size), U.el('div', { class: 'small', text: 'Drop another file here or click to change it' })])
        : U.el('div', {}, [U.el('strong', { text: 'Drop a file here' }), ' or click to choose one', U.el('div', { class: 'small mt-1', text: 'CSV, TSV, TXT, XLSX, XLS' })])
    ]);
    drop.addEventListener('click', function () { fileInput.click(); });
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation(); // the page-level drop handler must not open the file a second time
      drop.classList.remove('is-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) self.actions.openFile(e.dataTransfer.files[0]);
    });
    el.appendChild(drop);

    if (!src.file) {
      el.appendChild(U.el('div', { class: 'mt-2 small' }, [
        'No file at hand? ',
        U.el('a', { href: '#', text: 'Try the sample data', onclick: function (e) { e.preventDefault(); self.actions.loadSample(); } }),
        ' to see how Delimiter Lab works.'
      ]));
    }

    if (src.status === 'error') {
      el.appendChild(U.el('div', { class: 'alert alert-danger mt-3 mb-0' }, [U.el('i', { class: 'bi bi-exclamation-triangle me-1' }), src.error || 'The file could not be read.']));
    }

    if (src.file) el.appendChild(this.optionsForm());

    if (src.status === 'ready' && src.info) {
      var info = src.info;
      var bits = [DL.rowsAndColumns(info.rowCount, info.columns.length)];
      if (info.encoding) bits.push('encoding ' + info.encoding.toUpperCase());
      if (info.delimiter) bits.push('separator ' + describeDelimiter(info.delimiter));
      if (info.sheet) bits.push('sheet "' + info.sheet + '"');
      bits.push('read in ' + (info.ms / 1000).toFixed(1) + ' s');
      var box = U.el('div', { class: 'alert alert-light border mt-3 mb-0 py-2' }, [
        U.el('div', {}, [U.el('i', { class: 'bi bi-check-circle text-success me-1' }), bits.join(' · ')])
      ]);
      if (info.notes.length) {
        box.appendChild(U.el('ul', { class: 'notes-list mt-1 mb-0 text-warning-emphasis' }, info.notes.map(function (n) { return U.el('li', { text: n }); })));
      }
      el.appendChild(box);
    }
  };

  function describeDelimiter(d) {
    if (d === '\t') return 'tab';
    if (d === ',') return 'comma';
    if (d === ';') return 'semicolon';
    if (d === '|') return 'pipe';
    return '"' + d + '"';
  }

  SourceView.prototype.optionsForm = function () {
    var self = this;
    var st = this.store.state;
    var o = st.source.options;
    var format = DL.inputFormatFor(st.source.file.name);
    var apply = U.debounce(function () { self.actions.reload(); }, 400);

    var params = format.options;
    var rendered = DL.fields.renderAll(params, o, { columns: null, compact: false }, function (key, value, opts) {
      var patch = {};
      patch[key] = value;
      self.store.setSourceOptions(patch);
      DL.fields.updateVisibility(params, self.store.state.source.options, rendered.els);
      var def = DL.findOption(params.map(function (p) { return { value: p.key, param: p }; }), key).param;
      if (def.reload === 'now' && !(opts && opts.merge)) { apply.cancel(); self.actions.reload(); }
      else apply();
    });
    DL.fields.updateVisibility(params, o, rendered.els);
    var grid = rendered.grid;
    grid.classList.add('mt-3');

    if (format.hasSheets) {
      var sheets = st.source.sheets || [];
      var options = sheets.length ? sheets.map(function (s) { return { value: s, label: s }; }) : [{ value: '', label: 'Reading sheets…' }];
      var current = o.sheet || (st.source.info && st.source.info.sheet) || sheets[0] || '';
      var sheetSel = U.select(options, current, function (v) { self.store.setSourceOptions({ sheet: v }); apply.cancel(); self.actions.reload(); });
      grid.insertBefore(U.el('div', { class: 'field' }, [U.el('label', { class: 'field-label', text: 'Sheet' }), sheetSel]), grid.firstChild);
    }
    return grid;
  };

  SourceView.sampleFile = function () {
    return new File([SAMPLE_CSV], 'sample-contacts.csv', { type: 'text/csv' });
  };

  DL.SourceView = SourceView;
})(typeof self !== 'undefined' ? self : this);
