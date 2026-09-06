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
}

var state = {
  source: null,          // table { columns, cols, length }
  sourceInfo: null,      // { fileName, rowCount, notes, ... }
  sourceKey: '',         // identifies the loaded file and options in step hashes
  steps: [],             // [{ id, opId, params, skip }]
  cache: new Map(),      // stepId -> entry (see makeEntry)
  pinned: [],            // step ids on screen: their tables stay in memory
  recent: [],            // step ids read most recently by the preview
  cacheBudgetCells: 24e6,
  useCounter: 0,
  cancelRun: false,        // true after a cancel message: the run stops at the next step that must be computed
  cancelledFrom: -1,       // index of the first step that a cancel blocked; those steps are not computed on demand
  diffMemo: new Map()      // stepId -> { table, input, summary }
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
  var reply = function (payload) {
    payload.requestId = msg.requestId;
    self.postMessage(payload);
  };
  try {
    switch (msg.type) {
      case 'config': DL.maxCells = msg.maxCells; state.cacheBudgetCells = msg.maxCells * 3; reply({ type: 'ok' }); break;
      case 'sheets': reply({ type: 'sheets', sheets: sheetNames(msg.file) }); break;
      case 'load': loadFile(msg, reply); break;
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
      case 'zip': reply({ type: 'zip', blob: makeZip(msg.entries) }); break;
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

function progress(phase, percent) {
  self.postMessage({ type: 'progress', phase: phase, percent: percent });
}

function humanNumber(n) {
  if (n >= 1e6) return (Math.round(n / 1e5) / 10) + ' million';
  if (n >= 1e3) return Math.round(n / 1e3) + ' thousand';
  return String(Math.round(n));
}

function tooLarge(cells) {
  var err = new Error('This file is too large for your browser to work with smoothly. It has about ' + humanNumber(cells) +
    ' values, and the safe limit on this computer is about ' + humanNumber(DL.maxCells) + '. Try splitting the file, or use a computer with more memory.');
  err.tooLarge = true;
  return err;
}

/* ---------- Loading ---------- */

function readBuffer(blob) {
  return new FileReaderSync().readAsArrayBuffer(blob);
}

// Reads a small sample to detect the text encoding.
function detectEncoding(file) {
  var bytes = new Uint8Array(readBuffer(file.slice(0, 65536)));
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
  // Many zero bytes in the sample point to UTF-16 without a byte order mark.
  var zeros = 0;
  for (var i = 0; i < Math.min(bytes.length, 4096); i++) if (bytes[i] === 0) zeros++;
  if (zeros > 100) return 'utf-16le';
  try {
    // Cut the sample so that a multi-byte character at the end does not count as an error.
    var end = bytes.length;
    var cut = 0;
    while (cut < 4 && end > 0 && (bytes[end - 1] & 0xC0) === 0x80) { end--; cut++; }
    if (end > 0 && (bytes[end - 1] & 0x80)) end--;
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end));
    return 'utf-8';
  } catch (e) {
    return 'windows-1252';
  }
}

function makeDecoder(encoding, notes) {
  try {
    return new TextDecoder(encoding);
  } catch (e) {
    notes.push('The encoding "' + encoding + '" is not supported by this browser. UTF-8 was used.');
    return new TextDecoder('utf-8');
  }
}

// Readers by input format id. Each gives { table, notes, meta }.
var readers = {};

// A minimal Node-style stream. PapaParse reads text chunks from it and keeps row boundaries intact.
function TextStream() {
  this.readable = true;
  this.handlers = {};
}
TextStream.prototype.read = function () {};
TextStream.prototype.pause = function () {};
TextStream.prototype.resume = function () {};
TextStream.prototype.on = function (event, fn) { this.handlers[event] = fn; };
TextStream.prototype.removeListener = function (event) { delete this.handlers[event]; };
TextStream.prototype.emit = function (event, arg) { if (this.handlers[event]) this.handlers[event](arg); };

// Finds the column separator from the first lines of the text. Skipped and blank lines are not counted.
function guessDelimiter(text, quoteChar, skipLines) {
  var sample = text.slice(0, 65536);
  var cut = sample.lastIndexOf('\n');
  if (cut > 0 && sample.length === 65536) sample = sample.slice(0, cut);
  for (var i = 0; i < skipLines; i++) {
    var nl = sample.indexOf('\n');
    if (nl < 0) break;
    sample = sample.slice(nl + 1);
  }
  var res = Papa.parse(sample, { quoteChar: quoteChar, escapeChar: quoteChar, skipEmptyLines: 'greedy', preview: 50 });
  var failed = res.errors.some(function (e) { return e.type === 'Delimiter'; });
  return failed ? '' : res.meta.delimiter;
}

function delimiterOf(opts) {
  var d = opts.delimiter;
  if (d === 'custom') d = opts.customDelimiter;
  if (!d || d === 'auto') return '';
  return DL.unescapeText(d);
}

// Estimates the size from the first part of the file. Stops early when the file is too big.
function checkSize(file, decoder, delimiter, quoteChar) {
  var sampleBytes = Math.min(file.size, file.size < 50 * 1024 * 1024 ? 1024 * 1024 : 4 * 1024 * 1024);
  if (sampleBytes === file.size) return;
  var text = new TextDecoder(decoder.encoding).decode(readBuffer(file.slice(0, sampleBytes)));
  var cut = text.lastIndexOf('\n');
  if (cut > 0) text = text.slice(0, cut);
  var cfg = { quoteChar: quoteChar, escapeChar: quoteChar, skipEmptyLines: true };
  if (delimiter) cfg.delimiter = delimiter;
  var res = Papa.parse(text, cfg);
  var cells = 0;
  for (var i = 0; i < res.data.length; i++) cells += res.data[i].length;
  var projected = cells * (file.size / Math.max(1, sampleBytes));
  if (projected > DL.maxCells * 1.3) throw tooLarge(projected);
}

readers.delimited = function (file, opts) {
  var notes = [];
  var encoding = opts.encoding && opts.encoding !== 'auto' ? opts.encoding : detectEncoding(file);
  var decoder = makeDecoder(encoding, notes);
  var delimiter = delimiterOf(opts);
  var quoteChar = opts.quoteChar === 'none' ? '\u0000' : (opts.quoteChar || '"');
  checkSize(file, decoder, delimiter, quoteChar);

  var builder = new DL.TableBuilder(opts);
  var errors = { quotes: 0, delimiter: 0, other: 0 };
  var stopped = null;
  var config = {
    quoteChar: quoteChar,
    escapeChar: quoteChar,
    skipEmptyLines: false,
    chunk: function (results, parser) {
      var data = results.data;
      for (var i = 0; i < data.length; i++) builder.add(data[i]);
      var errs = results.errors;
      for (var k = 0; k < errs.length; k++) {
        if (errs[k].type === 'Quotes') errors.quotes++;
        else if (errs[k].type !== 'FieldMismatch' && errs[k].type !== 'Delimiter') errors.other++;
      }
      if (builder.cells > DL.maxCells) { stopped = tooLarge(builder.cells * 1.2); parser.abort(); }
    }
  };
  // Decode the bytes in slices with one streaming decoder, so that multi-byte characters
  // that cross a slice boundary stay intact. PapaParse joins partial rows across chunks.
  var SLICE = 8 * 1024 * 1024;
  var offset = 0;
  var stream = new TextStream();
  var started = false;
  while (offset < file.size && !stopped) {
    var end = Math.min(file.size, offset + SLICE);
    var text = decoder.decode(readBuffer(file.slice(offset, end)), { stream: end < file.size });
    offset = end;
    if (!started) {
      started = true;
      if (!delimiter) {
        delimiter = guessDelimiter(text, quoteChar, Math.max(0, Number(opts.skipRows) || 0));
        if (!delimiter) { errors.delimiter++; delimiter = ','; }
      }
      config.delimiter = delimiter;
      Papa.parse(stream, config);
    }
    stream.emit('data', text);
    progress('Reading file', Math.min(99, Math.round(100 * offset / file.size)));
  }
  if (stopped) throw stopped;
  if (started) stream.emit('end');

  var table = builder.finish();
  if (errors.quotes) notes.push(DL.pluralize(errors.quotes, 'value') + ' had unbalanced quotes. Check the text delimiter setting if data looks wrong.');
  if (errors.other) notes.push(DL.pluralize(errors.other, 'problem') + ' found while reading the file.');
  if (errors.delimiter && table.columns.length === 1) notes.push('The column separator could not be detected. Choose it in the options if the data looks wrong.');
  return { table: table, notes: notes, ragged: builder.ragged, meta: { encoding: encoding, delimiter: delimiter } };
};

function readWorkbook(file, sheetsOnly) {
  ensureXlsx();
  return XLSX.read(readBuffer(file), { type: 'array', cellDates: true, dense: true, bookSheets: !!sheetsOnly });
}

function sheetNames(file) {
  return readWorkbook(file, true).SheetNames;
}

readers.spreadsheet = function (file, opts) {
  progress('Reading workbook', 10);
  var wb = readWorkbook(file, false);
  var found = !opts.sheet || wb.SheetNames.indexOf(opts.sheet) >= 0;
  var sheetName = found ? opts.sheet || wb.SheetNames[0] : wb.SheetNames[0];
  var notes = found ? [] : ['Sheet "' + opts.sheet + '" is not in this workbook. The first sheet "' + sheetName + '" was read.'];
  var ws = wb.Sheets[sheetName];
  progress('Reading sheet "' + sheetName + '"', 50);
  var raw = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }) : [];
  wb = null;
  var builder = new DL.TableBuilder(opts);
  for (var i = 0; i < raw.length; i++) {
    builder.add(raw[i]);
    raw[i] = null;
    if (builder.cells > DL.maxCells) throw tooLarge(builder.cells * (raw.length / (i + 1)));
  }
  return { table: builder.finish(), notes: notes, ragged: 0, meta: { sheet: sheetName } };
};

