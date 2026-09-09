/* Reading files into tables, and writing tables into files.
 *
 * The bodies of the readers and the writers came from the worker and did not change. The few
 * places that reached for something only a browser worker has now go through DL.platform:
 *
 *   readBuffer(blob)   the bytes of a file, as an ArrayBuffer
 *   papa               the delimited-text parser
 *   xlsx()             the workbook library, brought in when a workbook needs it
 *   progress(phase, percent)  what to say while the work runs
 *
 * The worker fills those with the answers of the browser. The command line fills them with the
 * answers of Node. Neither has a reader of its own.
 */
import { DL } from './dl.js';

DL.platform = {
  readBuffer: function (): ArrayBuffer { throw new Error('DL.platform.readBuffer is not set.'); },
  papa: null as any,   // the parser for delimited text
  xlsx: function (): any { throw new Error('DL.platform.xlsx is not set.'); },
  progress: function (_phase?: string, _percent?: number) {},
  // Names the part of the work that follows, so that one file of a list owns one part of a bar.
  // A name of null means that no part is open.
  scope: function (_label: string | null, _from?: number, _to?: number) {}
};

function humanNumber(n) {
  if (n >= 999500) return (Math.round(n / 1e5) / 10) + ' million';
  if (n >= 1e3) return Math.round(n / 1e3) + ' thousand';
  return String(Math.round(n));
}

function tooLarge(cells) {
  var err = new Error('This file is too large to work with smoothly. It has about ' + humanNumber(cells) +
    ' values, and the safe limit on this computer is about ' + humanNumber(DL.maxCells) + '. Try splitting the file, or use a computer with more memory.');
  (err as any).tooLarge = true;
  return err;
}

/* ---------- Loading ---------- */

function readBuffer(blob) {
  return DL.platform.readBuffer(blob);
}

// Reads a small sample to detect the text encoding.
function detectEncoding(file) {
  var bytes = new Uint8Array(readBuffer(file.slice(0, 1024 * 1024)));
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
  // Many zero bytes in the sample point to UTF-16 without a byte order mark. Zero bytes at odd
  // positions come from little-endian text (ASCII letters are "x 0"); at even positions from big-endian.
  var zerosOdd = 0, zerosEven = 0;
  var span = Math.min(bytes.length, 4096);
  for (var i = 0; i < span; i++) if (bytes[i] === 0) { if (i % 2) zerosOdd++; else zerosEven++; }
  if (zerosOdd + zerosEven > span / 8 && zerosOdd + zerosEven >= 8) return zerosEven > zerosOdd ? 'utf-16be' : 'utf-16le';
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
    notes.push('The encoding "' + encoding + '" is not supported here. UTF-8 was used.');
    return new TextDecoder('utf-8');
  }
}

// Readers by input format id. Each gives { table, notes, meta }.
var readers: any = {};

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

// Finds the column separator from the first lines of the text. The count does not include skipped and blank lines.
function guessDelimiter(text, quoteChar, skipLines) {
  var sample = text.slice(0, 65536).replace(/\r\n?/g, '\n'); // one line ending for the sample
  var cut = sample.lastIndexOf('\n');
  if (cut > 0 && text.length > 65536) sample = sample.slice(0, cut);
  for (var i = 0; i < skipLines; i++) {
    var nl = sample.indexOf('\n');
    if (nl < 0) break;
    sample = sample.slice(nl + 1);
  }
  var res = DL.platform.papa.parse(sample, { quoteChar: quoteChar, escapeChar: quoteChar, skipEmptyLines: 'greedy', preview: 50 });
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
  var cfg: any = { quoteChar: quoteChar, escapeChar: quoteChar, skipEmptyLines: true };
  if (delimiter) cfg.delimiter = delimiter;
  var res = DL.platform.papa.parse(text, cfg);
  var cells = 0;
  for (var i = 0; i < res.data.length; i++) cells += res.data[i].length;
  var projected = cells * (file.size / Math.max(1, sampleBytes));
  if (projected > DL.maxCells * 1.3) throw tooLarge(projected);
}

