/* Application state with undo / redo. All UI reads from here and changes go through here. */
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
        options: Store.defaultSourceOptions(),
        info: null,        // from the worker after a load
        sheets: null,      // sheet names for spreadsheets
        status: 'empty',   // empty | loading | ready | error
        error: null
      },
      workflow: { id: null, name: '', steps: [] },
      selectedId: 'source',
      results: {},         // stepId -> worker result
      running: false,
      dirty: false
    };
    this.undoStack = [];
    this.redoStack = [];
    this.restoreSession();
  }

  Store.defaultSourceOptions = function () {
    return { headers: true, delimiter: 'auto', quoteChar: '"', encoding: 'auto', skipRows: 0, skipEmptyLines: true, sheet: '' };
  };

  Store.prototype.subscribe = function (fn) {
    this.listeners.push(fn);
    return function () { this.listeners = this.listeners.filter(function (l) { return l !== fn; }); }.bind(this);
  };

  Store.prototype.emit = function (what) {
    var self = this;
    this.listeners.forEach(function (l) { l(what, self.state); });
  };

  /* ---------- Undo / redo ---------- */

  Store.prototype.snapshot = function () {
    return JSON.stringify({ steps: this.state.workflow.steps, selectedId: this.state.selectedId });
  };

  Store.prototype.pushHistory = function () {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  };

  Store.prototype.applySnapshot = function (snap) {
    var data = JSON.parse(snap);
    this.state.workflow.steps = data.steps;
    var ids = data.steps.map(function (s) { return s.id; });
    this.state.selectedId = (data.selectedId === 'source' || ids.indexOf(data.selectedId) >= 0) ? data.selectedId : 'source';
  };

  Store.prototype.undo = function () {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop());
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
  };

  Store.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop());
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
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

  // Adds a step after the given step id (or at the end) and selects it.
  Store.prototype.addStep = function (opId, afterId) {
    this.pushHistory();
    var step = { id: U.uid(), opId: opId, params: DL.defaultParams(opId), enabled: true };
    var steps = this.state.workflow.steps;
    var idx = afterId && afterId !== 'source' ? this.stepIndex(afterId) : -1;
    if (afterId === 'source') idx = -1;
    else if (idx < 0) idx = steps.length - 1;
    steps.splice(idx + 1, 0, step);
    // Pre-fill parameters that depend on the input columns (for example "Reorder" and "Rename").
    var cols = this.inputColumnsFor(step.id);
    var op = DL.getOp(opId);
    if (op && op.params) {
      op.params.forEach(function (p) {
        if (p.type === 'columnOrder' && (!step.params[p.key] || !step.params[p.key].length)) step.params[p.key] = cols.slice();
      });
    }
    this.state.selectedId = step.id;
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
    return step;
  };

  Store.prototype.removeStep = function (id) {
    var idx = this.stepIndex(id);
    if (idx < 0) return;
    this.pushHistory();
    var steps = this.state.workflow.steps;
    steps.splice(idx, 1);
    delete this.state.results[id];
    if (this.state.selectedId === id) {
      this.state.selectedId = steps.length ? steps[Math.min(idx, steps.length - 1)].id : 'source';
    }
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
  };

  Store.prototype.duplicateStep = function (id) {
    var step = this.getStep(id);
    if (!step) return;
    this.pushHistory();
    var copy = JSON.parse(JSON.stringify(step));
    copy.id = U.uid();
    this.state.workflow.steps.splice(this.stepIndex(id) + 1, 0, copy);
    this.state.selectedId = copy.id;
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
  };

  Store.prototype.toggleStep = function (id) {
    var step = this.getStep(id);
    if (!step) return;
    this.pushHistory();
    step.enabled = step.enabled === false;
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
    this.state.dirty = true;
    this.emit('steps');
  };

  // Updates parameters of a step. Groups quick edits (typing) into one undo entry.
  Store.prototype.updateParams = function (id, patch, opts) {
    var step = this.getStep(id);
    if (!step) return;
    var now = Date.now();
    var key = id + ':' + Object.keys(patch).join(',');
    if (!(opts && opts.merge && this.lastEditKey === key && now - this.lastEditAt < 1500)) this.pushHistory();
    this.lastEditKey = key;
    this.lastEditAt = now;
    Object.keys(patch).forEach(function (k) { step.params[k] = patch[k]; });
    this.state.dirty = true;
    this.emit('params', id);
  };

  Store.prototype.replaceSteps = function (steps) {
    this.pushHistory();
    this.state.workflow.steps = steps.map(function (s) {
      return { id: s.id || U.uid(), opId: s.opId, params: Object.assign(DL.defaultParams(s.opId), s.params || {}), enabled: s.enabled !== false };
    });
    this.state.selectedId = this.state.workflow.steps.length ? this.state.workflow.steps[this.state.workflow.steps.length - 1].id : 'source';
    this.state.dirty = true;
    this.emit('steps');
    this.emit('selection');
  };

  Store.prototype.select = function (id) {
    if (this.state.selectedId === id) return;
    this.state.selectedId = id;
    this.emit('selection');
  };

  Store.prototype.setWorkflowMeta = function (patch) {
    Object.assign(this.state.workflow, patch);
    this.state.dirty = true;
    this.emit('workflow');
  };

  /* ---------- Columns ---------- */

  Store.prototype.sourceColumns = function () {
    return this.state.source.info ? this.state.source.info.columns.slice() : [];
  };

  // Columns that flow into the given step (the output of the step before it).
  Store.prototype.inputColumnsFor = function (stepId) {
    var idx = this.stepIndex(stepId);
    return this.outputColumnsAt(idx - 1);
  };

  // Output columns after step index i (-1 = source). Uses worker results when they exist.
  Store.prototype.outputColumnsAt = function (i) {
    var cols = this.sourceColumns();
    var steps = this.state.workflow.steps;
    for (var k = 0; k <= i && k < steps.length; k++) {
      var s = steps[k];
      if (s.enabled === false) continue;
      var r = this.state.results[s.id];
      if (r && r.columns && r.status !== 'blocked' && r.status !== 'invalid' && r.status !== 'error') cols = r.columns.slice();
      else cols = DL.predictColumns(s.opId, s.params, cols);
    }
    return cols;
  };

  Store.prototype.validateStep = function (id) {
    var step = this.getStep(id);
    if (!step) return [];
    // Without a source file the column names are unknown, so only the settings themselves are checked.
    var cols = this.state.source.status === 'ready' ? this.inputColumnsFor(id) : [];
    return DL.validateParams(step.opId, step.params, cols);
  };

  /* ---------- Source ---------- */

  Store.prototype.setSourceFile = function (file) {
    this.state.source.file = file;
    this.state.source.info = null;
    this.state.source.sheets = null;
    this.state.source.error = null;
    this.state.source.status = file ? 'loading' : 'empty';
    this.state.source.options.sheet = '';
    this.state.results = {};
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
    this.emit('source');
  };

  Store.prototype.setSourceError = function (message) {
    this.state.source.info = null;
    this.state.source.status = 'error';
    this.state.source.error = message;
    this.state.results = {};
    this.emit('source');
  };

  Store.prototype.setResults = function (results) {
    var map = {};
    results.forEach(function (r) { map[r.stepId] = r; });
    this.state.results = map;
    this.emit('results');
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
    } catch (e) { /* storage may be full or blocked */ }
  };

  Store.prototype.restoreSession = function () {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.workflow && Array.isArray(data.workflow.steps)) {
        this.state.workflow = {
          id: data.workflow.id || null,
          name: data.workflow.name || '',
          steps: data.workflow.steps.filter(function (s) { return DL.getOp(s.opId); }).map(function (s) {
            return { id: s.id || U.uid(), opId: s.opId, params: Object.assign(DL.defaultParams(s.opId), s.params || {}), enabled: s.enabled !== false };
          })
        };
        this.restoredSourceName = data.sourceName || null;
      }
      if (data.sourceOptions) this.state.source.options = Object.assign(Store.defaultSourceOptions(), data.sourceOptions, { sheet: '' });
    } catch (e) { /* ignore corrupt session */ }
  };

  Store.prototype.clearWorkflow = function () {
    this.pushHistory();
    this.state.workflow = { id: null, name: '', steps: [] };
    this.state.selectedId = 'source';
    this.state.results = {};
    this.state.dirty = false;
    this.emit('steps');
    this.emit('selection');
    this.emit('workflow');
  };

  DL.Store = Store;
})(typeof self !== 'undefined' ? self : this);
