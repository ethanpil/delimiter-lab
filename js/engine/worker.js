/* Delimiter Lab - processing worker.
 * Owns the source table and every step result. The main thread only receives small slices.
 */
'use strict';
var V = self.location.search || '';
importScripts('../manifest.js' + V);
importScripts.apply(self, ['../../vendor/papaparse.min.js' + V].concat(DL.FILES.engine, DL.FILES.ops).map(function (f) {
  return f.indexOf('../') === 0 ? f : '../../' + f + V;
}));

var xlsxLoaded = false;
function ensureXlsx() {
  if (!xlsxLoaded) { importScripts('../../vendor/xlsx.full.min.js' + V); xlsxLoaded = true; }
  return XLSX;
}

// How the engine reads files and says what it is doing, in a browser worker.
DL.platform.readBuffer = function (blob) { return new FileReaderSync().readAsArrayBuffer(blob); };
DL.platform.papa = Papa;
DL.platform.xlsx = ensureXlsx;
DL.platform.progress = function (phase, percent) { progress(phase, percent); };
DL.platform.scope = function (label, from, to) {
  progressScope = label === null ? null : { label: label, from: from, to: to };
};

var state = {
  source: null,          // table { columns, cols, length }
  sourceInfo: null,      // { fileName, rowCount, notes, ... }
  sourceKey: '',         // identifies the loaded file and options in step hashes
  numberStyle: '',       // how the open file writes its numbers; a batch reads another file and must not change it
  hashes: null,          // stepId -> chain hash, from the last run; a preview then does not hash the chain again
  steps: [],             // [{ id, opId, params, skip }]
  cache: new Map(),      // stepId -> entry (see makeEntry)
  pinned: [],            // step ids on screen: their tables stay in memory
  recent: [],            // step ids read most recently by the preview
  cacheBudgetCells: 24e6,
  useCounter: 0,
  cancelRun: false,        // true after a cancel message: the run stops at the next step that must be computed
  cancelledFrom: -1,       // index of the first step that a cancel blocked; those steps are not computed on demand
  diffMemo: new WeakMap()  // output table -> { input, summary }; a freed table frees its entry
};

// A run gives control back between the steps, so a cancel message can arrive. The other
// messages wait in a queue until the run is complete, so they see complete results.
var queue = [];
var busy = false;

self.onmessage = function (e) {
  var msg = e.data;
  // A cancel message applies to the active run and to the runs that wait in the queue.
  // A cancelled run still uses the results in the cache; it stops at the first step that must be computed.
  if (msg.type === 'cancel') {
    if (busy) state.cancelRun = true;
    queue.forEach(function (m) { if (m.type === 'run') m.cancelled = true; });
    self.postMessage({ type: 'ok', requestId: msg.requestId });
    return;
  }
  if (busy) { queue.push(msg); return; }
  handle(msg);
};

function drain() {
  busy = false;
  while (queue.length && !busy) handle(queue.shift());
}

function handle(msg) {
  // A batch reads another file and sets the style of that file on the engine. Put the style of
  // the open file back before any work on it, or its numbers are read at the wrong scale.
  DL.numberStyle = state.numberStyle;
  var reply = function (payload) {
    payload.requestId = msg.requestId;
    self.postMessage(payload);
  };
  try {
    switch (msg.type) {
      case 'config': DL.maxCells = msg.maxCells; state.cacheBudgetCells = msg.maxCells * 3; reply({ type: 'ok' }); break;
      case 'sheets': reply({ type: 'sheets', sheets: DL.sheetNames(msg.file) }); break;
      case 'unload': unload(); reply({ type: 'ok' }); break;
      case 'load':
        try { loadFile(msg, reply); } finally { progressScope = null; } // a throw must not leave the label
        break;
      case 'run':
        busy = true;
        runChain(msg, function (results, cancelled, err) {
          if (err) reply({ type: 'error', message: err && err.message ? err.message : String(err), tooLarge: !!(err && err.tooLarge) });
          else reply({ type: 'ran', results: results, cancelled: cancelled });
          drain();
        });
        break;
      case 'slice': reply({ type: 'slice', stepId: msg.stepId, data: getSlice(msg) }); break;
      case 'export': exportStep(msg, reply); break;
      case 'batch': reply({ type: 'batch', result: batchFile(msg) }); break;
      case 'zip': reply({ type: 'zip', blob: zipBlob(msg.entries) }); break;
      case 'columnInfo': reply({ type: 'columnInfo', stepId: msg.stepId, info: columnInfo(msg) }); break;
      case 'columnStats': reply({ type: 'columnStats', stepId: msg.stepId, col: msg.col, stats: columnStats(msg) }); break;
      case 'diffSummary': reply({ type: 'diffSummary', stepId: msg.stepId, summary: diffSummary(msg) }); break;
      case 'search': reply({ type: 'search', stepId: msg.stepId, result: search(msg) }); break;
      case 'findRows': reply({ type: 'findRows', stepId: msg.stepId, result: findRows(msg) }); break;
      case 'memory': reply({ type: 'memory', cells: cacheCells(), maxCells: DL.maxCells }); break;
      default: reply({ type: 'error', message: 'Unknown request "' + msg.type + '".' });
    }
  } catch (err) {
    busy = false;
    reply({ type: 'error', message: err && err.message ? err.message : String(err), tooLarge: !!(err && err.tooLarge) });
  }
}

