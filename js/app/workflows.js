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

  W.get = function (id) {
    return W.list().filter(function (w) { return w.id === id; })[0] || null;
  };

  // Saves (or updates) a workflow. Returns the saved record.
  W.save = function (wf) {
    var arr = W.list();
    var now = Date.now();
    var rec = {
      id: wf.id || U.uid(),
      name: wf.name,
      steps: wf.steps.map(cleanStep),
      columns: wf.columns || [],
      sourceOptions: wf.sourceOptions || null,
      createdAt: wf.createdAt || now,
      updatedAt: now,
      uses: wf.uses || 0
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

  function cleanStep(s) {
    return { id: s.id, opId: s.opId, params: s.params, enabled: s.enabled !== false };
  }

  // How well a saved workflow fits the columns of the current file: 'full', 'partial' or 'none'.
  W.matchLevel = function (wf, columns) {
    if (!columns || !columns.length) return 'unknown';
    var needed = W.columnsUsed(wf);
    if (!needed.length) return 'full';
    var hit = needed.filter(function (c) { return columns.indexOf(c) >= 0; }).length;
    if (hit === needed.length) return 'full';
    if (hit > 0) return 'partial';
    return 'none';
  };

  // Columns referenced by the steps of a workflow (input side only, best effort).
  W.columnsUsed = function (wf) {
    var out = [];
    var add = function (c) { if (c && out.indexOf(c) < 0) out.push(c); };
    (wf.steps || []).forEach(function (s) {
      var op = DL.getOp(s.opId);
      if (!op) return;
      op.params.forEach(function (p) {
        var v = s.params[p.key];
        if (p.type === 'column') add(v);
        else if (p.type === 'columns') (v || []).forEach(add);
        else if (p.type === 'conditions' || p.type === 'rules' || p.type === 'sortKeys') (v || []).forEach(function (r) { add(r.column); });
      });
    });
    // Only columns that must come from the source file count. Columns created by earlier steps are skipped.
    var created = [];
    var cols = out.slice();
    (wf.steps || []).forEach(function (s) {
      var before = created.slice();
      var after = DL.predictColumns(s.opId, s.params, before);
      after.forEach(function (c) { if (created.indexOf(c) < 0) created.push(c); });
    });
    return cols.filter(function (c) { return created.indexOf(c) < 0; });
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
    var unknown = data.steps.filter(function (s) { return !DL.getOp(s.opId); }).map(function (s) { return s.opId; });
    if (unknown.length) throw new Error('The workflow uses operations this version does not know: ' + unknown.join(', '));
    return {
      name: data.name || 'Imported workflow',
      columns: data.columns || [],
      sourceOptions: data.sourceOptions || null,
      steps: data.steps.map(function (s) {
        return { id: U.uid(), opId: s.opId, params: Object.assign(DL.defaultParams(s.opId), s.params || {}), enabled: s.enabled !== false };
      })
    };
  };
})(typeof self !== 'undefined' ? self : this);