readers.delimited = function (file, opts) {
  if (!DL.platform.papa) throw new Error('DL.platform.papa is not set.');
  var notes = [];
  var encoding = opts.encoding && opts.encoding !== 'auto' ? opts.encoding : detectEncoding(file);
  var decoder = makeDecoder(encoding, notes);
  var delimiter = delimiterOf(opts);
  var quoteChar = opts.quoteChar === 'none' ? '\u0000' : (opts.quoteChar || '"');
  checkSize(file, decoder, delimiter, quoteChar);

  var builder = new DL.TableBuilder(opts);
  var errors = { quotes: 0, delimiter: 0, other: 0 };
  var stopped = null;
  var config: any = {
    quoteChar: quoteChar,
    escapeChar: quoteChar,
    skipEmptyLines: false,
    chunk: function (results, parser) {
      var data = results.data;
      // A file with mixed line endings leaves "\r" on the last value, but only when the parser
      // took "\n" as the line ending. When the parser took "\r\n", a "\r" at the end of the last
      // value is part of the value, and to remove it takes a character out of the data.
      var strayCR = results.meta && results.meta.linebreak === '\n';
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        if (strayCR) {
          var lastCell = row[row.length - 1];
          if (typeof lastCell === 'string' && lastCell.charCodeAt(lastCell.length - 1) === 13) row[row.length - 1] = lastCell.slice(0, -1);
        }
        builder.add(row);
      }
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
      DL.platform.papa.parse(stream, config);
    }
    stream.emit('data', text);
    DL.platform.progress('Reading file', Math.min(99, Math.round(100 * offset / file.size)));
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
  return DL.platform.xlsx().read(readBuffer(file), { type: 'array', cellDates: true, dense: true, bookSheets: !!sheetsOnly });
}

function sheetNames(file) {
  return readWorkbook(file, true).SheetNames;
}

readers.spreadsheet = function (file, opts) {
  DL.platform.progress('Reading workbook', 10);
  var wb = readWorkbook(file, false);
  var found = !opts.sheet || wb.SheetNames.indexOf(opts.sheet) >= 0;
  var sheetName = found ? opts.sheet || wb.SheetNames[0] : wb.SheetNames[0];
  var notes = found ? [] : ['Sheet "' + opts.sheet + '" is not in this workbook. The first sheet "' + sheetName + '" was read.'];
  var ws = wb.Sheets[sheetName];
  DL.platform.progress('Reading sheet "' + sheetName + '"', 40);
  var raw = ws ? DL.platform.xlsx().utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true }) : [];
  wb = null;
  var builder = new DL.TableBuilder(opts);
  for (var i = 0; i < raw.length; i++) {
    builder.add(raw[i]);
    raw[i] = null;
    if (builder.cells > DL.maxCells) throw tooLarge(builder.cells * (raw.length / (i + 1)));
  }
  DL.platform.progress('Reading sheet "' + sheetName + '"', 95);
  return { table: builder.finish(), notes: notes, ragged: 0, meta: { sheet: sheetName } };
};