// While this holds { label, from, to }, every message of a reader carries the label and its percent
// stays between from and to. One file of a list then owns one part of the bar.
var progressScope = null;

// The bytes of a table as a blob, which is what the page and the worker pass around. The engine
// gives the bytes, because only a browser has a Blob.
function writeBlob(table, o) {
  var out = DL.writeBytes(table, o);
  return new Blob(out.chunks, { type: out.mime });
}

// A zip of the files that a batch made. Each file stays a blob: its checksum is read in slices and
// the blob itself goes into the zip, so a batch of many large files is never held in memory in
// full. The engine takes the size and the checksum in place of the bytes.
var CRC_SLICE = 8 * 1024 * 1024;
function zipBlob(entries) {
  var out = DL.makeZip(entries.map(function (e) {
    return {
      name: e.name, part: e.blob, size: e.blob.size,
      crc: function () {
        var c = -1;
        for (var at = 0; at < e.blob.size; at += CRC_SLICE) {
          var end = Math.min(e.blob.size, at + CRC_SLICE);
          c = DL.crcAdd(c, new Uint8Array(new FileReaderSync().readAsArrayBuffer(e.blob.slice(at, end))));
        }
        return DL.crcEnd(c);
      }
    };
  }));
  return new Blob(out.chunks, { type: out.mime });
}

function progress(phase, percent) {
  if (progressScope) {
    phase = phase ? progressScope.label + ' \u00b7 ' + phase : progressScope.label;
    percent = progressScope.from + (progressScope.to - progressScope.from) * (Math.max(0, Math.min(100, percent)) / 100);
  }
  self.postMessage({ type: 'progress', phase: phase, percent: Math.round(percent) });
}


// Lets the table and every result go. The page sends this when the last file leaves the source,
// so a large table does not stay in memory with nothing to show it.
function unload() {
  state.cache.clear();
  state.source = null;
  state.sourceInfo = null;
  state.sourceKey = '';
  state.hashes = null;
  state.cancelledFrom = -1;
}

function loadFile(msg, reply) {
  var files = msg.files || (msg.file ? [msg.file] : []);
  unload();
  var read = DL.readSource(files, msg.options || {});
  state.source = read.table;
  state.sourceKey = read.key;
  state.numberStyle = DL.numberStyle; // DL.readSource read it out of this file
  state.hashes = null;
  state.sourceInfo = read.info;
  reply({ type: 'loaded', info: state.sourceInfo });
}

/* ---------- Chain execution with caching ---------- */

// A 64-bit content hash from two 32-bit FNV-1a passes with different seeds.
function hashOf(str) {
  var h1 = 2166136261, h2 = 1234567891;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 16777619);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function stepHash(step, upstreamHash) {
  var op = DL.getOp(step.opId);
  var extra = op && op.hashExtra ? op.hashExtra(step.params) : '';
  return hashOf(upstreamHash + '|' + step.opId + '|' + (step.skip ? 'skip' : '') + '|' + JSON.stringify(step.params) + '|' + extra + '|' + state.numberStyle);
}

// Gives the position of a step id in the chain, or -1.
function stepIndex(stepId) {
  for (var i = 0; i < state.steps.length; i++) if (state.steps[i].id === stepId) return i;
  return -1;
}

function makeEntry(hash, status, table, notes, error, ms) {
  return { hash: hash, status: status, table: table, notes: notes || [], error: error || null, ms: ms || 0, lastUsed: ++state.useCounter };
}

function touch(entry) { entry.lastUsed = ++state.useCounter; }

