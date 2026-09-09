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
    // { openFile, openFiles, addFiles, removeFile, moveFile, reload, loadSample }
    this.actions = actions;
  }

  SourceView.prototype.render = function () {
    var st = this.store.state;
    var src = st.source;
    var self = this;
    // While the user types in an option, the reload must not rebuild the form under the cursor.
    // A tick is not typing: it takes its answer at once, and to wait for the blur leaves the panel
    // showing the counts of the read before it, or hides the message of a read that failed.
    var active = document.activeElement;
    var typing = active && active.tagName.toLowerCase() === 'input' && active.type !== 'checkbox';
    if (typing && this.el.contains(active) && src.file) {
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
      // The list on the left names the files, so the zone only says what a drop does.
      src.file ? U.el('div', {}, [U.el('strong', { text: DL.t(stacking(st) ? 'source.dropToAdd' : 'source.dropAnother') })])
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
    // The files of the source on the left, the drop zone on the right.
    el.appendChild(U.el('div', { class: 'source-layout' }, [this.fileList(), drop]));

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

    if (src.file) el.appendChild(this.optionsForm());

    if (src.status === 'ready' && src.info) {
      var info = src.info;
      var bits = [DL.rowsAndColumns(info.rowCount, info.columns.length)];
      var one = src.files.length < 2; // with many files these describe the first file only
      if (one && info.encoding) bits.push(DL.t('source.encoding', { name: info.encoding.toUpperCase() }));
      if (one && info.delimiter) bits.push(DL.t('source.separator', { name: describeDelimiter(info.delimiter) }));
      if (one && info.sheet) bits.push(DL.t('source.sheet', { name: info.sheet }));
      if (!one) bits.push(DL.t('source.fromFiles', { n: DL.pluralize(src.files.length, 'file') }));
      bits.push(DL.t('source.readIn', { s: (info.ms / 1000).toFixed(1) }));
      var box = U.el('div', { class: 'alert alert-light border mt-3 mb-0 py-2' }, [
        U.el('div', {}, [U.el('i', { class: 'bi bi-check-circle text-success me-1' }), bits.join(' · ')])
      ]);
      if (info.notes.length) {
        box.appendChild(U.el('ul', { class: 'notes-list mt-1 mb-0 text-warning-emphasis' }, info.notes.map(function (n) { return U.el('li', { text: n }); })));
      }
      el.appendChild(box);
    }
    U.hideOrphanTooltips(); // this view builds its content again, as the other views do
  };

  function stacking(st) { return st.source.options.multiFile === 'stack'; }

  // The files of the source, with the rows that each one gave and a way to move or take one out.
  // The list element lives as long as the view. A drag holds a row of it, and a redraw in the
  // middle of the drag takes that row away and stops the drag with no word to the user.
  SourceView.prototype.fileList = function () {
    var self = this;
    if (!this.filesEl) {
      this.filesEl = U.el('ul', { class: 'source-file-list sortable-list' });
      DL.fields.sortable(this.filesEl, 'li[draggable]', function (from, to) { self.actions.moveFile(from, to); });
      this.filesEl.addEventListener('dragstart', function () { self.fileDragging = true; });
      this.filesEl.addEventListener('dragend', function () { self.fileDragging = false; });
      this.filesEl.addEventListener('drop', function () { self.fileDragging = false; });
    }
    if (!this.fileDragging) this.fillFiles();
    var n = this.store.state.source.files.length;
    return U.el('div', { class: 'source-files' }, [
      U.el('div', { class: 'field-label', text: DL.t('source.files') + (n ? ' (' + n + ')' : '') }),
      this.filesEl,
      this.addFilesRow()
    ]);
  };

  SourceView.prototype.fillFiles = function () {
    var self = this;
    var st = this.store.state;
    var files = st.source.files;
    var info = st.source.info;
    var many = files.length > 1;
    U.empty(this.filesEl);
    if (!files.length) {
      this.filesEl.appendChild(U.el('li', { class: 'source-file text-secondary small', text: DL.t('source.noFilesYet') }));
      return;
    }
    // The information of the source lists the files in the same order, so the place gives the rows.
    var each = (info && info.files && info.files.length === files.length) ? info.files : null;
    function removeButton(i) {
      return U.el('button', {
        type: 'button', class: 'btn btn-sm btn-link text-danger p-0',
        title: DL.t('source.removeFile'), 'aria-label': DL.t('source.removeFile'),
        onclick: function () { self.actions.removeFile(i); }
      }, [U.el('i', { class: 'bi bi-x-lg' })]);
    }
    // A drag needs a second file to go to, so one file alone gets no grip and no drag. The buttons
    // do the work of the drag for a user who does not use a pointer.
    var items = files.map(function (f, i) {
      // The size is known at once. The rows and the columns come when the read is done.
      var stats = U.fmtBytes(f.size) + ' · ' + (each ? DL.rowsAndColumns(each[i].rowCount, each[i].columnCount) : DL.t('source.reading'));
      var move = function (to) { return function () { self.actions.moveFile(i, to); }; };
      var attrs = many
        ? { class: 'source-file', draggable: 'true', title: DL.t('source.dragToOrder') }
        : { class: 'source-file' };
      return U.el('li', attrs, [
        U.el('i', { class: 'bi ' + (many ? 'bi-grip-vertical' : 'bi-file-earmark-text') + ' me-2 text-secondary' }),
        U.el('div', { class: 'source-file-text' }, [
          U.el('div', { class: 'source-file-name', text: f.name, title: f.name }),
          U.el('div', { class: 'text-secondary small', text: stats })
        ]),
        U.el('div', { class: 'source-file-actions ms-auto' }, many ? [
          U.el('button', {
            type: 'button', class: 'btn btn-sm btn-link text-secondary p-0', disabled: i === 0 ? 'disabled' : null,
            title: DL.t('source.moveUp'), 'aria-label': DL.t('source.moveUp'), onclick: move(i - 1)
          }, [U.el('i', { class: 'bi bi-chevron-up' })]),
          U.el('button', {
            type: 'button', class: 'btn btn-sm btn-link text-secondary p-0', disabled: i === files.length - 1 ? 'disabled' : null,
            title: DL.t('source.moveDown'), 'aria-label': DL.t('source.moveDown'), onclick: move(i + 2)
          }, [U.el('i', { class: 'bi bi-chevron-down' })]),
          removeButton(i)
        ] : [removeButton(i)])
      ]);
    });
    items.forEach(function (li) { self.filesEl.appendChild(li); });
  };

  // The buttons that add more files and that take every file out of the source.
  SourceView.prototype.addFilesRow = function () {
    var self = this;
    var add = U.el('input', { type: 'file', multiple: true, accept: DL.acceptedExtensions().join(','), hidden: true });
    add.addEventListener('change', function () {
      var picked = Array.prototype.slice.call(add.files);
      add.value = '';
      if (picked.length) self.actions.addFiles(picked);
    });
    var row = U.el('div', { class: 'd-flex align-items-center gap-2 mt-2' }, [
      U.el('button', { type: 'button', class: 'btn btn-sm btn-outline-primary', onclick: function () { add.click(); } },
        [U.el('i', { class: 'bi bi-plus-lg me-1' }), DL.t('source.addFiles')]),
      add
    ]);
    if (this.store.state.source.files.length) {
      row.appendChild(U.el('button', { type: 'button', class: 'btn btn-sm btn-outline-danger', onclick: function () { self.actions.clearFiles(); } },
        [U.el('i', { class: 'bi bi-x-lg me-1' }), DL.t('source.removeAll')]));
    }
    return row;
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
      // This one says what a new file does, and it does not change how the bytes are read. But the
      // column with the name of the file belongs to a source that stacks, so with that setting on,
      // the change does change the data.
      if (key === 'multiFile' && !self.store.state.source.options.fileNameColumn) { self.render(); return; }
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
