/* Saved workflows: stored in the browser (localStorage) and exported / imported as JSON files. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var KEY = 'dl.workflows.v1';


  var W = DL.workflows = {};

  // True for a record with the shape that the application writes. Every step must be an object
  // with an operation id: a null step stops the dialog that is the only way to remove it.
  function validRecord(r) {
    return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.name === 'string' &&
      Array.isArray(r.steps) && r.steps.every(function (st) { return !!st && typeof st === 'object' && typeof st.opId === 'string'; });
  }

  // Reads the store. ok is false when the text is there but cannot be read. That must never look
  // like an empty store: every write puts the whole list back, so one write after a failed read
  // removes every workflow that the text still holds.
  //
  // other holds the records that this build does not know, for example ones that a later build
  // wrote. They go back to the store untouched, so an older build cannot delete them.
  function readAll() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return { ok: false, list: [], other: [] }; }
    if (!raw) return { ok: true, list: [], other: [] };
    var arr;
    try { arr = JSON.parse(raw); } catch (e) { return { ok: false, list: [], other: [] }; }
    if (!Array.isArray(arr)) return { ok: false, list: [], other: [] };
    var list = [], other = [];
    arr.forEach(function (r) { (validRecord(r) ? list : other).push(r); });
    return { ok: true, list: list, other: other };
  }

  W.list = function () { return readAll().list; };

  W.get = function (id) {
    return W.list().filter(function (r) { return r.id === id; })[0] || null;
  };

  // Puts the list back, with the records that this build does not know. A store that cannot
  // be read is never written over.
  function write(state, arr) {
    if (!state.ok) { U.toast(DL.t('wf.damaged'), 'danger'); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(arr.concat(state.other)));
      return true;
    } catch (e) {
      U.toast(DL.t('wf.notSaved'), 'danger');
      return false;
    }
  }

  var cleanStep = DL.cleanStep;

  // Saves (or updates) a workflow. Gives the saved record, or null when the save failed.
  W.save = function (wf) {
    var state = readAll();
    var arr = state.list;
    var now = Date.now();
    var rec = {
      id: wf.id || DL.uid(),
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
    return write(state, arr) ? rec : null;
  };

  W.touch = function (id) {
    var state = readAll();
    state.list.forEach(function (w) { if (w.id === id) w.lastUsedAt = Date.now(); });
    write(state, state.list);
  };

  W.rename = function (id, name) {
    var state = readAll();
    state.list.forEach(function (w) { if (w.id === id) { w.name = name; w.updatedAt = Date.now(); } });
    write(state, state.list);
  };

  W.remove = function (id) {
    var state = readAll();
    write(state, state.list.filter(function (w) { return w.id !== id; }));
  };

  // The saved workflow that a link names. The text can be the link name or the name itself. When two
  // names give the same link name, the workflow that was used or saved last wins. It only reads.
  W.findBySlug = function (text) {
    var slug = DL.workflowSlug(text);
    if (!slug) return null;
    var found = null;
    W.list().forEach(function (w) {
      if (DL.workflowSlug(w.name) !== slug) return;
      if (!found || (w.lastUsedAt || w.updatedAt || 0) > (found.lastUsedAt || found.updatedAt || 0)) found = w;
    });
    return found;
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
      if (!cols) return (missing || found) ? 'partial' : 'unknown';
    }
    if (!missing) return 'full';
    return found ? 'partial' : 'none';
  };

  // The engine writes and reads the file, so that every platform reads one format.
  W.toJSON = DL.workflowToJSON;

  W.fromJSON = DL.parseWorkflow;
})(typeof self !== 'undefined' ? self : this);