// Runs one step and puts the answer in the shape that the cache holds. DL.runStep() decides what
// running a step means; the worker only adds the hash and the age.
function computeStep(step, upstream, h) {
  var r = DL.runStep(step, upstream);
  return makeEntry(h, r.status, r.table, r.notes, r.error, r.ms);
}

function resultOf(step, entry) {
  return {
    stepId: step.id,
    hash: entry.hash,
    status: entry.status,
    hasTable: !!entry.table,
    notes: entry.notes,
    error: entry.error,
    columns: entry.table ? entry.table.columns : null,
    rowCount: entry.table ? entry.table.length : 0,
    ms: entry.ms
  };
}

// Memory used by the cache, counting each column array once (results share unchanged columns).
function cacheCells() {
  var seen = new Set();
  var total = 0;
  var count = function (table) {
    if (!table) return;
    for (var c = 0; c < table.cols.length; c++) {
      var col = table.cols[c];
      var arr = Array.isArray(col) ? col : col.src;
      if (!seen.has(arr)) { seen.add(arr); total += arr.length; }
      if (!Array.isArray(col) && !seen.has(col.idx)) { seen.add(col.idx); total += col.idx.length / 2; }
    }
  };
  count(state.source);
  state.cache.forEach(function (entry) { count(entry.table); });
  return total;
}

// Frees least-recently-used results when the cache is bigger than the budget.
// The steps on screen (state.pinned, state.recent) and the steps in keep are not freed.
function enforceBudget(keep) {
  if (cacheCells() <= state.cacheBudgetCells) return;
  var protect = state.pinned.concat(state.recent, keep || []);
  var entries = [];
  state.cache.forEach(function (entry, id) { if (entry.table && protect.indexOf(id) < 0) entries.push({ id: id, entry: entry }); });
  entries.sort(function (a, b) { return a.entry.lastUsed - b.entry.lastUsed; });
  for (var i = 0; i < entries.length; i++) {
    entries[i].entry.table = null; // tableFor computes the table again when a request needs it
    if (cacheCells() <= state.cacheBudgetCells) break;
  }
}

var CANCELLED_NOTE = 'The run was cancelled. Change a setting or turn a step off and on to run again.';

// Runs the whole chain and calls done(results, cancelled, error). Results with a table are kept by
// content hash. The other results are quick to make, so each run makes them again. A step that is
// fixed or removed never shows an old result. Between two steps the worker reads its messages, so
// a cancel message can stop the run before the next step.
function runChain(msg, done) {
  state.steps = msg.steps || [];
  state.hashes = null;
  state.pinned = msg.protect || [];
  state.cancelRun = !!msg.cancelled;
  state.cancelledFrom = -1;
  if (!state.source) { done([], false); return; }
  var results = [];
  var upstream = state.source;
  var upstreamHash = state.sourceKey;
  var blocked = null;
  var cancelled = false;
  var live = new Set();
  var chainHashes = [];
  var progressAt = Date.now();
  var i = 0;

  function finish() {
    Array.from(state.cache.keys()).forEach(function (id) { if (!live.has(id)) state.cache.delete(id); });
    state.recent = state.recent.filter(function (id) { return live.has(id); });
    enforceBudget([]);
    done(results, cancelled);
  }

  // The loop runs from a timer after the first slice, outside the try of handle(), so it has its own.
  function stepLoop() {
    try { stepSlice(); } catch (err) { done(null, false, err); }
  }

  function stepSlice() {
    var sliceStart = Date.now();
    while (i < state.steps.length) {
      var step = state.steps[i];
      live.add(step.id);
      var h = stepHash(step, upstreamHash);
      chainHashes.push(h);
      var entry;
      if (!blocked) {
        entry = state.cache.get(step.id);
        var hit = entry && entry.hash === h && entry.table;
        // After a cancel, the results in the cache are still used. The first step that must be
        // computed is blocked, like the steps after an invalid step.
        if (!hit && state.cancelRun) { cancelled = true; blocked = CANCELLED_NOTE; state.cancelledFrom = i; }
      }
      if (blocked) {
        entry = makeEntry(h, 'blocked', null, [blocked]);
      } else {
        if (!hit) entry = computeStep(step, upstream, h);
        touch(entry);
      }
      if (entry.table) state.cache.set(step.id, entry); else state.cache.delete(step.id);
      if (!entry.table) blocked = 'Waiting for step ' + (i + 1) + (entry.status === 'error' ? ' to be fixed.' : ' to be completed.');
      results.push(resultOf(step, entry));
      if (entry.table) { upstream = entry.table; upstreamHash = h; }
      enforceBudget([step.id]); // the cache stays within its budget while the chain runs
      i++;
      if (Date.now() - progressAt > 150) {
        progressAt = Date.now();
        progress('Running step ' + i + ' of ' + state.steps.length, Math.round(100 * i / state.steps.length));
      }
      // After 50 ms of work, let the message queue run so a cancel message can arrive.
      if (Date.now() - sliceStart > 50 && i < state.steps.length && !blocked) { setTimeout(stepLoop, 0); return; }
    }
    state.hashes = chainHashes;
    finish();
  }
  stepLoop();
}

