/* Delimiter Lab - engine core.
 * Shared by the main thread (for metadata) and the worker (for processing).
 * A table is a plain object: { columns: string[], rows: string[][] }.
 * Cells are always strings. Operations never change the input table.
 */
(function (root) {
  'use strict';
  var DL = root.DL || (root.DL = {});
  DL.VERSION = '1.0.7';

  /* ---------- Table helpers ----------
   * A table stores data by column: { columns: string[], cols: Column[], length: number }.
   * A Column is either a plain array of strings (one value per row), or a lazy column
   * { src: string[], idx: Uint32Array } that reads row i as src[idx[i]]. Row operations
   * (filter, sort, dedupe) only create index arrays; the text itself is never copied.
   * Use DL.col(table, c) to get a plain array (it is created once and then remembered).
   * Operations never change the tables they receive.
   */

  DL.makeTable = function (columns, cols, length) {
    if (length == null) length = cols.length ? DL.colLength(cols[0]) : 0;
    return { columns: columns, cols: cols, length: length };
  };

  DL.colLength = function (col) {
    return Array.isArray(col) ? col.length : col.idx.length;
  };

  DL.isLazy = function (col) {
    return !Array.isArray(col);
  };

  // Returns column c as a plain array, creating it from a lazy column when needed.
  DL.col = function (table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return col;
    var src = col.src, idx = col.idx;
    var n = idx.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = src[idx[i]];
    table.cols[c] = out; // remember: same content, faster next time
    return out;
  };

  // Returns a function(rowIndex) -> value for column c without creating a plain array.
  DL.cellGetter = function (table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return function (i) { return col[i]; };
    var src = col.src, idx = col.idx;
    return function (i) { return src[idx[i]]; };
  };

  // Builds a table from row arrays (used when reading files).
  DL.fromRows = function (columns, rows) {
    var w = columns.length;
    var n = rows.length;
    var cols = new Array(w);
    for (var c = 0; c < w; c++) {
      var arr = new Array(n);
      for (var i = 0; i < n; i++) {
        var v = rows[i][c];
        arr[i] = v == null ? '' : v;
      }
      cols[c] = arr;
    }
    return DL.makeTable(columns, cols, n);
  };

  // Returns row i as an array of values.
  DL.rowAt = function (table, i) {
    var w = table.cols.length;
    var r = new Array(w);
    for (var c = 0; c < w; c++) {
      var col = table.cols[c];
      r[c] = Array.isArray(col) ? col[i] : col.src[col.idx[i]];
    }
    return r;
  };

  // Returns rows start..end (exclusive) as arrays.
  DL.rowsSlice = function (table, start, end) {
    var out = [];
    for (var i = start; i < end; i++) out.push(DL.rowAt(table, i));
    return out;
  };

  DL.colIndex = function (table, name) {
    return table.columns.indexOf(name);
  };

  DL.colIndexes = function (table, names) {
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var idx = table.columns.indexOf(names[i]);
      if (idx >= 0) out.push(idx);
    }
    return out;
  };

  // New table with the values of column idx replaced by fn(value, rowIndex). Other columns are shared.
  DL.mapColumn = function (table, idx, fn) {
    var src = DL.col(table, idx);
    var n = table.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = fn(src[i], i);
    var cols = table.cols.slice();
    cols[idx] = out;
    return DL.makeTable(table.columns, cols, n);
  };

  // Largest number of different values for which results are remembered per column.
  var MEMO_LIMIT = 50000;

  // New table with several columns replaced by fn(value, ctx). fn must depend on the value only:
  // results are remembered per distinct value, which makes repeated values almost free.
  // fn can call ctx.tag() to count a cell (for example "changed" or "not a number"); the total
  // is written to stats.tagged when a stats object is given.
  DL.mapColumns = function (table, idxs, fn, stats) {
    var cols = table.cols.slice();
    var n = table.length;
    var tagged = 0;
    var ctx = { tagged: false, tag: function () { this.tagged = true; } };
    for (var k = 0; k < idxs.length; k++) {
      var c = idxs[k];
      var src = DL.col(table, c);
      var out = new Array(n);
      var cache = new Map();
      for (var i = 0; i < n; i++) {
        var v = src[i];
        if (cache !== null) {
          var e = cache.get(v);
          if (e !== undefined) {
            out[i] = e.out;
            if (e.tag) tagged++;
            continue;
          }
        }
        ctx.tagged = false;
        var r = fn(v, ctx);
        out[i] = r;
        if (ctx.tagged) tagged++;
        if (cache !== null) {
          cache.set(v, { out: r, tag: ctx.tagged });
          if (cache.size > MEMO_LIMIT) cache = null; // too many different values: stop remembering
        }
      }
      cols[c] = out;
    }
    if (stats) stats.tagged = tagged;
    return DL.makeTable(table.columns, cols, n);
  };

  // True when toLowerCase() would change the text. Avoids creating a new string when it would not.
  DL.hasUpper = function (s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 65 && c <= 90) || c > 127) return true;
    }
    return false;
  };

  // True when trim() would change the text.
  DL.hasEdgeSpace = function (s) {
    if (s.length === 0) return false;
    var a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1);
    return a <= 32 || b <= 32 || a === 160 || b === 160 || a === 0xFEFF;
  };

  // Lower-cases and / or trims a value, allocating a new string only when needed.
  DL.normalizeKey = function (v, trim, ignoreCase) {
    if (trim && DL.hasEdgeSpace(v)) v = v.trim();
    if (ignoreCase && DL.hasUpper(v)) v = v.toLowerCase();
    return v;
  };

  // New table with an extra column. position: 'end' (default) or 'start'.
  DL.addColumn = function (table, name, values, position) {
    var columns = table.columns.slice();
    var cols = table.cols.slice();
    if (position === 'start') { columns.unshift(name); cols.unshift(values); }
    else { columns.push(name); cols.push(values); }
    return DL.makeTable(columns, cols, table.length);
  };

  // New table that keeps only the columns at the given indexes, in that order.
  DL.pickColumns = function (table, idxs) {
    var columns = new Array(idxs.length);
    var cols = new Array(idxs.length);
    for (var k = 0; k < idxs.length; k++) { columns[k] = table.columns[idxs[k]]; cols[k] = table.cols[idxs[k]]; }
    return DL.makeTable(columns, cols, table.length);
  };

  // New table without the given column indexes.
  DL.dropColumns = function (table, idxs) {
    var keep = [];
    for (var c = 0; c < table.columns.length; c++) if (idxs.indexOf(c) < 0) keep.push(c);
    return DL.pickColumns(table, keep);
  };

  // New table with only the rows whose indexes are listed, in that order.
  // Only index arrays are created; the text stays shared with the input table.
  DL.selectRows = function (table, indexes) {
    var n = indexes.length;
    var idx = indexes instanceof Uint32Array ? indexes : Uint32Array.from(indexes);
    var w = table.cols.length;
    var cols = new Array(w);
    var composed = new Map(); // parent index array -> composed index array
    for (var c = 0; c < w; c++) {
      var col = table.cols[c];
      if (Array.isArray(col)) {
        cols[c] = { src: col, idx: idx };
      } else {
        var comp = composed.get(col.idx);
        if (!comp) {
          var parent = col.idx;
          comp = new Uint32Array(n);
          for (var i = 0; i < n; i++) comp[i] = parent[idx[i]];
          composed.set(parent, comp);
        }
        cols[c] = { src: col.src, idx: comp };
      }
    }
    return DL.makeTable(table.columns, cols, n);
  };

  // New table with only the rows for which keep[i] is true.
  DL.filterRows = function (table, keep) {
    var idx = [];
    for (var i = 0; i < table.length; i++) if (keep[i]) idx.push(i);
    return DL.selectRows(table, idx);
  };

  // Groups rows that have the same key. keyAt(i) returns the key text of row i.
  // Returns { first: Int32Array (row -> first row with the same key), count: Int32Array (first row -> group size), groups }.
  // Uses a typed-array hash table instead of Map / Set, which stays fast on millions of rows.
  DL.groupRows = function (keyAt, n) {
    var cap = 1024;
    while (cap < n * 2) cap *= 2;
    var mask = cap - 1;
    var slots = new Int32Array(cap).fill(-1);
    var hashes = new Int32Array(n);
    var first = new Int32Array(n);
    var count = new Int32Array(n);
    var keys = new Array(n);
    var groups = 0;
    for (var i = 0; i < n; i++) {
      var k = keyAt(i);
      keys[i] = k;
      // FNV-1a hash over the UTF-16 code units.
      var h = 2166136261;
      for (var j = 0; j < k.length; j++) {
        h ^= k.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      hashes[i] = h;
      var pos = h & mask;
      for (;;) {
        var s = slots[pos];
        if (s === -1) { slots[pos] = i; first[i] = i; count[i] = 1; groups++; break; }
        if (hashes[s] === h && keys[s] === k) { first[i] = s; count[s]++; break; }
        pos = (pos + 1) & mask;
      }
    }
    return { first: first, count: count, groups: groups };
  };

  // Makes a column name that does not collide with existing names.
  DL.uniqueName = function (columns, wanted) {
    var name = wanted;
    var n = 2;
    while (columns.indexOf(name) >= 0) {
      name = wanted + ' ' + n;
      n++;
    }
    return name;
  };

  // Makes sure all headers are non-empty and unique.
  DL.cleanHeaders = function (headers) {
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i] == null ? '' : String(headers[i]).trim();
      if (h === '') h = 'Column ' + (i + 1);
      var base = h;
      var n = 2;
      while (seen[h]) {
        h = base + ' ' + n;
        n++;
      }
      seen[h] = true;
      out.push(h);
    }
    return out;
  };

  DL.str = function (v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    return String(v);
  };

  /* ---------- Value parsing ---------- */

  var numRe = /^[+-]?(\d+([.,]\d+)*|\d*[.,]\d+)([eE][+-]?\d+)?$/;

  // Fast check: only digits, one optional sign, one optional decimal point and one optional exponent.
  function isPlainNumber(s) {
    var len = s.length;
    if (len === 0 || len > 24) return false;
    var digits = 0, dots = 0, exp = 0;
    for (var i = 0; i < len; i++) {
      var c = s.charCodeAt(i);
      if (c >= 48 && c <= 57) digits++;
      else if (c === 46) { if (dots++ || exp) return false; }
      else if (c === 45 || c === 43) { if (i !== 0 && !(exp && (s.charCodeAt(i - 1) === 101 || s.charCodeAt(i - 1) === 69))) return false; }
      else if (c === 101 || c === 69) { if (exp++ || digits === 0) return false; }
      else return false;
    }
    return digits > 0;
  }

  // Turns a text value into a number. Accepts "1,234.56", "1.234,56", "$1,000", "(12)", "12%".
  // Returns NaN when the value is not a number.
  DL.toNumber = function (v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = typeof v === 'string' ? v : String(v);
    if (s === '') return NaN;
    // Fast path for plain numbers such as "1234.5" or "-3".
    if (isPlainNumber(s)) return +s;
    s = s.trim();
    if (s === '') return NaN;
    if (isPlainNumber(s)) return +s;
    var neg = false;
    if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
      neg = true;
      s = s.slice(1, -1).trim();
    }
    // Strip currency symbols, spaces and percent signs.
    s = s.replace(/[\s '$€£¥₹%]/g, '');
    if (s === '' || !numRe.test(s)) return NaN;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) {
        // 1.234,56 -> European
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (lastComma >= 0) {
      var commas = s.split(',').length - 1;
      var after = s.length - lastComma - 1;
      // A single comma with exactly 3 digits after it is a thousands separator ("1,234").
      // Other single commas are decimal separators ("1,5"). Many commas are thousands separators.
      if (commas === 1 && after !== 3) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    var n = Number(s);
    if (isNaN(n)) return NaN;
    return neg ? -n : n;
  };

  var isoRe = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
  var slashRe = /^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

  // Parses common date formats. Returns a timestamp (ms) or NaN.
  // dayFirst: treat "01/02/2024" as 1 February (true) or 2 January (false).
  DL.toDate = function (v, dayFirst) {
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === '') return NaN;
    var m = isoRe.exec(s);
    if (m) {
      if (m[8]) return Date.parse(s);
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    m = slashRe.exec(s);
    if (m) {
      var a = +m[1], b = +m[2], c = +m[3];
      var y, mo, d;
      if (m[1].length === 4) {
        y = a; mo = b; d = c;
      } else {
        if (m[3].length <= 2) c = c + (c < 70 ? 2000 : 1900);
        y = c;
        if (dayFirst || a > 12) { d = a; mo = b; } else { mo = a; d = b; }
      }
      var h = +(m[4] || 0);
      var ampm = m[7];
      if (ampm) {
        var pm = ampm.toLowerCase() === 'pm';
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
      return new Date(y, mo - 1, d, h, +(m[5] || 0), +(m[6] || 0)).getTime();
    }
    // Fall back to the browser's parser for "March 5, 2024" and similar.
    var t = Date.parse(s);
    if (!isNaN(t) && /[a-zA-Z]/.test(s)) return t;
    return NaN;
  };

  DL.formatDateISO = function (ts) {
    var d = new Date(ts);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var out = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (d.getHours() || d.getMinutes() || d.getSeconds()) {
      out += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    return out;
  };

  /* ---------- Comparison ---------- */

  DL.collator = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    : null;

  DL.compareText = function (a, b) {
    if (DL.collator) return DL.collator.compare(a, b);
    return a < b ? -1 : a > b ? 1 : 0;
  };

  // Guesses the type of a column from a sample of its values: 'number', 'date' or 'text'.
  DL.detectType = function (col, sampleSize) {
    var n = Math.min(col.length, sampleSize || 500);
    var nums = 0, dates = 0, filled = 0;
    var step = Math.max(1, Math.floor(col.length / n));
    for (var i = 0; i < col.length && filled < n; i += step) {
      var v = col[i];
      if (v == null || v === '') continue;
      filled++;
      if (!isNaN(DL.toNumber(v))) nums++;
      else if (!isNaN(DL.toDate(v))) dates++;
    }
    if (filled === 0) return 'text';
    if (nums / filled > 0.9) return 'number';
    if (dates / filled > 0.9) return 'date';
    return 'text';
  };

  /* ---------- Text helpers ---------- */

  DL.escapeRegExp = function (s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  DL.buildRegex = function (find, opts) {
    var flags = 'g' + (opts.matchCase ? '' : 'i');
    var src = opts.regex ? find : DL.escapeRegExp(find);
    if (opts.wholeWord) src = '(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])';
    if (opts.wholeWord || opts.regex) flags += 'u';
    return new RegExp(src, flags);
  };

  // Upper-cases the first letter of every word; other letters become lower case.
  DL.titleCase = function (s) {
    var lower = s.toLowerCase();
    var out = '';
    var last = 0;
    var atStart = true;
    for (var i = 0; i < lower.length; i++) {
      var c = lower.charCodeAt(i);
      // Word separators: whitespace - / ( [ " '
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 45 || c === 47 || c === 40 || c === 91 || c === 34 || c === 39) {
        atStart = true;
        continue;
      }
      if (atStart) {
        atStart = false;
        var ch = lower.charAt(i);
        var up = ch.toUpperCase();
        if (up !== ch) {
          out += lower.slice(last, i) + up;
          last = i + 1;
        }
      }
    }
    return last === 0 ? lower : out + lower.slice(last);
  };

  DL.sentenceCase = function (s) {
    var lower = s.toLowerCase();
    return lower.replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, function (m) {
      return m.toUpperCase();
    });
  };

  /* ---------- Operation registry ---------- */

  DL.ops = [];
  DL.opsById = Object.create(null);

  /**
   * Registers an operation.
   * def = {
   *   id, name, category, icon, description,
   *   params: [ { key, label, type, help, default, options, required, showIf } ],
   *   outputColumns(inputColumns, params) -> string[]   (optional, for fast UI updates)
   *   apply(table, params, ctx) -> { table, notes: [] }
   * }
   */
  DL.registerOp = function (def) {
    if (!def.id) throw new Error('Operation needs an id');
    if (DL.opsById[def.id]) {
      DL.ops = DL.ops.filter(function (o) { return o.id !== def.id; });
    }
    def.params = def.params || [];
    def.category = def.category || 'Other';
    DL.ops.push(def);
    DL.opsById[def.id] = def;
    return def;
  };

  DL.getOp = function (id) {
    return DL.opsById[id] || null;
  };

  DL.defaultParams = function (opId) {
    var op = DL.getOp(opId);
    var out = {};
    if (!op) return out;
    op.params.forEach(function (p) {
      var d = p.default;
      if (typeof d === 'function') d = d();
      else if (Array.isArray(d)) d = d.slice();
      else if (d && typeof d === 'object') d = JSON.parse(JSON.stringify(d));
      out[p.key] = d === undefined ? (p.type === 'columns' || p.type === 'list' ? [] : '') : d;
    });
    return out;
  };

  // Returns a list of plain-language problems with the params, or [] if the step is ready to run.
  DL.validateParams = function (opId, params, inputColumns) {
    var op = DL.getOp(opId);
    if (!op) return ['Unknown operation "' + opId + '".'];
    var problems = [];
    var cols = inputColumns || [];
    op.params.forEach(function (p) {
      if (p.showIf && !p.showIf(params)) return;
      var v = params[p.key];
      if (p.type === 'column') {
        if (p.required !== false && (v == null || v === '')) problems.push('Choose a column for "' + p.label + '".');
        else if (v && cols.length && cols.indexOf(v) < 0) problems.push('Column "' + v + '" is not in the input. Choose another column for "' + p.label + '".');
      } else if (p.type === 'columns') {
        if (p.required !== false && (!v || !v.length)) problems.push('Choose at least one column for "' + p.label + '".');
        else if (v && cols.length) {
          v.forEach(function (c) {
            if (cols.indexOf(c) < 0) problems.push('Column "' + c + '" is not in the input.');
          });
        }
      } else if (p.type === 'text' || p.type === 'textarea') {
        if (p.required && (v == null || String(v).trim() === '')) problems.push('Fill in "' + p.label + '".');
      } else if (p.type === 'number') {
        if (p.required && (v === '' || v == null || isNaN(Number(v)))) problems.push('Enter a number for "' + p.label + '".');
        else if (v !== '' && v != null && !isNaN(Number(v))) {
          if (p.min != null && Number(v) < p.min) problems.push('"' + p.label + '" must be at least ' + p.min + '.');
          if (p.max != null && Number(v) > p.max) problems.push('"' + p.label + '" must be at most ' + p.max + '.');
        }
      }
    });
    if (op.validate) {
      var extra = op.validate(params, cols);
      if (extra && extra.length) problems = problems.concat(extra);
    }
    return problems;
  };

  // Predicts output columns without running the operation. Falls back to input columns.
  DL.predictColumns = function (opId, params, inputColumns) {
    var op = DL.getOp(opId);
    if (!op) return inputColumns.slice();
    if (op.outputColumns) {
      try {
        var out = op.outputColumns(inputColumns.slice(), params);
        if (out) return out;
      } catch (e) { /* fall through */ }
    }
    return inputColumns.slice();
  };

  // Runs one operation. Always returns { table, notes }.
  DL.runOp = function (opId, params, table, ctx) {
    var op = DL.getOp(opId);
    if (!op) throw new Error('Unknown operation "' + opId + '".');
    var result = op.apply(table, params, ctx || {});
    if (!result) throw new Error('Operation "' + op.name + '" returned nothing.');
    if (!result.table) result = { table: result, notes: [] };
    result.notes = result.notes || [];
    return result;
  };

  DL.pluralize = function (n, one, many) {
    return n === 1 ? n + ' ' + one : n + ' ' + (many || one + 's');
  };
})(typeof self !== 'undefined' ? self : this);
