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
  function showProgress(label, percent) {
    progressEl.hidden = false;
    progressEl.querySelector('.progress-bar').style.width = Math.max(2, percent || 0) + '%';
    progressEl.querySelector('.app-progress-label').textContent = label || '';
    clearTimeout(progressTimer);
    progressTimer = setTimeout(hideProgress, 4000);
  }
  function hideProgress() { clearTimeout(progressTimer); progressEl.hidden = true; $('btnStop').hidden = true; }

  // A step that does not finish (for example a slow regular expression) blocks the worker.
  // Stop ends the worker, loads the file again and turns the selected step off.
  var stopTimer = null;
  function armStop() {
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () { showProgress('Still running… this takes longer than usual.', 50); $('btnStop').hidden = false; }, 15000);
  }
  function disarmStop() { clearTimeout(stopTimer); $('btnStop').hidden = true; }
  $('btnStop').addEventListener('click', function () {
    disarmStop();
    engine.restart();
    var sel = store.state.selectedId;
    if (sel !== 'source' && store.getStep(sel) && store.getStep(sel).enabled !== false) {
      store.toggleStep(sel);
      U.toast('Step ' + (store.stepIndex(sel) + 1) + ' did not finish and was turned off. Check its settings.', 'warning');
    }
    grid.show(null, 'Reading the file…');
    previewKey = null;
    if (store.state.source.file) loadSource();
  });

  /* ---------- Source loading ---------- */
  var loadToken = 0;

  function openFile(file) {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024 * 1024) {
      U.toast('This file is larger than 1.5 GB. Browsers cannot work with files this big. Split it first.', 'danger');
      return;
    }
    store.setSourceFile(file);
    if (DL.inputFormatFor(file.name).hasSheets) {
      var token = ++loadToken;
      showProgress('Reading workbook', 5);
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
    showProgress('Reading file', 2);
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
    if (store.state.source.status !== 'ready') return;
    var token = ++runToken;
    var steps = store.state.workflow.steps.map(function (s) {
      return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false };
    });
    var started = Date.now();
    var slowTimer = setTimeout(function () { showProgress('Running steps…', 50); }, 400);
    armStop();
    engine.run(steps, protectedSteps()).then(function (msg) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      disarmStop();
      if (Date.now() - started > 400) hideProgress();
      store.setResults(msg.results);
    }).catch(function (err) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      disarmStop();
      hideProgress();
      U.toast('Something went wrong while running the steps: ' + err.message, 'danger');
    });
  }

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
    if (sel === 'source') title = 'Source file';
    else {
      var step = store.getStep(sel);
      var op = step && DL.getOp(step.opId);
      title = 'Step ' + (store.stepIndex(sel) + 1) + ': ' + (op ? op.name : '');
    }
    if (shown.stepId === 'source' && st.source.info) stats = DL.rowsAndColumns(st.source.info.rowCount, st.source.info.columns.length);
    else if (shown.result) stats = DL.rowsAndColumns(shown.result.rowCount, shown.result.columns.length) + (shown.result.ms > 50 ? ' · ' + (shown.result.ms / 1000).toFixed(1) + ' s' : '');
    if (shown.reason) stats += (stats ? ' · ' : '') + shown.reason;
    $('previewTitle').textContent = title;
    $('previewStats').textContent = stats;
    previewStats = stats;
    $('btnDiff').disabled = !shown.stepId || shown.stepId === 'source';
    grid.diff = !!(diffOn() && shown.stepId && shown.stepId !== 'source');
    var message = shown.stepId ? '' : (st.source.status === 'loading' ? 'Reading the file…' : 'Open a file to see a preview.');
    var key = (shown.stepId || 'none') + '|' + resultKey(shown.stepId || 'source') + '|' + message + '|' + (grid.diff ? 'diff' : '');
    if (key !== previewKey) {
      previewKey = key;
      grid.show(shown.stepId, message).then(function () {
        if (searchQuery) runSearch();
        else if (shown.result && shown.stepId === sel) scrollToNewColumns(shown);
      });
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
      text = 'Rows went from ' + summary.rowsBefore.toLocaleString() + ' to ' + summary.rowsAfter.toLocaleString() + '. Cell changes are not marked when the rows change.';
    } else {
      var cells = 0, cols = 0, added = 0;
      summary.columns.forEach(function (c) { if (c.isNew) added++; else if (c.changed) { cells += c.changed; cols++; } });
      var parts = [];
      if (cells) parts.push(DL.pluralize(cells, 'changed cell') + ' in ' + DL.pluralize(cols, 'column'));
      if (added) parts.push(DL.pluralize(added, 'new column'));
      if (summary.removed.length) parts.push(DL.pluralize(summary.removed.length, 'removed column') + ' (' + summary.removed.join(', ') + ')');
      text = parts.length ? parts.join(' · ') : 'No cell changed.';
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
      gridBefore = new DL.GridView(wrap, engine, { title: 'Before' });
      gridBefore.onScroll = function (top) { if (Math.abs(grid.scroll.scrollTop - top) > 1) grid.scroll.scrollTop = top; };
      grid.onScroll = function (top) { if (gridBefore && Math.abs(gridBefore.scroll.scrollTop - top) > 1) gridBefore.scroll.scrollTop = top; };
    }
    grid.setTitle('After');
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
    searchMatches = matches;
    searchIndex = matches.length ? 0 : -1;
    grid.setHits(matches);
    var info = $('previewSearchInfo');
    if (!searchQuery) info.textContent = '';
    else if (!total) info.textContent = 'No matches';
    else info.textContent = U.fmtInt(total) + (total > matches.length ? ' rows match (first ' + matches.length + ' shown)' : ' rows match');
    $('previewSearchPrev').disabled = $('previewSearchNext').disabled = !matches.length;
    if (matches.length) grid.setCurrent(matches[0]);
  }

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
      U.toast('Tip: open a file first so you can pick columns by name.', 'info');
    }
    DL.dialogs.pickOperation({}, function (opId) { store.addStep(opId, store.state.selectedId); });
  }

  /* ---------- Workflows ---------- */
  function saveWorkflow() {
    var st = store.state;
    if (!st.workflow.steps.length) { U.toast('Add at least one step before saving.', 'info'); return; }
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
      U.toast('Workflow "' + rec.name + '" saved.', 'success');
    };
    if (st.workflow.id && st.workflow.name) doSave(st.workflow.name);
    else {
      var suggested = st.workflow.name || (st.source.file ? U.baseName(st.source.file.name) + ' workflow' : 'My workflow');
      U.prompt({ title: 'Save workflow', message: 'Give this workflow a name so you can find it again.', value: suggested, yes: 'Save' }, doSave);
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
      if (level === 'partial' || level === 'none') U.toast('Some steps refer to columns that are not in this file. Check the steps marked "Needs setup".', 'warning');
    };
    if (store.state.workflow.steps.length && store.state.dirty) {
      U.confirm({ title: 'Replace current steps?', message: 'The steps you built now will be replaced. You can undo this.', yes: 'Replace' }, go);
    } else go();
  }

  function importWorkflowFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wf = DL.workflows.fromJSON(reader.result);
        var rec = DL.workflows.save(wf);
        applyWorkflow(rec || wf);
        U.toast('Workflow "' + wf.name + '" imported and saved.', 'success');
      } catch (e) { U.toast(e.message, 'danger'); }
    };
    reader.onerror = function () { U.toast('The file could not be read.', 'danger'); };
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
    else if (st.workflow.id && !st.dirty) el.textContent = 'Saved';
    else if (st.workflow.id) el.textContent = 'Changed since last save';
    else el.textContent = 'Not saved yet';
  }

  /* ---------- Download ---------- */
  function download() {
    var st = store.state;
    if (st.source.status !== 'ready') { U.toast('Open a file first.', 'info'); return; }
    var sel = st.selectedId;
    var shown = store.displayResultFor(sel);
    var note = null;
    if (sel !== 'source') {
      var idx = store.stepIndex(sel);
      var op = DL.getOp(st.workflow.steps[idx].opId);
      if (shown.stepId !== sel) note = 'Step ' + (idx + 1) + ' cannot run yet, so the download holds the data going into it.';
      else note = 'This download holds the result after step ' + (idx + 1) + (op ? ' (' + op.name + ')' : '') + '.';
    } else if (st.workflow.steps.length) {
      note = 'The source is selected, so this download holds the unchanged source data. Select the last step to download the final result.';
    }
    var base = U.baseName(st.source.file.name);
    var wfName = (st.workflow.name || '').trim();
    var suffix = sel === 'source' ? '' : (wfName ? '-' + U.safeFileName(wfName.replace(base, '').trim() || wfName) : '-step' + (store.stepIndex(sel) + 1));
    DL.dialogs.download({ baseName: base + suffix, note: note, lastFormat: lastFormat, lastOptions: lastFormatOptions }, function (options, fileName, allOptions) {
      lastFormat = options.format;
      lastFormatOptions = allOptions;
      showProgress('Preparing download', 20);
      engine.exportStep(shown.stepId, options).then(function (msg) {
        hideProgress();
        U.downloadBlob(msg.blob, fileName);
        U.toast('Downloaded ' + fileName + ' (' + DL.pluralize(msg.rowCount, 'row') + ').', 'success');
      }).catch(function (err) { hideProgress(); U.toast(err.message, 'danger'); });
    });
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
    var f = e.dataTransfer.files[0];
    if (DL.fileExtension(f.name) === 'json') importWorkflowFile(f);
    else openFile(f);
  });

  /* ---------- Start ---------- */
  U.tooltips(document.body);
  chain.render(true);
  renderConfig();
  refreshPreview();
  updateUndoButtons();
  updateSaveState();
  $('workflowName').value = store.state.workflow.name || '';
  if (store.restoredSourceName && store.state.workflow.steps.length) {
    U.toast('Your steps were restored. Open "' + store.restoredSourceName + '" again to continue.', 'info');
  }
  // A handle for tests: open the page with ?debug to use it from the browser console.
  if (/[?&]debug\b/.test(location.search)) window.DLApp = { store: store, engine: engine, grid: grid, openFile: openFile };
})();
