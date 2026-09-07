/* Application state with undo / redo. All views read from here and all changes go through here. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  var SESSION_KEY = 'dl.session.v1';
  var MAX_HISTORY = 100;

  function Store() {
    this.listeners = [];
    this.state = {
      source: {
        file: null,
        options: DL.defaultSourceOptions(),
        info: null,        // from the worker after a load
        sheets: null,      // sheet names for workbooks
        status: 'empty',   // empty | loading | ready | error
        error: null
      },
      workflow: { id: null, name: '', steps: [] },
      selectedId: 'source',
      results: {},         // stepId -> worker result
      dirty: false
    };
    this.undoStack = [];
    this.redoStack = [];
    this.savedSnapshot = null; // the workflow as it was last saved
    this.restoreSession();
  }

  // Makes a complete step record from saved or imported data. keepId: reuse the id when present.
  Store.normalizeStep = function (s, keepId) {
    return {
      id: keepId && s.id ? String(s.id) : U.uid(),
      opId: s.opId,
      params: DL.cleanParams(s.opId, s.params),
      enabled: s.enabled !== false
    };
  };

  Store.prototype.subscribe = function (fn) {
    this.listeners.push(fn);
  };

  Store.prototype.emit = function (what) {
    var self = this;
    this.listeners.forEach(function (l) { l(what, self.state); });
  };

  /* ---------- Undo / redo ---------- */

  Store.prototype.snapshot = function () {
    return JSON.stringify({ workflow: this.state.workflow, selectedId: this.state.selectedId, sourceOptions: this.state.source.options });
  };

  Store.prototype.pushHistory = function () {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
    this.lastEditKey = null; // the next edit starts a new undo entry
  };

  Store.prototype.workflowSnapshot = function () {
    return JSON.stringify(this.state.workflow);
  };

  // Forgets the steps that came before. Use it after an action that undo cannot complete.
  Store.prototype.clearHistory = function () {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  };

  Store.prototype.applySnapshot = function (snap) {
    var data = JSON.parse(snap);
    this.state.workflow = data.workflow;
    var ids = data.workflow.steps.map(function (s) { return s.id; });
    this.state.selectedId = (data.selectedId === 'source' || ids.indexOf(data.selectedId) >= 0) ? data.selectedId : 'source';
    this.invalidateResultsFrom(0);
    this.lastEditKey = null;
    this.state.dirty = this.workflowSnapshot() !== this.savedSnapshot;
    this.emit('steps');
    this.emit('workflow');
    // An undo of an applied workflow also restores the source options, which reload the file.
    if (data.sourceOptions && JSON.stringify(data.sourceOptions) !== JSON.stringify(this.state.source.options)) {
      this.state.source.options = data.sourceOptions;
      this.emit('sourceOptions');
    }
  };

  Store.prototype.undo = function () {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop());
  };

  Store.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop());
  };

  Store.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Store.prototype.canRedo = function () { return this.redoStack.length > 0; };

  /* ---------- Steps ---------- */

  Store.prototype.getStep = function (id) {
    var steps = this.state.workflow.steps;
    for (var i = 0; i < steps.length; i++) if (steps[i].id === id) return steps[i];
    return null;
  };

  Store.prototype.stepIndex = function (id) {
    var steps = this.state.workflow.steps;
    for (var i = 0; i < steps.length; i++) if (steps[i].id === id) return i;
    return -1;
  };

  // Results of the steps from index i on are out of date after a change.
  Store.prototype.invalidateResultsFrom = function (i) {
    var steps = this.state.workflow.steps;
    for (var k = Math.max(0, i); k < steps.length; k++) delete this.state.results[steps[k].id];
    var live = {};
    steps.forEach(function (s) { live[s.id] = true; });
    var self = this;
    Object.keys(this.state.results).forEach(function (id) { if (!live[id]) delete self.state.results[id]; });
  };

  // Adds a step after the given step id (or after the source) and selects it.
  Store.prototype.addStep = function (opId, afterId) {
    this.pushHistory();
    var steps = this.state.workflow.steps;
    var idx = afterId === 'source' ? -1 : this.stepIndex(afterId);
    if (afterId !== 'source' && idx < 0) idx = steps.length - 1;
    var step = { id: U.uid(), opId: opId, params: DL.defaultParams(opId), enabled: true };
    steps.splice(idx + 1, 0, step);
    DL.initParams(opId, step.params, this.inputColumnsFor(step.id));
    this.invalidateResultsFrom(idx + 1);
    this.state.selectedId = step.id;
    this.state.dirty = true;
    this.emit('steps');
    return step;
  };

  Store.prototype.removeStep = function (id) {
    var idx = this.stepIndex(id);
    if (idx < 0) return;
    this.pushHistory();
    var steps = this.state.workflow.steps;
    steps.splice(idx, 1);
    this.invalidateResultsFrom(idx);
    if (this.state.selectedId === id) {
      this.state.selectedId = steps.length ? steps[Math.min(idx, steps.length - 1)].id : 'source';
    }
    this.state.dirty = true;
    this.emit('steps');
  };

  Store.prototype.duplicateStep = function (id) {
    var step = this.getStep(id);
    if (!step) return;
    this.pushHistory();
    var copy = Store.normalizeStep(step, false);
    var idx = this.stepIndex(id) + 1;
    this.state.workflow.steps.splice(idx, 0, copy);
    this.invalidateResultsFrom(idx);
    this.state.selectedId = copy.id;
    this.state.dirty = true;
    this.emit('steps');
  };

  Store.prototype.toggleStep = function (id) {
    var step = this.getStep(id);
    if (!step) return;
    this.pushHistory();
    step.enabled = step.enabled === false;
    this.invalidateResultsFrom(this.stepIndex(id));
    this.state.dirty = true;
    this.emit('steps');
  };

  Store.prototype.moveStep = function (id, toIndex) {
    var from = this.stepIndex(id);
    if (from < 0) return;
    var steps = this.state.workflow.steps;
    if (toIndex > from) toIndex--;
    toIndex = Math.max(0, Math.min(steps.length - 1, toIndex));
    if (toIndex === from) return;
    this.pushHistory();
    var s = steps.splice(from, 1)[0];
    steps.splice(toIndex, 0, s);
    this.invalidateResultsFrom(Math.min(from, toIndex));
    this.state.dirty = true;
    this.emit('steps');
  };

  // Replaces the operation of a step. The settings start from their defaults.
  Store.prototype.changeOp = function (id, opId) {
    var step = this.getStep(id);
    if (!step || step.opId === opId) return;
    this.pushHistory();
    step.opId = opId;
    step.params = DL.defaultParams(opId);
    DL.initParams(opId, step.params, this.inputColumnsFor(id));
    this.invalidateResultsFrom(this.stepIndex(id));
    this.state.dirty = true;
    this.emit('steps');
  };

  // Updates settings of a step. Quick edits (typing) merge into one undo entry.
  Store.prototype.updateParams = function (id, patch, opts) {
    var step = this.getStep(id);
    if (!step) return;
    var now = Date.now();
    var key = id + ':' + Object.keys(patch).join(',');
    if (!(opts && opts.merge && this.lastEditKey === key && now - this.lastEditAt < 1500)) this.pushHistory();
    this.lastEditKey = key;
    this.lastEditAt = now;
    Object.keys(patch).forEach(function (k) { step.params[k] = patch[k]; });
    this.invalidateResultsFrom(this.stepIndex(id));
    this.state.dirty = true;
    this.emit('params');
  };

  // Replaces all steps, for example when a saved workflow is opened.
  Store.prototype.replaceWorkflow = function (wf) {
    this.pushHistory();
    var steps = (wf.steps || []).map(function (s) { return Store.normalizeStep(s, true); });
    this.state.workflow = { id: wf.id || null, name: wf.name || '', steps: steps };
    this.state.selectedId = steps.length ? steps[steps.length - 1].id : 'source';
    this.invalidateResultsFrom(0);
    this.savedSnapshot = wf.id ? this.workflowSnapshot() : null;
    this.state.dirty = false;
    this.emit('steps');
    this.emit('workflow');
  };

  Store.prototype.select = function (id) {
    if (this.state.selectedId === id) return;
    this.state.selectedId = id;
    this.emit('selection');
  };

  // Changes the name or id of the workflow. A new name can be undone. saved: the workflow was just saved.
  Store.prototype.setWorkflowMeta = function (patch, saved) {
    if (patch.name !== undefined && patch.name !== this.state.workflow.name && !saved) this.pushHistory();
    Object.assign(this.state.workflow, patch);
    if (saved) this.savedSnapshot = this.workflowSnapshot();
    this.state.dirty = this.workflowSnapshot() !== this.savedSnapshot;
    this.emit('workflow');
  };

  Store.prototype.setSheets = function (sheets) {
    this.state.source.sheets = sheets;
    if (sheets.indexOf(this.state.source.options.sheet) < 0) this.state.source.options.sheet = sheets[0] || '';
  };

  /* ---------- Columns ---------- */

  Store.prototype.sourceColumns = function () {
    return this.state.source.info ? this.state.source.info.columns.slice() : null;
  };

  // Columns that flow into the given step (the output of the step before it).
  // Gives null when the columns are not known: no file, or an earlier step must run first.
  Store.prototype.inputColumnsFor = function (stepId) {
    return this.outputColumnsAt(this.stepIndex(stepId) - 1);
  };

  // Output columns after step index i (-1 = source). Uses worker results when they exist.
  Store.prototype.outputColumnsAt = function (i) {
    var cols = this.sourceColumns();
    var steps = this.state.workflow.steps;
    for (var k = 0; k <= i && k < steps.length; k++) {
      var s = steps[k];
      if (s.enabled === false) continue;
      var r = this.state.results[s.id];
      if (r && r.hasTable) cols = r.columns.slice();
      else if (cols) cols = DL.predictColumns(s.opId, s.params, cols);
      if (!cols) return null;
    }
    return cols;
  };

  // Problems with the settings of a step, checked against the input columns when they are known.
  Store.prototype.validateStep = function (id) {
    var step = this.getStep(id);
    if (!step) return [];
    return DL.validateParams(step.opId, step.params, this.inputColumnsFor(id));
  };

  /* ---------- Results ---------- */

  Store.prototype.setResults = function (results) {
    var map = {};
    results.forEach(function (r) { map[r.stepId] = r; });
    this.state.results = map;
    this.emit('results');
  };

  // The step whose data the preview shows for the selected item. When the selected step
  // cannot run, the nearest earlier step with data is shown, with a reason.
  Store.prototype.displayResultFor = function (sel) {
    var st = this.state;
    if (st.source.status !== 'ready') return { stepId: null };
    if (sel === 'source') return { stepId: 'source', result: null, reason: '' };
    var idx = this.stepIndex(sel);
    var steps = st.workflow.steps;
    for (var i = idx; i >= 0; i--) {
      var r = st.results[steps[i].id];
      if (r && r.hasTable) {
        return { stepId: steps[i].id, result: r, reason: i === idx ? '' : DL.t('preview.showingInput', { n: idx + 1 }) };
      }
    }
    return { stepId: 'source', result: null, reason: DL.t('preview.showingSource', { n: idx + 1 }) };
  };

  /* ---------- Source ---------- */

  Store.prototype.setSourceFile = function (file) {
    this.state.source.file = file;
    this.state.source.info = null;
    this.state.source.sheets = null;
    this.state.source.error = null;
    this.state.source.status = file ? 'loading' : 'empty';
    this.state.source.options.sheet = '';
    this.invalidateResultsFrom(0);
    this.emit('source');
  };

  Store.prototype.setSourceOptions = function (patch) {
    Object.assign(this.state.source.options, patch);
    this.emit('sourceOptions');
  };

  Store.prototype.setSourceInfo = function (info) {
    this.state.source.info = info;
    this.state.source.status = 'ready';
    this.state.source.error = null;
    this.invalidateResultsFrom(0);
    this.emit('source');
  };

  Store.prototype.setSourceError = function (message) {
    this.state.source.info = null;
    this.state.source.status = 'error';
    this.state.source.error = message;
    this.invalidateResultsFrom(0);
    this.emit('source');
  };

  /* ---------- Session persistence ---------- */

  Store.prototype.saveSession = function () {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        workflow: this.state.workflow,
        selectedId: this.state.selectedId,
        sourceOptions: this.state.source.options,
        sourceName: this.state.source.file ? this.state.source.file.name : null
      }));
    } catch (e) { /* storage can be full or blocked */ }
  };

  Store.prototype.restoreSession = function () {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.workflow && Array.isArray(data.workflow.steps)) {
        var known = data.workflow.steps.filter(function (s) { return s && DL.getOp(s.opId); });
        this.droppedSteps = data.workflow.steps.length - known.length; // steps of an operation this version does not have
        this.state.workflow = {
          id: data.workflow.id || null,
          name: data.workflow.name || '',
          steps: known.map(function (s) { return Store.normalizeStep(s, true); })
        };
        var ids = this.state.workflow.steps.map(function (s) { return s.id; });
        if (data.selectedId && ids.indexOf(data.selectedId) >= 0) this.state.selectedId = data.selectedId;
        this.restoredSourceName = data.sourceName || null;
        // A restored workflow with an id counts as saved when it is the same as the saved record.
        var saved = this.state.workflow.id && DL.workflows ? DL.workflows.get(this.state.workflow.id) : null;
        if (saved) {
          this.savedSnapshot = JSON.stringify({ id: saved.id, name: saved.name, steps: saved.steps.map(function (st) { return Store.normalizeStep(st, true); }) });
          this.state.dirty = this.workflowSnapshot() !== this.savedSnapshot;
        } else if (this.state.workflow.steps.length) {
          this.state.workflow.id = null; // the record is gone: the steps are not saved
          this.state.dirty = true;
        }
      }
      // The sheet stays. The workspace opens the same workbook again at the same sheet.
      if (data.sourceOptions) this.state.source.options = DL.cleanSourceOptions(data.sourceOptions);
    } catch (e) { /* a broken session is ignored */ }
  };

  DL.Store = Store;
})(typeof self !== 'undefined' ? self : this);