function RAGGED_NOTE(count) {
  return DL.pluralize(count, 'row') + ' had a different number of values than the header. Missing values were left empty and extra values were kept in new columns.';
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

// CRC-32 in parts. A caller starts with -1, adds the bytes of each part in turn, and ends with
// crcEnd. A caller that holds a large file in slices can then make a checksum without holding the
// whole file in memory.
function crcAdd(c, bytes) {
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return c;
}
function crcEnd(c) { return (c ^ -1) >>> 0; }

// CRC-32 of bytes that are all here.
function crc32(bytes) { return crcEnd(crcAdd(-1, bytes)); }

var ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1;
var ZIP_MAX_ENTRIES = 65535;

// Makes a zip from a list of files. A file comes as { name, bytes } with a Uint8Array, or as
// { name, part, size, crc }, where part is something the platform can put in a file of its own,
// such as a blob. The second shape lets a caller keep a large file where it is: the checksum comes
// from crcAdd over slices, and nothing is copied into memory here. That crc may be a function,
// which is called only after the size of the zip is known to be allowed, so a batch that is too
// large is refused before any file is read.
//
// The zip stores the files without compression, because deflate needs a library or a stream that
// answers later. The chunks point at what came in, so no file is copied.
function makeZip(entries) {
  var encoder0 = new TextEncoder();
  var total = 22;
  entries.forEach(function (e) {
    var nameLen = encoder0.encode(e.name).length;
    if (nameLen > 65535) throw new Error('The file name "' + e.name.slice(0, 40) + '…" is too long for a zip file.');
    total += (e.bytes ? e.bytes.length : e.size) + 30 + 46 + 2 * nameLen;
  });
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
    var size = e.bytes ? e.bytes.length : e.size;
    var name = encoder.encode(e.name);
    var crc = e.bytes ? crc32(e.bytes) : (typeof e.crc === 'function' ? e.crc() : e.crc);
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
    parts.push(local.buffer, name, e.bytes || e.part);
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
  return { chunks: parts, mime: 'application/zip' };
}

/* ---------- Export ---------- */


// Writers by output format id. Each gives { chunks, mime }.
var writers: any = {};

// Writes a value for a delimited file. A value gets quotes when it holds the delimiter, a quote, a
// line break, a byte order mark or a space at an end, or always when quoteAll is on.
function quoteValue(v, delimiter, quoteAll) {
  var needs = quoteAll || v.indexOf(delimiter) >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0 ||
    v.indexOf('\ufeff') >= 0 || (v.length > 0 && (v.charCodeAt(0) === 32 || v.charCodeAt(v.length - 1) === 32));
  return needs ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function writeDelimited(table, o, delimiter, mime) {
  var n = table.length;
  var w = table.columns.length;
  var newline = o.newline === 'lf' ? '\n' : '\r\n';
  var quoteAll = !!o.quoteAll;
  var chunks = [];
  if (o.bom !== false) chunks.push('\ufeff');
  if (o.header !== false) chunks.push(table.columns.map(function (c) { return quoteValue(c, delimiter, quoteAll); }).join(delimiter) + newline);
  var get = [];
  for (var c = 0; c < w; c++) get.push(DL.cellGetter(table, c));
  // Write in blocks so that memory stays low for large tables.
  var BLOCK = 50000;
  for (var start = 0; start < n; start += BLOCK) {
    var end = Math.min(n, start + BLOCK);
    var lines = new Array(end - start);
    for (var i = start; i < end; i++) {
      var line = '';
      for (c = 0; c < w; c++) line += (c ? delimiter : '') + quoteValue(get[c](i), delimiter, quoteAll);
      lines[i - start] = line;
    }
    chunks.push(lines.join(newline) + newline);
    if (n > BLOCK) DL.platform.progress('Preparing download', Math.round(100 * end / n));
  }
  return { chunks: chunks, mime: mime };
}

writers.csv = function (table, o, format) { return writeDelimited(table, o, ',', format.mime); };
writers.tsv = function (table, o, format) { return writeDelimited(table, o, '\t', format.mime); };
writers.delimited = function (table, o, format) {
  var d = DL.unescapeText(o.delimiter) || ';';
  if (d.indexOf('"') >= 0 || d.indexOf('\n') >= 0 || d.indexOf('\r') >= 0) throw new Error('The separator cannot be a quote or a line break.');
  // Quotes keep one character apart from the data. With two, a value that ends with the first
  // character next to a value that starts with the second makes a separator that nobody wrote,
  // and the file then reads back with more columns than it was written with.
  if (Array.from(d).length > 1) throw new Error('The separator must be one character.');
  return writeDelimited(table, o, d, format.mime);
};

writers.xlsx = function (table, o, format) {
  var n = table.length;
  if (n > 1048575) throw new Error('Excel files can hold at most 1,048,576 rows. Use CSV for this data.');
  if (table.columns.length > 16384) throw new Error('Excel files can hold at most 16,384 columns. Use CSV for this data.');
  for (var c = 0; c < table.columns.length; c++) {
    var get = DL.cellGetter(table, c);
    for (var i = 0; i < n; i++) {
      if (get(i).length > 32767) throw new Error('Row ' + (i + 1) + ' of column "' + table.columns[c] + '" has more than 32,767 characters. Excel cannot hold it. Use CSV for this data.');
    }
  }
  // The Excel writer needs several copies of the data in memory.
  if (n * table.columns.length > DL.maxCells / 4) throw new Error('This table is too large for an Excel file. Use CSV for this data.');
  // Excel holds a number as a number. The table keeps only text, so a value that reads as a
  // number and writes back exactly the same becomes a number here. A value such as 007 or
  // 1,234.50 does not write back the same, so it stays text and keeps every character.
  var comma = DL.numberStyle === 'comma';
  var numeric = function (v) {
    if (v === '' || v.length > 20) return v;
    var c = v.charCodeAt(0);
    if (!(c >= 48 && c <= 57) && c !== 45 && c !== 46) return v; // must start with a digit, - or .
    if (comma) {
      // The file writes 1.234,56, so a plain Number() reads 1.234 as one and not as one thousand.
      // A value with a separator takes the answer of the reader; one without it must still write
      // back the same, so 007 keeps its characters.
      var g = DL.toNumber(v);
      if (!isFinite(g)) return v;
      return (v.indexOf(',') >= 0 || v.indexOf('.') >= 0 || String(g) === v) ? g : v;
    }
    var x = Number(v);
    return (isFinite(x) && String(x) === v) ? x : v;
  };
  var BLOCK = 20000;
  var ws = DL.platform.xlsx().utils.aoa_to_sheet(o.header !== false ? [table.columns] : [], { dense: true });
  var at = o.header !== false ? 1 : 0;
  for (var start = 0; start < n; start += BLOCK) {
    var end = Math.min(n, start + BLOCK);
    var block = DL.rowsSlice(table, start, end);
    for (var r = 0; r < block.length; r++) {
      var row = block[r];
      for (var cc = 0; cc < row.length; cc++) row[cc] = numeric(row[cc]);
    }
    DL.platform.xlsx().utils.sheet_add_aoa(ws, block, { origin: at + start });
    DL.platform.progress('Building Excel file', Math.round(60 * end / n));
  }
  var wb = DL.platform.xlsx().utils.book_new();
  var sheetName = DL.cleanName(o.sheetName, 'Data').replace(/[:\\\/?*\[\]]/g, '_').replace(/^'+|'+$/g, '').slice(0, 31) || 'Data';
  if (sheetName.toLowerCase() === 'history') sheetName = 'History_'; // Excel reserves this name
  DL.platform.xlsx().utils.book_append_sheet(wb, ws, sheetName);
  DL.platform.progress('Building Excel file', 80);
  var out = DL.platform.xlsx().write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  return { chunks: [out], mime: format.mime };
};

writers.json = function (table, o, format) {
  var n = table.length;
  var cols = table.columns;
  var parts = ['['];
  var pretty = !!o.pretty;
  var keys = cols.map(function (c) { return JSON.stringify(c) + (pretty ? ': ' : ':'); });
  var get = [];
  for (var c = 0; c < cols.length; c++) get.push(DL.cellGetter(table, c));
  for (var i = 0; i < n; i++) {
    var obj = pretty ? '\n  {' : '{';
    for (c = 0; c < cols.length; c++) obj += (c ? (pretty ? ',\n    ' : ',') : (pretty ? '\n    ' : '')) + keys[c] + JSON.stringify(get[c](i));
    obj += pretty ? '\n  }' : '}';
    parts.push((i ? ',' : '') + obj);
  }
  parts.push((pretty ? '\n' : '') + ']');
  return { chunks: parts, mime: format.mime };
};

// Writes a table in the output format of the options. Gives a Blob.
// The bytes of the table in the output format of the options, as { chunks, mime }. A chunk is a
// string or a byte array. Nothing here knows about Blob, so the command line writes the bytes
// straight to a file and the page wraps them.
function writeBytes(table, o) {
  var format = DL.outputFormatById(o.format) || DL.outputFormats[0];
  return writers[format.id](table, o, format);
}

DL.readers = readers;
DL.writeBytes = writeBytes;
DL.crcAdd = crcAdd;
DL.crcEnd = crcEnd;
DL.makeZip = makeZip;
DL.tooLarge = tooLarge;
DL.raggedNote = RAGGED_NOTE;
DL.readerFor = function (name) { return readers[DL.inputFormatFor(name).id]; };
DL.sheetNames = sheetNames;

/* Reads files into one table.
 *
 * Gives { table, info }. info names every file with its rows, and carries the notes of the read,
 * the encoding and the separator of the first file, and the time that the read took.
 *
 * The command line and the worker both call this. Neither has a reader of its own.
 */
DL.readSource = function (files, opts) {
  files = files || [];
  opts = opts || {};
  var started = Date.now();
  var tables = [];
  var names = [];
  var each = [];
  var notes = [];
  var ragged = 0;
  var meta: any = {};
  var cells = 0;
  var key = 'src:';
  // The column of the file name belongs to a source that puts files together.
  var stackOpts = { fileColumn: (opts.fileNameColumn && opts.multiFile === 'stack') ? 'Source file' : null };
  var many = files.length > 1;
  var share = many ? 90 / files.length : 0;
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (many) {
      DL.platform.scope(file.name + ' (' + (i + 1) + ' of ' + files.length + ')', share * i, share * (i + 1));
      DL.platform.progress('', 0); // the name of the file, before the reader says what it does
    }
    var result = DL.readerFor(file.name)(file, opts);
    // Each file adds to the cells that must be held, so the limit is on the total.
    cells += result.table.length * Math.max(1, result.table.columns.length);
    if (cells > DL.maxCells) throw DL.tooLarge(cells);
    tables.push(result.table);
    names.push(file.name);
    each.push({ name: file.name, size: file.size, rowCount: result.table.length, columnCount: result.table.columns.length });
    ragged += result.ragged || 0;
    for (var n = 0; n < result.notes.length; n++) {
      notes.push(files.length > 1 ? '"' + file.name + '": ' + result.notes[n] : result.notes[n]);
    }
    if (i === 0) meta = result.meta || {};
    key += file.name + ':' + file.size + ':' + file.lastModified + ':';
  }
  DL.platform.scope(null, 0, 0);
  // The columns of all the files together make the table wider than any one file, and the column of
  // the file name adds one more. Count the cells of that table before the memory for it is necessary.
  if (tables.length > 1 || stackOpts.fileColumn) {
    var shape = DL.stackedShape(tables, stackOpts);
    var stackedCells = shape.rows * Math.max(1, shape.columns.length);
    if (stackedCells > DL.maxCells) throw DL.tooLarge(stackedCells);
  }
  if (many) DL.platform.progress('Putting the files together', 92);
  var stacked = DL.stackTables(tables, names, stackOpts);
  var table = stacked.table;
  for (var m = 0; m < stacked.notes.length; m++) notes.push(stacked.notes[m]);
  var skip = Math.max(0, Number(opts.skipRows) || 0);
  if (skip) notes.push('Skipped the first ' + DL.pluralize(skip, 'row') + (files.length > 1 ? ' of each file.' : '.'));
  if (ragged) notes.push(DL.raggedNote(ragged));
  // The numbers of this file decide how every value in it is read. Without this the same column
  // can be read at two scales: 1.234,56 as one thousand and 1.000 as one.
  DL.numberStyle = DL.detectNumberStyle(table);
  if (DL.numberStyle === 'comma') notes.push('The numbers in this file write 1.234,56, so a comma is the decimal separator.');
  return {
    table: table,
    key: key + JSON.stringify(opts),
    info: {
      fileName: files.length ? files[0].name : '',
      fileSize: files.length ? files[0].size : 0,
      files: each,
      rowCount: table.length,
      columns: table.columns,
      notes: notes,
      encoding: meta.encoding || null,
      delimiter: meta.delimiter || null,
      sheet: meta.sheet || null,
      ms: Date.now() - started
    }
  };
};

