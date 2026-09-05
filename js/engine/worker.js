/* Delimiter Lab - processing worker.
 * Owns the source table and every step result. The main thread only receives small slices.
 */
'use strict';
var V = self.location.search || '';
importScripts('../../vendor/papaparse.min.js' + V, 'core.js' + V, '../ops/text.js' + V, '../ops/rows.js' + V, '../ops/columns.js' + V, '../ops/verify.js' + V);

var xlsxLoaded = false;
function ensureXlsx() {
  if (!xlsxLoaded) { importScripts('../../vendor/xlsx.full.min.js' + V); xlsxLoaded = true; }
}

var state = {
  source: null,          // { columns, rows }
  sourceInfo: null,      // { fileName, rowCount, notes, ... }
  steps: [],             // [{ id, opId, params }]
  cache: new Map(),      // stepId -> { hash, table, notes, status, ms, lastUsed }
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
      case 'sheets': listSheets(msg, reply); break;
      case 'load': loadFile(msg, reply); break;
      case 'clear': state.source = null; state.sourceInfo = null; state.workbook = null; state.cache.clear(); reply({ type: 'ok' }); break;
      case 'run': runChain(msg, reply); break;
      case 'slice': reply({ type: 'slice', stepId: msg.stepId, data: getSlice(msg) }); break;
      case 'export': exportStep(msg, reply); break;
      case 'columnInfo': reply({ type: 'columnInfo', stepId: msg.stepId, info: columnInfo(msg) }); break;
      case 'search': reply({ type: 'search', stepId: msg.stepId, result: search(msg) }); break;
      default: reply({ type: 'error', message: 'Unknown request "' + msg.type + '".' });
    }
  } catch (err) {
    reply({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};

/* ---------- Loading ---------- */

function readBuffer(file) {
  var r = new FileReaderSync();
  return r.readAsArrayBuffer(file);
}

// Reads a small sample to detect the text encoding.
function detectEncoding(file) {
  var head = readBuffer(file.slice(0, 65536));
  var bytes = new Uint8Array(head);
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
  // Many zero bytes in the sample suggests UTF-16 without a BOM.
  var zeros = 0;
  for (var i = 0; i < Math.min(bytes.length, 4096); i++) if (bytes[i] === 0) zeros++;
  if (zeros > 100) return 'utf-16le';
  try {
    // Trim the sample so that a multi-byte character cut at the end does not count as an error.
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

// Parses a workbook once and keeps it while the same file is in use.
function readWorkbook(file) {
  ensureXlsx();
  var key = file.name + ':' + file.size + ':' + file.lastModified;
  if (state.workbook && state.workbook.key === key) return state.workbook.wb;
  state.workbook = null;
  var buf = readBuffer(file);
  var wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
  state.workbook = { key: key, wb: wb };
  return wb;
}

function listSheets(msg, reply) {
  var wb = readWorkbook(msg.file);
  reply({ type: 'sheets', sheets: wb.SheetNames });
}

function isSpreadsheet(name) {
  return /\.(xlsx|xlsm|xlsb|xls|ods)$/i.test(name || '');
}

function loadFile(msg, reply) {
  var file = msg.file;
  var opts = msg.options || {};
  state.cache.clear();
  state.source = null;
  var started = Date.now();
  if (isSpreadsheet(file.name)) {
    var result = loadSpreadsheet(file, opts, reply);
    if (result) finishLoad(file, opts, result, started, reply);
    return;
  }
  loadDelimited(file, opts, reply, function (result) {
    if (result) finishLoad(file, opts, result, started, reply);
  });
}

function finishLoad(file, opts, result, started, reply) {
  var raw = result.rows;
  var notes = result.notes || [];
  var skip = result.skipDone ? 0 : Math.max(0, Number(opts.skipRows) || 0);
  if (skip) { raw = raw.slice(skip); notes.push('Skipped the first ' + DL.pluralize(skip, 'row') + '.'); }
  var width = 0;
  for (var i = 0; i < raw.length; i++) if (raw[i].length > width) width = raw[i].length;
  var columns;
  var start = 0;
  if (opts.headers !== false && raw.length) {
    var header = raw[0];
    columns = DL.cleanHeaders(header.concat(new Array(Math.max(0, width - header.length)).fill('')));
    start = 1;
  } else {
    columns = [];
    for (i = 0; i < width; i++) columns.push('Column ' + (i + 1));
  }
  var n = raw.length - start;
  var ragged = 0;
  var cols = new Array(width);
  for (var c = 0; c < width; c++) cols[c] = new Array(n);
  var stringify = !!result.needsStringify;
  for (i = 0; i < n; i++) {
    var r = raw[start + i];
    if (r.length !== width) ragged++;
    for (c = 0; c < width; c++) {
      var v = c < r.length ? r[c] : '';
      cols[c][i] = stringify ? cellText(v) : (v == null ? '' : v);
    }
    raw[start + i] = null; // free the row array as we go
  }
  raw = null;
  if (ragged) notes.push(DL.pluralize(ragged, 'row') + ' had a different number of values than the header. Missing values were left empty and extra values were kept in new columns.');
  state.source = DL.makeTable(columns, cols, n);
  state.sourceInfo = {
    fileName: file.name,
    fileSize: file.size,
    rowCount: n,
    columns: columns,
    notes: notes,
    encoding: result.encoding || null,
    delimiter: result.delimiter || null,
    sheet: result.sheet || null,
    ms: Date.now() - started
  };
  reply({ type: 'loaded', info: state.sourceInfo });
}

// Quick size estimate from the first part of the file. Returns a message when the file is clearly too big.
function tooLargeMessage(file, encoding, delimiter, quoteChar) {
  var sampleBytes = Math.min(file.size, 1024 * 1024);
  if (sampleBytes < file.size / 50) sampleBytes = Math.min(file.size, 4 * 1024 * 1024);
  if (sampleBytes === file.size) return null;
  var text;
  try {
    text = new TextDecoder(encoding).decode(readBuffer(file.slice(0, sampleBytes)));
  } catch (e) { return null; }
  var cut = text.lastIndexOf('\n');
  if (cut > 0) text = text.slice(0, cut);
  var cfg = { quoteChar: quoteChar, escapeChar: quoteChar, skipEmptyLines: true };
  if (delimiter) cfg.delimiter = delimiter;
  var res = Papa.parse(text, cfg);
  var cells = 0;
  for (var i = 0; i < res.data.length; i++) cells += res.data[i].length;
  var projected = cells * (file.size / Math.max(1, sampleBytes));
  if (projected > state.maxCells * 1.3) {
    return 'This file is too large for your browser to work with smoothly. It has about ' + humanNumber(projected) + ' values, and the safe limit on this computer is about ' + humanNumber(state.maxCells) + '. Try splitting the file, or use a computer with more memory.';
  }
  return null;
}

function loadDelimited(file, opts, reply, done) {
  var encoding = opts.encoding && opts.encoding !== 'auto' ? opts.encoding : detectEncoding(file);
  var quick = tooLargeMessage(file, encoding, opts.delimiter && opts.delimiter !== 'auto' ? DL.unescapeText(opts.delimiter) : '', opts.quoteChar || '"');
  if (quick) { reply({ type: 'error', message: quick, tooLarge: true }); done(null); return; }
  var rows = [];
  var errors = { quotes: 0, delimiter: 0, other: 0 };
  var aborted = null;
  var cellsSoFar = 0;
  var bytesSoFar = 0;
  var lastProgress = 0;
  var delimiter = opts.delimiter && opts.delimiter !== 'auto' ? DL.unescapeText(opts.delimiter) : '';
  var detected = '';
  var toSkip = Math.max(0, Number(opts.skipRows) || 0);
  var dropEmpty = opts.skipEmptyLines !== false;
  var config = {
    delimiter: delimiter,
    quoteChar: opts.quoteChar || '"',
    escapeChar: opts.quoteChar || '"',
    skipEmptyLines: false,
    encoding: encoding,
    comments: opts.comments || false,
    chunkSize: 1024 * 1024 * 4,
    chunk: function (results, parser) {
      var data = results.data;
      if (!detected && results.meta && results.meta.delimiter) detected = results.meta.delimiter;
      // Skip the first rows (counting blank lines), then drop rows that are completely empty.
      if (toSkip > 0) {
        var take = Math.min(toSkip, data.length);
        data = data.slice(take);
        toSkip -= take;
      }
      if (dropEmpty) {
        var kept = [];
        for (var d = 0; d < data.length; d++) if (!isBlankRow(data[d])) kept.push(data[d]);
        data = kept;
      }
      for (var i = 0; i < data.length; i++) {
        cellsSoFar += data[i].length;
      }
      if (results.errors && results.errors.length) {
        for (var k = 0; k < results.errors.length; k++) {
          var err = results.errors[k];
          if (err.type === 'Quotes') errors.quotes++;
          else if (err.type === 'Delimiter') errors.delimiter++;
          else if (err.type !== 'FieldMismatch') errors.other++;
        }
      }
      for (i = 0; i < data.length; i++) rows.push(data[i]);
      bytesSoFar = results.meta.cursor;
      var projected = cellsSoFar * (file.size / Math.max(1, bytesSoFar));
      if (projected > state.maxCells * 1.15 && bytesSoFar > Math.min(file.size * 0.1, 16 * 1024 * 1024)) {
        aborted = 'This file is too large for your browser to work with smoothly. It has about ' + humanNumber(projected) + ' values, and the safe limit on this computer is about ' + humanNumber(state.maxCells) + '. Try splitting the file, or use a computer with more memory.';
        parser.abort();
        return;
      }
      if (cellsSoFar > state.maxCells) {
        aborted = 'This file is too large for your browser to work with smoothly (more than ' + humanNumber(state.maxCells) + ' values). Try splitting the file first.';
        parser.abort();
        return;
      }
      var now = Date.now();
      if (now - lastProgress > 120) {
        lastProgress = now;
        self.postMessage({ type: 'progress', phase: 'Reading file', percent: Math.min(99, Math.round(100 * bytesSoFar / Math.max(1, file.size))) });
      }
    }
  };
  if (!delimiter) delete config.delimiter;
  config.complete = function (results) {
    if (aborted) {
      rows = null;
      reply({ type: 'error', message: aborted, tooLarge: true });
      done(null);
      return;
    }
    var notes = [];
    if (errors.quotes) notes.push(DL.pluralize(errors.quotes, 'value') + ' had unbalanced quotes. Check the text delimiter setting if data looks wrong.');
    if (errors.other) notes.push(DL.pluralize(errors.other, 'problem') + ' found while reading the file.');
    if (errors.delimiter && rows.length && rows[0].length === 1) notes.push('The column separator could not be detected. Choose it in the options if the data looks wrong.');
    if (Number(opts.skipRows) > 0) notes.push('Skipped the first ' + DL.pluralize(Number(opts.skipRows), 'row') + '.');
    done({ rows: rows, notes: notes, encoding: encoding, delimiter: detected || delimiter, skipDone: true });
  };
  config.error = function (err) {
    reply({ type: 'error', message: 'The file could not be read: ' + (err && err.message ? err.message : String(err)) });
    done(null);
  };
  Papa.parse(file, config);
}

// Turns a spreadsheet cell value into text: dates become "2024-01-31", numbers keep full precision.
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : DL.formatDateISO(v.getTime());
  if (typeof v === 'number') return isFinite(v) ? String(Math.abs(v) < 1e15 ? Number(v.toPrecision(15)) : v) : '';
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

function loadSpreadsheet(file, opts, reply) {
  self.postMessage({ type: 'progress', phase: 'Reading spreadsheet', percent: 10 });
  var wb = readWorkbook(file);
  var sheetName = opts.sheet && wb.SheetNames.indexOf(opts.sheet) >= 0 ? opts.sheet : wb.SheetNames[0];
  var ws = wb.Sheets[sheetName];
  self.postMessage({ type: 'progress', phase: 'Reading sheet "' + sheetName + '"', percent: 50 });
  var raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: !!opts.skipRows });
  var cells = 0;
  for (var i = 0; i < raw.length; i++) cells += raw[i].length;
  if (cells > state.maxCells) {
    reply({ type: 'error', message: 'This sheet is too large for your browser to work with smoothly (' + humanNumber(cells) + ' values; the limit on this computer is about ' + humanNumber(state.maxCells) + ').', tooLarge: true });
    return null;
  }
  var skip = Math.max(0, Number(opts.skipRows) || 0);
  var notes = [];
  if (skip) { raw = raw.slice(skip); notes.push('Skipped the first ' + DL.pluralize(skip, 'row') + '.'); }
  if (opts.skipEmptyLines !== false) raw = raw.filter(function (r) { return !isBlankRow(r); });
  return { rows: raw, notes: notes, sheet: sheetName, needsStringify: true, sheets: wb.SheetNames, skipDone: true };
}

function humanNumber(n) {
  if (n >= 1e6) return (Math.round(n / 1e5) / 10) + ' million';
  if (n >= 1e3) return Math.round(n / 1e3) + ' thousand';
  return String(Math.round(n));
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

function cellsOf(table) {
  return table.length * Math.max(1, table.columns.length);
}

function touch(entry) { entry.lastUsed = ++state.useCounter; }

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
function enforceBudget(protectId) {
  if (cacheCells() <= state.cacheBudgetCells) return;
  var entries = [];
  state.cache.forEach(function (entry, id) { if (entry.table) entries.push({ id: id, entry: entry }); });
  entries.sort(function (a, b) { return a.entry.lastUsed - b.entry.lastUsed; });
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].id === protectId) continue;
    entries[i].entry.table = null;
    entries[i].entry.evicted = true;
    if (cacheCells() <= state.cacheBudgetCells) break;
  }
}

