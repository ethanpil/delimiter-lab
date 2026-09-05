/* Delimiter Lab - engine core.
 * The main thread loads this file for metadata. The worker loads it to process data.
 * A table is a plain object: { columns: string[], cols: Column[], length: number }.
 * Cells are always strings. Operations never change the tables they receive.
 */
(function (root) {
  'use strict';
  var DL = root.DL || (root.DL = {});

  /* ---------- Table helpers ----------
   * A Column is a plain array of strings with one value per row, or a lazy column
   * { src: string[], idx: Uint32Array } that reads row i as src[idx[i]].
   * Row operations (filter, sort, dedupe) only make index arrays. They do not copy text.
   * DL.col(table, c) gives a plain array. It makes the array once and keeps it.
   */

  DL.makeTable = function (columns, cols, length) {
    return { columns: columns, cols: cols, length: length };
  };

  // Gives column c as a plain array. Makes it from a lazy column when necessary.
  DL.col = function (table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return col;
    var src = col.src, idx = col.idx;
    var n = idx.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = src[idx[i]];
    table.cols[c] = out; // same content, faster next time
    return out;
  };

  // Gives a function(rowIndex) -> value for column c. Does not make a plain array.
  DL.cellGetter = function (table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return function (i) { return col[i]; };
    var src = col.src, idx = col.idx;
    return function (i) { return src[idx[i]]; };
  };

  // Makes a table from row arrays.
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

  // Gives row i as an array of values.
  DL.rowAt = function (table, i) {
    var w = table.cols.length;
    var r = new Array(w);
    for (var c = 0; c < w; c++) {
      var col = table.cols[c];
      r[c] = Array.isArray(col) ? col[i] : col.src[col.idx[i]];
    }
    return r;
  };

  // Gives rows start..end (end not included) as arrays.
  DL.rowsSlice = function (table, start, end) {
    var out = [];
    for (var i = start; i < end; i++) out.push(DL.rowAt(table, i));
    return out;
  };

  DL.colIndex = function (table, name) {
    return table.columns.indexOf(name);
  };

  // Gives the index of a column. Stops with a clear message when the column does not exist.
  DL.requireCol = function (table, name) {
    var idx = table.columns.indexOf(name);
    if (idx < 0) throw new Error('Column "' + name + '" was not found.');
    return idx;
  };

  // Gives the indexes of the named columns. Names that do not exist are skipped.
  DL.colIndexes = function (table, names) {
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var idx = table.columns.indexOf(names[i]);
      if (idx >= 0) out.push(idx);
    }
    return out;
  };

  // Gives the indexes of the named columns, or of all columns when the list is empty.
  DL.colIndexesOrAll = function (table, names) {
    if (names && names.length) return DL.colIndexes(table, names);
    return DL.allIndexes(table);
  };

  DL.allIndexes = function (table) {
    var out = new Array(table.columns.length);
    for (var i = 0; i < out.length; i++) out[i] = i;
    return out;
  };

  // The largest number of different values for which the result is kept per column.
  var MEMO_LIMIT = 50000;

  // New table with the columns at idxs replaced by fn(value, ctx).
  // fn must use the value only. The result for each different value is kept and used again.
  // fn can call ctx.tag() to count a cell. The total goes to stats.tagged when stats is given.
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
          if (cache.size > MEMO_LIMIT) cache = null; // too many different values
        }
      }
      cols[c] = out;
    }
    if (stats) stats.tagged = tagged;
    return DL.makeTable(table.columns, cols, n);
  };

  var WS_RE = /\s/;

  // True when toLowerCase() changes the text.
  DL.hasUpper = function (s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if ((c >= 65 && c <= 90) || c > 127) return true;
    }
    return false;
  };

  // True when trim() changes the text.
  DL.hasEdgeSpace = function (s) {
    if (s.length === 0) return false;
    var a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1);
    if (a > 32 && a < 127 && b > 32 && b < 127) return false;
    return WS_RE.test(s.charAt(0)) || WS_RE.test(s.charAt(s.length - 1));
  };

  // Trims and lower-cases a value. Makes a new string only when the text changes.
  DL.normalizeKey = function (v, trim, ignoreCase) {
    if (trim && DL.hasEdgeSpace(v)) v = v.trim();
    if (ignoreCase && DL.hasUpper(v)) v = v.toLowerCase();
    return v;
  };

  // New table with one more column. position: 'end' (default) or 'start'.
  DL.addColumn = function (table, name, values, position) {
    var columns = table.columns.slice();
    var cols = table.cols.slice();
    if (position === 'start') { columns.unshift(name); cols.unshift(values); }
    else { columns.push(name); cols.push(values); }
    return DL.makeTable(columns, cols, table.length);
  };

  // New table with only the columns at the given indexes, in that order.
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

  // New table with only the rows at the given indexes, in that order.
  // Makes index arrays only. The text stays shared with the input table.
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

  /* ---------- Grouping ---------- */

  // Groups rows that have the same key. getters is a list of functions(rowIndex) -> text,
  // one per key column. Gives { first: Int32Array (row -> first row with the same key),
  // count: Int32Array (first row -> group size), groups }.
  // Uses a typed-array hash table. This stays fast on millions of rows.
  DL.groupRows = function (getters, n) {
    var cap = 1024;
    while (cap < n * 2) cap *= 2;
    var mask = cap - 1;
    var slots = new Int32Array(cap).fill(-1);
    var hashes = new Int32Array(n);
    var first = new Int32Array(n);
    var count = new Int32Array(n);
    var groups = 0;
    var g = getters.length;
    for (var i = 0; i < n; i++) {
      // FNV-1a over the UTF-16 code units of every key column, with a separator between columns.
      var h = 2166136261 | 0;
      for (var c = 0; c < g; c++) {
        var k = getters[c](i);
        for (var j = 0; j < k.length; j++) {
          h ^= k.charCodeAt(j);
          h = Math.imul(h, 16777619);
        }
        h ^= 0xFF;
        h = Math.imul(h, 16777619);
      }
      hashes[i] = h;
      var pos = h & mask;
      for (;;) {
        var s = slots[pos];
        if (s === -1) { slots[pos] = i; first[i] = i; count[i] = 1; groups++; break; }
        if (hashes[s] === h && sameKey(getters, s, i)) { first[i] = s; count[s]++; break; }
        pos = (pos + 1) & mask;
      }
    }
    return { first: first, count: count, groups: groups };
  };

  function sameKey(getters, a, b) {
    for (var c = 0; c < getters.length; c++) if (getters[c](a) !== getters[c](b)) return false;
    return true;
  }

  /* ---------- Names ---------- */

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

  // Cleans a name typed by the user. Gives fallback when the name is blank.
  DL.cleanName = function (name, fallback) {
    var s = name == null ? '' : String(name).trim();
    return s === '' ? fallback : s;
  };

  // Makes sure that all headers are not empty and are unique.
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

  // Makes a number from text. Accepts "1,234.56", "1.234,56", "$1,000", "(12)", "12%".
  // Gives NaN when the text is not a number.
  DL.toNumber = function (v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = typeof v === 'string' ? v : String(v);
    if (s === '') return NaN;
    if (isPlainNumber(s)) return +s;
    s = s.trim();
    if (s === '') return NaN;
    if (isPlainNumber(s)) return +s;
    var neg = false;
    if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
      neg = true;
      s = s.slice(1, -1).trim();
    }
    // Remove currency symbols, spaces and percent signs.
    s = s.replace(/[\s '$€£¥₹%]/g, '');
    if (s === '' || !numRe.test(s)) return NaN;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
      else s = s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      var commas = s.split(',').length - 1;
      var after = s.length - lastComma - 1;
      // One comma with exactly 3 digits after it is a thousands separator ("1,234").
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

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  // Makes a local timestamp from date parts. Gives NaN when the parts are not a real date.
  function makeDate(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return NaN;
    var date = new Date(2000, mo - 1, d, h, mi, s);
    date.setFullYear(y); // years 0-99 must not become 1900-1999
    return date.getTime();
  }

  // Parses common date formats. Gives a timestamp (ms) or NaN.
  // dayFirst: read "01/02/2024" as 1 February (true) or 2 January (false).
  DL.toDate = function (v, dayFirst) {
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === '') return NaN;
    var m = isoRe.exec(s);
    if (m) {
      if (m[8]) return Date.parse(s);
      return makeDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
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
      return makeDate(y, mo, d, h, +(m[5] || 0), +(m[6] || 0));
    }
    // Let the browser parse "March 5, 2024" and similar.
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

  /* ---------- Number formatting ---------- */

  var POW10 = [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

  // Rounds half away from zero, so 2.5 -> 3 and -2.5 -> -3.
  DL.formatFixed = function (v, dec) {
    var m = POW10[dec];
    var abs = Math.round((Math.abs(v) + Number.EPSILON) * m) / m;
    var s = abs.toFixed(dec);
    return v < 0 && abs !== 0 ? '-' + s : s;
  };

  // Makes text from a number without floating point noise such as 0.30000000000000004.
  DL.numberText = function (v) {
    if (v !== v || v === Infinity || v === -Infinity) return '';
    if (v % 1 === 0) return String(v);
    var s = String(v);
    return s.length > 16 && Math.abs(v) < 1e15 ? String(Number(v.toPrecision(15))) : s;
  };

  DL.formatNumber = function (n, dec, thousands, decimalSep, prefix, suffix, parens) {
    var s = DL.formatFixed(Math.abs(n), dec);
    var neg = n < 0 && s !== DL.formatFixed(0, dec);
    var intLen = dec ? s.length - dec - 1 : s.length;
    var int = intLen === s.length ? s : s.slice(0, intLen);
    if (thousands && intLen > 3) {
      var first = intLen % 3 || 3;
      var grouped = int.slice(0, first);
      for (var i = first; i < intLen; i += 3) grouped += thousands + int.slice(i, i + 3);
      int = grouped;
    }
    var out = dec ? int + (decimalSep || '.') + s.slice(intLen + 1) : int;
    if (prefix) out = prefix + out;
    if (suffix) out = out + suffix;
    if (neg) out = parens ? '(' + out + ')' : '-' + out;
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

  // Upper-cases the first letter of each word. Other letters become lower case.
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

  // Makes real characters from "\t" and "\n" typed by the user.
  DL.unescapeText = function (s) {
    if (s == null) return '';
    return String(s).replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  };

  DL.pluralize = function (n, one, many) {
    return n === 1 ? n + ' ' + one : n + ' ' + (many || one + 's');
  };

  DL.rowsAndColumns = function (rows, columns) {
    return DL.pluralize(rows, 'row') + ' · ' + DL.pluralize(columns, 'column');
  };

  /* ---------- Rule lists (shared by Filter, Verify and Sort) ---------- */

  DL.findOption = function (list, value) {
    for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i];
    return null;
  };

  DL.columnMissing = function (name) {
    return 'Column "' + name + '" is not in the input.';
  };

  // Checks a list of rules { column, op, value, value2 } against an operator list with "needs".
  // cols === null means that the input columns are not known yet: column names are not checked.
  DL.validateRuleList = function (rules, cols, operators, what) {
    var out = [];
    if (!rules || !rules.length) return ['Add at least one ' + what + '.'];
    rules.forEach(function (r, i) {
      var label = what.charAt(0).toUpperCase() + what.slice(1) + ' ' + (i + 1);
      if (!r.column) out.push(label + ': choose a column.');
      else if (cols && cols.indexOf(r.column) < 0) out.push(label + ': ' + DL.columnMissing(r.column));
      if (!operators) return;
      var def = DL.findOption(operators, r.op);
      if (!def) { out.push(label + ': choose a test.'); return; }
      if (def.needs === 'text' && (r.value == null || r.value === '')) out.push(label + ': enter a value.');
      if (def.needs === 'number' && isNaN(DL.toNumber(r.value))) out.push(label + ': enter a number.');
      if (def.needs === 'range' && (isNaN(DL.toNumber(r.value)) || isNaN(DL.toNumber(r.value2)))) out.push(label + ': enter two numbers.');
      if (def.needs === 'date' && isNaN(DL.toDate(r.value))) out.push(label + ': enter a date such as 2024-01-31.');
      if (r.op === 'regex') { try { new RegExp(r.value, 'u'); } catch (e) { out.push(label + ': the regular expression is not valid.'); } }
    });
    return out;
  };

  /* ---------- Parameter types ----------
   * Each form field type knows its empty value, how to check a value, how to correct a value
   * that has the wrong shape, and which input columns it refers to.
   * A field definition (param) is { key, label, type, help, default, options, required, showIf, ... }.
   */

  DL.paramTypes = Object.create(null);

  DL.registerParamType = function (name, def) {
    DL.paramTypes[name] = {
      empty: def.empty || function () { return ''; },
      coerce: def.coerce || function (v, p) { return v == null ? this.empty(p) : v; },
      validate: def.validate || function () { return []; },
      columnsUsed: def.columnsUsed || function () { return []; },
      init: def.init || null
    };
  };

  function isText(v) { return typeof v === 'string' || typeof v === 'number'; }
  function textOf(v, p) { return isText(v) ? String(v) : (p && p.default != null && isText(p.default) ? String(p.default) : ''); }

  var textType = {
    empty: function (p) { return p && p.default != null ? String(p.default) : ''; },
    coerce: function (v, p) { return textOf(v, p); },
    validate: function (v, p) {
      var s = v == null ? '' : String(v);
      if (p.required && s === '') return ['Fill in "' + p.label + '".'];
      if (p.notBlank && s.trim() === '') return ['Fill in "' + p.label + '".'];
      return [];
    }
  };
  DL.registerParamType('text', textType);
  DL.registerParamType('code', textType);

  DL.registerParamType('number', {
    empty: function (p) { return p && p.default != null ? p.default : ''; },
    coerce: function (v, p) {
      if (v === '' || v == null) return p.required ? this.empty(p) : '';
      return isNaN(Number(v)) ? this.empty(p) : v;
    },
    validate: function (v, p) {
      if (v === '' || v == null) return p.required ? ['Enter a number for "' + p.label + '".'] : [];
      var n = Number(v);
      if (isNaN(n)) return ['Enter a number for "' + p.label + '".'];
      var out = [];
      if (p.min != null && n < p.min) out.push('"' + p.label + '" must be at least ' + p.min + '.');
      if (p.max != null && n > p.max) out.push('"' + p.label + '" must be at most ' + p.max + '.');
      return out;
    }
  });

  DL.registerParamType('boolean', {
    empty: function (p) { return !!(p && p.default); },
    coerce: function (v, p) { return typeof v === 'boolean' ? v : this.empty(p); }
  });

  DL.registerParamType('select', {
    empty: function (p) { return p && p.default != null ? p.default : (p && p.options && p.options.length ? p.options[0].value : ''); },
    coerce: function (v, p) {
      return p.options && DL.findOption(p.options, v) ? v : this.empty(p);
    }
  });

  DL.registerParamType('checkboxes', {
    empty: function (p) { return p && Array.isArray(p.default) ? p.default.slice() : []; },
    coerce: function (v, p) {
      if (!Array.isArray(v)) return this.empty(p);
      return v.filter(function (x) { return p.options && DL.findOption(p.options, x); });
    }
  });

  DL.registerParamType('column', {
    empty: function () { return ''; },
    coerce: function (v) { return isText(v) ? String(v) : ''; },
    validate: function (v, p, cols) {
      if (!v) return p.required !== false ? ['Choose a column for "' + p.label + '".'] : [];
      if (cols && cols.indexOf(v) < 0) return [DL.columnMissing(v) + ' Choose another column for "' + p.label + '".'];
      return [];
    },
    columnsUsed: function (v) { return v ? [v] : []; }
  });

  var columnsType = {
    empty: function () { return []; },
    coerce: function (v) { return Array.isArray(v) ? v.filter(isText).map(String) : []; },
    validate: function (v, p, cols) {
      if (!v.length) return p.required !== false ? ['Choose at least one column for "' + p.label + '".'] : [];
      if (!cols) return [];
      return v.filter(function (c) { return cols.indexOf(c) < 0; }).map(DL.columnMissing);
    },
    columnsUsed: function (v) { return v.slice(); }
  };
  DL.registerParamType('columns', columnsType);

  DL.registerParamType('columnOrder', {
    empty: function () { return []; },
    coerce: columnsType.coerce,
    validate: function (v) { return v.length ? [] : ['Arrange the columns.']; },
    columnsUsed: function (v) { return v.slice(); },
    init: function (columns) { return columns.slice(); }
  });

  DL.registerParamType('renameMap', {
    empty: function () { return {}; },
    coerce: function (v) {
      var out = {};
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (k) { if (isText(v[k])) out[k] = String(v[k]); });
      }
      return out;
    },
    columnsUsed: function (v) { return Object.keys(v); }
  });

  DL.registerParamType('mapping', {
    empty: function () { return [{ from: '', to: '' }]; },
    coerce: function (v) {
      if (!Array.isArray(v)) return this.empty();
      var out = v.filter(function (m) { return m && typeof m === 'object'; })
        .map(function (m) { return { from: textOf(m.from), to: textOf(m.to) }; });
      return out.length ? out : this.empty();
    },
    validate: function (v) {
      return v.some(function (m) { return m.from !== ''; }) ? [] : ['Add at least one value to the lookup list.'];
    }
  });

  function ruleListType(what, operatorsName, blank) {
    return {
      empty: function () { return [blank()]; },
      coerce: function (v) {
        if (!Array.isArray(v)) return this.empty();
        var out = v.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
          var b = blank();
          Object.keys(b).forEach(function (k) {
            if (typeof b[k] === 'boolean') b[k] = typeof r[k] === 'boolean' ? r[k] : b[k];
            else if (isText(r[k])) b[k] = String(r[k]);
          });
          if (r.value2 !== undefined) b.value2 = textOf(r.value2);
          return b;
        });
        return out.length ? out : this.empty();
      },
      validate: function (v, p, cols) { return DL.validateRuleList(v, cols, operatorsName ? DL[operatorsName] : null, what); },
      columnsUsed: function (v) { return v.map(function (r) { return r.column; }).filter(Boolean); }
    };
  }
  DL.registerParamType('conditions', ruleListType('rule', 'FILTER_OPERATORS', function () { return { column: '', op: 'contains', value: '', value2: '' }; }));
  DL.registerParamType('rules', ruleListType('rule', 'VERIFY_RULES', function () { return { column: '', op: 'notEmpty', value: '', allowEmpty: true }; }));
  DL.registerParamType('sortKeys', ruleListType('sort key', null, function () { return { column: '', type: 'auto', dir: 'asc' }; }));

  /* ---------- Operation registry ---------- */

  DL.ops = [];
  DL.opsById = Object.create(null);

  /**
   * Registers an operation.
   * def = {
   *   id, name, category, icon, description, keywords,
   *   params: [ field definitions ],
   *   outputColumns(inputColumns, params) -> string[] | null   (null = not known before the step runs),
   *   validate(params, cols) -> string[]                        (optional cross-field checks),
   *   apply(table, params) -> { table, notes, status }
   * }
   */
  DL.registerOp = function (def) {
    if (!def.id || DL.opsById[def.id]) throw new Error('Operation id "' + def.id + '" is missing or used twice.');
    def.params = def.params || [];
    def.params.forEach(function (p) {
      if (!DL.paramTypes[p.type]) throw new Error('Operation "' + def.id + '" uses unknown field type "' + p.type + '".');
    });
    def.category = def.category || 'Other';
    DL.ops.push(def);
    DL.opsById[def.id] = def;
    return def;
  };

  DL.getOp = function (id) {
    return DL.opsById[id] || null;
  };

  function copyValue(d) {
    if (Array.isArray(d)) return d.map(copyValue);
    if (d && typeof d === 'object') return JSON.parse(JSON.stringify(d));
    return d;
  }

  DL.defaultParams = function (opId) {
    var op = DL.getOp(opId);
    var out = {};
    if (!op) return out;
    op.params.forEach(function (p) {
      var type = DL.paramTypes[p.type];
      out[p.key] = p.default !== undefined ? copyValue(p.default) : type.empty(p);
    });
    return out;
  };

  // Makes params complete and gives every value the correct shape. Unknown keys are dropped.
  DL.cleanParams = function (opId, params) {
    var op = DL.getOp(opId);
    var out = {};
    if (!op) return out;
    params = params && typeof params === 'object' ? params : {};
    op.params.forEach(function (p) {
      var type = DL.paramTypes[p.type];
      out[p.key] = params[p.key] === undefined ? (p.default !== undefined ? copyValue(p.default) : type.empty(p)) : type.coerce(copyValue(params[p.key]), p);
    });
    return out;
  };

  // Fills in values that depend on the input columns (for example the column order).
  DL.initParams = function (opId, params, columns) {
    var op = DL.getOp(opId);
    if (!op || !columns) return params;
    op.params.forEach(function (p) {
      var type = DL.paramTypes[p.type];
      var v = params[p.key];
      if (type.init && (v == null || (Array.isArray(v) && !v.length))) params[p.key] = type.init(columns, p);
    });
    return params;
  };

  // Gives a list of plain-language problems, or [] when the step can run.
  // inputColumns === null means that the columns are not known: only the settings are checked.
  DL.validateParams = function (opId, params, inputColumns) {
    var op = DL.getOp(opId);
    if (!op) return ['Unknown operation "' + opId + '".'];
    var problems = [];
    var cols = inputColumns || null;
    op.params.forEach(function (p) {
      if (p.showIf && !p.showIf(params)) return;
      var type = DL.paramTypes[p.type];
      var found = type.validate(params[p.key], p, cols);
      if (found.length) problems = problems.concat(found);
    });
    if (op.validate) {
      var extra = op.validate(params, cols || []);
      if (extra && extra.length) problems = problems.concat(extra);
    }
    return problems;
  };

  // Gives the input column names that a step refers to.
  DL.columnsUsedByStep = function (opId, params) {
    var op = DL.getOp(opId);
    var out = [];
    if (!op) return out;
    op.params.forEach(function (p) {
      if (p.showIf && !p.showIf(params)) return;
      DL.paramTypes[p.type].columnsUsed(params[p.key], p).forEach(function (c) {
        if (c && out.indexOf(c) < 0) out.push(c);
      });
    });
    return out;
  };

  // Predicts the output columns without running the operation.
  // Gives null when the columns are only known after the step runs.
  DL.predictColumns = function (opId, params, inputColumns) {
    var op = DL.getOp(opId);
    if (!op || inputColumns == null) return null;
    if (!op.outputColumns) return inputColumns.slice();
    return op.outputColumns(inputColumns.slice(), params);
  };

  // Runs one operation. Gives { table, notes, status }.
  DL.runOp = function (opId, params, table) {
    var op = DL.getOp(opId);
    if (!op) throw new Error('Unknown operation "' + opId + '".');
    var result = op.apply(table, params);
    result.notes = result.notes || [];
    result.status = result.status || 'ok';
    return result;
  };

  /* ---------- Step results ---------- */

  // Every status a step result can have. hasTable: the step gives data that can be shown.
  DL.RESULT_STATUS = {
    ok: { hasTable: true, label: 'Done' },
    warning: { hasTable: true, label: 'Done with warnings' },
    skipped: { hasTable: true, label: 'Turned off' },
    invalid: { hasTable: false, label: 'Needs setup' },
    blocked: { hasTable: false, label: 'Waiting' },
    error: { hasTable: false, label: 'Error' }
  };

  DL.resultHasTable = function (result) {
    return !!(result && DL.RESULT_STATUS[result.status] && DL.RESULT_STATUS[result.status].hasTable);
  };

  /* ---------- Input and output formats ---------- */

  DL.SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'];
  DL.DELIMITED_EXTENSIONS = ['csv', 'tsv', 'txt', 'tab', 'dat', 'psv'];

  DL.fileExtension = function (name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  };

  DL.isSpreadsheet = function (name) {
    return DL.SPREADSHEET_EXTENSIONS.indexOf(DL.fileExtension(name)) >= 0;
  };

  var headerOption = { key: 'headers', label: 'First row holds the column names', type: 'boolean', default: true, reload: 'now', help: 'Turn this off if the first row is data. Columns are then named "Column 1", "Column 2", …' };
  var skipRowsOption = { key: 'skipRows', label: 'Skip rows at the top', type: 'number', default: 0, min: 0, max: 100000, help: 'Use this when the file starts with notes or a title before the real header row.' };

  // Input formats. The worker registers a reader for each id. options are field definitions.
  DL.inputFormats = [
    {
      id: 'delimited',
      label: 'Delimited text (CSV, TSV, …)',
      extensions: DL.DELIMITED_EXTENSIONS,
      options: [
        headerOption,
        skipRowsOption,
        { key: 'delimiter', label: 'Column separator', type: 'select', default: 'auto', reload: 'now', help: 'The character between values. It is detected automatically in most files.',
          options: [{ value: 'auto', label: 'Detect automatically' }, { value: ',', label: 'Comma ( , )' }, { value: '\\t', label: 'Tab' }, { value: ';', label: 'Semicolon ( ; )' }, { value: '|', label: 'Pipe ( | )' }, { value: 'custom', label: 'Other…' }] },
        { key: 'customDelimiter', label: 'Other separator', type: 'text', default: '', showIf: function (o) { return o.delimiter === 'custom'; } },
        { key: 'quoteChar', label: 'Text delimiter', type: 'select', default: '"', reload: 'now', help: 'The character around values that contain the separator, for example "Doe, Jane".',
          options: [{ value: '"', label: 'Double quote ( " )' }, { value: "'", label: "Single quote ( ' )" }, { value: 'none', label: 'None' }] },
        { key: 'encoding', label: 'File encoding', type: 'select', default: 'auto', reload: 'now', help: 'Change this if accented letters look wrong (for example Ã© instead of é).',
          options: [{ value: 'auto', label: 'Detect automatically' }, { value: 'utf-8', label: 'UTF-8' }, { value: 'windows-1252', label: 'Windows-1252 (Western Europe)' }, { value: 'iso-8859-1', label: 'ISO-8859-1 (Latin 1)' }, { value: 'utf-16le', label: 'UTF-16' }, { value: 'macintosh', label: 'Mac Roman' }, { value: 'windows-1251', label: 'Windows-1251 (Cyrillic)' }, { value: 'shift_jis', label: 'Shift JIS (Japanese)' }, { value: 'gbk', label: 'GBK (Chinese)' }] },
        { key: 'skipEmptyLines', label: 'Skip empty lines', type: 'boolean', default: true, reload: 'now' }
      ]
    },
    {
      id: 'spreadsheet',
      label: 'Excel workbook',
      extensions: DL.SPREADSHEET_EXTENSIONS,
      hasSheets: true,
      options: [
        headerOption,
        skipRowsOption,
        { key: 'skipEmptyLines', label: 'Skip empty rows', type: 'boolean', default: true, reload: 'now' }
      ]
    }
  ];

  DL.inputFormatFor = function (fileName) {
    var ext = DL.fileExtension(fileName);
    for (var i = 0; i < DL.inputFormats.length; i++) {
      if (DL.inputFormats[i].extensions.indexOf(ext) >= 0) return DL.inputFormats[i];
    }
    return DL.inputFormats[0];
  };

  DL.acceptedExtensions = function () {
    var out = [];
    DL.inputFormats.forEach(function (f) { f.extensions.forEach(function (e) { out.push('.' + e); }); });
    return out;
  };

  DL.defaultSourceOptions = function () {
    var out = {};
    DL.inputFormats.forEach(function (f) {
      f.options.forEach(function (p) { if (!(p.key in out)) out[p.key] = p.default; });
    });
    out.sheet = '';
    return out;
  };

  // Output formats. The worker registers a writer for each id.
  var textOutputOptions = [
    { key: 'quoteAll', label: 'Put quotes around every value', type: 'boolean', default: false },
    { key: 'header', label: 'Include the header row', type: 'boolean', default: true },
    { key: 'bom', label: 'Add a byte order mark (helps Excel show accents correctly)', type: 'boolean', default: true },
    { key: 'newline', label: 'Line endings', type: 'select', default: 'crlf', options: [{ value: 'crlf', label: 'Windows (CRLF)' }, { value: 'lf', label: 'Unix / Mac (LF)' }] }
  ];
  DL.outputFormats = [
    { id: 'csv', label: 'CSV (comma separated)', extension: '.csv', mime: 'text/csv;charset=utf-8', options: textOutputOptions },
    { id: 'tsv', label: 'TSV (tab separated)', extension: '.tsv', mime: 'text/tab-separated-values;charset=utf-8', options: textOutputOptions },
    { id: 'delimited', label: 'Text with another separator', extension: '.txt', mime: 'text/plain;charset=utf-8',
      options: [{ key: 'delimiter', label: 'Separator', type: 'text', default: ';', required: true, help: 'Use \\t for a tab.' }].concat(textOutputOptions) },
    { id: 'xlsx', label: 'Excel workbook (.xlsx)', extension: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      options: [{ key: 'header', label: 'Include the header row', type: 'boolean', default: true }, { key: 'sheetName', label: 'Sheet name', type: 'text', default: 'Data' }] },
    { id: 'json', label: 'JSON', extension: '.json', mime: 'application/json',
      options: [{ key: 'pretty', label: 'Indent the JSON (easier to read, larger file)', type: 'boolean', default: false }] }
  ];

  DL.outputFormatById = function (id) {
    for (var i = 0; i < DL.outputFormats.length; i++) if (DL.outputFormats[i].id === id) return DL.outputFormats[i];
    return null;
  };

  // Default values for the options of a format (input or output).
  DL.defaultFormatOptions = function (format) {
    var out = {};
    format.options.forEach(function (p) { out[p.key] = p.default !== undefined ? copyValue(p.default) : DL.paramTypes[p.type].empty(p); });
    return out;
  };
})(typeof self !== 'undefined' ? self : this);
