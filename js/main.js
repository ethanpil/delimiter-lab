/* Delimiter Lab - application controller. */
(function () {
  'use strict';
  var U = DL.util;
  var $ = function (id) { return document.getElementById(id); };
  DL.setLocale(DL.detectLocale()); // before any view makes text

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
    reload: loadSource,
    loadSample: function () { openFile(DL.SourceView.sampleFile()); }
  });
  var configView = new DL.ConfigView($('config'), store, {
    changeOp: function (id) {
      DL.dialogs.pickOperation({ title: 'Change operation' }, function (opId) { store.changeOp(id, opId); });
    },
    remove: function (id) { store.removeStep(id); }
  });
  var grid = new DL.GridView($('grid'), engine);
  var gridBefore = null;
  var lastFormat = 'csv';
  var lastFormatOptions = {};

  /* ---------- Progress ---------- */
  var progressTimer = null;
  var batchLabel = ''; // "File 2 of 5: x.csv" while a batch runs; worker messages go after it
  var runInFlight = false; // true while the worker runs the chain: the bar stays until the run ends
  var cancelable = false;  // true while a click on Cancel can stop the work
  function showProgress(label, percent) {
    progressEl.hidden = false;
    progressEl.querySelector('.progress-bar').style.width = Math.max(2, percent || 0) + '%';
    progressEl.querySelector('.app-progress-label').textContent = batchLabel ? batchLabel + (label ? ' · ' + label : '') : (label || '');
    $('btnCancel').hidden = !cancelable;
    clearTimeout(progressTimer);
    if (!batchLabel && !runInFlight) progressTimer = setTimeout(hideProgress, 4000);
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

  // One file opens as the source. Many files go through the workflow one by one (batch).
  function openFiles(files) {
    if (!files || !files.length) return;
    if (files.length === 1) { openFile(files[0]); return; }
    if (!store.state.workflow.steps.length) {
      U.toast(DL.t('msg.addStepsFirst'), 'info');
      openFile(files[0]);
      return;
    }
    batchApply(files);
  }

  function openFile(file) {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024 * 1024) {
      U.toast(DL.t('msg.fileTooBig'), 'danger');
      return;
    }
    store.setSourceFile(file);
    if (DL.inputFormatFor(file.name).hasSheets) {
      var token = ++loadToken;
      showProgress(DL.t('progress.readingWorkbook'), 5);
      engine.listSheets(file).then(function (msg) {
        if (token !== loadToken) return;
        store.setSheets(msg.sheets);
        loadSource();
      }).catch(function (err) {
        if (token !== loadToken) return;
        hideProgress();
        store.setSourceError(err.message);
      });
    } else {
      loadSource();
    }
  }

  function loadSource() {
    var src = store.state.source;
    if (!src.file) return;
    var token = ++loadToken;
    src.status = 'loading';
    store.emit('source');
    showProgress(DL.t('progress.readingFile'), 2);
    armStop();
    engine.load(src.file, src.options).then(function (msg) {
      if (token !== loadToken) return;
      disarmStop();
      hideProgress();
      store.setSourceInfo(msg.info);
      runChain();
    }).catch(function (err) {
      if (token !== loadToken) return;
      disarmStop();
      hideProgress();
      store.setSourceError(err.message);
      U.toast(err.message, 'danger');
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

  function runChain() {
    if (store.state.source.status !== 'ready') { runInFlight = false; return; }
    var token = ++runToken;
    var steps = store.state.workflow.steps.map(function (s) {
      return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false };
    });
    var started = Date.now();
    var slowTimer = setTimeout(function () { showProgress(DL.t('progress.runningSteps'), 50); }, 400);
    armStop();
    runInFlight = true;
    cancelable = true;
    engine.run(steps, protectedSteps()).then(function (msg) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      runInFlight = false;
      cancelable = false;
      disarmStop();
      if (!batchLabel) hideProgress();
      store.setResults(msg.results);
      if (msg.cancelled) U.toast(DL.t('msg.runCancelled'), 'info');
    }).catch(function (err) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      runInFlight = false;
      cancelable = false;
      disarmStop();
      hideProgress();
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
      var f = st.source.file;
      return 'source:' + (f ? f.name + f.size + f.lastModified : '') + ':' + (st.source.info ? st.source.info.rowCount + '/' + st.source.info.columns.join('|') : '');
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
    $('btnDiff').disabled = !shown.stepId || shown.stepId === 'source';
    grid.diff = !!(diffOn() && shown.stepId && shown.stepId !== 'source');
    var message = shown.stepId ? '' : (st.source.status === 'loading' ? DL.t('preview.readingFile') : DL.t('preview.openFile'));
    var key = (shown.stepId || 'none') + '|' + resultKey(shown.stepId || 'source') + '|' + message + '|' + (grid.diff ? 'diff' : '');
    if (key !== previewKey) {
      previewKey = key;
      grid.show(shown.stepId, message).then(function () {
        if (searchQuery) runSearch();
        else if (searchMatches.length) showMatches([], ''); // rows from a note belong to the old preview
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
    var steps = store.state.workflow.steps;
    for (var i = store.stepIndex(sel) - 1; i >= 0; i--) {
      if (DL.resultHasTable(store.state.results[steps[i].id])) return steps[i].id;
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
    }).catch(function (err) { U.toast(err.message, 'danger'); });
  }

  function setSearchResult(matches, total) {
    var info = '';
    if (searchQuery) info = !total ? DL.t('preview.noMatches') : DL.t(total > matches.length ? 'preview.rowsMatchFirst' : 'preview.rowsMatch', { n: U.fmtInt(total), shown: matches.length });
    showMatches(matches, info);
  }

  // Marks rows in the preview and lets the user step through them with the search buttons.
  function showMatches(matches, info) {
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
      if (r.removed) { showMatches([], DL.t('preview.notInOutput')); return; }
      if (grid.stepId !== stepId) { showMatches([], ''); return; }
      showMatches(r.matches, note.text + (r.total > r.matches.length ? DL.t('preview.firstShown', { shown: r.matches.length }) : ''));
    }).catch(function (err) { U.toast(err.message, 'danger'); });
  };

  function stepSearch(dir) {
    if (!searchMatches.length) return;
    searchIndex = (searchIndex + dir + searchMatches.length) % searchMatches.length;
    grid.setCurrent(searchMatches[searchIndex]);
    $('previewSearchInfo').textContent = (searchIndex + 1) + ' of ' + searchMatches.length;
  }

  var searchSoon = U.debounce(function () { searchQuery = $('previewSearch').value.trim(); runSearch(); }, 250);
  $('previewSearch').addEventListener('input', searchSoon);
  $('previewSearch').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); searchSoon.flush(); stepSearch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { $('previewSearch').value = ''; searchQuery = ''; setSearchResult([], 0); }
  });
  $('previewSearchNext').addEventListener('click', function () { stepSearch(1); });
  $('previewSearchPrev').addEventListener('click', function () { stepSearch(-1); });
  $('btnCompare').addEventListener('click', function () { setTimeout(refreshCompare, 0); });
  $('btnDiff').addEventListener('click', function () { setTimeout(refreshPreview, 0); });

  /* ---------- Steps ---------- */
  function addStep() {
    if (store.state.source.status !== 'ready' && !store.state.workflow.steps.length) {
      U.toast(DL.t('msg.openFileTip'), 'info');
    }
    DL.dialogs.pickOperation({}, function (opId) { store.addStep(opId, store.state.selectedId); });
  }

  /* ---------- Workflows ---------- */
  function saveWorkflow() {
    var st = store.state;
    if (!st.workflow.steps.length) { U.toast(DL.t('msg.addStepBeforeSave'), 'info'); return; }
    var doSave = function (name) {
      var rec = DL.workflows.save({
        id: st.workflow.id,
        name: name,
        steps: st.workflow.steps,
        columns: store.sourceColumns() || [],
        sourceOptions: st.source.options
      });
      if (!rec) return;
      store.setWorkflowMeta({ id: rec.id, name: rec.name }, true);
      U.toast(DL.t('msg.workflowSaved', { name: rec.name }), 'success');
    };
    if (st.workflow.id && st.workflow.name) doSave(st.workflow.name);
    else {
      var suggested = st.workflow.name || (st.source.file ? U.baseName(st.source.file.name) + ' workflow' : 'My workflow');
      U.prompt({ title: DL.t('msg.saveTitle'), message: DL.t('msg.saveMessage'), value: suggested, yes: DL.t('common.save') }, doSave);
    }
  }

  function applyWorkflow(wf) {
    var go = function () {
      store.replaceWorkflow(wf);
      if (wf.id) DL.workflows.touch(wf.id);
      if (wf.sourceOptions && store.state.source.file) {
        var wanted = DL.cleanSourceOptions(wf.sourceOptions);
        wanted.sheet = store.state.source.options.sheet;
        if (JSON.stringify(wanted) !== JSON.stringify(store.state.source.options)) {
          store.setSourceOptions(wanted);
          loadSource();
        }
      }
      var level = DL.workflows.matchLevel(wf, store.sourceColumns());
      if (level === 'partial' || level === 'none') U.toast(DL.t('msg.columnsMissing'), 'warning');
    };
    if (store.state.workflow.steps.length && store.state.dirty) {
      U.confirm({ title: DL.t('msg.replaceTitle'), message: DL.t('msg.replaceMessage'), yes: DL.t('msg.replace') }, go);
    } else go();
  }

  function importWorkflowFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wf = DL.workflows.fromJSON(reader.result);
        var rec = DL.workflows.save(wf);
        applyWorkflow(rec || wf);
        U.toast(DL.t('msg.workflowImported', { name: wf.name }), 'success');
      } catch (e) { U.toast(e.message, 'danger'); }
    };
    reader.onerror = function () { U.toast(DL.t('msg.fileNotRead'), 'danger'); };
    reader.readAsText(file);
  }

  function openWorkflows() {
    DL.dialogs.workflows({ currentColumns: store.sourceColumns(), currentId: store.state.workflow.id }, {
      apply: applyWorkflow,
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

  /* ---------- Download ---------- */
  function download() {
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
    var suffix = sel === 'source' ? '' : (wfName ? '-' + U.safeFileName(wfName.replace(base, '').trim() || wfName) : '-step' + (store.stepIndex(sel) + 1));
    DL.dialogs.download({ baseName: base + suffix, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, fileName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      showProgress(DL.t('progress.preparingDownload'), 20);
      engine.exportStep(shown.stepId, options).then(function (msg) {
        hideProgress();
        U.downloadBlob(msg.blob, fileName);
        U.toast(DL.t('msg.downloaded', { name: fileName, rows: DL.pluralize(msg.rowCount, 'row') }), 'success');
      }).catch(function (err) { hideProgress(); U.toast(err.message, 'danger'); });
    });
  }

  /* ---------- Batch: apply the workflow to many files ---------- */
  var batchRunning = false;
  var batchToken = 0;
  var batchCancelled = false;

  // Ends a batch after the current file. The files that are done go into the zip.
  function cancelBatch() { batchCancelled = true; }

  // Ends a batch that does not finish: the worker restarts and the open file is read again.
  function stopBatch() {
    batchToken++;
    batchRunning = false;
    batchLabel = '';
    engine.restart();
    grid.show(null, DL.t('preview.readingFile'));
    previewKey = null;
    if (store.state.source.file) loadSource();
    U.toast(DL.t('msg.batchStopped'), 'warning');
  }

  function batchApply(files) {
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var accepted = DL.acceptedExtensions();
    var skipped = files.filter(function (f) { return accepted.indexOf('.' + DL.fileExtension(f.name)) < 0; });
    files = files.filter(function (f) { return skipped.indexOf(f) < 0; });
    if (!files.length) { U.toast(DL.t('msg.noDataFiles', { types: accepted.join(', ') }), 'warning'); return; }
    var st = store.state;
    var steps = st.workflow.steps.map(function (s) { return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false }; });
    var wfName = U.safeFileName((st.workflow.name || '').trim() || 'workflow');
    var note = DL.t('msg.batchNote', { steps: DL.pluralize(steps.length, 'step') });
    DL.dialogs.download({ files: files, baseName: wfName, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, zipName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      runBatch(files, steps, options, zipName, skipped.map(function (f) { return { name: f.name, error: DL.t('msg.notDataFile') }; }));
    });
  }

  function runBatch(files, steps, output, zipName, items) {
    var format = DL.outputFormatById(output.format);
    var sourceOptions = store.state.source.options;
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
      batchLabel = DL.t('progress.zip');
      cancelable = false;
      showProgress('', 95);
      engine.zip(done.map(function (it) { return { name: it.name, blob: it.blob }; })).then(function (msg) {
        end();
        U.downloadBlob(msg.blob, zipName);
        var attention = items.some(function (it) { return it.error || (it.notes && it.notes.length); });
        if (attention) DL.dialogs.batchReport(items);
        else U.toast(DL.t('msg.downloadedZip', { name: zipName, files: DL.pluralize(done.length, 'file') }), 'success');
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
        refreshPreview();
        break;
      case 'params':
        chain.render(false);
        configView.update();
        runAgainSoon();
        updateUndoButtons();
        updateSaveState();
        store.saveSession();
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
        $('workflowName').value = st.workflow.name || '';
        updateSaveState();
        store.saveSession();
        break;
    }
  });

  /* ---------- Header buttons ---------- */
  $('btnAddStep').addEventListener('click', addStep);
  $('btnUndo').addEventListener('click', function () { store.undo(); });
  $('btnRedo').addEventListener('click', function () { store.redo(); });
  $('btnSave').addEventListener('click', saveWorkflow);
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
    var files = Array.from(e.dataTransfer.files);
    if (files.length === 1 && DL.fileExtension(files[0].name) === 'json') importWorkflowFile(files[0]);
    else openFiles(files);
  });

  /* ---------- Start ---------- */
  DL.applyI18n(document);
  U.tooltips(document.body);
  chain.render(true);
  renderConfig();
  refreshPreview();
  updateUndoButtons();
  updateSaveState();
  $('workflowName').value = store.state.workflow.name || '';
  if (store.restoredSourceName && store.state.workflow.steps.length) {
    U.toast(DL.t('msg.stepsRestored', { name: store.restoredSourceName }), 'info');
  }
  // A handle for tests: open the page with ?debug to use it from the browser console.
  if (/[?&]debug\b/.test(location.search)) window.DLApp = { store: store, engine: engine, grid: grid, openFile: openFile, openFiles: openFiles };
})();