function runChain(msg, reply) {
  state.steps = msg.steps || [];
  if (!state.source) { reply({ type: 'ran', results: [] }); return; }
  var results = [];
  var upstreamHash = 'src:' + state.sourceInfo.fileName + ':' + state.sourceInfo.rowCount;
  var upstream = state.source;
  var blocked = null;
  var live = new Set();
  var progressAt = Date.now();
  for (var i = 0; i < state.steps.length; i++) {
    var step = state.steps[i];
    live.add(step.id);
    var h = stepHash(step, upstreamHash);
    var entry = state.cache.get(step.id);
    if (blocked) {
      entry = { hash: h, table: null, status: 'blocked', notes: [blocked], error: null, columns: null, rowCount: 0, ms: 0 };
      state.cache.set(step.id, entry);
    } else if (step.invalid && !step.skip) {
      entry = { hash: h, table: null, status: 'invalid', notes: ['This step needs more settings before it can run.'], error: null, columns: null, rowCount: 0, ms: 0 };
      state.cache.set(step.id, entry);
      blocked = 'Waiting for step ' + (i + 1) + ' to be completed.';
    } else if (!entry || entry.hash !== h || (entry.status === 'ok' && !entry.table && !entry.evicted)) {
      entry = computeStep(step, upstream, h);
      state.cache.set(step.id, entry);
    } else if (entry.evicted) {
      // Result was freed to save memory. Recompute it now so the chain can continue.
      entry = computeStep(step, upstream, h);
      state.cache.set(step.id, entry);
    }
    touch(entry);
    if (entry.status === 'error') blocked = 'Waiting for step ' + (i + 1) + ' to be fixed.';
    results.push({
      stepId: step.id,
      hash: entry.hash,
      status: entry.status,
      notes: entry.notes,
      error: entry.error,
      columns: entry.columns,
      rowCount: entry.rowCount,
      ms: entry.ms
    });
    if (entry.table) { upstream = entry.table; upstreamHash = h; }
    if (Date.now() - progressAt > 150) {
      progressAt = Date.now();
      self.postMessage({ type: 'progress', phase: 'Running step ' + (i + 1) + ' of ' + state.steps.length, percent: Math.round(100 * (i + 1) / state.steps.length) });
    }
  }
  // Drop cache entries for deleted steps.
  Array.from(state.cache.keys()).forEach(function (id) { if (!live.has(id)) state.cache.delete(id); });
  enforceBudget(msg.selectedStepId);
  reply({ type: 'ran', results: results });
}