function RAGGED_NOTE(count) {
  return DL.pluralize(count, 'row') + ' had a different number of values than the header. Missing values were left empty and extra values were kept in new columns.';
}

function loadFile(msg, reply) {
  var file = msg.file;
  var opts = msg.options || {};
  var format = DL.inputFormatFor(file.name);
  state.cache.clear();
  state.source = null;
  state.sourceInfo = null;
  var started = Date.now();
  var result = readers[format.id](file, opts);
  var table = result.table;
  var notes = result.notes;
  var skip = Math.max(0, Number(opts.skipRows) || 0);
  if (skip) notes.push('Skipped the first ' + DL.pluralize(skip, 'row') + '.');
  if (result.ragged) notes.push(RAGGED_NOTE(result.ragged));
  state.source = table;
  state.sourceKey = 'src:' + file.name + ':' + file.size + ':' + file.lastModified + ':' + JSON.stringify(opts);
  state.sourceInfo = {
    fileName: file.name,
    fileSize: file.size,
    rowCount: table.length,
    columns: table.columns,
    notes: notes,
    encoding: result.meta.encoding || null,
    delimiter: result.meta.delimiter || null,
    sheet: result.meta.sheet || null,
    ms: Date.now() - started
  };
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
  return hashOf(upstreamHash + '|' + step.opId + '|' + (step.skip ? 'skip' : '') + '|' + JSON.stringify(step.params) + '|' + extra);
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

// Runs one step on its input table. Checks the settings against the real input columns first.
function computeStep(step, upstream, h) {
  var t0 = Date.now();
  if (step.skip) return makeEntry(h, 'skipped', upstream, ['This step is turned off. Data passes through unchanged.']);
  var problems = DL.validateParams(step.opId, step.params, upstream.columns);
  if (problems.length) return makeEntry(h, 'invalid', null, problems);
  try {
    var res = DL.runOp(step.opId, step.params, upstream);
    return makeEntry(h, res.status, res.table, res.notes, null, Date.now() - t0);
  } catch (err) {
    return makeEntry(h, 'error', null, [], err && err.message ? err.message : String(err), Date.now() - t0);
  }
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
    entries[i].entry.table = null; // recomputed on demand by tableFor
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
      enforceBudget([step.id]); // keep memory in check while the chain runs
      i++;
      if (Date.now() - progressAt > 150) {
        progressAt = Date.now();
        progress('Running step ' + i + ' of ' + state.steps.length, Math.round(100 * i / state.steps.length));
      }
      // After 50 ms of work, let the message queue run so a cancel message can arrive.
      if (Date.now() - sliceStart > 50 && i < state.steps.length && !blocked) { setTimeout(stepLoop, 0); return; }
    }
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
  if (state.cancelledFrom >= 0 && idx >= state.cancelledFrom) return null; // cancelled: not computed on demand
  state.recent = [stepId].concat(state.recent.filter(function (id) { return id !== stepId; })).slice(0, 2);
  var entry = state.cache.get(stepId);
  if (entry && entry.table) { touch(entry); return entry.table; }
  // Recompute from the nearest upstream result that is still in memory.
  var upstream = state.source;
  var upstreamHash = state.sourceKey;
  var start = 0;
  for (i = idx - 1; i >= 0; i--) {
    var e = state.cache.get(state.steps[i].id);
    if (e && e.table) { upstream = e.table; upstreamHash = e.hash; start = i + 1; break; }
  }
  for (i = start; i <= idx; i++) {
    var step = state.steps[i];
    var h = stepHash(step, upstreamHash);
    var ne = computeStep(step, upstream, h);
    if (!ne.table) return null;
    state.cache.set(step.id, ne);
    upstream = ne.table;
    upstreamHash = h;
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
  var memo = state.diffMemo.get(msg.stepId);
  if (memo && memo.table === table && memo.input === input) return memo.summary;
  var summary = compareTables(table, input);
  state.diffMemo.set(msg.stepId, { table: table, input: input, summary: summary });
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
var statsMemo = new WeakMap(); // column data -> statistics; steps that share a column share the result

function columnStats(msg) {
  var table = tableFor(msg.stepId);
  if (!table || msg.col < 0 || msg.col >= table.columns.length) return null;
  var known = statsMemo.get(table.cols[msg.col]);
  if (known && known.name === table.columns[msg.col]) return known;
  var st = computeColumnStats(table, msg.col);
  statsMemo.set(table.cols[msg.col], st);
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
    var x = type === 'number' ? DL.toNumber(v) : NaN;
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
  var file = msg.file;
  var format = DL.inputFormatFor(file.name);
  var read = readers[format.id](file, msg.options || {});
  var table = read.table;
  var notes = read.notes.slice();
  if (read.ragged) notes.push(RAGGED_NOTE(read.ragged));
  var steps = msg.steps || [];
  for (var i = 0; i < steps.length; i++) {
    var entry = computeStep(steps[i], table, '');
    if (!entry.table) return { error: entry.error || entry.notes[0], step: i + 1, notes: notes };
    if (entry.status === 'warning') entry.notes.forEach(function (n) { notes.push('Step ' + (i + 1) + ': ' + DL.noteText(n)); });
    table = entry.table;
  }
  var o = msg.output || {};
  var out = DL.outputFormatById(o.format) || DL.outputFormats[0];
  return { blob: writers[out.id](table, o, out), rowCount: table.length, notes: notes };
}

/* ---------- Zip (store only, no compression) ---------- */

var CRC_TABLE = (function () {
  var t = new Int32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

// CRC-32 of a blob, read in slices so that the whole file is not in memory at one time.
function crc32(blob) {
  var c = -1;
  var SLICE = 8 * 1024 * 1024;
  for (var at = 0; at < blob.size; at += SLICE) {
    var bytes = new Uint8Array(readBuffer(blob.slice(at, Math.min(blob.size, at + SLICE))));
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

var ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1;
var ZIP_MAX_ENTRIES = 65535;

// Makes a zip file from [{ name, blob }]. The zip stores the files without compression, because
// deflate needs a library or an asynchronous stream. The zip refers to the blobs, so no file is copied.
function makeZip(entries) {
  var total = entries.reduce(function (sum, e) { return sum + e.blob.size; }, 0);
  if (entries.length > ZIP_MAX_ENTRIES || total > ZIP_MAX_BYTES) {
    throw new Error('A zip file can hold at most ' + ZIP_MAX_ENTRIES + ' files and 4 GB. Apply the workflow to fewer files at one time.');
  }
  var now = new Date();
  var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  var encoder = new TextEncoder();
  var parts = [];
  var central = [];
  var offset = 0;
  entries.forEach(function (e) {
    var size = e.blob.size;
    var name = encoder.encode(e.name);
    var crc = crc32(e.blob);
    var local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);       // version needed
    local.setUint16(6, 0x0800, true);   // flags: UTF-8 names
    local.setUint16(8, 0, true);        // method: store
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, e.blob);
    central.push({ name: name, crc: crc, size: size, offset: offset });
    offset += 30 + name.length + size;
  });
  var centralStart = offset;
  central.forEach(function (c) {
    var h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);           // version made by
    h.setUint16(6, 20, true);           // version needed
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, dosTime, true);
    h.setUint16(14, dosDate, true);
    h.setUint32(16, c.crc, true);
    h.setUint32(20, c.size, true);
    h.setUint32(24, c.size, true);
    h.setUint16(28, c.name.length, true);
    h.setUint16(30, 0, true);           // extra length
    h.setUint16(32, 0, true);           // comment length
    h.setUint16(34, 0, true);           // disk number
    h.setUint16(36, 0, true);           // internal attributes
    h.setUint32(38, 0, true);           // external attributes
    h.setUint32(42, c.offset, true);
    parts.push(h.buffer, c.name);
    offset += 46 + c.name.length;
  });
  var end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  end.setUint16(20, 0, true);
  parts.push(end.buffer);
  return new Blob(parts, { type: 'application/zip' });
}

/* ---------- Export ---------- */

// Writers by output format id. Each gives a Blob.
var writers = {};

function writeDelimited(table, o, delimiter, mime) {
  var n = table.length;
  var newline = o.newline === 'lf' ? '\n' : '\r\n';
  var cfg = { delimiter: delimiter, quotes: !!o.quoteAll, quoteChar: '"', escapeChar: '"', newline: newline };
  var chunks = [];
  if (o.bom !== false) chunks.push('\ufeff');
  if (o.header !== false) chunks.push(Papa.unparse([table.columns], cfg) + newline);
  // Convert in blocks so that memory stays low for large tables.
  var BLOCK = 50000;
  for (var start = 0; start < n; start += BLOCK) {
    var end = Math.min(n, start + BLOCK);
    chunks.push(Papa.unparse(DL.rowsSlice(table, start, end), cfg) + newline);
    if (n > BLOCK) progress('Preparing download', Math.round(100 * end / n));
  }
  return new Blob(chunks, { type: mime });
}

writers.csv = function (table, o, format) { return writeDelimited(table, o, ',', format.mime); };
writers.tsv = function (table, o, format) { return writeDelimited(table, o, '\t', format.mime); };
writers.delimited = function (table, o, format) { return writeDelimited(table, o, DL.unescapeText(o.delimiter) || ';', format.mime); };

writers.xlsx = function (table, o, format) {
  ensureXlsx();
  var n = table.length;
  if (n > 1048575) throw new Error('Excel files can hold at most 1,048,576 rows. Use CSV for this data.');
  // The Excel writer needs several copies of the data in memory.
  if (n * table.columns.length > DL.maxCells / 4) throw new Error('This table is too large for an Excel file in the browser. Use CSV for this data.');
  var BLOCK = 20000;
  var ws = XLSX.utils.aoa_to_sheet(o.header !== false ? [table.columns] : [], { dense: true });
  var at = o.header !== false ? 1 : 0;
  for (var start = 0; start < n; start += BLOCK) {
    var end = Math.min(n, start + BLOCK);
    XLSX.utils.sheet_add_aoa(ws, DL.rowsSlice(table, start, end), { origin: at + start });
    progress('Building Excel file', Math.round(60 * end / n));
  }
  var wb = XLSX.utils.book_new();
  var sheetName = DL.cleanName(o.sheetName, 'Data').replace(/[:\\\/?*\[\]]/g, '_').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  progress('Building Excel file', 80);
  var out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  return new Blob([out], { type: format.mime });
};

writers.json = function (table, o, format) {
  var n = table.length;
  var cols = table.columns;
  var parts = ['['];
  var indent = o.pretty ? 2 : 0;
  for (var i = 0; i < n; i++) {
    var obj = {};
    var row = DL.rowAt(table, i);
    for (var c = 0; c < cols.length; c++) obj[cols[c]] = row[c];
    parts.push((i ? ',' : '') + (indent ? '\n' : '') + JSON.stringify(obj, null, indent));
  }
  parts.push((indent ? '\n' : '') + ']');
  return new Blob(parts, { type: format.mime });
};

function exportStep(msg, reply) {
  var table = tableFor(msg.stepId);
  if (!table) { reply({ type: 'error', message: 'There is no data to download for this step.' }); return; }
  var o = msg.options || {};
  var format = DL.outputFormatById(o.format) || DL.outputFormats[0];
  var blob = writers[format.id](table, o, format);
  reply({ type: 'exported', blob: blob, rowCount: table.length });
}