// Gives the table for a step id ('source' or a step id). Recomputes freed results when needed.
function tableFor(stepId) {
  if (!state.source) return null;
  if (stepId === 'source' || !stepId) return state.source;
  var idx = stepIndex(stepId);
  if (idx < 0) return null;
  if (state.cancelledFrom >= 0 && idx >= state.cancelledFrom) return null; // The run cancelled this step: no request computes it
  state.recent = [stepId].concat(state.recent.filter(function (id) { return id !== stepId; })).slice(0, 2);
  // The hash of every step of the chain as it is now. A result in the cache whose hash does not
  // agree belongs to a chain that no longer exists: a run that threw before it clears the
  // cache leaves such results behind, and to give one back shows, counts and writes data that
  // the settings of today do not make.
  var i;
  var hashes = state.hashes;
  if (!hashes || hashes.length < idx + 1) {
    hashes = [];
    var h = state.sourceKey;
    for (i = 0; i <= idx; i++) { h = stepHash(state.steps[i], h); hashes.push(h); }
  }
  var entry = state.cache.get(stepId);
  if (entry && entry.table && entry.hash === hashes[idx]) { touch(entry); return entry.table; }
  // Recompute from the nearest upstream result that is still in memory and still belongs.
  var upstream = state.source;
  var start = 0;
  for (i = idx - 1; i >= 0; i--) {
    var e = state.cache.get(state.steps[i].id);
    if (e && e.table && e.hash === hashes[i]) { upstream = e.table; start = i + 1; break; }
  }
  for (i = start; i <= idx; i++) {
    var ne = computeStep(state.steps[i], upstream, hashes[i]);
    if (!ne.table) return null;
    state.cache.set(state.steps[i].id, ne);
    upstream = ne.table;
  }
  enforceBudget([]);
  return upstream;
}

// Gives the table that feeds a step: the output of the step before it, or the source.
function inputFor(stepId) {
  if (!state.source || stepId === 'source' || !stepId) return null;
  var i = stepIndex(stepId);
  if (i < 0) return null;
  return i === 0 ? state.source : tableFor(state.steps[i - 1].id);
}

/* ---------- Preview slices ---------- */

function getSlice(msg) {
  var table = tableFor(msg.stepId);
  if (!table) return { columns: [], rows: [], total: 0, start: 0 };
  var start = Math.max(0, msg.start | 0);
  var end = Math.min(table.length, start + Math.max(0, msg.count | 0));
  var data = { columns: table.columns, rows: DL.rowsSlice(table, start, end), total: table.length, start: start };
  if (msg.diff) data.changes = sliceChanges(table, inputFor(msg.stepId), start, end);
  return data;
}

// Pairs the columns of an output table with the columns of its input: first by name, then by shared
// data (a renamed column). Gives an array output column -> input column, or -1 for a new column.
function columnPairs(table, input) {
  var map = table.columns.map(function (name) { return input.columns.indexOf(name); });
  var taken = {};
  map.forEach(function (u) { if (u >= 0) taken[u] = true; });
  for (var c = 0; c < map.length; c++) {
    if (map[c] >= 0) continue;
    for (var u = 0; u < input.columns.length; u++) {
      if (!taken[u] && sameColumn(table.cols[c], input.cols[u])) { map[c] = u; taken[u] = true; break; }
    }
  }
  return map;
}

// Gives the input row of each output row when the step kept, removed or moved rows (DL.selectRows),
// or null when the rows are in the same places.
function rowMapOf(table, input) {
  if (table === input) return null; // a step that passes the data through
  if (table.rowMap && table.rowMap.length === table.length) return table.rowMap;
  return table.length === input.length ? null : undefined;
}