function computeStep(step, upstream, h) {
  var t0 = Date.now();
  if (step.skip) {
    return { hash: h, table: upstream, status: 'skipped', notes: ['This step is turned off. Data passes through unchanged.'], error: null, columns: upstream.columns, rowCount: upstream.length, ms: 0 };
  }
  try {
    var res = DL.runOp(step.opId, step.params, upstream, {});
    var table = res.table;
    return {
      hash: h, table: table, status: res.status || 'ok', notes: res.notes || [], error: null,
      columns: table.columns, rowCount: table.length, ms: Date.now() - t0
    };
  } catch (err) {
    return { hash: h, table: null, status: 'error', notes: [], error: err && err.message ? err.message : String(err), columns: null, rowCount: 0, ms: Date.now() - t0 };
  }
}

// Returns the table for a step id ('source' or a step id), recomputing evicted results if needed.
function tableFor(stepId) {
  if (!state.source) return null;
  if (stepId === 'source' || !stepId) return state.source;
  var idx = -1;
  for (var i = 0; i < state.steps.length; i++) if (state.steps[i].id === stepId) { idx = i; break; }
  if (idx < 0) return null;
  var entry = state.cache.get(stepId);
  if (entry && entry.table) { touch(entry); return entry.table; }
  if (entry && entry.status !== 'ok') return null;
  // Recompute from the nearest available upstream result.
  var upstream = state.source;
  var upstreamHash = 'src:' + state.sourceInfo.fileName + ':' + state.sourceInfo.rowCount;
  var start = 0;
  for (i = idx - 1; i >= 0; i--) {
    var e = state.cache.get(state.steps[i].id);
    if (e && e.table) { upstream = e.table; upstreamHash = e.hash; start = i + 1; break; }
  }
  for (i = start; i <= idx; i++) {
    var step = state.steps[i];
    var h = stepHash(step, upstreamHash);
    var ne = computeStep(step, upstream, h);
    state.cache.set(step.id, ne);
    touch(ne);
    if (!ne.table) return null;
    upstream = ne.table;
    upstreamHash = h;
  }
  enforceBudget(stepId);
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
  var q = (msg.query || '').toLowerCase();
  if (!q) return { matches: [], total: 0 };
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
      if (v && v.toLowerCase().indexOf(q) >= 0) {
        total++;
        if (matches.length < limit) matches.push([i, c]);
        break;
      }
    }
  }
  return { matches: matches, total: total };
}

