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
    reload: loadSource,
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
    progressEl.querySelector('.progress-bar').style.width = Math.max(2, percent || 0) + '%';
    progressEl.querySelector('.app-progress-label').textContent = batchLabel ? batchLabel + (label ? ' · ' + label : '') : (label || '');
    $('btnCancel').hidden = !cancelable;
    clearTimeout(progressTimer);
    if (!batchLabel && !runInFlight && store.state.source.status !== 'loading') progressTimer = setTimeout(hideProgress, 4000);
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

  // One file opens as the source. Many files go through the workflow one by one (batch).
  function openFiles(files) {
    if (!files || !files.length) return;
    if (files.length === 1 && DL.fileExtension(files[0].name) === 'json') { importWorkflowFile(files[0]); return; }
    if (files.length === 1) { openFile(files[0]); return; }
    if (!store.state.workflow.steps.length) {
      U.toast(DL.t('msg.addStepsFirst'), 'info');
      openFile(files[0]);
      return;
    }
    batchApply(files);
  }

  var MAX_FILE_BYTES = 1.5 * 1024 * 1024 * 1024; // browsers cannot read a larger file into memory

  // opts.sheet opens a workbook at that sheet. setSourceFile() empties the sheet, so it goes back after.
  // opts.keep false leaves the workspace store as it is, for a file that came out of that store.
  function openFile(file, opts) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      U.toast(DL.t('msg.fileTooBig'), 'danger');
      return;
    }
    opts = opts || {};
    store.setSourceFile(file);
    if (opts.sheet) store.setSourceOptions({ sheet: opts.sheet });
    if (opts.keep !== false) {
      // The workspace comes back after a reload, but only for a file that is small enough.
      if (file.size > DL.fileStore.MAX_BYTES) U.toast(DL.t('msg.workspaceTooBig', { size: U.fmtBytes(DL.fileStore.MAX_BYTES) }), 'warning');
      DL.fileStore.put(file);
    }
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
        U.toast(err.message, 'danger');
        DL.fileStore.clear(); // a file that does not open must not come back at the next reload
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
      // The browser keeps a file as a name and a time, not as bytes. A file that moved, or that
      // another program wrote again, does not read any more. Such a file must not come back.
      DL.fileStore.clear();
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
    if (!exporting && store.state.source.status !== 'loading') hideProgress();
  }

  // The steps in the shape that the worker reads.
  function workerSteps() {
    return store.state.workflow.steps.map(function (s) { return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false }; });
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

  // Empties the steps and closes the file, so that the user can start again.
  function newWorkflow() {
    grid.closeProfile();
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var st = store.state;
    if (!st.workflow.steps.length && !st.workflow.name && !st.source.file) { U.toast(DL.t('msg.newEmpty'), 'info'); return; }
    U.confirm({
      title: DL.t('msg.newTitle'),
      message: DL.t('msg.newMessage'),
      yes: DL.t('msg.newYes')
    }, function () {
      U.confirm({ title: DL.t('msg.newSureTitle'), message: DL.t('msg.newSureMessage'), yes: DL.t('msg.newSureYes'), danger: true }, function () {
        // A file dropped on the page can start a batch while the questions are on the screen.
        if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
        autosaveSoon.cancel();
        autosaveNow(); // a change that waits goes to the old record before the steps go away
        store.replaceWorkflow({ id: null, name: '', steps: [] });
        loadToken++; // a load that is on its way must not put its file on the empty screen
        searchToken++;
        exportToken++;
        store.setSourceFile(null);
        store.setSourceOptions(DL.defaultSourceOptions());
        DL.fileStore.clear();
        engine.restart(); // the worker holds the table of the old file
        // Undo cannot bring the file back, and it would put the settings of the old file on an empty
        // screen. A half undo is worse than none.
        store.clearHistory();
        updateUndoButtons();
        U.toast(DL.t('msg.newDone'), 'success');
      });
    });
  }

  // Runs a saved workflow on files that the user gives, and downloads the result. The workflow on the
  // screen and the file that is open do not change.
  function quickRunWorkflow(wf, files) {
    if (batchRunning) { U.toast(DL.t('msg.batchRunning'), 'info'); return; }
    var steps = (wf.steps || []).map(function (s) { return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false }; });
    if (!steps.length) { U.toast(DL.t('msg.quickRunNoSteps'), 'info'); return; }
    var accepted = DL.acceptedExtensions();
    var skipped = files.filter(function (f) { return accepted.indexOf('.' + DL.fileExtension(f.name)) < 0 || f.size > MAX_FILE_BYTES; });
    files = files.filter(function (f) { return skipped.indexOf(f) < 0; });
    if (!files.length) { U.toast(DL.t('msg.noDataFiles', { types: accepted.join(', ') }), 'warning'); return; }
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
      runBatch(files, steps, options, outName, skipped.map(function (f) { return { name: f.name, error: DL.t(f.size > MAX_FILE_BYTES ? 'msg.fileTooBig' : 'msg.notDataFile') }; }), sourceOptions);
    });
  }

  function applyWorkflow(wf, then) {
    // Write a waiting autosave first: it decides whether the steps count as saved. autosaveNow() opens
    // no dialog, so it cannot put the save dialog under the dialogs below.
    autosaveSoon.cancel();
    autosaveNow();
    var go = function () {
      store.replaceWorkflow(wf);
      if (then) then();
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
    var saveThenGo = function () {
      saveWorkflow(function (rec) {
        if (!rec) { U.toast(DL.t('msg.notOpened', { name: wf.name }), 'info'); return; }
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
        }, saveThenGo, null, go);
        return;
      }
      U.confirm({ title: DL.t('msg.replaceTitle'), message: DL.t('msg.replaceMessage'), yes: DL.t('msg.replace') }, go);
    };
    // A workflow with code gets its own warning first. The question about saving must not hide it.
    if ((wf.steps || []).some(function (s) { return s.opId === 'javascript'; })) {
      U.confirm({ title: DL.t('msg.applyTitle'), message: DL.t('msg.codeWarning'), yes: DL.t('common.use'), danger: true }, ask);
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
      showProgress(DL.t('progress.preparingDownload'), 20);
      exporting = true;
      var token = ++exportToken;
      engine.exportStep(shown.stepId, options).then(function (msg) {
        exporting = false; // before the test of the token: the bar waits for this flag
        if (token !== exportToken) return;
        hideProgress();
        U.downloadBlob(msg.blob, fileName);
        U.toast(DL.t('msg.downloaded', { name: fileName, rows: DL.pluralize(msg.rowCount, 'row') }), 'success');
      }).catch(function (err) {
        exporting = false;
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
    var accepted = DL.acceptedExtensions();
    var skipped = files.filter(function (f) { return accepted.indexOf('.' + DL.fileExtension(f.name)) < 0 || f.size > MAX_FILE_BYTES; });
    files = files.filter(function (f) { return skipped.indexOf(f) < 0; });
    if (!files.length) { U.toast(DL.t('msg.noDataFiles', { types: accepted.join(', ') }), 'warning'); return; }
    var st = store.state;
    var steps = JSON.parse(JSON.stringify(workerSteps())); // a copy: edits during the batch do not change it
    var wfName = U.safeFileName((st.workflow.name || '').trim() || 'workflow');
    var note = DL.t('msg.batchNote', { steps: DL.pluralize(steps.length, 'step') });
    DL.dialogs.download({ files: files, baseName: wfName, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, zipName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      runBatch(files, steps, options, zipName, skipped.map(function (f) { return { name: f.name, error: DL.t(f.size > MAX_FILE_BYTES ? 'msg.fileTooBig' : 'msg.notDataFile') }; }), JSON.parse(JSON.stringify(store.state.source.options)));
    });
  }

  // outName is the name of the zip file, or the name of the output when there is one file.
  function runBatch(files, steps, output, outName, items, sourceOptions) {
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
      var oneAttention = items.some(function (it) { return it.error || (it.notes && it.notes.length); });
      if (single) {
        end();
        U.downloadBlob(done[0].blob, outName);
        if (oneAttention) DL.dialogs.batchReport(items);
        else U.toast(DL.t('msg.downloaded', { name: outName, rows: DL.pluralize(done[0].rowCount, 'row') }), 'success');
        return;
      }
      batchLabel = DL.t('progress.zip');
      cancelable = false;
      showProgress('', 95);
      engine.zip(done.map(function (it) { return { name: it.name, blob: it.blob }; })).then(function (msg) {
        end();
        U.downloadBlob(msg.blob, outName);
        var attention = items.some(function (it) { return it.error || (it.notes && it.notes.length); });
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
  $('btnNew').addEventListener('click', newWorkflow);
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
  DL.fileStore.get().then(function (file) {
    // The two stores are written one after the other, and every tab of this browser writes the same
    // two. A file with a different name does not belong to these steps, so it stays closed.
    var mine = file && (!store.restoredSourceName || file.name === store.restoredSourceName);
    if (mine && !store.state.source.file) {
      U.toast(DL.t('msg.workspaceBack', { name: file.name }), 'info');
      openFile(file, { sheet: store.state.source.options.sheet, keep: false });
    } else if (store.restoredSourceName && store.state.workflow.steps.length) {
      U.toast(DL.t('msg.stepsRestored', { name: store.restoredSourceName }), 'info');
    }
  });
  // A handle for tests: open the page with ?debug to use it from the browser console.
  if (/[?&]debug\b/.test(location.search)) window.DLApp = { store: store, engine: engine, grid: grid, openFile: openFile, openFiles: openFiles };
})();
