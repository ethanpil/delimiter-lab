/* Delimiter Lab - application controller. */
(function () {
  'use strict';
  var U = DL.util;
  var $ = function (id) { return document.getElementById(id); };

  var store = new DL.Store();
  var progressEl = $('progress');
  var engine = new DL.EngineClient(function (msg) { showProgress(msg.phase, msg.percent); });
  engine.configure(U.cellBudget());

  var chain = new DL.ChainView($('chain'), store, {
    toggle: function (id) { store.toggleStep(id); },
    duplicate: function (id) { store.duplicateStep(id); },
    remove: function (id) { removeStep(id); }
  });
  var sourceView = new DL.SourceView($('config'), store, {
    openFile: openFile,
    reload: loadSource,
    loadSample: function () { openFile(DL.SourceView.sampleFile()); }
  });
  var configView = new DL.ConfigView($('config'), store, {
    changeOp: function (id) {
      DL.dialogs.pickOperation({ title: 'Change operation' }, function (opId) {
        var step = store.getStep(id);
        if (!step || step.opId === opId) return;
        store.pushHistory();
        step.opId = opId;
        step.params = DL.defaultParams(opId);
        store.state.dirty = true;
        store.emit('steps');
        store.emit('selection');
      });
    },
    remove: removeStep
  });
  var grid = new DL.GridView($('grid'), engine);
  var gridBefore = null;
  var lastFormat = 'csv';

  /* ---------- Progress ---------- */
  var progressTimer = null;
  function showProgress(label, percent) {
    progressEl.hidden = false;
    progressEl.querySelector('.progress-bar').style.width = Math.max(2, percent || 0) + '%';
    progressEl.querySelector('.app-progress-label').textContent = label || '';
    clearTimeout(progressTimer);
    progressTimer = setTimeout(hideProgress, 4000);
  }
  function hideProgress() { clearTimeout(progressTimer); progressEl.hidden = true; }

  /* ---------- Source loading ---------- */
  var loadToken = 0;

  function openFile(file) {
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024 * 1024) {
      U.toast('This file is larger than 1.5 GB. Browsers cannot work with files this big. Split it first.', 'danger');
      return;
    }
    store.setSourceFile(file);
    if (!store.state.workflow.name && !store.state.workflow.steps.length) {
      store.setWorkflowMeta({ name: '' });
    }
    if (/\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(file.name)) {
      var token = ++loadToken;
      showProgress('Reading workbook', 5);
      engine.listSheets(file).then(function (msg) {
        if (token !== loadToken) return;
        store.state.source.sheets = msg.sheets;
        if (!store.state.source.options.sheet || msg.sheets.indexOf(store.state.source.options.sheet) < 0) store.state.source.options.sheet = msg.sheets[0] || '';
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
    engine.load(src.file, src.options).then(function (msg) {
      if (token !== loadToken) return;
      hideProgress();
      store.setSourceInfo(msg.info);
      if (store.state.selectedId === 'source' && !store.state.workflow.steps.length) {
        // Nothing else to do; keep the source selected so the user sees the options and preview.
      }
      runChain();
    }).catch(function (err) {
      if (token !== loadToken) return;
      hideProgress();
      store.setSourceError(err.message);
      U.toast(err.message, 'danger');
    });
  }

  /* ---------- Running the chain ---------- */
  var runToken = 0;
  var runScheduled = false;

  function buildWorkerSteps() {
    return store.state.workflow.steps.map(function (s) {
      return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false, invalid: store.validateStep(s.id).length > 0 };
    });
  }

  function runChain() {
    if (store.state.source.status !== 'ready') return;
    var token = ++runToken;
    var steps = buildWorkerSteps();
    var started = Date.now();
    var slowTimer = setTimeout(function () { showProgress('Running steps…', 50); }, 400);
    engine.run(steps, store.state.selectedId).then(function (msg) {
      clearTimeout(slowTimer);
      if (token !== runToken) return;
      if (Date.now() - started > 400) hideProgress();
      store.setResults(msg.results);
    }).catch(function (err) {
      clearTimeout(slowTimer);
      hideProgress();
      if (token !== runToken) return;
      U.toast('Something went wrong while running the steps: ' + err.message, 'danger');
    });
  }

  var runSoon = U.debounce(runChain, 220);

  /* ---------- Preview ---------- */
  var previewKey = null;

  // Which step result the preview should show for the selected item, plus a message.
  function previewTarget() {
    var st = store.state;
    var sel = st.selectedId;
    if (st.source.status !== 'ready') return { stepId: null, message: st.source.status === 'loading' ? 'Reading the file…' : 'Open a file to see a preview.', label: '' };
    if (sel === 'source') return { stepId: 'source', label: 'Source file', note: '' };
    var idx = store.stepIndex(sel);
    var steps = st.workflow.steps;
    for (var i = idx; i >= 0; i--) {
      var s = steps[i];
      var r = st.results[s.id];
      if (r && (r.status === 'ok' || r.status === 'warning' || r.status === 'skipped')) {
        var op = DL.getOp(steps[idx].opId);
        var note = i === idx ? '' : 'Showing the data going into this step until it can run.';
        return { stepId: s.id, label: 'Step ' + (idx + 1) + ': ' + (op ? op.name : ''), note: note, result: r, pending: !st.results[sel] && i !== idx };
      }
      if (r && r.status === 'error') return { stepId: 'source', label: 'Step ' + (idx + 1), note: 'Showing the source file. Step ' + (i + 1) + ' failed.', pending: false };
    }
    var op2 = DL.getOp(steps[idx].opId);
    var anyResult = Object.keys(st.results).length > 0;
    return { stepId: 'source', label: 'Step ' + (idx + 1) + ': ' + (op2 ? op2.name : ''), note: anyResult ? 'Showing the source file until this step can run.' : '', pending: !anyResult };
  }

  function resultKey(stepId) {
    if (stepId === 'source') return 'source:' + (store.state.source.file ? store.state.source.file.name + store.state.source.file.size + store.state.source.file.lastModified : '') + ':' + (store.state.source.info ? store.state.source.info.rowCount + '/' + store.state.source.info.columns.join('|') : '');
    var r = store.state.results[stepId];
    return stepId + ':' + (r ? r.hash || (r.rowCount + '/' + (r.columns || []).join('|')) : 'none');
  }

  function refreshPreview() {
    var t = previewTarget();
    var st = store.state;
    $('previewTitle').textContent = t.label || '';
    var stats = '';
    if (t.stepId === 'source' && st.source.info) stats = U.fmtInt(st.source.info.rowCount) + ' rows · ' + st.source.info.columns.length + ' columns';
    else if (t.result) stats = U.fmtInt(t.result.rowCount) + ' rows · ' + t.result.columns.length + ' columns' + (t.result.ms > 50 ? ' · ' + (t.result.ms / 1000).toFixed(1) + ' s' : '');
    if (t.note) stats += (stats ? ' · ' : '') + t.note;
    $('previewStats').textContent = stats;
    var key = (t.stepId || 'none') + '|' + resultKey(t.stepId || 'source') + '|' + (t.message || '');
    if (key !== previewKey) {
      previewKey = key;
      grid.show(t.stepId, t.message).then(function () { if (searchQuery) runSearch(); });
    }
    refreshCompare();
  }

  function refreshCompare() {
    var on = $('btnCompare').classList.contains('active');
    var wrap = $('gridBefore');
    var sel = store.state.selectedId;
    if (!on || sel === 'source' || store.state.source.status !== 'ready') {
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
    var idx = store.stepIndex(sel);
    var beforeId = 'source';
    for (var i = idx - 1; i >= 0; i--) {
      var r = store.state.results[store.state.workflow.steps[i].id];
      if (r && (r.status === 'ok' || r.status === 'warning' || r.status === 'skipped')) { beforeId = store.state.workflow.steps[i].id; break; }
    }
    var key = beforeId + '|' + resultKey(beforeId);
    if (gridBefore.key !== key) { gridBefore.key = key; gridBefore.show(beforeId); }
  }

  /* ---------- Search in preview ---------- */
  var searchQuery = '';
  var searchMatches = [];
  var searchIndex = -1;
  var searchToken = 0;

  function runSearch() {
    var t = previewTarget();
    var token = ++searchToken;
    if (!searchQuery || !t.stepId) { setSearchResult([], 0); return; }
    engine.search(t.stepId, searchQuery, 2000).then(function (msg) {
      if (token !== searchToken) return;
      setSearchResult(msg.result.matches, msg.result.total);
    });
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

  /* ---------- Steps ---------- */
  function addStep() {
    if (store.state.source.status !== 'ready' && !store.state.workflow.steps.length) {
      // Allow building without a file, but nudge toward opening one first.
      U.toast('Tip: open a file first so you can pick columns by name.', 'info');
    }
    DL.dialogs.pickOperation({}, function (opId) { store.addStep(opId, store.state.selectedId); });
  }

  function removeStep(id) {
    store.removeStep(id);
  }

  /* ---------- Workflows ---------- */
  function currentWorkflowRecord(name) {
    var st = store.state;
    return {
      id: st.workflow.id,
      name: name || st.workflow.name,
      steps: st.workflow.steps,
      columns: store.sourceColumns(),
      sourceOptions: st.source.options
    };
  }

  function saveWorkflow() {
    var st = store.state;
    if (!st.workflow.steps.length) { U.toast('Add at least one step before saving.', 'info'); return; }
    var doSave = function (name) {
      var rec = DL.workflows.save(currentWorkflowRecord(name));
      if (!rec) return;
      store.state.dirty = false;
      store.setWorkflowMeta({ id: rec.id, name: rec.name });
      store.state.dirty = false;
      updateSaveState();
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
      store.replaceSteps(wf.steps);
      store.setWorkflowMeta({ id: wf.id || null, name: wf.name });
      store.state.dirty = false;
      if (wf.id) DL.workflows.touch(wf.id);
      if (wf.sourceOptions && store.state.source.file) {
        var o = wf.sourceOptions;
        var cur = store.state.source.options;
        if (o.headers !== cur.headers || o.skipRows !== cur.skipRows) {
          store.setSourceOptions({ headers: o.headers, skipRows: o.skipRows });
          loadSource();
        }
      }
      updateSaveState();
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
      renamed: function (id, name) { if (store.state.workflow.id === id) store.setWorkflowMeta({ name: name }); },
      removed: function (id) { if (store.state.workflow.id === id) { store.setWorkflowMeta({ id: null }); updateSaveState(); } }
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
    var t = previewTarget();
    var sel = st.selectedId;
    var stepId = t.stepId;
    var note = null;
    if (sel !== 'source') {
      var idx = store.stepIndex(sel);
      var r = st.results[sel];
      if (!r || (r.status !== 'ok' && r.status !== 'warning' && r.status !== 'skipped')) {
        note = 'Step ' + (idx + 1) + ' cannot run yet, so the download holds the data going into it.';
      } else note = 'This download holds the result after step ' + (idx + 1) + ' (' + DL.getOp(st.workflow.steps[idx].opId).name + ').';
    } else if (st.workflow.steps.length) {
      note = 'The source is selected, so this download holds the unchanged source data. Select the last step to download the final result.';
    }
    var base = U.baseName(st.source.file.name);
    var wfName = (st.workflow.name || '').trim();
    var suffix = sel === 'source' ? '' : (wfName ? '-' + U.safeFileName(wfName.replace(base, '').trim() || wfName) : '-step' + (store.stepIndex(sel) + 1));
    DL.dialogs.download({ fileName: base + suffix + '.csv', note: note, lastFormat: lastFormat }, function (options, fileName, fmt) {
      lastFormat = fmt;
      showProgress('Preparing download', 20);
      engine.exportStep(stepId, options).then(function (msg) {
        hideProgress();
        U.downloadBlob(msg.blob, fileName);
        U.toast('Downloaded ' + fileName + ' (' + U.fmtInt(msg.rowCount) + ' rows).', 'success');
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
        chain.render();
        configView.renderedFor = null; // structure changed: rebuild the form
        renderConfig();
        runSoon();
        updateUndoButtons();
        updateSaveState();
        store.saveSession();
        refreshPreview();
        break;
      case 'params':
        chain.render();
        configView.update();
        runSoon();
        updateUndoButtons();
        updateSaveState();
        store.saveSession();
        break;
      case 'selection':
        chain.render();
        renderConfig();
        refreshPreview();
        store.saveSession();
        break;
      case 'source':
        chain.render();
        renderConfig();
        refreshPreview();
        break;
      case 'sourceOptions':
        store.saveSession();
        break;
      case 'results':
        chain.render();
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
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { if (!typing || e.target.type === 'checkbox') { e.preventDefault(); store.undo(); } return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { if (!typing || e.target.type === 'checkbox') { e.preventDefault(); store.redo(); } return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveWorkflow(); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); download(); return; }
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); store.select('source'); var dz = document.querySelector('.dropzone'); if (dz) dz.click(); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('previewSearch').focus(); $('previewSearch').select(); return; }
    if (typing) return;
    if (document.querySelector('.modal.show')) return;
    if (e.key === 'Insert') { e.preventDefault(); addStep(); }
    else if (e.key === 'Delete' && store.state.selectedId !== 'source') { e.preventDefault(); removeStep(store.state.selectedId); }
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
  document.addEventListener('drop', function (e) {
    dragDepth = 0;
    document.body.classList.remove('is-dragging-file');
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files[0]) return;
    e.preventDefault();
    var f = e.dataTransfer.files[0];
    if (/\.workflow\.json$|\.json$/i.test(f.name)) importWorkflowFile(f);
    else openFile(f);
  });

  /* ---------- Start ---------- */
  chain.render();
  renderConfig();
  refreshPreview();
  updateUndoButtons();
  updateSaveState();
  $('workflowName').value = store.state.workflow.name || '';
  U.initTooltips(document.querySelector('.app-header'));
  U.initTooltips(document.querySelector('.preview-toolbar'));
  if (store.restoredSourceName && store.state.workflow.steps.length) {
    U.toast('Your steps were restored. Open "' + store.restoredSourceName + '" again to continue.', 'info');
  }
  window.DLApp = { store: store, engine: engine, grid: grid, openFile: openFile };
})();
