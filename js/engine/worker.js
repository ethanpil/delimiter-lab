/* Delimiter Lab - processing worker.
 * Owns the source table and every step result. The main thread only receives small slices.
 */
'use strict';
var V = self.location.search || '';
importScripts('../manifest.js' + V);
importScripts.apply(self, ['../../vendor/papaparse.min.js'].concat(DL.FILES.engine, DL.FILES.ops).map(function (f) {
  return (f.indexOf('vendor') === 0 || f.indexOf('../') === 0 ? f : '../../' + f) + V;
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
  maxCells: 8e6,
  cacheBudgetCells: 24e6,
  useCounter: 0
};

self.onmessage = function (e) {
  var msg = e.data;
  var reply = function (payload) {
    payload.requestId = msg.requestId;
    self.postMessage(payload);
  };
  try {
    switch (msg.type) {
      case 'config': state.maxCells = msg.maxCells; state.cacheBudgetCells = msg.maxCells * 3; reply({ type: 'ok' }); break;
      case 'sheets': reply({ type: 'sheets', sheets: sheetNames(msg.file) }); break;
      case 'load': loadFile(msg, reply); break;
      case 'run': reply({ type: 'ran', results: runChain(msg) }); break;
      case 'slice': reply({ type: 'slice', stepId: msg.stepId, data: getSlice(msg) }); break;
      case 'export': exportStep(msg, reply); break;
      case 'columnInfo': reply({ type: 'columnInfo', stepId: msg.stepId, info: columnInfo(msg) }); break;
      case 'search': reply({ type: 'search', stepId: msg.stepId, result: search(msg) }); break;
      default: reply({ type: 'error', message: 'Unknown request "' + msg.type + '".' });
    }
  } catch (err) {
    reply({ type: 'error', message: err && err.message ? err.message : String(err), tooLarge: !!(err && err.tooLarge) });
  }
};

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
    ' values, and the safe limit on this computer is about ' + humanNumber(state.maxCells) + '. Try splitting the file, or use a computer with more memory.');
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

// Builds a columnar table while rows arrive. Handles header row, skipped rows and blank rows.
function TableBuilder(opts) {
  this.headers = opts.headers !== false;
  this.toSkip = Math.max(0, Number(opts.skipRows) || 0);
  this.dropEmpty = opts.skipEmptyLines !== false;
  this.columns = null;
  this.cols = [];
  this.n = 0;
  this.ragged = 0;
  this.cells = 0;
}

TableBuilder.prototype.add = function (row) {
  if (this.toSkip > 0) { this.toSkip--; return; }
  if (this.dropEmpty && isBlankRow(row)) return;
  if (this.columns === null && this.headers) {
    this.columns = row;
    return;
  }
  var w = this.cols.length;
  if (row.length > w) {
    for (var c = w; c < row.length; c++) {
      var arr = new Array(this.n);
      for (var i = 0; i < this.n; i++) arr[i] = '';
      this.cols.push(arr);
    }
    if (this.n > 0) this.ragged++;
  } else if (row.length < w) this.ragged++;
  for (c = 0; c < this.cols.length; c++) this.cols[c][this.n] = c < row.length ? cellText(row[c]) : '';
  this.n++;
  this.cells += this.cols.length;
};

TableBuilder.prototype.finish = function () {
  var width = this.cols.length;
  var header = this.columns || [];
  if (header.length > width) {
    for (var c = width; c < header.length; c++) { var arr = new Array(this.n); for (var i = 0; i < this.n; i++) arr[i] = ''; this.cols.push(arr); }
    width = header.length;
  }
  var columns = this.headers && this.columns
    ? DL.cleanHeaders(header.concat(new Array(width - header.length).fill('')))
    : DL.cleanHeaders(new Array(width).fill(''));
  return DL.makeTable(columns, this.cols, this.n);
};

// Makes text from a spreadsheet cell value: dates become "2024-01-31", numbers keep full precision.
function cellText(v) {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : DL.formatDateISO(v.getTime());
  if (typeof v === 'number') return DL.numberText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

function isBlankRow(row) {
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    if (v != null && v !== '' && String(v).trim() !== '') return false;
  }
  return true;
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
  if (projected > state.maxCells * 1.3) throw tooLarge(projected);
}

readers.delimited = function (file, opts) {
  var notes = [];
  var encoding = opts.encoding && opts.encoding !== 'auto' ? opts.encoding : detectEncoding(file);
  var decoder = makeDecoder(encoding, notes);
  var delimiter = delimiterOf(opts);
  var quoteChar = opts.quoteChar === 'none' ? '\u0000' : (opts.quoteChar || '"');
  checkSize(file, decoder, delimiter, quoteChar);

  var builder = new TableBuilder(opts);
  var errors = { quotes: 0, delimiter: 0, other: 0 };
  var detected = '';
  var stopped = null;
  var config = {
    quoteChar: quoteChar,
    escapeChar: quoteChar,
    skipEmptyLines: false,
    chunk: function (results, parser) {
      if (!detected && results.meta && results.meta.delimiter) detected = results.meta.delimiter;
      var data = results.data;
      for (var i = 0; i < data.length; i++) builder.add(data[i]);
      var errs = results.errors;
      for (var k = 0; k < errs.length; k++) {
        if (errs[k].type === 'Quotes') errors.quotes++;
        else if (errs[k].type === 'Delimiter') errors.delimiter++;
        else if (errs[k].type !== 'FieldMismatch') errors.other++;
      }
      if (builder.cells > state.maxCells) { stopped = tooLarge(builder.cells * 1.2); parser.abort(); }
    }
  };
  if (delimiter) config.delimiter = delimiter;

  // Decode the bytes in slices with one streaming decoder, so that multi-byte characters
  // that cross a slice boundary stay intact. PapaParse joins partial rows across chunks.
  var stream = new TextStream();
  Papa.parse(stream, config);
  var SLICE = 8 * 1024 * 1024;
  var offset = 0;
  while (offset < file.size && !stopped) {
    var end = Math.min(file.size, offset + SLICE);
    var text = decoder.decode(readBuffer(file.slice(offset, end)), { stream: end < file.size });
    offset = end;
    stream.emit('data', text);
    progress('Reading file', Math.min(99, Math.round(100 * offset / file.size)));
  }
  if (stopped) throw stopped;
  stream.emit('end');

  var table = builder.finish();
  if (errors.quotes) notes.push(DL.pluralize(errors.quotes, 'value') + ' had unbalanced quotes. Check the text delimiter setting if data looks wrong.');
  if (errors.other) notes.push(DL.pluralize(errors.other, 'problem') + ' found while reading the file.');
  if (errors.delimiter && table.columns.length === 1) notes.push('The column separator could not be detected. Choose it in the options if the data looks wrong.');
  return { table: table, notes: notes, ragged: builder.ragged, meta: { encoding: encoding, delimiter: detected || delimiter } };
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
  var sheetName = opts.sheet && wb.SheetNames.indexOf(opts.sheet) >= 0 ? opts.sheet : wb.SheetNames[0];
  var ws = wb.Sheets[sheetName];
  progress('Reading sheet "' + sheetName + '"', 50);
  var raw = ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }) : [];
  wb = null;
  var builder = new TableBuilder(opts);
  for (var i = 0; i < raw.length; i++) {
    builder.add(raw[i]);
    raw[i] = null;
    if (builder.cells > state.maxCells) throw tooLarge(builder.cells * (raw.length / (i + 1)));
  }
  return { table: builder.finish(), notes: [], ragged: 0, meta: { sheet: sheetName } };
};

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
  if (result.ragged) notes.push(DL.pluralize(result.ragged, 'row') + ' had a different number of values than the header. Missing values were left empty and extra values were kept in new columns.');
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