// Gives, for each row of the slice, the indexes of the cells that differ from the input table.
// A new column counts as changed in every row. Gives null when the rows cannot be paired.
function sliceChanges(table, input, start, end) {
  if (!input) return null;
  var rows = rowMapOf(table, input);
  if (rows === undefined) return null;
  var w = table.columns.length;
  var map = columnPairs(table, input);
  var getA = [], getB = [];
  for (var c = 0; c < w; c++) {
    getA.push(DL.cellGetter(table, c));
    getB.push(map[c] >= 0 ? DL.cellGetter(input, map[c]) : null);
  }
  var out = [];
  for (var i = start; i < end; i++) {
    var r = rows ? rows[i] : i;
    var changed = [];
    for (c = 0; c < w; c++) {
      if (getB[c] === null || getA[c](i) !== getB[c](r)) changed.push(c);
    }
    out.push(changed);
  }
  return out;
}

// Counts the cells that a step changed, column by column. The worker keeps the count for each step.
function diffSummary(msg) {
  var table = tableFor(msg.stepId);
  var input = inputFor(msg.stepId);
  if (!table || !input) return null;
  var memo = state.diffMemo.get(table);
  if (memo && memo.input === input) return memo.summary;
  var summary = compareTables(table, input);
  state.diffMemo.set(table, { input: input, summary: summary });
  return summary;
}

function compareTables(table, input) {
  var rows = rowMapOf(table, input);
  var comparable = rows !== undefined;
  var n = table.length;
  var map = columnPairs(table, input);
  var columns = table.columns.map(function (name, c) {
    var u = map[c];
    if (u < 0) return { name: name, isNew: true, changed: comparable ? n : 0 };
    var renamed = input.columns[u] !== name;
    if (!comparable || (!rows && sameColumn(table.cols[c], input.cols[u]))) return { name: name, isNew: false, renamed: renamed, changed: 0 };
    var a = DL.cellGetter(table, c), b = DL.cellGetter(input, u);
    var changed = 0;
    for (var i = 0; i < n; i++) if (a(i) !== b(rows ? rows[i] : i)) changed++;
    return { name: name, isNew: false, renamed: renamed, changed: changed };
  });
  var removed = input.columns.filter(function (name, u) { return map.indexOf(u) < 0; });
  return { sameRows: comparable, rowsBefore: input.length, rowsAfter: n, columns: columns, removed: removed };
}

// True when two columns share the same data, so no cell can differ.
function sameColumn(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return false;
  return a.src === b.src && a.idx === b.idx;
}

function columnInfo(msg) {
  var table = tableFor(msg.stepId);
  if (!table) return [];
  var n = table.length;
  var out = [];
  for (var c = 0; c < table.columns.length; c++) {
    var get = DL.cellGetter(table, c);
    var empty = 0;
    var step = Math.max(1, Math.floor(n / 2000));
    var sampled = 0;
    var maxLen = 0;
    var sample = [];
    for (var i = 0; i < n; i += step) {
      sampled++;
      var v = get(i);
      if (v === '') empty++;
      else { if (v.length > maxLen) maxLen = v.length; if (sample.length < 300) sample.push(v); }
    }
    out.push({ name: table.columns[c], type: DL.detectType(sample, 300), emptyPct: sampled ? Math.round(100 * empty / sampled) : 0, maxLen: maxLen });
  }
  return out;
}

var TOP_VALUES = 5;

// Gives up to `size` values spread over the column, without a copy of the whole column.
function sampleOf(get, n, size) {
  var step = Math.max(1, Math.floor(n / size));
  var out = [];
  for (var i = 0; i < n && out.length < size; i += step) out.push(get(i));
  return out;
}

// Calculates the statistics of one column for the column profile.
var statsMemo = new WeakMap(); // column data -> { name: statistics }; steps that share a column share the result

function columnStats(msg) {
  var table = tableFor(msg.stepId);
  if (!table || msg.col < 0 || msg.col >= table.columns.length) return null;
  var name = table.columns[msg.col];
  var col = table.cols[msg.col];
  var byName = statsMemo.get(col);
  if (byName && byName[name]) return byName[name];
  var st = computeColumnStats(table, msg.col);
  if (!byName) { byName = Object.create(null); statsMemo.set(col, byName); }
  byName[name] = st;
  if (!Array.isArray(col)) statsMemo.set(table.cols[msg.col], byName); // DL.col replaced the lazy column
  return st;
}