/* ---------- Export ---------- */

function exportStep(msg, reply) {
  var table = tableFor(msg.stepId);
  if (!table) { reply({ type: 'error', message: 'There is no data to download for this step.' }); return; }
  var o = msg.options || {};
  var format = o.format || 'csv';
  var n = table.length;
  var blob;
  if (format === 'xlsx') {
    ensureXlsx();
    if (n > 1048575) { reply({ type: 'error', message: 'Excel files can hold at most 1,048,576 rows. Use CSV for this data.' }); return; }
    self.postMessage({ type: 'progress', phase: 'Building Excel file', percent: 30 });
    var aoa = DL.rowsSlice(table, 0, n);
    if (o.header !== false) aoa.unshift(table.columns);
    var ws = XLSX.utils.aoa_to_sheet(aoa, { dense: true });
    aoa = null;
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (o.sheetName || 'Data').slice(0, 31));
    var out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  } else if (format === 'json') {
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
    blob = new Blob(parts, { type: 'application/json' });
  } else {
    var delimiter = format === 'tsv' ? '\t' : DL.unescapeText(o.delimiter == null || o.delimiter === '' ? ',' : o.delimiter);
    var newline = o.newline === 'lf' ? '\n' : '\r\n';
    var cfg = { delimiter: delimiter, quotes: !!o.quoteAll, quoteChar: o.quoteChar || '"', escapeChar: o.quoteChar || '"', newline: newline };
    var chunks = [];
    if (o.bom !== false) chunks.push('\ufeff');
    if (o.header !== false) chunks.push(Papa.unparse([table.columns], cfg) + newline);
    // Convert in blocks so that memory stays low for large tables.
    var BLOCK = 50000;
    for (var start = 0; start < n; start += BLOCK) {
      var end = Math.min(n, start + BLOCK);
      chunks.push(Papa.unparse(DL.rowsSlice(table, start, end), cfg) + newline);
      if (n > BLOCK) self.postMessage({ type: 'progress', phase: 'Preparing download', percent: Math.round(100 * end / n) });
    }
    blob = new Blob(chunks, { type: 'text/csv;charset=utf-8' });
  }
  reply({ type: 'exported', blob: blob, rowCount: n });
}