function hashOf(str) {
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function stepHash(step, upstreamHash) {
  return hashOf(upstreamHash + '|' + step.opId + '|' + (step.skip ? 'skip' : '') + '|' + JSON.stringify(step.params));
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
// The steps in protect (the ones on screen) are kept.
function enforceBudget(protect) {
  if (cacheCells() <= state.cacheBudgetCells) return;
  var entries = [];
  state.cache.forEach(function (entry, id) { if (entry.table && protect.indexOf(id) < 0) entries.push({ id: id, entry: entry }); });
  entries.sort(function (a, b) { return a.entry.lastUsed - b.entry.lastUsed; });
  for (var i = 0; i < entries.length; i++) {
    entries[i].entry.table = null; // recomputed on demand by tableFor
    if (cacheCells() <= state.cacheBudgetCells) break;
  }
}

// Runs the whole chain. Results with a table are kept by content hash. The other results are
// quick to make and are made again on each run, so a step that is fixed or removed does not keep an old verdict.
function runChain(msg) {
  state.steps = msg.steps || [];
  if (!state.source) return [];
  var results = [];
  var upstream = state.source;
  var upstreamHash = state.sourceKey;
  var blocked = null;
  var live = new Set();
  var progressAt = Date.now();
  for (var i = 0; i < state.steps.length; i++) {
    var step = state.steps[i];
    live.add(step.id);
    var h = stepHash(step, upstreamHash);
    var entry;
    if (blocked) {
      entry = makeEntry(h, 'blocked', null, [blocked]);
    } else {
      entry = state.cache.get(step.id);
      if (!entry || entry.hash !== h || !entry.table) entry = computeStep(step, upstream, h);
      touch(entry);
    }
    if (entry.table) state.cache.set(step.id, entry); else state.cache.delete(step.id);
    if (!entry.table) blocked = 'Waiting for step ' + (i + 1) + (entry.status === 'error' ? ' to be fixed.' : ' to be completed.');
    results.push(resultOf(step, entry));
    if (entry.table) { upstream = entry.table; upstreamHash = h; }
    if (Date.now() - progressAt > 150) {
      progressAt = Date.now();
      progress('Running step ' + (i + 1) + ' of ' + state.steps.length, Math.round(100 * (i + 1) / state.steps.length));
    }
  }
  Array.from(state.cache.keys()).forEach(function (id) { if (!live.has(id)) state.cache.delete(id); });
  enforceBudget(msg.protect || []);
  return results;
}

// Gives the table for a step id ('source' or a step id). Recomputes freed results when needed.
function tableFor(stepId) {
  if (!state.source) return null;
  if (stepId === 'source' || !stepId) return state.source;
  var idx = -1;
  for (var i = 0; i < state.steps.length; i++) if (state.steps[i].id === stepId) { idx = i; break; }
  if (idx < 0) return null;
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
  enforceBudget([stepId]);
  return upstream;
}

/* ---------- Preview slices ---------- */

function getSlice(msg) {
  var table = tableFor(msg.stepId);
  if (!table) return { columns: [], rows: [], total: 0, start: 0 };
  var start = Math.max(0, msg.start | 0);
  var end = Math.min(table.length, start + Math.max(0, msg.count | 0));
  return { columns: table.columns, rows: DL.rowsSlice(table, start, end), total: table.length, start: start };
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
  progress('Building Excel file', 30);
  var aoa = DL.rowsSlice(table, 0, n);
  if (o.header !== false) aoa.unshift(table.columns);
  var ws = XLSX.utils.aoa_to_sheet(aoa, { dense: true });
  aoa = null;
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, DL.cleanName(o.sheetName, 'Data').slice(0, 31));
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
