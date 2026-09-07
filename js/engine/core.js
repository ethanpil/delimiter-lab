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
    table.cols[c] = out; // the same content; the next read is quick
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

  // The largest number of cells that one table can have. The worker sets it from the memory of the computer.
  DL.maxCells = 8e6;

  // New table with the columns at idxs replaced by fn(value, ctx).
  // fn must use the value only. The result for each different value is kept and used again.
  // fn can call ctx.tag() to count a cell. The total goes to stats.tagged when stats is given.
  DL.mapColumns = function (table, idxs, fn, stats) {
    var cols = table.cols.slice();
    var n = table.length;
    var tagged = 0;
    for (var k = 0; k < idxs.length; k++) {
      var c = idxs[k];
      var one = {};
      cols[c] = DL.mapValues(DL.col(table, c), n, fn, one);
      tagged += one.tagged;
    }
    if (stats) stats.tagged = tagged;
    return DL.makeTable(table.columns, cols, n);
  };

  // Maps one array of values with fn(value, ctx). The function keeps the result of each different
  // value and uses it again, so fn must depend on the value only. stats.tagged counts the cells where fn called ctx.tag().
  DL.mapValues = function (src, n, fn, stats) {
    var out = new Array(n);
    var tagged = 0;
    var ctx = { tagged: false, tag: function () { this.tagged = true; } };
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
        if (cache.size > MEMO_LIMIT) cache = null; // The cache stops when there are too many different values.
      }
    }
    if (stats) stats.tagged = tagged;
    return out;
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
    var out = DL.makeTable(table.columns, cols, n);
    out.rowMap = idx; // output row -> row of the input table, for the Changes view
    return out;
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

  // Makes the name of a new column: the wanted name, or the fallback when it is empty, made unique.
  DL.newColumnName = function (columns, wanted, fallback) {
    return DL.uniqueName(columns, DL.cleanName(wanted, fallback));
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
    var n;
    if (isPlainNumber(s)) { n = +s; return isFinite(n) ? n : NaN; }
    s = s.trim();
    if (s === '') return NaN;
    if (isPlainNumber(s)) { n = +s; return isFinite(n) ? n : NaN; }
    var neg = false;
    if (s.charAt(0) === '(' && s.charAt(s.length - 1) === ')') {
      neg = true;
      s = s.slice(1, -1).trim();
      if (s.charAt(0) === '-' || s.charAt(0) === '+') return NaN; // "(-5)" is not a number
    }
    // Remove currency symbols, spaces and percent signs.
    s = s.replace(/[\s '$€£¥₹%]/g, '');
    if (s === '' || !numRe.test(s)) return NaN;
    var lastComma = s.lastIndexOf(',');
    var lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) {
        if (!groupsOf3(s.slice(0, lastComma), '.')) return NaN; // 1.234,56
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        if (!groupsOf3(s.slice(0, lastDot), ',')) return NaN; // 1,234.56
        s = s.replace(/,/g, '');
      }
    } else if (lastComma >= 0) {
      var commas = s.split(',').length - 1;
      var after = s.length - lastComma - 1;
      // One comma with exactly 3 digits after it is a thousands separator ("1,234").
      // Other single commas are decimal separators ("1,5"). Many commas must all separate groups of 3.
      if (commas === 1 && after !== 3) s = s.replace(',', '.');
      else if (groupsOf3(s, ',')) s = s.replace(/,/g, '');
      else return NaN;
    } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
      if (!groupsOf3(s, '.')) return NaN; // 1.234.567
      s = s.replace(/\./g, '');
    }
    n = Number(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  };

  // True when every separator in the text sits before a group of exactly three digits ("1,234,567").
  function groupsOf3(s, sep) {
    var parts = s.replace(/^[+-]/, '').split(sep);
    if (parts.length < 2 || parts[0].length === 0 || parts[0].length > 3) return false;
    for (var i = 1; i < parts.length; i++) if (!/^\d{3}$/.test(parts[i])) return false;
    return true;
  }

  var isoRe = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
  var compactRe = /^((?:19|20)\d{2})(\d{2})(\d{2})$/; // 20240131; other 8-digit values are identifiers
  var slashRe = /^(\d{1,4})([\/.\-])(\d{1,2})\2(\d{1,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;

  var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function daysInMonth(y, m) {
    if (m === 2 && ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0)) return 29;
    return DAYS[m - 1];
  }

  // Makes a local timestamp from date parts. Gives NaN when the parts are not a real date.
  function makeDate(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return NaN;
    var date = new Date(y, mo - 1, d, h, mi, s);
    if (y < 100) date.setFullYear(y); // years 0-99 must not become 1900-1999
    return date.getTime();
  }

  // Makes a timestamp from date parts and a zone such as "Z", "+01:00" or "-0500".
  function makeZonedDate(y, mo, d, h, mi, s, ms, zone) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return NaN;
    var t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    if (zone !== 'Z') {
      var sign = zone.charAt(0) === '-' ? -1 : 1;
      var zh = +zone.slice(1, 3), zm = +zone.slice(-2);
      t -= sign * (zh * 60 + zm) * 60000;
    }
    return t;
  }

  var MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?/i;
  var YEAR_RE = /\b\d{4}\b/;

  // Parses common date formats. Gives a timestamp (ms) or NaN.
  // dayFirst: read "01/02/2024" as 1 February (true) or 2 January (false).
  DL.toDate = function (v, dayFirst) {
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === '') return NaN;
    var m = isoRe.exec(s);
    if (m) {
      if (m[8]) return makeZonedDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || '0') + '00').slice(0, 3), m[8]);
      return makeDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    m = compactRe.exec(s);
    if (m) return makeDate(+m[1], +m[2], +m[3], 0, 0, 0);
    m = slashRe.exec(s);
    if (m) {
      var a = +m[1], b = +m[3], c = +m[4];
      var y, mo, d;
      if (m[1].length === 4) {
        y = a; mo = b; d = c;
      } else {
        // A version such as "1.5.3" is not a date: with "." or "-" the year needs four digits.
        if (m[4].length <= 2) {
          if (m[2] !== '/') return NaN;
          c = c + (c < 70 ? 2000 : 1900);
        }
        y = c;
        if (dayFirst || a > 12) { d = a; mo = b; } else { mo = a; d = b; }
      }
      var h = +(m[5] || 0);
      var ampm = m[8];
      if (ampm) {
        if (h > 12) return NaN;
        var pm = ampm.toLowerCase() === 'pm';
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      return makeDate(y, mo, d, h, +(m[6] || 0), +(m[7] || 0));
    }
    // Let the browser parse "March 5, 2024" and similar. A month name and a four-digit year are
    // required, because the browser also accepts text such as "Room 12" or "5 March" as a date.
    if (!MONTH_RE.test(s) || !YEAR_RE.test(s)) return NaN;
    var t = Date.parse(s);
    if (isNaN(t)) return NaN;
    var year = new Date(t).getFullYear();
    return year >= 1000 && year <= 9999 ? t : NaN;
  };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  DL.formatDateISO = function (ts) {
    var d = new Date(ts);
    var pad = pad2;
    var out = ('000' + d.getFullYear()).slice(-4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (d.getHours() || d.getMinutes() || d.getSeconds()) {
      out += ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    return out;
  };

  DL.MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  DL.DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var TOKEN_RE = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|HH|H|mm|ss|A|a/g;

  // One function per token. Each function reads a Date object.
  var TOKENS = {
    YYYY: function (d) { return ('000' + d.getFullYear()).slice(-4); },
    YY: function (d) { return pad2(d.getFullYear() % 100); },
    MMMM: function (d) { return DL.MONTH_NAMES[d.getMonth()]; },
    MMM: function (d) { return DL.MONTH_NAMES[d.getMonth()].slice(0, 3); },
    MM: function (d) { return pad2(d.getMonth() + 1); },
    M: function (d) { return String(d.getMonth() + 1); },
    DDDD: function (d) { return DL.DAY_NAMES[d.getDay()]; },
    DDD: function (d) { return DL.DAY_NAMES[d.getDay()].slice(0, 3); },
    DD: function (d) { return pad2(d.getDate()); },
    D: function (d) { return String(d.getDate()); },
    HH: function (d) { return pad2(d.getHours()); },
    H: function (d) { return String(d.getHours()); },
    mm: function (d) { return pad2(d.getMinutes()); },
    ss: function (d) { return pad2(d.getSeconds()); },
    A: function (d) { return d.getHours() < 12 ? 'AM' : 'PM'; },
    a: function (d) { return d.getHours() < 12 ? 'am' : 'pm'; }
  };

  // Turns a pattern such as "YYYY-MM-DD" or "D MMM YYYY HH:mm" into a function(timestamp) -> text.
  // Tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D HH H mm ss A a. Text in square brackets and all
  // other characters go into the result without change.
  DL.compileDateFormat = function (pattern) {
    var parts = [];
    var last = 0;
    pattern.replace(TOKEN_RE, function (t, at) {
      if (at > last) parts.push(pattern.slice(last, at));
      parts.push(t.charAt(0) === '[' ? t.slice(1, -1) : TOKENS[t]);
      last = at + t.length;
    });
    if (last < pattern.length) parts.push(pattern.slice(last));
    return function (ts) {
      var d = new Date(ts);
      var out = '';
      for (var i = 0; i < parts.length; i++) out += typeof parts[i] === 'string' ? parts[i] : parts[i](d);
      return out;
    };
  };

  var compiledFormats = Object.create(null);
  var compiledCount = 0;

  // Writes a local timestamp with a pattern. The compiled patterns are kept, so repeated calls are quick.
  DL.formatDate = function (ts, pattern) {
    var f = compiledFormats[pattern];
    if (!f) {
      if (compiledCount > 100) { compiledFormats = Object.create(null); compiledCount = 0; }
      f = compiledFormats[pattern] = DL.compileDateFormat(pattern);
      compiledCount++;
    }
    return f(ts);
  };

  // Makes a local date for any year, also for the years 0 to 99 that the Date constructor moves to 1900.
  DL.localDate = function (year, month, day) {
    var d = new Date(2000, 0, 1);
    d.setFullYear(year, month, day);
    return d;
  };

  /* ---------- Number formatting ---------- */

  var POW10 = [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];

  // Rounds half away from zero, so 2.5 -> 3 and -2.5 -> -3. Gives '' for NaN and infinite values.
  // Values at or above 1e15 keep the digits that toFixed gives; values at or above 1e21 use the exponent form.
  DL.formatFixed = function (v, dec) {
    if (!isFinite(v)) return '';
    dec = Math.min(15, Math.max(0, Math.floor(Number(dec) || 0)));
    var abs = Math.abs(v);
    if (abs >= 1e21) return String(v);
    if (abs >= 1e15) return (v < 0 ? '-' : '') + abs.toFixed(dec);
    var m = POW10[dec];
    abs = Math.round((abs + Number.EPSILON) * m) / m;
    var s = abs.toFixed(dec);
    return v < 0 && abs !== 0 ? '-' + s : s;
  };

  // Makes text from a number. Removes the rounding error of values such as 0.30000000000000004.
  DL.numberText = function (v) {
    if (v !== v || v === Infinity || v === -Infinity) return '';
    if (v % 1 === 0) return String(v);
    var s = String(v);
    return s.length > 16 && Math.abs(v) < 1e15 ? String(Number(v.toPrecision(15))) : s;
  };

  DL.formatNumber = function (n, dec, thousands, decimalSep, prefix, suffix, parens) {
    if (!isFinite(n) || Math.abs(n) >= 1e21) return DL.formatFixed(n, dec); // no grouping for the exponent form
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

  // True when the collator sorts plain Latin text in the root order (English and similar locales).
  var latinCollation = (function () {
    try {
      var loc = DL.collator ? DL.collator.resolvedOptions().locale : 'en';
      return /^(en|und|root|de|fr|es|it|pt|nl)(-|$)/i.test(loc);
    } catch (e) { return false; }
  })();

  // Gives a key for text made of letters A-Z, digits and spaces, such that plain "<" on the keys
  // gives the same order as the collator (numeric, base sensitivity). Gives null for other text,
  // so the caller must then compare with the collator. A run of digits becomes one length
  // character (48 + the number of digits without leading zeros) and then those digits.
  DL.sortKey = function (s) {
    if (!latinCollation) return null;
    var out = '';
    var i = 0, n = s.length, last = 0;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        var si = i;
        while (si < n && s.charCodeAt(si) === 48) si++;
        var ei = si;
        while (ei < n && s.charCodeAt(ei) >= 48 && s.charCodeAt(ei) <= 57) ei++;
        var len = ei - si;
        if (len > 40) return null;
        out += s.slice(last, i) + String.fromCharCode(48 + len) + s.slice(si, ei);
        last = i = ei;
      } else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) {
        i++;
      } else return null;
    }
    return (out + s.slice(last)).toLowerCase();
  };

  // Guesses the type of a column from a sample of its values: 'number', 'date' or 'text'.
  DL.detectType = function (col, sampleSize) {
    var n = Math.min(col.length, sampleSize || 500);
    var nums = 0, dates = 0, filled = 0;
    // The sample positions come from a fixed pseudo-random sequence, so a column whose type
    // changes with a fixed period (for example each second row) is not misread.
    var seed = 12345;
    for (var k = 0; k < n * 2 && filled < n; k++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      var i = col.length === n ? k : seed % col.length;
      if (i >= col.length) break;
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

  // Gives a problem message when the text is not a valid regular expression, or '' when it is.
  DL.regexProblem = function (src, flags) {
    try { new RegExp(src, flags || 'u'); return ''; } catch (e) { return 'The regular expression is not valid: ' + e.message; }
  };

  DL.buildRegex = function (find, opts) {
    var flags = 'g' + (opts.matchCase ? '' : 'i');
    var src = opts.regex ? find : DL.escapeRegExp(find);
    if (opts.wholeWord) {
      // A boundary applies only at an end of the text that is a word character; "-" or "." can match anywhere.
      var left = /^[\p{L}\p{N}_]/u.test(find) ? '(?<![\\p{L}\\p{N}_])' : '';
      var right = /[\p{L}\p{N}_]$/u.test(find) ? '(?![\\p{L}\\p{N}_])' : '';
      src = left + '(?:' + src + ')' + right;
    }
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
      // Word separators: whitespace - / ( [ " and an apostrophe after one letter (o'neil, d'angelo).
      // An apostrophe inside a word (don't, it's) is not a separator.
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 45 || c === 47 || c === 40 || c === 91 || c === 34 || c === 95) {
        atStart = true;
        continue;
      }
      if (c === 39) {
        var wordStart = i - 1;
        while (wordStart >= 0 && /[\p{L}]/u.test(lower.charAt(wordStart))) wordStart--;
        if (i - wordStart - 1 === 1) atStart = true;
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
    return lower.replace(/(^[\s"'(\[]*\p{L}|[.!?]["')\]]*\s+["'(\[]*\p{L})/gu, function (m) {
      return m.toUpperCase();
    });
  };

  // True when the text is empty or has only white space.
  DL.isBlank = function (v) {
    if (v === '') return true;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      if (c > 32 && c !== 160 && !(c >= 0x2000 && c <= 0x200A) && c !== 0x202F && c !== 0x205F && c !== 0x3000 && c !== 0xFEFF) return false;
    }
    return true;
  };

  // Gives the number of characters (code points) in a text. Emoji and other astral characters count as one.
  DL.charCount = function (s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) i++;
      n++;
    }
    return n;
  };

  // Gives the timestamp of the local midnight of a day.
  DL.startOfDay = function (ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  // Makes real characters from "\t" and "\n" typed by the user.
  DL.unescapeText = function (s) {
    if (s == null) return '';
    return String(s).replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
  };

  // "1 row", "2,500 rows": the count with thousands separators and the word in the correct form.
  DL.pluralize = function (n, one) {
    return n.toLocaleString() + ' ' + (n === 1 ? one : one + 's');
  };

  DL.rowsAndColumns = function (rows, columns) {
    return DL.pluralize(rows, 'row') + ' · ' + DL.pluralize(columns, 'column');
  };

  /* ---------- Table builder (used by the file readers) ---------- */

  // Makes text from a cell value: dates become "2024-01-31", numbers keep full precision.
  DL.cellText = function (v) {
    if (typeof v === 'string') return v;
    if (v == null) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      // A spreadsheet cell with a time only has the date 30 or 31 December 1899.
      if (v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() >= 30) return pad2(v.getHours()) + ':' + pad2(v.getMinutes()) + ':' + pad2(v.getSeconds());
      return DL.formatDateISO(v.getTime());
    }
    if (typeof v === 'number') return DL.numberText(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  };

  DL.isBlankRow = function (row) {
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v != null && v !== '' && String(v).trim() !== '') return false;
    }
    return true;
  };

  // Builds a columnar table while rows arrive. It reads the header row, skips rows and drops blank rows.
  // opts: { headers, skipRows, skipRowsBottom, skipEmptyLines }
  DL.TableBuilder = function (opts) {
    this.headers = opts.headers !== false;
    this.toSkip = Math.max(0, Math.floor(Number(opts.skipRows) || 0));
    this.toSkipBottom = Math.max(0, Math.floor(Number(opts.skipRowsBottom) || 0));
    this.dropEmpty = opts.skipEmptyLines !== false;
    this.columns = null;   // the header row, when there is one
    this.expected = -1;    // the number of values a row must have (from the header or the first row)
    this.cols = [];
    this.n = 0;
    this.ragged = 0;
    this.cells = 0;
  };

  DL.TableBuilder.prototype.add = function (row) {
    if (this.toSkip > 0) { this.toSkip--; return; }
    if (this.dropEmpty && DL.isBlankRow(row)) return;
    if (this.columns === null && this.headers) {
      this.columns = row.map(DL.cellText);
      this.expected = row.length;
      return;
    }
    // A blank line that the user keeps is a row of empty values, not a ragged row.
    if (row.length === 1 && row[0] === '' && this.expected > 1) row = [];
    if (this.expected < 0) this.expected = row.length;
    else if (row.length !== this.expected && row.length !== 0) this.ragged++;
    for (var c = this.cols.length; c < row.length; c++) { this.cols.push(new Array(this.n).fill('')); this.cells += this.n; }
    for (c = 0; c < this.cols.length; c++) this.cols[c][this.n] = c < row.length ? DL.cellText(row[c]) : '';
    this.n++;
    this.cells += this.cols.length;
  };

  DL.TableBuilder.prototype.finish = function () {
    var header = this.columns || [];
    while (this.cols.length < header.length) this.cols.push(new Array(this.n).fill(''));
    var names = header.concat(new Array(this.cols.length - header.length).fill(''));
    var n = this.n;
    // The last rows go away. The count is of the rows that the table holds, so the rows that
    // "Skip rows at the top" and the empty-row rule removed are not in it.
    if (this.toSkipBottom) {
      n = Math.max(0, n - this.toSkipBottom);
      for (var i = 0; i < this.cols.length; i++) this.cols[i].length = n;
    }
    return DL.makeTable(DL.cleanHeaders(names), this.cols, n);
  };

  // Puts tables one after the other into one table. A column goes to the column of the same name.
  // A column that a table does not have is empty for the rows of that table. names[i] is the name of
  // the file that gave tables[i]; it goes into the notes.
  DL.stackTables = function (tables, names) {
    if (!tables.length) return { table: DL.makeTable([], [], 0), notes: [] };
    if (tables.length === 1) return { table: tables[0], notes: [] };
    var columns = [];
    var indexOf = Object.create(null);
    var total = 0;
    var i, c, r;
    for (i = 0; i < tables.length; i++) {
      total += tables[i].length;
      for (c = 0; c < tables[i].columns.length; c++) {
        var name = tables[i].columns[c];
        if (!(name in indexOf)) { indexOf[name] = columns.length; columns.push(name); }
      }
    }
    var cols = new Array(columns.length);
    for (c = 0; c < columns.length; c++) cols[c] = new Array(total);
    var notes = [];
    var at = 0;
    for (i = 0; i < tables.length; i++) {
      var t = tables[i];
      var have = Object.create(null);
      for (c = 0; c < t.columns.length; c++) have[t.columns[c]] = c;
      var missing = [];
      for (c = 0; c < columns.length; c++) {
        var from = have[columns[c]];
        var out = cols[c];
        if (from === undefined) {
          missing.push(columns[c]);
          for (r = 0; r < t.length; r++) out[at + r] = '';
        } else {
          var src = DL.col(t, from);
          for (r = 0; r < t.length; r++) out[at + r] = src[r];
        }
      }
      if (missing.length) {
        notes.push('"' + (names && names[i] ? names[i] : 'File ' + (i + 1)) + '" does not have ' +
          DL.pluralize(missing.length, 'column') + ': ' + missing.join(', ') + '. Those values are empty.');
      }
      at += t.length;
    }
    return { table: DL.makeTable(columns, cols, total), notes: notes };
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
      if (r.op === 'regex' && DL.regexProblem(r.value)) out.push(label + ': ' + DL.regexProblem(r.value));
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
      empty: def.empty,
      coerce: def.coerce,
      validate: def.validate || function () { return []; },
      columnsUsed: def.columnsUsed || function () { return []; },
      init: def.init || null,
      blank: def.blank || null
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

  // A number field. p.integer: only whole numbers are accepted.
  DL.registerParamType('number', {
    empty: function (p) { return p && p.default != null ? p.default : ''; },
    coerce: function (v, p) {
      if (v === '' || v == null) return p.required ? this.empty(p) : '';
      if (!isText(v)) return this.empty(p);
      return String(v).trim(); // text that is not a number stays, so the validation reports it
    },
    validate: function (v, p) {
      if (v === '' || v == null) return p.required ? ['Enter a number for "' + p.label + '".'] : [];
      var n = isText(v) ? Number(v) : NaN;
      if (!isFinite(n) || !isPlainNumber(String(v).trim())) return ['Enter a number for "' + p.label + '".'];
      var out = [];
      if (p.integer && n % 1 !== 0) out.push('"' + p.label + '" must be a whole number.');
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
      return v.filter(function (x, i) { return p.options && DL.findOption(p.options, x) && v.indexOf(x) === i; });
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
    coerce: function (v) {
      if (!Array.isArray(v)) return [];
      var out = [];
      v.forEach(function (x) { if (isText(x) && out.indexOf(String(x)) < 0) out.push(String(x)); });
      return out;
    },
    validate: function (v, p, cols) {
      if (!v.length) return p.required !== false ? ['Choose at least one column for "' + p.label + '".'] : [];
      if (!cols) return [];
      return v.filter(function (c) { return cols.indexOf(c) < 0; }).map(DL.columnMissing);
    },
    columnsUsed: function (v) { return v.slice(); }
  };
  DL.registerParamType('columns', columnsType);

  // An empty list means: keep the original order.
  DL.registerParamType('columnOrder', {
    empty: function () { return []; },
    coerce: columnsType.coerce,
    columnsUsed: function (v) { return v.slice(); },
    init: function (columns) { return columns.slice(); }
  });

  DL.registerParamType('renameMap', {
    empty: function () { return {}; },
    coerce: function (v) {
      var out = Object.create(null);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.keys(v).forEach(function (k) { if (isText(v[k])) out[k] = String(v[k]); });
      }
      return out;
    },
    columnsUsed: function (v) { return Object.keys(v); }
  });

  DL.registerParamType('mapping', {
    empty: function () { return [{ from: '', to: '' }]; },
    blank: function () { return { from: '', to: '' }; },
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

  DL.SORT_TYPES = [{ value: 'auto', label: 'Detect type' }, { value: 'text', label: 'As text' }, { value: 'number', label: 'As numbers' }, { value: 'date', label: 'As dates' }];
  DL.SORT_DIRS = [{ value: 'asc', label: 'A → Z / low → high' }, { value: 'desc', label: 'Z → A / high → low' }];

  // A list of rules. blank() gives a new row; enums maps a row key to the list of allowed options.
  function ruleListType(what, operatorsName, blank, enums) {
    return {
      empty: function () { return [blank()]; },
      blank: blank,
      coerce: function (v) {
        if (!Array.isArray(v)) return this.empty();
        var out = v.filter(function (r) { return r && typeof r === 'object'; }).map(function (r) {
          var b = blank();
          Object.keys(b).forEach(function (k) {
            if (typeof b[k] === 'boolean') b[k] = typeof r[k] === 'boolean' ? r[k] : b[k];
            else if (isText(r[k])) b[k] = String(r[k]);
            var allowed = enums && enums[k] && (typeof enums[k] === 'function' ? enums[k]() : enums[k]);
            if (allowed && !DL.findOption(allowed, b[k])) b[k] = blank()[k];
          });
          if ('value2' in b && r.value2 !== undefined) b.value2 = textOf(r.value2);
          return b;
        });
        return out.length ? out : this.empty();
      },
      validate: function (v, p, cols) { return DL.validateRuleList(v, cols, operatorsName ? DL[operatorsName] : null, what); },
      columnsUsed: function (v) { return v.map(function (r) { return r.column; }).filter(Boolean); }
    };
  }
  // The operator lists live in the operation files; the check reads them when a value arrives.
  DL.registerParamType('conditions', ruleListType('rule', 'FILTER_OPERATORS', function () { return { column: '', op: 'contains', value: '', value2: '' }; }, { op: function () { return DL.FILTER_OPERATORS; } }));
  DL.registerParamType('rules', ruleListType('rule', 'VERIFY_RULES', function () { return { column: '', op: 'notEmpty', value: '', allowEmpty: true }; }, { op: function () { return DL.VERIFY_RULES; } }));
  DL.registerParamType('sortKeys', ruleListType('sort key', null, function () { return { column: '', type: 'auto', dir: 'asc' }; }, { type: DL.SORT_TYPES, dir: DL.SORT_DIRS }));

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
   *   apply(table, params) -> { table, notes, status }         (a note is a text or { text, rows }),
   *   findRows(inputTable, params, rows, limit) -> { matches: [[row, col]], total, removed }  (optional, for notes with rows),
   *   hashExtra(params) -> string   (optional: text that must change the cached result, for example today's date)
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

  // The default value of a field: its declared default, or the empty value of its type.
  DL.emptyValue = function (p) {
    return p.default !== undefined ? copyValue(p.default) : DL.paramTypes[p.type].empty(p);
  };

  DL.defaultParams = function (opId) {
    return DL.cleanParams(opId, {});
  };

  // Makes params complete and gives every value the correct shape. Unknown keys are dropped.
  DL.cleanParams = function (opId, params) {
    var op = DL.getOp(opId);
    var out = {};
    if (!op) return out;
    params = params && typeof params === 'object' ? params : {};
    op.params.forEach(function (p) {
      out[p.key] = params[p.key] === undefined ? DL.emptyValue(p) : DL.paramTypes[p.type].coerce(copyValue(params[p.key]), p);
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
    params = DL.cleanParams(opId, params || {}); // the checks read the same shapes as apply()
    var problems = [];
    var cols = inputColumns || null;
    op.params.forEach(function (p) {
      if (p.showIf && !p.showIf(params)) return;
      var type = DL.paramTypes[p.type];
      var found = type.validate(params[p.key], p, cols);
      if (found.length) problems = problems.concat(found);
    });
    if (op.validate) {
      var extra = op.validate(params, cols); // cols is null when the input columns are not known yet
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

  // Gives the text of a result note. A note is a text, or an object { text, rows } when the
  // operation can show the rows that the note is about.
  DL.noteText = function (note) {
    return typeof note === 'string' ? note : note.text;
  };

  // Finds rows in the output of an operation for a note with a rows lookup.
  // Gives { matches: [[row, col], ...], total, removed } where removed is true when the rows are not in the output.
  DL.findRows = function (opId, params, inputTable, lookup, limit) {
    var op = DL.getOp(opId);
    if (!op || typeof op.findRows !== 'function') return { matches: [], total: 0 };
    return op.findRows(inputTable, params, lookup, limit || 2000);
  };

  // Runs one operation. Gives { table, notes, status }.
  DL.runOp = function (opId, params, table) {
    var op = DL.getOp(opId);
    if (!op) throw new Error('Unknown operation "' + opId + '".');
    var result = op.apply(table, params);
    result.notes = result.notes || [];
    result.status = result.status || 'ok';
    if (result.status !== 'ok' && result.status !== 'warning') throw new Error('Operation "' + op.name + '" gave the unknown status "' + result.status + '".');
    if (!result.table) throw new Error('Operation "' + op.name + '" gave no table.');
    return result;
  };

  /* ---------- Step results ---------- */

  // Every status a step result can have, with the label shown in the steps list.
  // Results with data carry hasTable: true. 'running' is used by the user interface only.
  DL.RESULT_STATUS = {
    ok: { label: 'Done' },
    warning: { label: 'Done with warnings' },
    skipped: { label: 'Turned off' },
    invalid: { label: 'Needs setup' },
    blocked: { label: 'Waiting' },
    error: { label: 'Error' },
    running: { label: 'Running…' }
  };

  DL.SKIPPED_NOTE = 'This step is turned off. Data passes through unchanged.';

  DL.resultHasTable = function (result) {
    return !!(result && result.hasTable);
  };

  /* ---------- Input and output formats ---------- */

  DL.SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'];
  DL.DELIMITED_EXTENSIONS = ['csv', 'tsv', 'txt', 'tab', 'dat', 'psv'];

  DL.fileExtension = function (name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  };

  var headerOption = { key: 'headers', label: 'First row holds the column names', type: 'boolean', default: true, help: 'Turn this off if the first row is data. Columns are then named "Column 1", "Column 2", …' };
  var multiFileOption = { key: 'multiFile', label: 'Many files', type: 'select', default: 'batch',
    help: 'Batch: each file goes through the steps on its own and the results download together. Stack: the files become one Data Source, one after the other.',
    options: [{ value: 'batch', label: 'Work on each file on its own (batch)' }, { value: 'stack', label: 'Put the files together (stack)' }] };
  var skipRowsOption = { key: 'skipRows', label: 'Skip rows at the top', type: 'number', default: 0, min: 0, max: 100000, integer: true, help: 'Use this when the file starts with notes or a title before the real header row.' };
  var skipRowsBottomOption = { key: 'skipRowsBottom', label: 'Skip rows at the bottom', type: 'number', default: 0, min: 0, max: 100000, integer: true, help: 'Use this when the file ends with totals, notes or an empty block. The last rows go away.' };

  // Input formats. The worker registers a reader for each id. options are field definitions.
  DL.inputFormats = [
    {
      id: 'delimited',
      label: 'Delimited text (CSV, TSV, …)',
      extensions: DL.DELIMITED_EXTENSIONS,
      options: [
        multiFileOption,
        headerOption,
        skipRowsOption,
        skipRowsBottomOption,
        { key: 'delimiter', label: 'Column separator', type: 'select', default: 'auto', help: 'The character between values. It is detected automatically in most files.',
          options: [{ value: 'auto', label: 'Detect automatically' }, { value: ',', label: 'Comma ( , )' }, { value: '\\t', label: 'Tab' }, { value: ';', label: 'Semicolon ( ; )' }, { value: '|', label: 'Pipe ( | )' }, { value: 'custom', label: 'Other…' }] },
        { key: 'customDelimiter', label: 'Other separator', type: 'text', default: '', showIf: function (o) { return o.delimiter === 'custom'; } },
        { key: 'quoteChar', label: 'Text delimiter', type: 'select', default: '"', help: 'The character around values that contain the separator, for example "Doe, Jane".',
          options: [{ value: '"', label: 'Double quote ( " )' }, { value: "'", label: "Single quote ( ' )" }, { value: 'none', label: 'None' }] },
        { key: 'encoding', label: 'File encoding', type: 'select', default: 'auto', help: 'Change this if accented letters look wrong (for example Ã© instead of é).',
          options: [{ value: 'auto', label: 'Detect automatically' }, { value: 'utf-8', label: 'UTF-8' }, { value: 'windows-1252', label: 'Windows-1252 (Western Europe)' }, { value: 'iso-8859-1', label: 'ISO-8859-1 (Latin 1)' }, { value: 'utf-16le', label: 'UTF-16' }, { value: 'macintosh', label: 'Mac Roman' }, { value: 'windows-1251', label: 'Windows-1251 (Cyrillic)' }, { value: 'shift_jis', label: 'Shift JIS (Japanese)' }, { value: 'gbk', label: 'GBK (Chinese)' }] },
        { key: 'skipEmptyLines', label: 'Skip empty lines', type: 'boolean', default: true }
      ]
    },
    {
      id: 'spreadsheet',
      label: 'Excel workbook',
      extensions: DL.SPREADSHEET_EXTENSIONS,
      hasSheets: true,
      options: [
        multiFileOption,
        headerOption,
        skipRowsOption,
        skipRowsBottomOption,
        { key: 'skipEmptyLines', label: 'Skip empty rows', type: 'boolean', default: true }
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

  // Gives complete source options with values of the correct shape.
  DL.cleanSourceOptions = function (o) {
    var out = DL.defaultSourceOptions();
    if (!o || typeof o !== 'object') return out;
    DL.inputFormats.forEach(function (f) {
      f.options.forEach(function (p) {
        if (o[p.key] !== undefined) out[p.key] = DL.paramTypes[p.type].coerce(o[p.key], p);
      });
    });
    if (typeof o.sheet === 'string') out.sheet = o.sheet;
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
    format.options.forEach(function (p) { out[p.key] = DL.emptyValue(p); });
    return out;
  };
})(typeof self !== 'undefined' ? self : this);