function computeColumnStats(table, colIndex) {
  var n = table.length;
  var get = DL.cellGetter(table, colIndex);
  var g = DL.groupRows([get], n);
  var type = DL.detectType(sampleOf(get, n, 500), 500);
  var st = { name: table.columns[colIndex], type: type, rows: n, empty: 0, distinct: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity,
    minLen: Infinity, maxLen: 0, dates: 0, earliest: Infinity, latest: -Infinity, top: [] };
  // The loop looks at each different value once and uses its count as the weight.
  for (var i = 0; i < n; i++) {
    if (g.first[i] !== i) continue;
    var v = get(i);
    var count = g.count[i];
    if (v === '') { st.empty = count; continue; }
    st.distinct++;
    if (v.length < st.minLen) st.minLen = v.length;
    if (v.length > st.maxLen) st.maxLen = v.length;
    var x = DL.toNumber(v);
    if (x === x) {
      st.numbers += count;
      st.sum += x * count;
      if (x < st.min) st.min = x;
      if (x > st.max) st.max = x;
    } else if (type === 'date') {
      var t = DL.toDate(v);
      if (t === t) {
        st.dates += count;
        if (t < st.earliest) st.earliest = t;
        if (t > st.latest) st.latest = t;
      }
    }
    // Keep the most common values, in order, without a sort of every value.
    var top = st.top;
    if (top.length < TOP_VALUES || count > top[top.length - 1].count) {
      var pos = top.length;
      while (pos > 0 && top[pos - 1].count < count) pos--;
      top.splice(pos, 0, { value: v, count: count });
      if (top.length > TOP_VALUES) top.pop();
    }
  }
  if (st.numbers) st.avg = st.sum / st.numbers;
  return st;
}

function search(msg) {
  var table = tableFor(msg.stepId);
  if (!table) return { matches: [], total: 0 };
  var q = (msg.query || '');
  if (!q) return { matches: [], total: 0 };
  var re = new RegExp(DL.escapeRegExp(q), 'i');
  var matches = [];
  var total = 0;
  var n = table.length;
  var w = table.columns.length;
  var get = [];
  for (var g = 0; g < w; g++) get.push(DL.cellGetter(table, g));
  var limit = msg.limit || 500;
  for (var i = 0; i < n; i++) {
    for (var c = 0; c < w; c++) {
      var v = get[c](i);
      if (v && re.test(v)) {
        total++;
        if (matches.length < limit) matches.push([i, c]);
        break;
      }
    }
  }
  return { matches: matches, total: total };
}

// Finds the rows that a result note is about (for example the rows that failed a Verify rule).
function findRows(msg) {
  var step = state.steps[stepIndex(msg.stepId)];
  var input = inputFor(msg.stepId);
  if (!step || !input || !tableFor(msg.stepId)) return { matches: [], total: 0 }; // the step has no result now
  return DL.findRows(step.opId, step.params, input, msg.lookup, msg.limit);
}

/* ---------- Batch: one file through the whole workflow ---------- */

// Reads a file, runs every step and writes the result. The interactive source and cache stay as they are.
// Gives { blob, rowCount, notes } or { error, step, notes } where step is the 1-based number of the step that failed.
// The notes hold the reader notes and the notes of the steps that gave a warning.
function batchFile(msg) {
  // DL.readSource is the one way a file becomes a table. To call a reader here in place of it
  // left out the column with the name of the file, the note about skipped rows and the check on
  // the number of cells, so a batch and the dl command gave different answers for one workflow.
  var read = DL.readSource([msg.file], msg.options || {});
  var table = read.table;
  var notes = read.info.notes.slice();
  var batchStyle = DL.numberStyle; // the style of THIS file, for the steps below
  var run = DL.runWorkflow(table, msg.steps || []);
  run.results.forEach(function (r, i) {
    if (r.status === 'warning') r.notes.forEach(function (n) { notes.push('Step ' + (i + 1) + ': ' + DL.noteText(n)); });
  });
  if (!run.table) {
    var bad = run.results[run.failedAt];
    DL.numberStyle = state.numberStyle; // the open file owns the engine again
    return { error: bad.error || bad.notes[0], step: run.failedAt + 1, notes: notes };
  }
  if (batchStyle !== DL.numberStyle) DL.numberStyle = batchStyle; // a step must not change it
  var out = { blob: writeBlob(run.table, msg.output || {}), rowCount: run.table.length, notes: notes };
  DL.numberStyle = state.numberStyle; // the open file owns the engine again
  return out;
}

// Writers by output format id. Each gives a Blob.

function exportStep(msg, reply) {
  var table = tableFor(msg.stepId);
  if (!table) { reply({ type: 'error', message: 'There is no data to download for this step.' }); return; }
  reply({ type: 'exported', blob: writeBlob(table, msg.options || {}), rowCount: table.length });
}
