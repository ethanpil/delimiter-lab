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

    var fileInput = U.el('input', { type: 'file', accept: '.csv,.tsv,.txt,.tab,.dat,.psv,.xlsx,.xlsm,.xls,.xlsb,.ods,text/csv,text/plain', hidden: true });
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
      e.preventDefault(); drop.classList.remove('is-over');
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
      var bits = [U.fmtInt(info.rowCount) + ' rows', info.columns.length + ' columns'];
      if (info.encoding) bits.push('encoding ' + info.encoding.toUpperCase());
      if (info.delimiter) bits.push('separator ' + describeDelimiter(info.delimiter));
      if (info.sheet) bits.push('sheet "' + info.sheet + '"');
      bits.push('read in ' + (info.ms / 1000).toFixed(1) + ' s');
      var box = U.el('div', { class: 'alert alert-light border mt-3 mb-0 py-2' }, [
        U.el('div', {}, [U.el('i', { class: 'bi bi-check-circle text-success me-1' }), bits.join(' · ')])
      ]);
      if (info.notes && info.notes.length) {
        box.appendChild(U.el('ul', { class: 'notes-list mt-1 mb-0 text-warning-emphasis' }, info.notes.map(function (n) { return U.el('li', { text: n }); })));
      }
      el.appendChild(box);
    }
    U.initTooltips(el);
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
    var isSheet = /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(st.source.file.name);
    var grid = U.el('div', { class: 'field-grid mt-3' });

    var apply = U.debounce(function () { self.actions.reload(); }, 400);
    var change = function (patch, immediate) {
      self.store.setSourceOptions(patch);
      if (immediate) { apply.cancel(); self.actions.reload(); } else apply();
    };

    // Headers
    var hid = 'src_headers';
    var headers = U.el('input', { type: 'checkbox', class: 'form-check-input', role: 'switch', id: hid });
    headers.checked = o.headers !== false;
    headers.addEventListener('change', function () { change({ headers: headers.checked }, true); });
    grid.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field-label', text: 'Headers' }),
      U.el('div', { class: 'form-check form-switch' }, [headers, U.el('label', { class: 'form-check-label', for: hid, text: 'First row holds the column names' }),
        U.el('i', { class: 'bi bi-info-circle help-icon ms-1', 'data-bs-toggle': 'tooltip', title: 'Turn this off if the first row is data. Columns are then named "Column 1", "Column 2", …' })])
    ]));

    // Skip rows
    var skip = U.el('input', { type: 'number', class: 'form-control form-control-sm', min: '0', max: '100000', value: o.skipRows || 0 });
    skip.addEventListener('input', function () { change({ skipRows: Math.max(0, parseInt(skip.value, 10) || 0) }); });
    grid.appendChild(U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field-label' }, ['Skip rows at the top', U.el('i', { class: 'bi bi-info-circle help-icon', 'data-bs-toggle': 'tooltip', title: 'Use this when the file starts with notes or a title before the real header row.' })]),
      skip
    ]));

    if (isSheet) {
      var sheetSel = U.el('select', { class: 'form-select form-select-sm' });
      var sheets = st.source.sheets || [];
      if (!sheets.length) sheetSel.appendChild(U.el('option', { value: '', text: 'Reading sheets…' }));
      sheets.forEach(function (s) { sheetSel.appendChild(U.el('option', { value: s, text: s })); });
      sheetSel.value = o.sheet || (st.source.info && st.source.info.sheet) || sheets[0] || '';
      sheetSel.addEventListener('change', function () { change({ sheet: sheetSel.value }, true); });
      grid.appendChild(U.el('div', { class: 'field' }, [U.el('label', { class: 'field-label', text: 'Sheet' }), sheetSel]));
    } else {
      var delim = U.el('select', { class: 'form-select form-select-sm' });
      [['auto', 'Detect automatically'], [',', 'Comma ( , )'], ['\\t', 'Tab'], [';', 'Semicolon ( ; )'], ['|', 'Pipe ( | )'], ['custom', 'Other…']].forEach(function (x) { delim.appendChild(U.el('option', { value: x[0], text: x[1] })); });
      var custom = U.el('input', { type: 'text', class: 'form-control form-control-sm mt-1', placeholder: 'Type the separator', maxlength: '5' });
      var known = ['auto', ',', '\\t', ';', '|'];
      if (known.indexOf(o.delimiter) >= 0) { delim.value = o.delimiter; custom.hidden = true; }
      else { delim.value = 'custom'; custom.value = o.delimiter; }
      delim.addEventListener('change', function () {
        if (delim.value === 'custom') { custom.hidden = false; custom.focus(); return; }
        custom.hidden = true;
        change({ delimiter: delim.value }, true);
      });
      custom.addEventListener('input', function () { if (custom.value) change({ delimiter: custom.value }); });
      grid.appendChild(U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field-label' }, ['Column separator', U.el('i', { class: 'bi bi-info-circle help-icon', 'data-bs-toggle': 'tooltip', title: 'The character between values. Detected automatically in most files.' })]),
        delim, custom
      ]));

      var quote = U.el('select', { class: 'form-select form-select-sm' });
      [['"', 'Double quote ( " )'], ["'", "Single quote ( ' )"], [' ', 'None']].forEach(function (x) { quote.appendChild(U.el('option', { value: x[0], text: x[1] })); });
      quote.value = o.quoteChar || '"';
      quote.addEventListener('change', function () { change({ quoteChar: quote.value }, true); });
      grid.appendChild(U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field-label' }, ['Text delimiter', U.el('i', { class: 'bi bi-info-circle help-icon', 'data-bs-toggle': 'tooltip', title: 'The character that wraps values which contain the separator, for example "Doe, Jane".' })]),
        quote
      ]));

      var enc = U.el('select', { class: 'form-select form-select-sm' });
      [['auto', 'Detect automatically'], ['utf-8', 'UTF-8'], ['windows-1252', 'Windows-1252 (Western Europe)'], ['iso-8859-1', 'ISO-8859-1 (Latin 1)'], ['utf-16le', 'UTF-16'], ['macintosh', 'Mac Roman'], ['windows-1251', 'Windows-1251 (Cyrillic)'], ['shift_jis', 'Shift JIS (Japanese)'], ['gbk', 'GBK (Chinese)']].forEach(function (x) { enc.appendChild(U.el('option', { value: x[0], text: x[1] })); });
      enc.value = o.encoding || 'auto';
      enc.addEventListener('change', function () { change({ encoding: enc.value }, true); });
      grid.appendChild(U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field-label' }, ['File encoding', U.el('i', { class: 'bi bi-info-circle help-icon', 'data-bs-toggle': 'tooltip', title: 'Change this if accented letters look wrong (for example Ã© instead of é).' })]),
        enc
      ]));

      var eid = 'src_skipempty';
      var skipEmpty = U.el('input', { type: 'checkbox', class: 'form-check-input', role: 'switch', id: eid });
      skipEmpty.checked = o.skipEmptyLines !== false;
      skipEmpty.addEventListener('change', function () { change({ skipEmptyLines: skipEmpty.checked }, true); });
      grid.appendChild(U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field-label', text: 'Empty lines' }),
        U.el('div', { class: 'form-check form-switch' }, [skipEmpty, U.el('label', { class: 'form-check-label', for: eid, text: 'Skip empty lines' })])
      ]));
    }
    return grid;
  };

  SourceView.sampleFile = function () {
    return new File([SAMPLE_CSV], 'sample-contacts.csv', { type: 'text/csv' });
  };

  DL.SourceView = SourceView;
})(typeof self !== 'undefined' ? self : this);
