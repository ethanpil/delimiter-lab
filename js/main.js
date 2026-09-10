/* Delimiter Lab - application controller. */
(function () {
  'use strict';
  var U = DL.util;
  var $ = function (id) { return document.getElementById(id); };

  var store = new DL.Store();
  var progressEl = $('progress');
  var engine = new DL.EngineClient(function (msg) { showProgress(msg.phase, msg.percent); });
  engine.configure(U.cellBudget()).catch(function (err) { U.toast(err.message, 'danger'); });

  var chain = new DL.ChainView($('chain'), store, {
    toggle: function (id) { store.toggleStep(id); },
    duplicate: function (id) { store.duplicateStep(id); },
    remove: function (id) { store.removeStep(id); }
  });
  var sourceView = new DL.SourceView($('config'), store, {
    openFile: openFile,
    openFiles: openFiles,
    addFiles: addSourceFiles,
    removeFile: removeSourceFile,
    clearFiles: clearSourceFiles,
    moveFile: moveSourceFile,
    // A read that follows a change of the settings says nothing about the file itself. Without
    // this, a read that fails on a new delimiter takes the file out of the workspace.
    reload: function () { restoredLoad = false; loadSource(); },
    loadSample: function () { openFile(DL.SourceView.sampleFile()); }
  });
  var configView = new DL.ConfigView($('config'), store, {
    changeOp: function (id) {
      DL.dialogs.pickOperation({ title: DL.t('config.changeOp') }, function (opId) { store.changeOp(id, opId); });
    },
    remove: function (id) { store.removeStep(id); }
  });
  var grid = new DL.GridView($('grid'), engine);
  var gridBefore = null;
  var lastFormat = 'csv';
  var lastFormatOptions = {};

  /* ---------- Progress ---------- */
  var progressTimer = null;
  var batchLabel = ''; // The batch text, for example "File 2 of 5: x.csv". Worker messages go after it.
  var runInFlight = false; // True while the worker runs the chain. The bar stays until the run ends.
  var cancelable = false;  // True while a click on Cancel can stop the work.
  var exporting = false;   // True while the worker makes a download.
  function showProgress(label, percent) {
    progressEl.hidden = false;
    var pc = Math.max(0, Math.min(100, Math.round(percent || 0)));
    progressEl.querySelector('.progress-bar').style.width = Math.max(2, pc) + '%';
    var bar = progressEl.querySelector('[role=progressbar]');
    if (bar) bar.setAttribute('aria-valuenow', String(pc)); // a bar with no value says nothing
    progressEl.querySelector('.app-progress-label').textContent = batchLabel ? batchLabel + (label ? ' · ' + label : '') : (label || '');
    $('btnCancel').hidden = !cancelable || exporting; // Cancel stops a run, never a download
    clearTimeout(progressTimer);
    if (!batchLabel && !runInFlight && !exporting && store.state.source.status !== 'loading') progressTimer = setTimeout(hideProgress, 4000);
  }
  function hideProgress() { clearTimeout(progressTimer); progressEl.hidden = true; $('btnStop').hidden = true; $('btnCancel').hidden = true; }

  // A step that does not finish (for example a slow regular expression) blocks the worker.
  // Stop ends the worker, loads the file again and turns the selected step off.
  var stopTimer = null;
  function armStop() {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () { showProgress(DL.t('progress.slow'), 50); $('btnStop').hidden = false; }, 15000);
  }
  function disarmStop() { clearTimeout(stopTimer); $('btnStop').hidden = true; }
  $('btnStop').addEventListener('click', function () {
    disarmStop();
    if (batchRunning) { stopBatch(); return; }
    runToken++; // the stopped run does not report an error
    engine.restart();
    var sel = store.state.selectedId;
    if (sel !== 'source' && store.getStep(sel) && store.getStep(sel).enabled !== false) {
      store.toggleStep(sel);
      U.toast(DL.t('msg.stepStopped', { n: store.stepIndex(sel) + 1 }), 'warning');
    }
    grid.show(null, DL.t('preview.readingFile'));
    previewKey = null;
    if (store.state.source.file) loadSource();
  });

  /* ---------- Source loading ---------- */
  var loadToken = 0;

  // "Many files" in the source settings says what a second file means: another run of the steps
  // (batch), or more rows in the same source (stack).
  function stacking() { return store.state.source.options.multiFile === 'stack'; }

  function openFiles(files) {
    if (!files || !files.length) return;
    if (files.length === 1 && DL.fileExtension(files[0].name) === 'json') { importWorkflowFile(files[0]); return; }
    if (stacking()) { addSourceFiles(files); return; }
    if (files.length === 1) { openFile(files[0]); return; }
    if (!store.state.workflow.steps.length) {
      U.toast(DL.t('msg.addStepsFirst'), 'info');
      openFile(files[0]);
      return;
    }
    batchApply(files);
  }

  // Sorts files into the ones that a data source can read and the ones that it cannot.
  function splitDataFiles(files) {
    var accepted = DL.acceptedExtensions();
    var good = [];
    var skipped = [];
    [].concat(files || []).forEach(function (f) {
      if (accepted.indexOf('.' + DL.fileExtension(f.name)) < 0) skipped.push({ name: f.name, error: DL.t('msg.notDataFile') });
      else if (f.size > MAX_FILE_BYTES) skipped.push({ name: f.name, error: DL.t('msg.fileTooBig') });
      else good.push(f);
    });
    return { good: good, skipped: skipped, accepted: accepted };
  }

  // Adds files to the source that is open, and reads them all again. Every file of one source must
  // have the same format, because one set of settings reads all of them.
  function addSourceFiles(files) {
    var split = splitDataFiles(files);
    var good = split.good;
    var refused = split.skipped.length;
    var first = store.state.source.files[0] || good[0];
    var wanted = first ? DL.inputFormatFor(first.name) : null;
    var mixed = 0;
    if (wanted) {
      good = good.filter(function (f) {
        if (DL.inputFormatFor(f.name).id === wanted.id) return true;
        mixed++;
        return false;
      });
    }
    if (refused) U.toast(DL.t('msg.someFilesRefused', { n: DL.pluralize(refused, 'file'), types: split.accepted.join(', ') }), 'warning');
    if (mixed) U.toast(DL.t('msg.mixedFormats', { n: DL.pluralize(mixed, 'file'), format: wanted.label }), 'warning');
    if (!good.length) return;
    // Files that go into one source make a stack. The setting must say so, or it says "batch" over
    // a source of two files, and the column with the name of the file stays out of reach.
    if (!stacking() && store.state.source.files.length + good.length > 1) store.setSourceOptions({ multiFile: 'stack' });
    if (!store.state.source.files.length) { openFile(good[0], { extra: good.slice(1) }); return; }
    var added = store.addSourceFiles(good);
    if (!added) { U.toast(DL.t('msg.filesAlreadyThere'), 'info'); return; }
    U.toast(DL.t('msg.filesAdded', { n: DL.pluralize(added, 'file') }), 'success');
    afterSourceFilesChanged();
  }

  function moveSourceFile(from, to) {
    if (!store.moveSourceFile(from, to)) return;
    afterSourceFilesChanged();
  }

  function removeSourceFile(index) {
    store.removeSourceFile(index);
    afterSourceFilesChanged();
  }

  // Takes every file out of the source. The steps stay, so the user can open other files for them.
  function clearSourceFiles() {
    var n = store.state.source.files.length;
    if (!n) return;
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    U.confirm({
      title: DL.t('source.removeAllTitle'),
      message: DL.t('source.removeAllMessage', { n: DL.pluralize(n, 'file') }),
      yes: DL.t('source.removeAllYes'),
      danger: true
    }, function () {
      store.setSourceFiles([]);
      afterSourceFilesChanged();
    });
  }

  // Reads the files again after a change of the list, or stops the work when no file remains.
  function afterSourceFilesChanged() {
    keepWorkspace();
    if (store.state.source.files.length) { startLoad(); return; }
    loadToken++; // a load that is on its way must not make an empty source ready
    runToken++; // a run that is on its way must not put its results under an empty source
    disarmStop();
    hideProgress();
    engine.unload().catch(function () { /* a worker that stopped holds nothing */ });
    // The store has emitted 'source' already, and the listener draws the empty preview. To draw
    // it again here only clears the key that the next refresh reads.
  }

  // Writes the files of the source to the workspace store, and says when it cannot keep them.
  function keepWorkspace() {
    var files = store.state.source.files;
    if (!files.length) { DL.fileStore.clear(); return; }
    DL.fileStore.put(files).then(function (kept) {
      if (kept || store.state.source.files !== files) return; // a later list took the place of this one
      var bytes = 0;
      files.forEach(function (f) { bytes += f.size; });
      var key = bytes > DL.fileStore.MAX_BYTES
        ? (files.length > 1 ? 'msg.workspaceTooBigMany' : 'msg.workspaceTooBig')
        : 'msg.workspaceNotKept';
      U.toast(DL.t(key, { size: U.fmtBytes(DL.fileStore.MAX_BYTES) }), 'warning');
    });
  }

  var MAX_FILE_BYTES = 1.5 * 1024 * 1024 * 1024; // browsers cannot read a larger file into memory

  // opts.sheet opens a workbook at that sheet. setSourceFiles() empties the sheet, so it goes back after.
  // opts.fromStore says that the files came out of the workspace store: they do not go back in.
  // opts.extra holds more files for the same source.
  function openFile(file, opts) {
    if (!file) return;
    opts = opts || {};
    var all = [file].concat(opts.extra || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].size > MAX_FILE_BYTES) { U.toast(DL.t('msg.fileTooBig'), 'danger'); return; }
    }
    restoredLoad = opts.fromStore === true;
    store.setSourceFiles(all);
    if (opts.sheet) store.setSourceOptions({ sheet: opts.sheet });
    if (!opts.fromStore) keepWorkspace();
    startLoad();
  }

  // Reads the sheet names when the source is a workbook, then reads the data. Every change of the
  // list of files goes through here, because setSourceFiles() drops the sheet names.
  function startLoad() {
    var files = store.state.source.files;
    if (!files.length) return;
    if (!DL.inputFormatFor(files[0].name).hasSheets) { loadSource(); return; }
    var token = ++loadToken;
    showProgress(DL.t('progress.readingWorkbook'), 5);
    engine.listSheets(files[0]).then(function (msg) {
      if (token !== loadToken) return;
      store.setSheets(msg.sheets);
      loadSource();
    }).catch(function (err) {
      if (token !== loadToken) return;
      disarmStop();
      hideProgress();
      store.setSourceError(err.message);
      U.toast(err.message, 'danger');
      forgetIfRestored(); // a file that does not open must not come back at the next reload
    });
  }

  // True while the first read of a file that came out of the workspace store runs.
  var restoredLoad = false;

  // The browser keeps a file as a name and a time, not as bytes. A file that moved, or that another
  // program wrote again, does not read any more, and it must not come back at every reload. A read
  // that fails after a change of the settings says nothing about the file, so that file stays.
  function forgetIfRestored() {
    if (!restoredLoad) return;
    restoredLoad = false;
    DL.fileStore.clear();
  }

  function loadSource() {
    var src = store.state.source;
    if (!src.files.length) return;
    var token = ++loadToken;
    src.status = 'loading';
    store.emit('source');
    showProgress(DL.t('progress.readingFile'), 2);
    armStop();
    engine.load(src.files, src.options).then(function (msg) {
      // Only the load that still owns the screen puts the timer away. One timer serves every
      // load, and a load that another one took over would else disarm the timer of that other
      // load, which then runs a large file with no way to stop it.
      if (token !== loadToken) return;
      disarmStop();
      hideProgress();
      restoredLoad = false;
      store.setSourceInfo(msg.info);
      runChain();
    }).catch(function (err) {
      if (token !== loadToken) return;
      disarmStop();
      hideProgress();
      store.setSourceError(err.message);
      U.toast(err.message, 'danger');
      forgetIfRestored();
    });
  }

  /* ---------- Running the chain ---------- */
  var runToken = 0;

  // The steps on screen: the worker keeps their results in memory when it frees space.
  function protectedSteps() {
    var shown = store.displayResultFor(store.state.selectedId);
    var ids = [];
    if (shown.stepId && shown.stepId !== 'source') ids.push(shown.stepId);
    var before = beforeStepId();
    if (before && before !== 'source') ids.push(before);
    return ids;
  }

  // The run ended: the progress bar and the Cancel button go, unless a batch, a download or a
  // file load still uses them.
  function runEnded() {
    runInFlight = false;
    if (batchRunning || store.state.source.status === 'loading') return; // the batch or the load owns the bar, Cancel and the Stop timer
    cancelable = false;
    disarmStop();
    if (!exporting) hideProgress();
  }

  // The steps in the shape that the worker reads. The engine says what that shape is, so the page
  // and the dl command cannot drift apart.
  function workerSteps() {
    return DL.workerSteps(store.state.workflow.steps);
  }

  function runChain() {
    if (store.state.source.status !== 'ready') { runEnded(); return; }
    var token = ++runToken;
    var steps = workerSteps();
    var slowTimer = setTimeout(function () { showProgress(DL.t('progress.runningSteps'), 50); }, 400);
    if (!batchRunning) { armStop(); cancelable = true; }
    runInFlight = true;
    engine.run(steps, protectedSteps()).then(function (msg) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      runEnded();
      store.setResults(msg.results);
      if (msg.cancelled) U.toast(DL.t('msg.runCancelled'), 'info');
    }).catch(function (err) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      runEnded();
      U.toast(DL.t('msg.runFailed', { error: err.message }), 'danger');
    });
  }

  $('btnCancel').addEventListener('click', function () {
    cancelable = false;
    $('btnCancel').hidden = true;
    if (batchRunning) { cancelBatch(); return; }
    engine.cancel().catch(function () { /* the worker is gone; Stop handles that */ });
  });

  // Results of a run that started before the latest change are out of date: drop them and run again.
  var runSoon = U.debounce(runChain, 220);
  function runAgainSoon() {
    runToken++;
    runSoon();
  }

  /* ---------- Preview ---------- */
  var previewKey = null;

  function resultKey(stepId) {
    var st = store.state;
    if (stepId === 'source') {
      var names = st.source.files.map(function (f) { return f.name + f.size + f.lastModified; }).join(',');
      return 'source:' + names + ':' + (st.source.info ? st.source.info.rowCount + '/' + st.source.info.columns.join('|') : '');
    }
    var r = st.results[stepId];
    return stepId + ':' + (r ? r.hash : 'none');
  }

  function refreshPreview() {
    var st = store.state;
    var sel = st.selectedId;
    var shown = store.displayResultFor(sel);
    var title = '';
    var stats = '';
    if (sel === 'source') title = DL.t('preview.sourceFile');
    else {
      var step = store.getStep(sel);
      var op = step && DL.getOp(step.opId);
      title = DL.t('preview.step', { n: store.stepIndex(sel) + 1, name: op ? op.name : '' });
    }
    if (shown.stepId === 'source' && st.source.info) stats = DL.rowsAndColumns(st.source.info.rowCount, st.source.info.columns.length);
    else if (shown.result) stats = DL.rowsAndColumns(shown.result.rowCount, shown.result.columns.length) + (shown.result.ms > 50 ? ' · ' + (shown.result.ms / 1000).toFixed(1) + ' s' : '');
    if (shown.reason) stats += (stats ? ' · ' : '') + shown.reason;
    $('previewTitle').textContent = title;
    $('previewStats').textContent = stats;
    previewStats = stats;
    var canDiff = !!(shown.stepId && shown.stepId !== 'source');
    $('btnDiff').disabled = !canDiff;
    grid.diff = diffOn() && canDiff;
    var message = shown.stepId ? '' : (st.source.status === 'loading' ? DL.t('preview.readingFile') : DL.t('preview.openFile'));
    var key = (shown.stepId || 'none') + '|' + resultKey(shown.stepId || 'source') + '|' + message + '|' + (grid.diff ? 'diff' : '');
    if (key !== previewKey) {
      previewKey = key;
      grid.show(shown.stepId, message).then(function () {
        if (searchQuery) runSearch();
        else if (noteRowsShown) showMatches([], ''); // rows from a note belong to the old preview
        else if (shown.result && shown.stepId === sel) scrollToNewColumns(shown);
      });
    } else if (grid.diff && grid.diffSummary) {
      grid.onDiffSummary(grid.diffSummary); // the grid did not change: keep the change counts on the stats line
    }
    refreshCompare();
  }

  var previewStats = '';
  function diffOn() { return $('btnDiff').classList.contains('active'); }

  // Adds the change counts of the "Changes" view to the preview statistics.
  grid.onDiffSummary = function (summary) {
    if (!summary || !diffOn()) return;
    var text;
    if (!summary.sameRows) {
      text = DL.t('preview.rowsWent', { before: summary.rowsBefore.toLocaleString(), after: summary.rowsAfter.toLocaleString() });
    } else {
      var cells = 0, cols = 0, added = 0;
      summary.columns.forEach(function (c) { if (c.isNew) added++; else if (c.changed) { cells += c.changed; cols++; } });
      var parts = [];
      if (cells) parts.push(DL.t('preview.changedCells', { cells: DL.pluralize(cells, 'changed cell'), cols: DL.pluralize(cols, 'column') }));
      if (added) parts.push(DL.pluralize(added, 'new column'));
      if (summary.removed.length) parts.push(DL.t('preview.removedColumns', { n: DL.pluralize(summary.removed.length, 'removed column'), names: summary.removed.join(', ') }));
      text = parts.length ? parts.join(' · ') : DL.t('preview.noCellChanged');
    }
    $('previewStats').textContent = previewStats + (previewStats ? ' · ' : '') + text;
  };

  // Brings the first column that a step added into view.
  function scrollToNewColumns(shown) {
    var before = store.outputColumnsAt(store.stepIndex(shown.stepId) - 1);
    if (!before) return;
    var cols = shown.result.columns;
    for (var c = 0; c < cols.length; c++) {
      if (before.indexOf(cols[c]) < 0) { grid.scrollToColumn(c); return; }
    }
  }

  // The step whose output feeds the selected step (for the "Compare" view).
  function beforeStepId() {
    var sel = store.state.selectedId;
    if (sel === 'source') return null;
    var shown = store.displayResultFor(sel).stepId;
    if (!shown || shown === 'source') return null; // the preview shows the source: there is no input to compare
    var steps = store.state.workflow.steps;
    for (var i = store.stepIndex(shown) - 1; i >= 0; i--) {
      var r = store.state.results[steps[i].id];
      if (r && r.hasTable) return steps[i].id;
    }
    return 'source';
  }

  function refreshCompare() {
    var on = $('btnCompare').classList.contains('active');
    var wrap = $('gridBefore');
    var beforeId = beforeStepId();
    if (!on || !beforeId || store.state.source.status !== 'ready') {
      wrap.hidden = true;
      if (gridBefore) { gridBefore.destroy(); gridBefore = null; U.empty(wrap); }
      grid.setTitle('');
      return;
    }
    wrap.hidden = false;
    if (!gridBefore) {
      gridBefore = new DL.GridView(wrap, engine, { title: DL.t('preview.before') });
      gridBefore.onScroll = function (top) { if (Math.abs(grid.scroll.scrollTop - top) > 1) grid.scroll.scrollTop = top; };
      grid.onScroll = function (top) { if (gridBefore && Math.abs(gridBefore.scroll.scrollTop - top) > 1) gridBefore.scroll.scrollTop = top; };
    }
    grid.setTitle(DL.t('preview.after'));
    var key = beforeId + '|' + resultKey(beforeId);
    if (gridBefore.key !== key) { gridBefore.key = key; gridBefore.show(beforeId); }
  }

  /* ---------- Search in preview ---------- */
  var searchQuery = '';
  var searchMatches = [];
  var searchIndex = -1;
  var searchToken = 0;

  function runSearch() {
    var stepId = grid.stepId; // search the data that the grid shows
    var token = ++searchToken;
    if (!searchQuery || !stepId) { setSearchResult([], 0); return; }
    engine.search(stepId, searchQuery, 2000).then(function (msg) {
      if (token !== searchToken) return;
      setSearchResult(msg.result.matches, msg.result.total);
    }).catch(function (err) { if (token !== searchToken) return; U.toast(err.message, 'danger'); });
  }

  function setSearchResult(matches, total) {
    var info = '';
    if (searchQuery) info = !total ? DL.t('preview.noMatches') : DL.t(total > matches.length ? 'preview.rowsMatchFirst' : 'preview.rowsMatch', { n: DL.pluralize(total, 'row'), shown: matches.length });
    showMatches(matches, info);
  }

  var noteRowsShown = false; // true while the preview marks the rows of a result note

  // Marks rows in the preview and lets the user step through them with the search buttons.
  function showMatches(matches, info) {
    noteRowsShown = false;
    searchMatches = matches;
    searchIndex = matches.length ? 0 : -1;
    grid.setHits(matches);
    $('previewSearchInfo').textContent = info;
    $('previewSearchPrev').disabled = $('previewSearchNext').disabled = !matches.length;
    if (matches.length) grid.setCurrent(matches[0]);
  }

  // Shows the rows that a result note is about (a click on the note in the step settings).
  configView.onShowRows = function (stepId, note) {
    if (store.state.selectedId !== stepId) store.select(stepId);
    $('previewSearch').value = '';
    searchQuery = '';
    var token = ++searchToken;
    engine.findRows(stepId, note.rows, 2000).then(function (msg) {
      if (token !== searchToken) return;
      var r = msg.result;
      if (r.removed) { showMatches([], DL.t('preview.notInOutput')); noteRowsShown = true; return; }
      if (grid.stepId !== stepId) { showMatches([], ''); return; }
      showMatches(r.matches, note.text + (r.total > r.matches.length ? DL.t('preview.firstShown', { shown: r.matches.length }) : ''));
      noteRowsShown = true;
    }).catch(function (err) { if (token !== searchToken) return; U.toast(err.message, 'danger'); });
  };

  function stepSearch(dir) {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    grid.setCurrent(searchMatches[searchIndex]);
    $('previewSearchInfo').textContent = DL.t('preview.matchOf', { n: searchIndex + 1, total: searchMatches.length });
  }

  var searchSoon = U.debounce(function () { searchQuery = $('previewSearch').value.trim(); runSearch(); }, 250);
  $('previewSearch').addEventListener('input', searchSoon);
  $('previewSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if ($('previewSearch').value.trim() !== searchQuery) searchSoon.flush(); // a new query: the first match shows when it arrives
      else stepSearch(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') { $('previewSearch').value = ''; searchQuery = ''; setSearchResult([], 0); }
  });
  $('previewSearchNext').addEventListener('click', function () { stepSearch(1); });
  $('previewSearchPrev').addEventListener('click', function () { stepSearch(-1); });
  $('btnCompare').addEventListener('click', function () { setTimeout(refreshCompare, 0); });
  $('btnDiff').addEventListener('click', function () { setTimeout(refreshPreview, 0); });

  /* ---------- Steps ---------- */
  function addStep() {
    grid.closeProfile();
    if (store.state.source.status !== 'ready' && !store.state.workflow.steps.length) {
      U.toast(DL.t('msg.openFileTip'), 'info');
    }
    DL.dialogs.pickOperation({}, function (opId) { store.addStep(opId, store.state.selectedId); });
  }

  /* ---------- Workflows ---------- */
  // Builds the record to save. Without an open file the columns and the source options of the saved
  // record stay as they are. The live state does not hold them, and an empty value writes over good data.
  function currentRecord(name) {
    var st = store.state;
    var cols = store.sourceColumns();
    var old = st.workflow.id ? DL.workflows.get(st.workflow.id) : null;
    return {
      id: st.workflow.id,
      name: name,
      steps: st.workflow.steps,
      columns: cols || (old ? old.columns : []),
      sourceOptions: cols ? st.source.options : (old ? old.sourceOptions : st.source.options)
    };
  }

  // Saves the workflow. then(record) runs after a save. then(null) runs when the user stops.
  function saveWorkflow(then) {
    var st = store.state;
    if (!st.workflow.steps.length) { U.toast(DL.t('msg.addStepBeforeSave'), 'info'); if (then) then(null); return; }
    var doSave = function (name) {
      var rec = DL.workflows.save(currentRecord(name));
      if (!rec) { if (then) then(null); return; }
      store.setWorkflowMeta({ id: rec.id, name: rec.name }, true);
      U.toast(DL.t('msg.workflowSaved', { name: rec.name }), 'success');
      if (then) then(rec);
    };
    if (st.workflow.id && st.workflow.name) doSave(st.workflow.name);
    else {
      var suggested = st.workflow.name || (st.source.file ? DL.t('msg.suggestedName', { file: U.baseName(st.source.file.name) }) : DL.t('msg.defaultName'));
      U.prompt({ title: DL.t('msg.saveTitle'), message: DL.t('msg.saveMessage'), value: suggested, yes: DL.t('common.save') }, doSave, function () { if (then) then(null); });
    }
  }

  /* ---------- Autosave ---------- */
  var autosaveOn = false;
  try { autosaveOn = localStorage.getItem('dl.autosave') === '1'; } catch (e) { /* no storage: autosave stays off */ }

  function showAutosave() {
    var b = $('btnAutosave');
    // Green shows that autosave is on. The blue of an active Bootstrap button looks like the other buttons.
    b.classList.toggle('btn-success', autosaveOn);
    b.classList.toggle('btn-outline-primary', !autosaveOn);
    b.setAttribute('aria-pressed', autosaveOn ? 'true' : 'false');
    b.setAttribute('title', DL.t(autosaveOn ? 'header.autosaveOnTitle' : 'header.autosaveTitle'));
  }

  function setAutosave(on) {
    autosaveOn = on;
    try { localStorage.setItem('dl.autosave', on ? '1' : '0'); } catch (e) { /* the setting lasts for this page only */ }
    showAutosave();
  }

  var askingName = false; // the save dialog is open: do not open a second one

  // Writes the open workflow to its record, without a dialog. It does nothing when there is no record.
  function autosaveNow() {
    var st = store.state;
    if (!autosaveOn || !st.workflow.id || !st.workflow.name || !st.workflow.steps.length || !st.dirty) return;
    var rec = DL.workflows.save(currentRecord(st.workflow.name));
    if (!rec) { setAutosave(false); U.toast(DL.t('msg.autosaveStopped'), 'danger'); return; }
    store.setWorkflowMeta({ id: rec.id, name: rec.name }, true);
  }

  // Autosaves after a pause in the changes.
  var autosaveSoon = U.debounce(function () {
    var st = store.state;
    if (!autosaveOn || askingName || !st.workflow.steps.length) return;
    // Autosave needs a record with a name. Ask for one, and stop autosave when the user does not give it.
    if (!st.workflow.id || !st.workflow.name) {
      askingName = true;
      saveWorkflow(function (rec) { askingName = false; if (!rec) setAutosave(false); });
      return;
    }
    autosaveNow();
  }, 800);

  window.addEventListener('pagehide', function () { autosaveSoon.cancel(); autosaveNow(); });

  $('btnAutosave').addEventListener('click', function () {
    if (autosaveOn) { setAutosave(false); U.toast(DL.t('msg.autosaveOff'), 'info'); return; }
    var st = store.state;
    // Autosave needs a saved workflow. Ask for a name first.
    if (!st.workflow.id || !st.workflow.name) {
      if (!st.workflow.steps.length) { U.toast(DL.t('msg.addStepBeforeSave'), 'info'); return; }
      saveWorkflow(function (rec) {
        if (!rec) return; // the user stopped: autosave stays off
        setAutosave(true);
        U.toast(DL.t('msg.autosaveOn', { name: rec.name }), 'success');
      });
      return;
    }
    setAutosave(true);
    U.toast(DL.t('msg.autosaveOn', { name: st.workflow.name }), 'success');
  });

  // Empties the steps and closes the file, so that the user can start again. opts is for a caller
  // that goes on after the clear, such as a link: opts.intro goes before the first question,
  // opts.then runs after the clear (or at once when there is nothing to remove), and
  // opts.onCancel runs when the steps and the file stay.
  function newWorkflow(opts) {
    opts = opts || {};
    var stop = function () { if (opts.onCancel) opts.onCancel(); };
    grid.closeProfile();
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); stop(); return; }
    var st = store.state;
    if (!st.workflow.steps.length && !st.workflow.name && !st.source.file) {
      if (opts.then) opts.then();
      else U.toast(DL.t('msg.newEmpty'), 'info');
      return;
    }
    var message = !st.source.files.length ? DL.t('msg.newMessage')
      : st.source.files.length > 1 ? DL.t('msg.newMessageFiles', { n: DL.pluralize(st.source.files.length, 'file') })
      : DL.t('msg.newMessageFile', { name: st.source.file.name });
    U.confirm({
      title: DL.t('msg.newTitle'),
      message: opts.intro ? opts.intro + ' ' + message : message,
      yes: DL.t('msg.newYes')
    }, function () {
      U.confirm({ title: DL.t('msg.newSureTitle'), message: DL.t('msg.newSureMessage'), yes: DL.t('msg.newSureYes'), danger: true }, function () {
        // A file dropped on the page can start a batch while the questions are on the screen.
        if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); stop(); return; }
        autosaveSoon.cancel();
        autosaveNow(); // a change that waits goes to the old record before the steps go away
        store.replaceWorkflow({ id: null, name: '', steps: [] });
        loadToken++; // a load that is on its way must not put its file on the empty screen
        searchToken++;
        exportToken++;
        exporting = false;
        store.setSourceFiles([]);
        store.setSourceOptions(DL.defaultSourceOptions());
        DL.fileStore.clear();
        engine.restart(); // the worker holds the table of the old file
        // Undo cannot bring the file back, and it puts the settings of the old file on an empty
        // screen. A half undo is worse than none.
        store.clearHistory();
        updateUndoButtons();
        if (opts.then) opts.then();
        else U.toast(DL.t('msg.newDone'), 'success');
      }, stop);
    }, stop);
  }

  // Runs a saved workflow on files that the user gives, and downloads the result. The workflow on the
  // screen and the file that is open do not change.
  function quickRunWorkflow(wf, files) {
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var steps = DL.workerSteps(wf.steps);
    if (!steps.length) { U.toast(DL.t('msg.quickRunNoSteps'), 'info'); return; }
    var split = splitDataFiles(files);
    files = split.good;
    if (!files.length) { U.toast(DL.t('msg.noDataFiles', { types: split.accepted.join(', ') }), 'warning'); return; }
    var sourceOptions = DL.cleanSourceOptions(wf.sourceOptions || store.state.source.options);
    sourceOptions.sheet = ''; // the first sheet of each file
    var many = files.length > 1;
    var wfName = U.safeFileName((wf.name || '').trim() || 'workflow');
    var stamp = DL.formatDate(Date.now(), 'YYYY-MM-DD-HH-mm');
    var baseName = (many ? wfName : U.baseName(files[0].name)) + '-processed-' + stamp;
    var note = DL.t('msg.quickRunNote', { name: wf.name, steps: DL.pluralize(steps.length, 'step') });
    DL.dialogs.download({ files: many ? files : null, baseName: baseName, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, outName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      if (wf.id) DL.workflows.touch(wf.id);
      runBatch(files, steps, options, outName, split.skipped, sourceOptions);
    });
  }

  // Opens a saved workflow. then() runs when its steps are on the screen. onCancel() runs when the
  // user stops and the workflow does not open.
  function applyWorkflow(wf, then, onCancel) {
    // Write a waiting autosave first: it decides whether the steps count as saved. autosaveNow() opens
    // no dialog, so it cannot put the save dialog under the dialogs below.
    autosaveSoon.cancel();
    autosaveNow();
    var go = function () {
      store.replaceWorkflow(wf);
      // A step of an operation this build does not have goes out, and the person is told. Without
      // a word, that step comes back empty and the next save writes the empty one down.
      if (store.droppedSteps) U.toast(DL.t('msg.stepsDropped', { n: DL.pluralize(store.droppedSteps, 'step') }), 'warning');
      if (then) then();
      if (wf.id) DL.workflows.touch(wf.id);
      if (wf.sourceOptions && store.state.source.file) {
        var wanted = DL.cleanSourceOptions(wf.sourceOptions);
        wanted.sheet = store.state.source.options.sheet;
        wanted.multiFile = store.state.source.options.multiFile; // a habit of the user, not of the data
        if (JSON.stringify(wanted) !== JSON.stringify(store.state.source.options)) {
          store.setSourceOptions(wanted);
          loadSource();
        }
      }
      var level = DL.workflows.matchLevel(wf, store.sourceColumns());
      if (level === 'partial' || level === 'none') U.toast(DL.t('msg.columnsMissing'), 'warning');
    };
    var saveThenGo = function () {
      saveWorkflow(function (rec) {
        if (!rec) { U.toast(DL.t('msg.notOpened', { name: wf.name }), 'info'); if (onCancel) onCancel(); return; }
        // The save went into the record we are about to open: read it again, or the steps
        // that the save wrote go away.
        if (rec.id === wf.id) wf = DL.workflows.get(wf.id) || wf;
        go();
      });
    };
    var ask = function () {
      var cur = store.state.workflow;
      if (!cur.steps.length) { go(); return; }
      // The steps on screen are not in a saved record, or they changed after the last save.
      if (!cur.id || store.state.dirty) {
        U.confirm({
          title: DL.t('msg.unsavedTitle'),
          message: DL.t('msg.unsavedMessage', { name: wf.name }),
          yes: DL.t('msg.saveAndUse'),
          alt: DL.t('msg.useWithoutSaving')
        }, saveThenGo, onCancel, go);
        return;
      }
      U.confirm({ title: DL.t('msg.replaceTitle'), message: DL.t('msg.replaceMessage'), yes: DL.t('msg.replace') }, go, onCancel);
    };
    // A workflow with code gets its own warning first. The question about saving must not hide it.
    // A step that is turned off does not run, so it does not need the question. The dl command
    // asks the same way.
    if ((wf.steps || []).some(function (s) { return s && s.opId === 'javascript' && s.enabled !== false; })) {
      U.confirm({ title: DL.t('msg.applyTitle'), message: DL.t('msg.codeWarning'), yes: DL.t('common.use'), danger: true }, ask, onCancel);
      return;
    }
    ask();
  }

  function importWorkflowFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wf = DL.workflows.fromJSON(reader.result);
        var same = DL.workflows.list().filter(function (r) { return r.name === wf.name; })[0];
        if (same) wf.id = same.id; // the same name replaces the saved record instead of a second copy
        applyWorkflow(wf, function () {
          var rec = DL.workflows.save(wf);
          if (rec) { store.setWorkflowMeta({ id: rec.id, name: rec.name }, true); U.toast(DL.t('msg.workflowImported', { name: wf.name }), 'success'); }
        });
      } catch (e) { U.toast(e.message, 'danger'); }
    };
    reader.onerror = function () { U.toast(DL.t('msg.fileNotRead'), 'danger'); };
    reader.readAsText(file);
  }

  function openWorkflows() {
    DL.dialogs.workflows({ currentColumns: store.sourceColumns(), currentId: store.state.workflow.id }, {
      apply: applyWorkflow,
      quickRun: quickRunWorkflow,
      importFile: importWorkflowFile,
      renamed: function (id, name) { if (store.state.workflow.id === id) store.setWorkflowMeta({ name: name }, !store.state.dirty); },
      removed: function (id) { if (store.state.workflow.id === id) store.setWorkflowMeta({ id: null }); }
    });
  }

  function updateSaveState() {
    var st = store.state;
    var el = $('saveState');
    if (!st.workflow.steps.length) el.textContent = '';
    else if (st.workflow.id && !st.dirty) el.textContent = DL.t('header.saved');
    else if (st.workflow.id) el.textContent = DL.t('header.unsavedChanges');
    else el.textContent = DL.t('header.notSaved');
  }

  /* ---------- Open from a link ---------- */
  // A link can open a saved workflow and data: #workflow=<link name>&source=<data in base64>. The
  // same keys also work after "?", but GitHub Pages refuses an address above about 8 KB, and a
  // query goes to the server. A key after "#" wins.
  var linkBusy = false; // a link is on its way through its questions
  var linkLoad = null;  // { file, badAt, wf }: the data of a link, until its read ends

  // Gives { workflow, source } from the address, or null when the address holds neither. An empty
  // value counts as no value. Only the name is trimmed: a space in the data is a "+".
  function readLink() {
    var hash = new URLSearchParams(location.hash.slice(1));
    var query = new URLSearchParams(location.search);
    var get = function (k) { return hash.get(k) || query.get(k) || ''; };
    var link = { workflow: get('workflow').trim().slice(0, 80), source: get('source') };
    return link.workflow || link.source ? link : null;
  }

  // Takes the keys of a link out of the address, so that a reload does not open the link again.
  // Other keys, such as ?lang= and ?debug, stay.
  function forgetLink() {
    var parts = [location.search.slice(1), location.hash.slice(1)].map(function (text) {
      var p = new URLSearchParams(text);
      if (!p.has('workflow') && !p.has('source')) return text;
      p.delete('workflow');
      p.delete('source');
      return p.toString();
    });
    history.replaceState(history.state, '', location.pathname + (parts[0] ? '?' + parts[0] : '') + (parts[1] ? '#' + parts[1] : ''));
  }

  // The words for a fault of the base64 data in a link.
  function linkDataFault(badAt) {
    return badAt ? DL.t('link.badData', { n: badAt }) : DL.t('link.noData');
  }

  function showLinkProblems(faults, intro) {
    U.modal({
      title: DL.t('link.problemsTitle'),
      scrollable: true,
      body: [U.el('p', { text: intro }), U.el('ul', { class: 'notes-list mb-0' }, faults.map(function (f) { return U.el('li', { text: f }); }))],
      footer: [U.el('button', { type: 'button', class: 'btn btn-primary', 'data-bs-dismiss': 'modal', text: DL.t('common.close') })]
    });
  }

  // Opens the link in the address: the questions of New, then the workflow, then the data. Nothing
  // changes when the data holds nothing that the page can read.
  function openLinkFromAddress() {
    var link = readLink();
    if (!link) return;
    // Bootstrap shows one dialog at a time. The keys stay in the address, so a reload opens the link.
    if (linkBusy || batchRunning || document.querySelector('.modal.show')) { U.toast(DL.t('link.wait'), 'info'); return; }
    forgetLink();
    var data = link.source ? DL.decodeBase64(link.source) : null;
    if (data && !data.bytes.length) { showLinkProblems([linkDataFault(data.badAt)], DL.t('link.noDataIntro')); return; }
    var name = link.workflow;
    linkBusy = true;
    newWorkflow({
      intro: !name ? DL.t('link.introData') : DL.t(data ? 'link.introBoth' : 'link.introWorkflow', { name: name }),
      then: function () {
        if (!name) { openLinkData(null, data); return; }
        var wf = DL.workflows.findBySlug(name);
        if (wf) {
          // A stop at the warning about code opens the data without the workflow.
          applyWorkflow(wf, function () { openLinkData(wf, data); }, function () { openLinkData(null, data); });
          return;
        }
        U.confirm({ title: DL.t('link.notFoundTitle'), message: DL.t('link.notFoundMessage', { name: name }), yes: DL.t('link.startNew') },
          function () { store.setWorkflowMeta({ name: name }); openLinkData(null, data); },
          function () { openLinkData(null, data); });
      },
      onCancel: function () { linkBusy = false; U.toast(DL.t('link.notOpened'), 'info'); }
    });
  }

  // Puts the data of a link in the source, with the reader settings of the workflow. The settings are
  // set each time: a workspace with no steps and no file keeps the settings of an older file.
  // applyWorkflow() calls this before it compares the settings, so it finds them equal and does not
  // read the data a second time.
  function openLinkData(wf, data) {
    linkBusy = false;
    if (!data) return;
    var options = DL.cleanSourceOptions(wf && wf.sourceOptions);
    options.sheet = '';
    options.multiFile = store.state.source.options.multiFile; // a habit of the user, not of the data
    store.setSourceOptions(options);
    linkLoad = { file: new File([data.bytes], 'link-data.csv', { type: 'text/csv' }), badAt: data.badAt, wf: wf };
    openFile(linkLoad.file);
  }

  // When the read of the data of a link ends, this says how it went: the faults of the data in a
  // dialog, or a short message when there are none.
  function linkLoadEnded(st) {
    var l = linkLoad;
    if (st.source.file !== l.file) { linkLoad = null; return; } // other data took its place
    if (st.source.status === 'loading') return;
    linkLoad = null;
    // The page shows the error of a read that failed.
    if (st.source.status === 'error') { if (l.badAt) U.toast(linkDataFault(l.badAt), 'warning'); return; }
    var info = st.source.info;
    var faults = (l.badAt ? [linkDataFault(l.badAt)] : []).concat(info.problems);
    // The check of the columns in applyWorkflow() ran before the data was there.
    var level = l.wf ? DL.workflows.matchLevel(l.wf, info.columns) : 'unknown';
    if (level === 'partial' || level === 'none') faults.push(DL.t('msg.columnsMissing'));
    if (!faults.length) U.toast(DL.t('link.opened', { rows: DL.rowsAndColumns(info.rowCount, info.columns.length) }), 'success');
    else if (document.querySelector('.modal.show')) U.toast(DL.t('link.problemsToast', { n: DL.pluralize(faults.length, 'problem') }), 'warning');
    else showLinkProblems(faults, DL.t('link.problemsIntro'));
  }

  /* ---------- Download ---------- */
  var exportToken = 0;

  function download() {
    grid.closeProfile();
    var st = store.state;
    if (st.source.status !== 'ready') { U.toast(DL.t('msg.openFileFirst'), 'info'); return; }
    var sel = st.selectedId;
    var shown = store.displayResultFor(sel);
    var note = null;
    if (sel !== 'source') {
      var idx = store.stepIndex(sel);
      var op = DL.getOp(st.workflow.steps[idx].opId);
      if (shown.stepId !== sel) note = DL.t('msg.downloadNoteBlocked', { n: idx + 1 });
      else note = DL.t('msg.downloadNoteStep', { n: idx + 1, op: op ? ' (' + op.name + ')' : '' });
    } else if (st.workflow.steps.length) {
      note = DL.t('msg.downloadNoteSource');
    }
    var base = U.baseName(st.source.file.name);
    var wfName = (st.workflow.name || '').trim();
    var shortName = wfName.toLowerCase().indexOf(base.toLowerCase()) === 0 ? wfName.slice(base.length).trim() : wfName;
    var shownStep = shown.stepId === 'source' ? -1 : store.stepIndex(shown.stepId);
    var suffix = shownStep < 0 ? '' : (wfName ? '-' + U.safeFileName(shortName || wfName) : '-step' + (shownStep + 1));
    DL.dialogs.download({ baseName: base + suffix, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, fileName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      if (exporting) { U.toast(DL.t('msg.downloadRunning'), 'info'); return; }
      showProgress(DL.t('progress.preparingDownload'), 20);
      exporting = true;
      var token = ++exportToken;
      engine.exportStep(shown.stepId, options).then(function (msg) {
        if (token === exportToken) exporting = false; // the last download owns the flag
        if (token !== exportToken) return;
        hideProgress();
        U.downloadBlob(msg.blob, fileName);
        U.toast(DL.t('msg.downloaded', { name: fileName, rows: DL.pluralize(msg.rowCount, 'row') }), 'success');
      }).catch(function (err) {
        if (token === exportToken) exporting = false;
        if (token !== exportToken) return;
        hideProgress();
        U.toast(err.message, 'danger');
      });
    });
  }

  /* ---------- Batch: apply the workflow to many files ---------- */
  var batchRunning = false;
  var batchToken = 0;
  var batchCancelled = false;

  // Ends a batch after the current file. The files that are done go into the zip.
  function cancelBatch() { batchCancelled = true; }

  // Ends a batch that does not finish. The worker restarts and reads the open file again.
  function stopBatch() {
    batchToken++;
    runToken++; // the run that the restart refuses does not report an error
    batchRunning = false;
    batchLabel = '';
    cancelable = false;
    disarmStop();
    hideProgress();
    engine.restart();
    grid.show(null, DL.t('preview.readingFile'));
    previewKey = null;
    if (store.state.source.file) loadSource();
    U.toast(DL.t('msg.batchStopped'), 'warning');
  }

  function batchApply(files) {
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var split = splitDataFiles(files);
    files = split.good;
    if (!files.length) { U.toast(DL.t('msg.noDataFiles', { types: split.accepted.join(', ') }), 'warning'); return; }
    var st = store.state;
    var steps = JSON.parse(JSON.stringify(workerSteps())); // a copy: edits during the batch do not change it
    var wfName = U.safeFileName((st.workflow.name || '').trim() || 'workflow');
    var note = DL.t('msg.batchNote', { steps: DL.pluralize(steps.length, 'step') });
    DL.dialogs.download({ files: files, baseName: wfName, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, zipName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      var batchOptions = JSON.parse(JSON.stringify(store.state.source.options));
      if (!store.state.source.file) batchOptions.sheet = ''; // the sheet of a file that is not open says nothing
      runBatch(files, steps, options, zipName, split.skipped, batchOptions);
    });
  }

  // outName is the name of the zip file, or the name of the output when there is one file.
  function runBatch(files, steps, output, outName, items, sourceOptions) {
    // The dialog that leads here stays open while a batch can start by another way, for example a
    // drop on the page. Without this check the new batch takes the token of the running one, and
    // that one ends with no file, no report and no word.
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var format = DL.outputFormatById(output.format);
    var single = files.length === 1;
    var usedNames = {};
    var token = ++batchToken;
    var i = 0;
    batchRunning = true;
    batchCancelled = false;
    // Two inputs with the same base name (a.csv, a.xlsx) get different names in the zip.
    function outputName(file) {
      var base = U.baseName(file.name);
      var name = base + format.extension;
      for (var n = 2; usedNames[name]; n++) name = base + ' (' + n + ')' + format.extension;
      usedNames[name] = true;
      return name;
    }
    function end() { batchRunning = false; batchLabel = ''; cancelable = false; disarmStop(); hideProgress(); }
    function next() {
      if (token !== batchToken) return;
      if (batchCancelled) { for (; i < files.length; i++) items.push({ name: files[i].name, error: DL.t('msg.cancelled') }); }
      if (i >= files.length) { finish(); return; }
      var file = files[i++];
      batchLabel = DL.t('progress.file', { n: i, total: files.length, name: file.name });
      cancelable = !batchCancelled;
      showProgress('', Math.round(100 * (i - 1) / files.length));
      armStop();
      engine.batch(file, sourceOptions, steps, output).then(function (msg) {
        var r = msg.result;
        if (r.error) items.push({ name: file.name, error: r.error, step: r.step, notes: r.notes });
        else items.push({ name: outputName(file), blob: r.blob, rowCount: r.rowCount, notes: r.notes });
        next();
      }).catch(function (err) {
        if (token !== batchToken) return;
        items.push({ name: file.name, error: err.message || String(err) });
        next();
      });
    }
    function finish() {
      var done = items.filter(function (it) { return it.blob; });
      if (!done.length) { end(); DL.dialogs.batchReport(items); return; }
      var attention = items.some(function (it) { return it.error || (it.notes && it.notes.length); });
      if (single) {
        end();
        U.downloadBlob(done[0].blob, outName);
        if (attention) DL.dialogs.batchReport(items);
        else U.toast(DL.t('msg.downloaded', { name: outName, rows: DL.pluralize(done[0].rowCount, 'row') }), 'success');
        return;
      }
      batchLabel = DL.t('progress.zip');
      cancelable = false;
      showProgress('', 95);
      engine.zip(done.map(function (it) { return { name: it.name, blob: it.blob }; })).then(function (msg) {
        end();
        U.downloadBlob(msg.blob, outName);

        if (attention) DL.dialogs.batchReport(items);
        else U.toast(DL.t('msg.downloadedZip', { name: outName, files: DL.pluralize(done.length, 'file') }), 'success');
      }).catch(function (err) { if (token !== batchToken) return; end(); U.toast(err.message, 'danger'); });
    }
    next();
  }

  /* ---------- Rendering ---------- */
  function renderConfig() {
    if (store.state.selectedId === 'source') { configView.renderedFor = null; sourceView.render(); }
    else configView.render();
  }

  function updateUndoButtons() {
    $('btnUndo').disabled = !store.canUndo();
    $('btnRedo').disabled = !store.canRedo();
  }

  store.subscribe(function (what, st) {
    switch (what) {
      case 'steps':
        chain.render(true);
        renderConfig();
        runAgainSoon();
        updateUndoButtons();
        updateSaveState();
        store.saveSession();
        if (autosaveOn) autosaveSoon();
        refreshPreview();
        break;
      case 'params':
        chain.render(false);
        configView.update();
        runAgainSoon();
        updateUndoButtons();
        updateSaveState();
        store.saveSession();
        if (autosaveOn) autosaveSoon();
        break;
      case 'selection':
        chain.render(true);
        renderConfig();
        refreshPreview();
        store.saveSession();
        break;
      case 'source':
        chain.render(false);
        renderConfig();
        refreshPreview();
        store.saveSession(); // the name of the file belongs to the session, as the steps do
        if (linkLoad) linkLoadEnded(st);
        break;
      case 'sourceOptions':
        store.saveSession();
        break;
      case 'results':
        chain.render(false);
        if (st.selectedId !== 'source') configView.update();
        refreshPreview();
        break;
      case 'workflow':
        // Not while the user types in the box: the box holds a name that the store does not have yet.
        if (document.activeElement !== $('workflowName')) $('workflowName').value = st.workflow.name || '';
        updateSaveState();
        store.saveSession();
        if (autosaveOn) autosaveSoon();
        break;
    }
  });

  /* ---------- Header buttons ---------- */
  $('btnAddStep').addEventListener('click', addStep);
  $('btnUndo').addEventListener('click', function () { store.undo(); });
  $('btnRedo').addEventListener('click', function () { store.redo(); });
  $('btnNew').addEventListener('click', function () { newWorkflow(); }); // the click event is not opts
  $('btnSave').addEventListener('click', function () { saveWorkflow(); });
  $('btnWorkflows').addEventListener('click', openWorkflows);
  $('btnDownload').addEventListener('click', download);
  $('btnHelp').addEventListener('click', DL.dialogs.help);
  $('btnTiming').addEventListener('click', function () {
    engine.memory().then(function (m) { DL.showTiming(store, m); }).catch(function () { DL.showTiming(store, null); });
  });

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    $('btnTheme').querySelector('i').className = theme === 'dark' ? 'bi bi-sun' : 'bi bi-moon';
  }
  applyTheme(document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light');
  $('btnTheme').addEventListener('click', function () {
    var theme = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('dl.theme', theme); } catch (e) { /* no storage: the theme lasts for this page only */ }
  });
  $('brand').addEventListener('click', function (e) { e.preventDefault(); store.select('source'); });
  $('workflowName').addEventListener('change', function () { store.setWorkflowMeta({ name: $('workflowName').value.trim() }); });
  $('workflowName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('workflowName').blur(); } });

  /* ---------- Keyboard shortcuts ---------- */
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key.toLowerCase();
    if (document.querySelector('.modal.show')) return; // a dialog owns the keyboard
    if (mod && !e.shiftKey && key === 'z') { if (!typing || e.target.type === 'checkbox') { e.preventDefault(); store.undo(); } return; }
    if (mod && (key === 'y' || (e.shiftKey && key === 'z'))) { if (!typing || e.target.type === 'checkbox') { e.preventDefault(); store.redo(); } return; }
    if (mod && key === 's') { e.preventDefault(); saveWorkflow(); return; }
    if (mod && key === 'd') { e.preventDefault(); download(); return; }
    if (mod && key === 'o') { e.preventDefault(); store.select('source'); var dz = document.querySelector('.dropzone'); if (dz) dz.click(); return; }
    if (mod && key === 'f') { e.preventDefault(); $('previewSearch').focus(); $('previewSearch').select(); return; }
    if (typing || document.querySelector('.modal.show')) return;
    if (e.key === 'Insert') { e.preventDefault(); addStep(); }
    else if (e.key === 'Delete' && store.state.selectedId !== 'source') { e.preventDefault(); store.removeStep(store.state.selectedId); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      var ids = ['source'].concat(store.state.workflow.steps.map(function (s) { return s.id; }));
      var i = ids.indexOf(store.state.selectedId) + (e.key === 'ArrowUp' ? -1 : 1);
      if (i >= 0 && i < ids.length) store.select(ids[i]);
    }
  });

  /* ---------- Drag a file anywhere ---------- */
  var dragDepth = 0;
  document.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') < 0) return;
    dragDepth++;
    document.body.classList.add('is-dragging-file');
  });
  document.addEventListener('dragleave', function () { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('is-dragging-file'); } });
  document.addEventListener('dragover', function (e) { if (document.body.classList.contains('is-dragging-file')) e.preventDefault(); });
  // The capture phase runs before the drop zone's own handler, which stops the event.
  document.addEventListener('drop', function () {
    dragDepth = 0;
    document.body.classList.remove('is-dragging-file');
  }, true);
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files[0]) return;
    e.preventDefault();
    openFiles(Array.from(e.dataTransfer.files));
  });

  /* ---------- Start ---------- */
  DL.applyI18n(document);
  document.documentElement.lang = DL.locale;
  showAutosave();
  Array.prototype.forEach.call(document.querySelectorAll('button[title]'), function (b) {
    if (!b.textContent.trim() && !b.getAttribute('aria-label')) b.setAttribute('aria-label', b.title);
  });
  U.tooltips(document.body);
  chain.render(true);
  renderConfig();
  refreshPreview();
  updateUndoButtons();
  updateSaveState();
  $('workflowName').value = store.state.workflow.name || '';
  if (store.droppedSteps) U.toast(DL.t('msg.stepsDropped', { n: DL.pluralize(store.droppedSteps, 'step') }), 'warning');
  // The steps come from localStorage. The file comes from IndexedDB, which answers later.
  DL.fileStore.get().then(function (files) {
    // The two stores are written one after the other, and every tab of this browser writes the same
    // two. A file that does not belong to these steps stays closed. The name alone is not enough:
    // two files can share a name, and the wrong one opens beside steps built for the other.
    var names = store.restoredSourceNames || [];
    var keyOf = function (f) { return f.name + ':' + f.size + ':' + f.lastModified; };
    var mine = files.length === names.length && files.every(function (f, i) { return keyOf(f) === names[i]; });
    if (mine && files.length && !store.state.source.files.length) {
      U.toast(files.length > 1
        ? DL.t('msg.workspaceBackMany', { n: DL.pluralize(files.length, 'file') })
        : DL.t('msg.workspaceBack', { name: files[0].name }), 'info');
      openFile(files[0], { extra: files.slice(1), sheet: store.state.source.options.sheet, fromStore: true });
    } else if (store.restoredSourceName && store.state.workflow.steps.length) {
      U.toast(DL.t('msg.stepsRestored', { name: store.restoredSourceName }), 'info');
    }
  }).then(function () {
    // A link comes after the workspace, so that its questions name the file that is open. A link
    // that the user pastes into the address of an open page does not load the page again.
    openLinkFromAddress();
    window.addEventListener('hashchange', openLinkFromAddress);
  });
  // A handle for tests: open the page with ?debug to use it from the browser console.
  if (/[?&]debug\b/.test(location.search)) window.DLApp = { store: store, engine: engine, grid: grid, openFile: openFile, openFiles: openFiles };
})();
