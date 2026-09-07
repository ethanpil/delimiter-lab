/* Saved workflows: stored in the browser (localStorage) and exported / imported as JSON files. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var KEY = 'dl.workflows.v1';


  var W = DL.workflows = {};

  // True for a record with the shape that the application writes.
  function validRecord(r) {
    return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.steps);
  }

  W.list = function () {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(validRecord) : [];
    } catch (e) { return []; }
  };

  W.get = function (id) {
    return W.list().filter(function (r) { return r.id === id; })[0] || null;
  };

  function write(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      U.toast(DL.t('wf.notSaved'), 'danger');
      return false;
    }
  }

  var cleanStep = DL.cleanStep;

  // Saves (or updates) a workflow. Gives the saved record, or null when the save failed.
  W.save = function (wf) {
    var arr = W.list();
    var now = Date.now();
    var rec = {
      id: wf.id || U.uid(),
      name: wf.name,
      steps: wf.steps.map(cleanStep),
      columns: wf.columns || [],
      sourceOptions: wf.sourceOptions || null,
      createdAt: now,
      updatedAt: now
    };
    var idx = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) idx = i;
    if (idx >= 0) { rec.createdAt = arr[idx].createdAt; rec.lastUsedAt = arr[idx].lastUsedAt || 0; arr[idx] = rec; }
    else arr.unshift(rec);
    return write(arr) ? rec : null;
  };

  W.touch = function (id) {
    var arr = W.list();
    arr.forEach(function (w) { if (w.id === id) w.lastUsedAt = Date.now(); });
    write(arr);
  };

  W.rename = function (id, name) {
    var arr = W.list();
    arr.forEach(function (w) { if (w.id === id) { w.name = name; w.updatedAt = Date.now(); } });
    write(arr);
  };

  W.remove = function (id) {
    write(W.list().filter(function (w) { return w.id !== id; }));
  };

  // How well a workflow fits the columns of the current file: 'full', 'partial', 'none' or 'unknown'.
  // The check goes through the steps with the real columns, so that columns from earlier steps count as present.
  W.matchLevel = function (wf, columns) {
    if (!columns) return 'unknown';
    var cols = columns.slice();
    var found = 0, missing = 0;
    var steps = (wf.steps || []).filter(function (s) { return s && s.enabled !== false; });
    for (var i = 0; i < steps.length; i++) {
      if (!DL.getOp(steps[i].opId)) return 'none'; // an operation this version does not have
      var params = DL.cleanParams(steps[i].opId, steps[i].params);
      DL.columnsUsedByStep(steps[i].opId, params).forEach(function (c) {
        if (cols.indexOf(c) >= 0) found++; else missing++;
      });
      cols = DL.predictColumns(steps[i].opId, params, cols);
      if (!cols) return missing ? 'partial' : found ? 'partial' : 'unknown';
    }
    if (!missing) return 'full';
    return found ? 'partial' : 'none';
  };

  // The engine writes and reads the file, so that every platform reads one format.
  W.toJSON = DL.workflowToJSON;

  W.fromJSON = DL.parseWorkflow;
})(typeof self !== 'undefined' ? self : this);
