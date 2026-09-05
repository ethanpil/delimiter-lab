/* Saved workflows: stored in the browser (localStorage) and exported / imported as JSON files. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var KEY = 'dl.workflows.v1';
  var FORMAT = 'delimiter-lab-workflow';
  var VERSION = 1;

  var W = DL.workflows = {};

  W.list = function () {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  };

  function write(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
      return true;
    } catch (e) {
      U.toast('The workflow could not be saved. The browser storage may be full.', 'danger');
      return false;
    }
  }

  function cleanStep(s) {
    return { id: s.id, opId: s.opId, params: s.params, enabled: s.enabled !== false };
  }

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
      updatedAt: now,
      uses: 0
    };
    var idx = -1;
    for (var i = 0; i < arr.length; i++) if (arr[i].id === rec.id) idx = i;
    if (idx >= 0) { rec.createdAt = arr[idx].createdAt; rec.uses = arr[idx].uses || 0; arr[idx] = rec; }
    else arr.unshift(rec);
    return write(arr) ? rec : null;
  };

  W.touch = function (id) {
    var arr = W.list();
    arr.forEach(function (w) { if (w.id === id) { w.uses = (w.uses || 0) + 1; w.lastUsedAt = Date.now(); } });
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
  // Walks the steps with the real columns, so that columns made by earlier steps count as present.
  W.matchLevel = function (wf, columns) {
    if (!columns) return 'unknown';
    var cols = columns.slice();
    var found = 0, missing = 0;
    var steps = (wf.steps || []).filter(function (s) { return s.enabled !== false && DL.getOp(s.opId); });
    for (var i = 0; i < steps.length; i++) {
      var params = DL.cleanParams(steps[i].opId, steps[i].params);
      DL.columnsUsedByStep(steps[i].opId, params).forEach(function (c) {
        if (cols.indexOf(c) >= 0) found++; else missing++;
      });
      cols = DL.predictColumns(steps[i].opId, params, cols);
      if (!cols) return missing ? 'partial' : 'unknown';
    }
    if (!missing) return 'full';
    return found ? 'partial' : 'none';
  };

  W.toJSON = function (wf) {
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      name: wf.name,
      exportedAt: new Date().toISOString(),
      columns: wf.columns || [],
      sourceOptions: wf.sourceOptions || null,
      steps: (wf.steps || []).map(cleanStep)
    }, null, 2);
  };

  // Parses an imported file. Throws with a plain message when the file is not a workflow.
  W.fromJSON = function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('This file is not a workflow file.'); }
    if (!data || data.format !== FORMAT || !Array.isArray(data.steps)) throw new Error('This file is not a Delimiter Lab workflow.');
    var unknown = data.steps.filter(function (s) { return !s || !DL.getOp(s.opId); }).map(function (s) { return s ? s.opId : '?'; });
    if (unknown.length) throw new Error('The workflow uses operations this version does not know: ' + unknown.join(', '));
    return {
      name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported workflow',
      columns: Array.isArray(data.columns) ? data.columns.filter(function (c) { return typeof c === 'string'; }) : [],
      sourceOptions: data.sourceOptions && typeof data.sourceOptions === 'object' ? DL.cleanSourceOptions(data.sourceOptions) : null,
      steps: data.steps.map(function (s) { return DL.Store.normalizeStep(s, false); })
    };
  };
})(typeof self !== 'undefined' ? self : this);
