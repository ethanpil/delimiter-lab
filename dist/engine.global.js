"use strict";
(() => {
  // packages/engine/src/dl.ts
  var DL = {};

  // packages/engine/src/version.ts
  DL.VERSION = "1.0";

  // packages/engine/src/core.ts
  DL.makeTable = function(columns, cols, length) {
    return { columns, cols, length };
  };
  DL.col = function(table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return col;
    var src = col.src, idx = col.idx;
    var n = idx.length;
    var out = new Array(n);
    for (var i = 0; i < n; i++) out[i] = src[idx[i]];
    table.cols[c] = out;
    return out;
  };
  DL.cellGetter = function(table, c) {
    var col = table.cols[c];
    if (Array.isArray(col)) return function(i) {
      return col[i];
    };
    var src = col.src, idx = col.idx;
    return function(i) {
      return src[idx[i]];
    };
  };
  DL.fromRows = function(columns, rows) {
    var w = columns.length;
    var n = rows.length;
    var cols = new Array(w);
    for (var c = 0; c < w; c++) {
      var arr = new Array(n);
      for (var i = 0; i < n; i++) {
        var v = rows[i][c];
        arr[i] = v == null ? "" : v;
      }
      cols[c] = arr;
    }
    return DL.makeTable(columns, cols, n);
  };
  DL.rowAt = function(table, i) {
    var w = table.cols.length;
    var r = new Array(w);
    for (var c = 0; c < w; c++) {
      var col = table.cols[c];
      r[c] = Array.isArray(col) ? col[i] : col.src[col.idx[i]];
    }
    return r;
  };
  DL.rowsSlice = function(table, start, end) {
    var out = [];
    for (var i = start; i < end; i++) out.push(DL.rowAt(table, i));
    return out;
  };
  DL.requireCol = function(table, name) {
    var idx = table.columns.indexOf(name);
    if (idx < 0) throw new Error('Column "' + name + '" was not found.');
    return idx;
  };
  DL.colIndexes = function(table, names) {
    var out = [];
    for (var i = 0; i < names.length; i++) {
      var idx = table.columns.indexOf(names[i]);
      if (idx >= 0) out.push(idx);
    }
    return out;
  };
  DL.colIndexesOrAll = function(table, names) {
    if (names && names.length) return DL.colIndexes(table, names);
    return DL.allIndexes(table);
  };
  DL.allIndexes = function(table) {
    var out = new Array(table.columns.length);
    for (var i = 0; i < out.length; i++) out[i] = i;
    return out;
  };
  var MEMO_LIMIT = 5e4;
  DL.maxCells = 8e6;
  DL.mapColumns = function(table, idxs, fn, stats) {
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
  DL.mapValues = function(src, n, fn, stats) {
    var out = new Array(n);
    var tagged = 0;
    var ctx = { tagged: false, tag: function() {
      this.tagged = true;
    } };
    var cache = /* @__PURE__ */ new Map();
    for (var i = 0; i < n; i++) {
      var v = src[i];
      if (cache !== null) {
        var e = cache.get(v);
        if (e !== void 0) {
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
        if (cache.size > MEMO_LIMIT) cache = null;
      }
    }
    if (stats) stats.tagged = tagged;
    return out;
  };
  var WS_RE = /\s/;
  DL.hasUpper = function(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 65 && c <= 90 || c > 127) return true;
    }
    return false;
  };
  DL.hasEdgeSpace = function(s) {
    if (s.length === 0) return false;
    var a = s.charCodeAt(0), b = s.charCodeAt(s.length - 1);
    if (a > 32 && a < 127 && b > 32 && b < 127) return false;
    return WS_RE.test(s.charAt(0)) || WS_RE.test(s.charAt(s.length - 1));
  };
  DL.normalizeKey = function(v, trim, ignoreCase) {
    if (trim && DL.hasEdgeSpace(v)) v = v.trim();
    if (ignoreCase && DL.hasUpper(v)) v = v.toLowerCase();
    return v;
  };
  DL.addColumn = function(table, name, values, position) {
    var columns = table.columns.slice();
    var cols = table.cols.slice();
    if (position === "start") {
      columns.unshift(name);
      cols.unshift(values);
    } else {
      columns.push(name);
      cols.push(values);
    }
    return DL.makeTable(columns, cols, table.length);
  };
  DL.pickColumns = function(table, idxs) {
    var columns = new Array(idxs.length);
    var cols = new Array(idxs.length);
    for (var k = 0; k < idxs.length; k++) {
      columns[k] = table.columns[idxs[k]];
      cols[k] = table.cols[idxs[k]];
    }
    return DL.makeTable(columns, cols, table.length);
  };
  DL.dropColumns = function(table, idxs) {
    var keep = [];
    for (var c = 0; c < table.columns.length; c++) if (idxs.indexOf(c) < 0) keep.push(c);
    return DL.pickColumns(table, keep);
  };
  DL.selectRows = function(table, indexes) {
    var n = indexes.length;
    var idx = indexes instanceof Uint32Array ? indexes : Uint32Array.from(indexes);
    var w = table.cols.length;
    var cols = new Array(w);
    var composed = /* @__PURE__ */ new Map();
    for (var c = 0; c < w; c++) {
      var col = table.cols[c];
      if (Array.isArray(col)) {
        cols[c] = { src: col, idx };
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
    out.rowMap = idx;
    return out;
  };
  DL.groupRows = function(getters, n) {
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
      var h = 2166136261 | 0;
      for (var c = 0; c < g; c++) {
        var k = getters[c](i);
        for (var j = 0; j < k.length; j++) {
          h ^= k.charCodeAt(j);
          h = Math.imul(h, 16777619);
        }
        h ^= 255;
        h = Math.imul(h, 16777619);
      }
      hashes[i] = h;
      var pos = h & mask;
      for (; ; ) {
        var s = slots[pos];
        if (s === -1) {
          slots[pos] = i;
          first[i] = i;
          count[i] = 1;
          groups++;
          break;
        }
        if (hashes[s] === h && sameKey(getters, s, i)) {
          first[i] = s;
          count[s]++;
          break;
        }
        pos = pos + 1 & mask;
      }
    }
    return { first, count, groups };
  };
  function sameKey(getters, a, b) {
    for (var c = 0; c < getters.length; c++) if (getters[c](a) !== getters[c](b)) return false;
    return true;
  }
  DL.newColumnName = function(columns, wanted, fallback) {
    return DL.uniqueName(columns, DL.cleanName(wanted, fallback));
  };
  DL.uniqueName = function(columns, wanted) {
    var name = wanted;
    var n = 2;
    while (columns.indexOf(name) >= 0) {
      name = wanted + " " + n;
      n++;
    }
    return name;
  };
  DL.cleanName = function(name, fallback) {
    var s = name == null ? "" : String(name).trim();
    return s === "" ? fallback : s;
  };
  DL.cleanHeaders = function(headers) {
    var out = [];
    var seen = /* @__PURE__ */ Object.create(null);
    for (var i = 0; i < headers.length; i++) {
      var h = headers[i] == null ? "" : String(headers[i]).trim();
      if (h === "") h = "Column " + (i + 1);
      var base = h;
      var n = 2;
      while (seen[h]) {
        h = base + " " + n;
        n++;
      }
      seen[h] = true;
      out.push(h);
    }
    return out;
  };
  var numRe = /^[+-]?(\d+([.,]\d+)*|\d*[.,]\d+)([eE][+-]?\d+)?$/;
  function isPlainNumber(s) {
    var len = s.length;
    if (len === 0 || len > 24) return false;
    var digits = 0, dots = 0, exp = 0;
    for (var i = 0; i < len; i++) {
      var c = s.charCodeAt(i);
      if (c >= 48 && c <= 57) digits++;
      else if (c === 46) {
        if (dots++ || exp) return false;
      } else if (c === 45 || c === 43) {
        if (i !== 0 && !(exp && (s.charCodeAt(i - 1) === 101 || s.charCodeAt(i - 1) === 69))) return false;
      } else if (c === 101 || c === 69) {
        if (exp++ || digits === 0) return false;
      } else return false;
    }
    return digits > 0;
  }
  DL.toNumber = function(v) {
    if (typeof v === "number") return v;
    if (v == null) return NaN;
    var s = typeof v === "string" ? v : String(v);
    if (s === "") return NaN;
    var n;
    var style = DL.numberStyle;
    var quick = !(style === "comma" && s.indexOf(".") >= 0);
    if (quick && isPlainNumber(s)) {
      n = +s;
      return isFinite(n) ? n : NaN;
    }
    s = s.trim();
    if (s === "") return NaN;
    if (quick && isPlainNumber(s)) {
      n = +s;
      return isFinite(n) ? n : NaN;
    }
    var neg = false;
    if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
      neg = true;
      s = s.slice(1, -1).trim();
      if (s.charAt(0) === "-" || s.charAt(0) === "+") return NaN;
    }
    s = s.replace(/[\s '$€£¥₹%]/g, "");
    if (s === "" || !numRe.test(s)) return NaN;
    var lastComma = s.lastIndexOf(",");
    var lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) {
        if (!groupsOf3(s.slice(0, lastComma), ".")) return NaN;
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        if (!groupsOf3(s.slice(0, lastDot), ",")) return NaN;
        s = s.replace(/,/g, "");
      }
    } else if (lastComma >= 0) {
      var commas = s.split(",").length - 1;
      var after = s.length - lastComma - 1;
      if (style === "dot" && groupsOf3(s, ",")) s = s.replace(/,/g, "");
      else if (style === "comma" && commas === 1) s = s.replace(",", ".");
      else if (commas === 1 && after !== 3) s = s.replace(",", ".");
      else if (groupsOf3(s, ",")) s = s.replace(/,/g, "");
      else return NaN;
    } else if (lastDot >= 0) {
      if (style === "comma" && groupsOf3(s, ".")) s = s.replace(/\./g, "");
      else if (s.indexOf(".") !== lastDot) {
        if (!groupsOf3(s, ".")) return NaN;
        s = s.replace(/\./g, "");
      }
    }
    n = Number(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  };
  function groupsOf3(s, sep) {
    var parts = s.replace(/^[+-]/, "").split(sep);
    if (parts.length < 2 || parts[0].length === 0 || parts[0].length > 3) return false;
    for (var i = 1; i < parts.length; i++) if (!/^\d{3}$/.test(parts[i])) return false;
    return true;
  }
  var isoRe = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
  var compactRe = /^((?:19|20)\d{2})(\d{2})(\d{2})$/;
  var slashRe = /^(\d{1,4})([\/.\-])(\d{1,2})\2(\d{1,4})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
  var DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function daysInMonth(y, m) {
    if (m === 2 && (y % 4 === 0 && y % 100 !== 0 || y % 400 === 0)) return 29;
    return DAYS[m - 1];
  }
  function makeDate(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return NaN;
    var date = new Date(y, mo - 1, d, h, mi, s);
    if (y < 100) date.setFullYear(y);
    return date.getTime();
  }
  function makeZonedDate(y, mo, d, h, mi, s, ms, zone) {
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return NaN;
    var t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
    if (zone !== "Z") {
      var sign = zone.charAt(0) === "-" ? -1 : 1;
      var zh = +zone.slice(1, 3), zm = +zone.slice(-2);
      t -= sign * (zh * 60 + zm) * 6e4;
    }
    return t;
  }
  var MONTH_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?/i;
  var YEAR_RE = /\b\d{4}\b/;
  DL.numberStyle = "";
  DL.detectNumberStyle = function(table, sampleSize) {
    var dot = 0, comma = 0;
    var rows = Math.min(table.length, sampleSize || 200);
    for (var c = 0; c < table.columns.length; c++) {
      var col = DL.col(table, c);
      for (var i = 0; i < rows; i++) {
        var v = col[i];
        if (!v || v.length > 40) continue;
        var lc = v.lastIndexOf(","), ld = v.lastIndexOf(".");
        if (lc < 0 && ld < 0) continue;
        if (!/\d/.test(v)) continue;
        if (lc >= 0 && ld >= 0) {
          if (lc > ld) comma++;
          else dot++;
          continue;
        }
        var sep = lc >= 0 ? "," : ".";
        if (v.split(sep).length > 2) continue;
        var at = lc >= 0 ? lc : ld;
        var run = v.length - at - 1;
        if (run === 3 || run === 0) continue;
        if (!/^\d+$/.test(v.slice(at + 1))) continue;
        if (lc >= 0) comma++;
        else dot++;
      }
    }
    if (comma + dot < 3) return "";
    if (comma > dot * 3) return "comma";
    if (dot > comma * 3) return "dot";
    return "";
  };
  DL.memoDate = function(dayFirst) {
    var cache = /* @__PURE__ */ new Map();
    return function(v) {
      var t = cache.get(v);
      if (t === void 0) {
        t = DL.toDate(v, dayFirst);
        if (cache.size < MEMO_LIMIT) cache.set(v, t);
      }
      return t;
    };
  };
  DL.DAY_FIRST = { key: "dayFirst", label: "Read 01/02/2024 as 1 February", type: "boolean", default: false, help: "Turn this on for day-first dates (common outside the USA). Dates with a four-digit year first are always read correctly. A value with a time zone, such as 2024-01-01T00:00:00Z, is converted to the local time of this computer." };
  DL.toDate = function(v, dayFirst) {
    if (v == null) return NaN;
    var s = String(v).trim();
    if (s === "") return NaN;
    var m = isoRe.exec(s);
    if (m) {
      if (m[8]) return makeZonedDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +((m[7] || "0") + "00").slice(0, 3), m[8]);
      return makeDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    }
    m = compactRe.exec(s);
    if (m) return makeDate(+m[1], +m[2], +m[3], 0, 0, 0);
    m = slashRe.exec(s);
    if (m) {
      var a = +m[1], b = +m[3], c = +m[4];
      var y, mo, d;
      if (m[1].length === 4) {
        y = a;
        mo = b;
        d = c;
      } else {
        if (m[4].length <= 2) {
          if (m[2] !== "/") return NaN;
          c = c + (c < 70 ? 2e3 : 1900);
        }
        y = c;
        if (dayFirst || a > 12) {
          d = a;
          mo = b;
        } else {
          mo = a;
          d = b;
        }
      }
      var h = +(m[5] || 0);
      var ampm = m[8];
      if (ampm) {
        if (h > 12) return NaN;
        var pm = ampm.toLowerCase() === "pm";
        if (pm && h < 12) h += 12;
        if (!pm && h === 12) h = 0;
      }
      return makeDate(y, mo, d, h, +(m[6] || 0), +(m[7] || 0));
    }
    if (!MONTH_RE.test(s) || !YEAR_RE.test(s)) return NaN;
    var t = Date.parse(s);
    if (isNaN(t)) return NaN;
    var year = new Date(t).getFullYear();
    return year >= 1e3 && year <= 9999 ? t : NaN;
  };
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  DL.formatDateISO = function(ts) {
    var d = new Date(ts);
    var pad = pad2;
    var out = ("000" + d.getFullYear()).slice(-4) + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    if (d.getHours() || d.getMinutes() || d.getSeconds()) {
      out += " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }
    return out;
  };
  DL.MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  DL.DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var TOKEN_RE = /\[[^\]]*\]|YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|HH|H|mm|ss|A|a/g;
  var TOKENS = {
    YYYY: function(d) {
      return ("000" + d.getFullYear()).slice(-4);
    },
    YY: function(d) {
      return pad2(d.getFullYear() % 100);
    },
    MMMM: function(d) {
      return DL.MONTH_NAMES[d.getMonth()];
    },
    MMM: function(d) {
      return DL.MONTH_NAMES[d.getMonth()].slice(0, 3);
    },
    MM: function(d) {
      return pad2(d.getMonth() + 1);
    },
    M: function(d) {
      return String(d.getMonth() + 1);
    },
    DDDD: function(d) {
      return DL.DAY_NAMES[d.getDay()];
    },
    DDD: function(d) {
      return DL.DAY_NAMES[d.getDay()].slice(0, 3);
    },
    DD: function(d) {
      return pad2(d.getDate());
    },
    D: function(d) {
      return String(d.getDate());
    },
    HH: function(d) {
      return pad2(d.getHours());
    },
    H: function(d) {
      return String(d.getHours());
    },
    mm: function(d) {
      return pad2(d.getMinutes());
    },
    ss: function(d) {
      return pad2(d.getSeconds());
    },
    A: function(d) {
      return d.getHours() < 12 ? "AM" : "PM";
    },
    a: function(d) {
      return d.getHours() < 12 ? "am" : "pm";
    }
  };
  DL.compileDateFormat = function(pattern) {
    var parts = [];
    var last = 0;
    pattern.replace(TOKEN_RE, function(t, at) {
      if (at > last) parts.push(pattern.slice(last, at));
      parts.push(t.charAt(0) === "[" ? t.slice(1, -1) : TOKENS[t]);
      last = at + t.length;
    });
    if (last < pattern.length) parts.push(pattern.slice(last));
    return function(ts) {
      var d = new Date(ts);
      var out = "";
      for (var i = 0; i < parts.length; i++) out += typeof parts[i] === "string" ? parts[i] : parts[i](d);
      return out;
    };
  };
  var compiledFormats = /* @__PURE__ */ Object.create(null);
  var compiledCount = 0;
  DL.formatDate = function(ts, pattern) {
    var f = compiledFormats[pattern];
    if (!f) {
      if (compiledCount > 100) {
        compiledFormats = /* @__PURE__ */ Object.create(null);
        compiledCount = 0;
      }
      f = compiledFormats[pattern] = DL.compileDateFormat(pattern);
      compiledCount++;
    }
    return f(ts);
  };
  DL.localDate = function(year, month, day) {
    var d = new Date(2e3, 0, 1);
    d.setFullYear(year, month, day);
    return d;
  };
  var POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15];
  DL.formatFixed = function(v, dec) {
    if (!isFinite(v)) return "";
    dec = Math.min(15, Math.max(0, Math.floor(Number(dec) || 0)));
    var abs = Math.abs(v);
    if (abs >= 1e21) return String(v);
    if (abs >= 1e15) return (v < 0 ? "-" : "") + abs.toFixed(dec);
    var m = POW10[dec];
    abs = Math.round((abs + Number.EPSILON) * m) / m;
    var s = abs.toFixed(dec);
    return v < 0 && abs !== 0 ? "-" + s : s;
  };
  DL.numberText = function(v) {
    if (v !== v || v === Infinity || v === -Infinity) return "";
    if (v % 1 === 0) return String(v);
    var s = String(v);
    return s.length > 16 && Math.abs(v) < 1e15 ? String(Number(v.toPrecision(15))) : s;
  };
  DL.formatNumber = function(n, dec, thousands, decimalSep, prefix, suffix, parens) {
    if (!isFinite(n) || Math.abs(n) >= 1e21) return DL.formatFixed(n, dec);
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
    var out = dec ? int + (decimalSep || ".") + s.slice(intLen + 1) : int;
    if (prefix) out = prefix + out;
    if (suffix) out = out + suffix;
    if (neg) out = parens ? "(" + out + ")" : "-" + out;
    return out;
  };
  DL.collator = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator("en", { numeric: true, sensitivity: "base" }) : null;
  DL.compareText = function(a, b) {
    if (DL.collator) return DL.collator.compare(a, b);
    return a < b ? -1 : a > b ? 1 : 0;
  };
  var latinCollation = (function() {
    try {
      var loc = DL.collator ? DL.collator.resolvedOptions().locale : "en";
      return /^(en|und|root|de|fr|es|it|pt|nl)(-|$)/i.test(loc);
    } catch (e) {
      return false;
    }
  })();
  DL.sortKey = function(s) {
    if (!latinCollation) return null;
    var out = "";
    var i = 0, n = s.length, last = 0;
    while (i < n) {
      var c = s.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        var si = i;
        while (si < n && s.charCodeAt(si) === 48) si++;
        var ei = si;
        while (ei < n && s.charCodeAt(ei) >= 48 && s.charCodeAt(ei) <= 57) ei++;
        var len = ei - si;
        if (len > 16) return null;
        out += s.slice(last, i) + String.fromCharCode(48 + len) + s.slice(si, ei);
        last = i = ei;
      } else if (c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 32) {
        i++;
      } else return null;
    }
    return (out + s.slice(last)).toLowerCase();
  };
  DL.detectType = function(col, sampleSize) {
    var n = Math.min(col.length, sampleSize || 500);
    var nums = 0, dates = 0, filled = 0;
    var seed = 12345;
    for (var k = 0; k < n * 2 && filled < n; k++) {
      seed = Math.imul(seed, 1103515245) + 12345 & 2147483647;
      var i = col.length === n ? k : seed % col.length;
      if (i >= col.length) break;
      var v = col[i];
      if (v == null || v === "") continue;
      filled++;
      if (!isNaN(DL.toNumber(v))) nums++;
      else if (!isNaN(DL.toDate(v))) dates++;
    }
    if (filled === 0) return "text";
    if (nums / filled > 0.9) return "number";
    if (dates / filled > 0.9) return "date";
    return "text";
  };
  DL.escapeRegExp = function(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };
  DL.regexProblem = function(src, flags) {
    try {
      new RegExp(src, flags || "u");
      return "";
    } catch (e) {
      return "The regular expression is not valid: " + e.message;
    }
  };
  DL.buildRegex = function(find, opts) {
    var flags = "g" + (opts.matchCase ? "" : "i");
    var src = opts.regex ? find : DL.escapeRegExp(find);
    if (opts.wholeWord) {
      var left = /^[\p{L}\p{N}_]/u.test(find) ? "(?<![\\p{L}\\p{N}_])" : "";
      var right = /[\p{L}\p{N}_]$/u.test(find) ? "(?![\\p{L}\\p{N}_])" : "";
      src = left + "(?:" + src + ")" + right;
    }
    if (opts.wholeWord || opts.regex) flags += "u";
    return new RegExp(src, flags);
  };
  DL.titleCase = function(s) {
    var lower = s.toLowerCase();
    var out = "";
    var last = 0;
    var atStart = true;
    for (var i = 0; i < lower.length; i++) {
      var c = lower.charCodeAt(i);
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
  DL.sentenceCase = function(s) {
    var lower = s.toLowerCase();
    return lower.replace(/(^[\s"'(\[]*\p{L}|[.!?]["')\]]*\s+["'(\[]*\p{L})/gu, function(m) {
      return m.toUpperCase();
    });
  };
  DL.isBlank = function(v) {
    if (v === "") return true;
    for (var i = 0; i < v.length; i++) {
      var c = v.charCodeAt(i);
      if (c > 32 && c !== 160 && !(c >= 8192 && c <= 8202) && c !== 8239 && c !== 8287 && c !== 12288 && c !== 65279) return false;
    }
    return true;
  };
  DL.charCount = function(s) {
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 55296 && c <= 56319 && i + 1 < s.length) i++;
      n++;
    }
    return n;
  };
  DL.startOfDay = function(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  DL.unescapeText = function(s) {
    if (s == null) return "";
    return String(s).replace(/\\t/g, "	").replace(/\\n/g, "\n").replace(/\\r/g, "\r");
  };
  DL.pluralize = function(n, one) {
    return n.toLocaleString() + " " + (n === 1 ? one : one + "s");
  };
  DL.rowsAndColumns = function(rows, columns) {
    return DL.pluralize(rows, "row") + " \xB7 " + DL.pluralize(columns, "column");
  };
  DL.cellText = function(v) {
    if (typeof v === "string") return v;
    if (v == null) return "";
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return "";
      if (v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() >= 30) return pad2(v.getHours()) + ":" + pad2(v.getMinutes()) + ":" + pad2(v.getSeconds());
      return DL.formatDateISO(v.getTime());
    }
    if (typeof v === "number") return DL.numberText(v);
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    return String(v);
  };
  DL.isBlankRow = function(row) {
    for (var i = 0; i < row.length; i++) {
      var v = row[i];
      if (v != null && v !== "" && String(v).trim() !== "") return false;
    }
    return true;
  };
  DL.TableBuilder = function(opts) {
    this.headers = opts.headers !== false;
    this.toSkip = Math.max(0, Math.floor(Number(opts.skipRows) || 0));
    this.toSkipBottom = Math.max(0, Math.floor(Number(opts.skipRowsBottom) || 0));
    this.dropEmpty = opts.skipEmptyLines !== false;
    this.columns = null;
    this.expected = -1;
    this.cols = [];
    this.n = 0;
    this.ragged = 0;
    this.cells = 0;
  };
  DL.TableBuilder.prototype.add = function(row) {
    if (this.toSkip > 0) {
      this.toSkip--;
      return;
    }
    var blank = this.dropEmpty && DL.isBlankRow(row);
    if (this.columns === null && this.headers && !(blank && row.length <= 1)) {
      this.columns = row.map(DL.cellText);
      this.expected = row.length;
      return;
    }
    if (blank) return;
    if (row.length === 1 && row[0] === "" && this.expected > 1) row = [];
    if (this.expected < 0) this.expected = row.length;
    else if (row.length !== this.expected && row.length !== 0) this.ragged++;
    for (var c = this.cols.length; c < row.length; c++) {
      this.cols.push(new Array(this.n).fill(""));
      this.cells += this.n;
    }
    for (c = 0; c < this.cols.length; c++) this.cols[c][this.n] = c < row.length ? DL.cellText(row[c]) : "";
    this.n++;
    this.cells += this.cols.length;
  };
  DL.TableBuilder.prototype.finish = function() {
    var header = this.columns || [];
    while (this.cols.length < header.length) this.cols.push(new Array(this.n).fill(""));
    var names = header.concat(new Array(this.cols.length - header.length).fill(""));
    var n = this.n;
    if (this.toSkipBottom) {
      n = Math.max(0, n - this.toSkipBottom);
      for (var i = 0; i < this.cols.length; i++) this.cols[i].length = n;
    }
    return DL.makeTable(DL.cleanHeaders(names), this.cols, n);
  };
  function stackKey(name) {
    var out = String(name).replace(/\s+/g, " ").trim().toLowerCase();
    return out.normalize ? out.normalize("NFC") : out;
  }
  var keyCache = typeof WeakMap === "function" ? /* @__PURE__ */ new WeakMap() : null;
  function tableKeys(table) {
    var got = keyCache && keyCache.get(table);
    if (got) return got;
    var keys = new Array(table.columns.length);
    var used = /* @__PURE__ */ Object.create(null);
    for (var c = 0; c < table.columns.length; c++) {
      var k = stackKey(table.columns[c]);
      var n = used[k] = (used[k] || 0) + 1;
      if (n > 1) k = k + "\0#" + n;
      keys[c] = k;
    }
    if (keyCache) keyCache.set(table, keys);
    return keys;
  }
  DL.unionColumns = function(tables, opts) {
    var keys = [];
    var indexOf = /* @__PURE__ */ Object.create(null);
    var spelling = [];
    var rows = 0;
    var i, c;
    for (i = 0; i < tables.length; i++) {
      rows += tables[i].length;
      var mine = tableKeys(tables[i]);
      for (c = 0; c < mine.length; c++) {
        var key = mine[c];
        var name = tables[i].columns[c];
        if (!(key in indexOf)) {
          indexOf[key] = keys.length;
          keys.push(key);
          spelling.push([name]);
        } else spelling[indexOf[key]].push(name);
      }
    }
    var columns = spelling.map(function(list) {
      var count = /* @__PURE__ */ Object.create(null);
      list.forEach(function(n2) {
        var t = String(n2).trim();
        count[t] = (count[t] || 0) + 1;
      });
      return Object.keys(count).sort(function(a, b) {
        return count[b] - count[a] || (a < b ? -1 : a > b ? 1 : 0);
      })[0];
    });
    var notes = [];
    var varied = [];
    for (c = 0; c < spelling.length; c++) {
      var shapes = /* @__PURE__ */ Object.create(null);
      spelling[c].forEach(function(n2) {
        shapes[String(n2).trim()] = true;
      });
      if (Object.keys(shapes).length > 1) varied.push(columns[c]);
    }
    if (varied.length) {
      notes.push("The files write " + DL.pluralize(varied.length, "column name") + " in more than one way, for example " + varied.slice(0, 3).join(", ") + ". Each of them is one column.");
    }
    var seen = /* @__PURE__ */ Object.create(null);
    for (c = 0; c < columns.length; c++) {
      var base = columns[c];
      var name2 = base;
      for (var n = 2; seen[name2]; n++) name2 = base + " " + n;
      seen[name2] = true;
      columns[c] = name2;
    }
    if (opts && opts.fileColumn && tables.length) {
      var given = opts.fileColumn;
      var fileName = given;
      for (var m = 2; seen[fileName]; m++) fileName = given + " " + m;
      if (fileName !== given) {
        notes.push('A column of the data is called "' + given + '", so the column with the name of the file is called "' + fileName + '".');
      }
      columns.unshift(fileName);
      keys.unshift(null);
    }
    return { columns, keys, rows, notes };
  };
  DL.stackedShape = function(tables, opts) {
    var u = DL.unionColumns(tables, opts);
    return { columns: u.columns, rows: u.rows };
  };
  DL.stackTables = function(tables, names, opts) {
    opts = opts || {};
    if (!tables.length) return { table: DL.makeTable([], [], 0), notes: [] };
    if (tables.length === 1 && !opts.fileColumn) return { table: tables[0], notes: [] };
    var u = DL.unionColumns(tables, opts);
    var columns = u.columns;
    var keys = u.keys;
    var total = u.rows;
    var notes = u.notes.slice();
    var i, c, r;
    var parts = new Array(columns.length);
    for (c = 0; c < columns.length; c++) parts[c] = [];
    var fileOf = function(i2) {
      return names && names[i2] ? names[i2] : "File " + (i2 + 1);
    };
    for (i = 0; i < tables.length; i++) {
      var t = tables[i];
      var mine = tableKeys(t);
      var have = /* @__PURE__ */ Object.create(null);
      for (c = 0; c < mine.length; c++) have[mine[c]] = c;
      var blank = null;
      var missing = [];
      for (c = 0; c < columns.length; c++) {
        if (keys[c] === null) {
          var label = fileOf(i);
          var mineCol = new Array(t.length);
          for (r = 0; r < t.length; r++) mineCol[r] = label;
          parts[c].push(mineCol);
          continue;
        }
        var from = have[keys[c]];
        if (from === void 0) {
          missing.push(columns[c]);
          if (!blank) {
            blank = new Array(t.length);
            for (r = 0; r < t.length; r++) blank[r] = "";
          }
          parts[c].push(blank);
        } else {
          parts[c].push(DL.col(t, from));
        }
      }
      if (missing.length) {
        notes.push('"' + fileOf(i) + '" does not have ' + DL.pluralize(missing.length, "column") + ": " + missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", \u2026" : "") + ". Those values are empty.");
      }
    }
    var cols = new Array(columns.length);
    for (c = 0; c < columns.length; c++) cols[c] = parts[c].length === 1 ? parts[c][0] : Array.prototype.concat.apply([], parts[c]);
    return { table: DL.makeTable(columns, cols, total), notes };
  };
  DL.findOption = function(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i];
    return null;
  };
  DL.columnMissing = function(name) {
    return 'Column "' + name + '" is not in the input.';
  };
  DL.validateRuleList = function(rules, cols, operators, what) {
    var out = [];
    if (!rules || !rules.length) return ["Add at least one " + what + "."];
    rules.forEach(function(r, i) {
      var label = what.charAt(0).toUpperCase() + what.slice(1) + " " + (i + 1);
      if (!r.column) out.push(label + ": choose a column.");
      else if (cols && cols.indexOf(r.column) < 0) out.push(label + ": " + DL.columnMissing(r.column));
      if (!operators) return;
      var def = DL.findOption(operators, r.op);
      if (!def) {
        out.push(label + ": choose a test.");
        return;
      }
      if (def.needs === "text" && (r.value == null || r.value === "")) out.push(label + ": enter a value.");
      if (def.needs === "number" && isNaN(DL.toNumber(r.value))) out.push(label + ": enter a number.");
      if (def.needs === "range" && (isNaN(DL.toNumber(r.value)) || isNaN(DL.toNumber(r.value2)))) out.push(label + ": enter two numbers.");
      if (def.needs === "date" && isNaN(DL.toDate(r.value))) out.push(label + ": enter a date such as 2024-01-31.");
      if (r.op === "regex" && DL.regexProblem(r.value)) out.push(label + ": " + DL.regexProblem(r.value));
    });
    return out;
  };
  DL.paramTypes = /* @__PURE__ */ Object.create(null);
  DL.registerParamType = function(name, def) {
    DL.paramTypes[name] = {
      empty: def.empty,
      coerce: def.coerce,
      validate: def.validate || function() {
        return [];
      },
      columnsUsed: def.columnsUsed || function() {
        return [];
      },
      init: def.init || null,
      blank: def.blank || null
    };
  };
  function isText(v) {
    return typeof v === "string" || typeof v === "number";
  }
  function textOf(v, p) {
    return isText(v) ? String(v) : p && p.default != null && isText(p.default) ? String(p.default) : "";
  }
  var textType = {
    empty: function(p) {
      return p && p.default != null ? String(p.default) : "";
    },
    coerce: function(v, p) {
      return textOf(v, p);
    },
    validate: function(v, p) {
      var s = v == null ? "" : String(v);
      if (p.required && s === "") return ['Fill in "' + p.label + '".'];
      if (p.notBlank && s.trim() === "") return ['Fill in "' + p.label + '".'];
      return [];
    }
  };
  DL.registerParamType("text", textType);
  DL.registerParamType("code", textType);
  DL.registerParamType("number", {
    empty: function(p) {
      return p && p.default != null ? p.default : "";
    },
    coerce: function(v, p) {
      if (v === "" || v == null) return p.required ? this.empty(p) : "";
      if (!isText(v)) return this.empty(p);
      return String(v).trim();
    },
    validate: function(v, p) {
      if (v === "" || v == null) return p.required ? ['Enter a number for "' + p.label + '".'] : [];
      var n = isText(v) ? Number(v) : NaN;
      if (!isFinite(n) || !isPlainNumber(String(v).trim())) return ['Enter a number for "' + p.label + '".'];
      var out = [];
      if (p.integer && n % 1 !== 0) out.push('"' + p.label + '" must be a whole number.');
      if (p.min != null && n < p.min) out.push('"' + p.label + '" must be at least ' + p.min + ".");
      if (p.max != null && n > p.max) out.push('"' + p.label + '" must be at most ' + p.max + ".");
      return out;
    }
  });
  DL.registerParamType("boolean", {
    empty: function(p) {
      return !!(p && p.default);
    },
    coerce: function(v, p) {
      return typeof v === "boolean" ? v : this.empty(p);
    }
  });
  DL.registerParamType("select", {
    empty: function(p) {
      return p && p.default != null ? p.default : p && p.options && p.options.length ? p.options[0].value : "";
    },
    coerce: function(v, p) {
      return p.options && DL.findOption(p.options, v) ? v : this.empty(p);
    }
  });
  DL.registerParamType("checkboxes", {
    empty: function(p) {
      return p && Array.isArray(p.default) ? p.default.slice() : [];
    },
    coerce: function(v, p) {
      if (!Array.isArray(v)) return this.empty(p);
      return v.filter(function(x, i) {
        return p.options && DL.findOption(p.options, x) && v.indexOf(x) === i;
      });
    }
  });
  DL.registerParamType("column", {
    empty: function() {
      return "";
    },
    coerce: function(v) {
      return isText(v) ? String(v) : "";
    },
    validate: function(v, p, cols) {
      if (!v) return p.required !== false ? ['Choose a column for "' + p.label + '".'] : [];
      if (cols && cols.indexOf(v) < 0) return [DL.columnMissing(v) + ' Choose another column for "' + p.label + '".'];
      return [];
    },
    columnsUsed: function(v) {
      return v ? [v] : [];
    }
  });
  var columnsType = {
    empty: function() {
      return [];
    },
    coerce: function(v) {
      if (!Array.isArray(v)) return [];
      var out = [];
      v.forEach(function(x) {
        if (isText(x) && out.indexOf(String(x)) < 0) out.push(String(x));
      });
      return out;
    },
    validate: function(v, p, cols) {
      if (!v.length) return p.required !== false ? ['Choose at least one column for "' + p.label + '".'] : [];
      if (!cols) return [];
      return v.filter(function(c) {
        return cols.indexOf(c) < 0;
      }).map(DL.columnMissing);
    },
    columnsUsed: function(v) {
      return v.slice();
    }
  };
  DL.registerParamType("columns", columnsType);
  DL.registerParamType("columnOrder", {
    empty: function() {
      return [];
    },
    coerce: columnsType.coerce,
    columnsUsed: function(v) {
      return v.slice();
    },
    init: function(columns) {
      return columns.slice();
    }
  });
  DL.registerParamType("renameMap", {
    empty: function() {
      return {};
    },
    coerce: function(v) {
      var out = /* @__PURE__ */ Object.create(null);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.keys(v).forEach(function(k) {
          if (isText(v[k])) out[k] = String(v[k]);
        });
      }
      return out;
    },
    columnsUsed: function(v) {
      return Object.keys(v);
    }
  });
  DL.registerParamType("mapping", {
    empty: function() {
      return [{ from: "", to: "" }];
    },
    blank: function() {
      return { from: "", to: "" };
    },
    coerce: function(v) {
      if (!Array.isArray(v)) return this.empty();
      var out = v.filter(function(m) {
        return m && typeof m === "object";
      }).map(function(m) {
        return { from: textOf(m.from), to: textOf(m.to) };
      });
      return out.length ? out : this.empty();
    },
    validate: function(v) {
      return v.some(function(m) {
        return m.from !== "";
      }) ? [] : ["Add at least one value to the lookup list."];
    }
  });
  DL.SORT_TYPES = [{ value: "auto", label: "Detect type" }, { value: "text", label: "As text" }, { value: "number", label: "As numbers" }, { value: "date", label: "As dates" }];
  DL.SORT_DIRS = [{ value: "asc", label: "A \u2192 Z / low \u2192 high" }, { value: "desc", label: "Z \u2192 A / high \u2192 low" }];
  function ruleListType(what, operatorsName, blank, enums) {
    return {
      empty: function() {
        return [blank()];
      },
      blank,
      coerce: function(v) {
        if (!Array.isArray(v)) return this.empty();
        var out = v.filter(function(r) {
          return r && typeof r === "object";
        }).map(function(r) {
          var b = blank();
          Object.keys(b).forEach(function(k) {
            if (typeof b[k] === "boolean") b[k] = typeof r[k] === "boolean" ? r[k] : b[k];
            else if (isText(r[k])) b[k] = String(r[k]);
            var allowed = enums && enums[k] && (typeof enums[k] === "function" ? enums[k]() : enums[k]);
            if (allowed && !DL.findOption(allowed, b[k])) b[k] = blank()[k];
          });
          if ("value2" in b && r.value2 !== void 0) b.value2 = textOf(r.value2);
          return b;
        });
        return out.length ? out : this.empty();
      },
      validate: function(v, p, cols) {
        return DL.validateRuleList(v, cols, operatorsName ? DL[operatorsName] : null, what);
      },
      columnsUsed: function(v) {
        return v.map(function(r) {
          return r.column;
        }).filter(Boolean);
      }
    };
  }
  DL.registerParamType("conditions", ruleListType("rule", "FILTER_OPERATORS", function() {
    return { column: "", op: "contains", value: "", value2: "" };
  }, { op: function() {
    return DL.FILTER_OPERATORS;
  } }));
  DL.registerParamType("rules", ruleListType("rule", "VERIFY_RULES", function() {
    return { column: "", op: "notEmpty", value: "", allowEmpty: true };
  }, { op: function() {
    return DL.VERIFY_RULES;
  } }));
  DL.registerParamType("sortKeys", ruleListType("sort key", null, function() {
    return { column: "", type: "auto", dir: "asc" };
  }, { type: DL.SORT_TYPES, dir: DL.SORT_DIRS }));
  DL.ops = [];
  DL.opsById = /* @__PURE__ */ Object.create(null);
  DL.registerOp = function(def) {
    if (!def.id || DL.opsById[def.id]) throw new Error('Operation id "' + def.id + '" is missing or used twice.');
    def.params = def.params || [];
    def.params.forEach(function(p) {
      if (!DL.paramTypes[p.type]) throw new Error('Operation "' + def.id + '" uses unknown field type "' + p.type + '".');
    });
    def.category = def.category || "Other";
    DL.ops.push(def);
    DL.opsById[def.id] = def;
    return def;
  };
  DL.getOp = function(id) {
    return DL.opsById[id] || null;
  };
  function copyValue(d) {
    if (Array.isArray(d)) return d.map(copyValue);
    if (d && typeof d === "object") return JSON.parse(JSON.stringify(d));
    return d;
  }
  DL.emptyValue = function(p) {
    return p.default !== void 0 ? copyValue(p.default) : DL.paramTypes[p.type].empty(p);
  };
  DL.defaultParams = function(opId) {
    return DL.cleanParams(opId, {});
  };
  DL.cleanParams = function(opId, params) {
    var op = DL.getOp(opId);
    var out = {};
    if (!op) return out;
    params = params && typeof params === "object" ? params : {};
    op.params.forEach(function(p) {
      out[p.key] = params[p.key] === void 0 ? DL.emptyValue(p) : DL.paramTypes[p.type].coerce(copyValue(params[p.key]), p);
    });
    return out;
  };
  DL.initParams = function(opId, params, columns) {
    var op = DL.getOp(opId);
    if (!op || !columns) return params;
    op.params.forEach(function(p) {
      var type = DL.paramTypes[p.type];
      var v = params[p.key];
      if (type.init && (v == null || Array.isArray(v) && !v.length)) params[p.key] = type.init(columns, p);
    });
    return params;
  };
  DL.validateParams = function(opId, params, inputColumns, clean) {
    var op = DL.getOp(opId);
    if (!op) return ['Unknown operation "' + opId + '".'];
    if (clean !== true) params = DL.cleanParams(opId, params || {});
    var problems = [];
    var cols = inputColumns || null;
    op.params.forEach(function(p) {
      if (p.showIf && !p.showIf(params)) return;
      var type = DL.paramTypes[p.type];
      var found = type.validate(params[p.key], p, cols);
      if (found.length) problems = problems.concat(found);
    });
    if (op.validate) {
      var extra = op.validate(params, cols);
      if (extra && extra.length) problems = problems.concat(extra);
    }
    return problems;
  };
  DL.columnsUsedByStep = function(opId, params) {
    var op = DL.getOp(opId);
    var out = [];
    if (!op) return out;
    op.params.forEach(function(p) {
      if (p.showIf && !p.showIf(params)) return;
      DL.paramTypes[p.type].columnsUsed(params[p.key], p).forEach(function(c) {
        if (c && out.indexOf(c) < 0) out.push(c);
      });
    });
    return out;
  };
  DL.predictColumns = function(opId, params, inputColumns) {
    var op = DL.getOp(opId);
    if (!op || inputColumns == null) return null;
    if (!op.outputColumns) return inputColumns.slice();
    return op.outputColumns(inputColumns.slice(), params);
  };
  DL.noteText = function(note) {
    return typeof note === "string" ? note : note.text;
  };
  DL.findRows = function(opId, params, inputTable, lookup, limit) {
    var op = DL.getOp(opId);
    if (!op || typeof op.findRows !== "function") return { matches: [], total: 0 };
    return op.findRows(inputTable, params, lookup, limit || 2e3);
  };
  DL.runOp = function(opId, params, table) {
    var op = DL.getOp(opId);
    if (!op) throw new Error('Unknown operation "' + opId + '".');
    var result = op.apply(table, params);
    result.notes = result.notes || [];
    result.status = result.status || "ok";
    if (result.status !== "ok" && result.status !== "warning") throw new Error('Operation "' + op.name + '" gave the unknown status "' + result.status + '".');
    if (!result.table) throw new Error('Operation "' + op.name + '" gave no table.');
    return result;
  };
  DL.RESULT_STATUS = {
    ok: { label: "Done" },
    warning: { label: "Done with warnings" },
    skipped: { label: "Turned off" },
    invalid: { label: "Needs setup" },
    blocked: { label: "Waiting" },
    error: { label: "Error" },
    running: { label: "Running\u2026" }
  };
  DL.SKIPPED_NOTE = "This step is turned off. Data passes through unchanged.";
  DL.SPREADSHEET_EXTENSIONS = ["xlsx", "xlsm", "xlsb", "xls", "ods"];
  DL.DELIMITED_EXTENSIONS = ["csv", "tsv", "txt", "tab", "dat", "psv"];
  DL.fileExtension = function(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || "");
    return m ? m[1].toLowerCase() : "";
  };
  var headerOption = { key: "headers", label: "First row holds the column names", type: "boolean", default: true, help: 'Turn this off if the first row is data. Columns are then named "Column 1", "Column 2", \u2026' };
  var multiFileOption = {
    key: "multiFile",
    label: "Many files",
    type: "select",
    default: "batch",
    help: "Batch: each file goes through the steps on its own and the results download together. Stack: the files become one Data Source, one after the other.",
    options: [{ value: "batch", label: "Work on each file on its own (batch)" }, { value: "stack", label: "Put the files together (stack)" }]
  };
  var fileColumnOption = {
    key: "fileNameColumn",
    label: "Add a column with the name of the file",
    type: "boolean",
    default: false,
    help: "The first column then holds the name of the file that gave each row. Use it to keep the source of the rows after the files are together.",
    showIf: function(o) {
      return o.multiFile === "stack";
    }
  };
  var skipRowsOption = { key: "skipRows", label: "Skip rows at the top", type: "number", default: 0, min: 0, max: 1e5, integer: true, help: "Use this when the file starts with notes or a title before the real header row." };
  var skipRowsBottomOption = { key: "skipRowsBottom", label: "Skip rows at the bottom", type: "number", default: 0, min: 0, max: 1e5, integer: true, help: "Use this when the file ends with totals, notes or an empty block. The last rows go away." };
  DL.inputFormats = [
    {
      id: "delimited",
      label: "Delimited text (CSV, TSV, \u2026)",
      extensions: DL.DELIMITED_EXTENSIONS,
      options: [
        multiFileOption,
        fileColumnOption,
        headerOption,
        skipRowsOption,
        skipRowsBottomOption,
        {
          key: "delimiter",
          label: "Column separator",
          type: "select",
          default: "auto",
          help: "The character between values. It is detected automatically in most files.",
          options: [{ value: "auto", label: "Detect automatically" }, { value: ",", label: "Comma ( , )" }, { value: "\\t", label: "Tab" }, { value: ";", label: "Semicolon ( ; )" }, { value: "|", label: "Pipe ( | )" }, { value: "custom", label: "Other\u2026" }]
        },
        { key: "customDelimiter", label: "Other separator", type: "text", default: "", showIf: function(o) {
          return o.delimiter === "custom";
        } },
        {
          key: "quoteChar",
          label: "Text delimiter",
          type: "select",
          default: '"',
          help: 'The character around values that contain the separator, for example "Doe, Jane".',
          options: [{ value: '"', label: 'Double quote ( " )' }, { value: "'", label: "Single quote ( ' )" }, { value: "none", label: "None" }]
        },
        {
          key: "encoding",
          label: "File encoding",
          type: "select",
          default: "auto",
          help: "Change this if accented letters look wrong (for example \xC3\xA9 instead of \xE9).",
          options: [{ value: "auto", label: "Detect automatically" }, { value: "utf-8", label: "UTF-8" }, { value: "windows-1252", label: "Windows-1252 (Western Europe)" }, { value: "iso-8859-1", label: "ISO-8859-1 (Latin 1)" }, { value: "utf-16le", label: "UTF-16" }, { value: "macintosh", label: "Mac Roman" }, { value: "windows-1251", label: "Windows-1251 (Cyrillic)" }, { value: "shift_jis", label: "Shift JIS (Japanese)" }, { value: "gbk", label: "GBK (Chinese)" }]
        },
        { key: "skipEmptyLines", label: "Skip empty lines", type: "boolean", default: true }
      ]
    },
    {
      id: "spreadsheet",
      label: "Excel workbook",
      extensions: DL.SPREADSHEET_EXTENSIONS,
      hasSheets: true,
      options: [
        multiFileOption,
        fileColumnOption,
        headerOption,
        skipRowsOption,
        skipRowsBottomOption,
        { key: "skipEmptyLines", label: "Skip empty rows", type: "boolean", default: true }
      ]
    }
  ];
  DL.inputFormatFor = function(fileName) {
    var ext = DL.fileExtension(fileName);
    for (var i = 0; i < DL.inputFormats.length; i++) {
      if (DL.inputFormats[i].extensions.indexOf(ext) >= 0) return DL.inputFormats[i];
    }
    return DL.inputFormats[0];
  };
  DL.acceptedExtensions = function() {
    var out = [];
    DL.inputFormats.forEach(function(f) {
      f.extensions.forEach(function(e) {
        out.push("." + e);
      });
    });
    return out;
  };
  DL.defaultSourceOptions = function() {
    var out = {};
    DL.inputFormats.forEach(function(f) {
      f.options.forEach(function(p) {
        if (!(p.key in out)) out[p.key] = p.default;
      });
    });
    out.sheet = "";
    return out;
  };
  DL.cleanSourceOptions = function(o) {
    var out = DL.defaultSourceOptions();
    if (!o || typeof o !== "object") return out;
    DL.inputFormats.forEach(function(f) {
      f.options.forEach(function(p) {
        if (o[p.key] !== void 0) out[p.key] = DL.paramTypes[p.type].coerce(o[p.key], p);
      });
    });
    if (typeof o.sheet === "string") out.sheet = o.sheet;
    return out;
  };
  var textOutputOptions = [
    { key: "quoteAll", label: "Put quotes around every value", type: "boolean", default: false },
    { key: "header", label: "Include the header row", type: "boolean", default: true },
    { key: "bom", label: "Add a byte order mark (helps Excel show accents correctly)", type: "boolean", default: true },
    { key: "newline", label: "Line endings", type: "select", default: "crlf", options: [{ value: "crlf", label: "Windows (CRLF)" }, { value: "lf", label: "Unix / Mac (LF)" }] }
  ];
  DL.outputFormats = [
    { id: "csv", label: "CSV (comma separated)", extension: ".csv", mime: "text/csv;charset=utf-8", options: textOutputOptions },
    { id: "tsv", label: "TSV (tab separated)", extension: ".tsv", mime: "text/tab-separated-values;charset=utf-8", options: textOutputOptions },
    {
      id: "delimited",
      label: "Text with another separator",
      extension: ".txt",
      mime: "text/plain;charset=utf-8",
      options: [{ key: "delimiter", label: "Separator", type: "text", default: ";", required: true, help: "Use \\t for a tab." }].concat(textOutputOptions)
    },
    {
      id: "xlsx",
      label: "Excel workbook (.xlsx)",
      extension: ".xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      options: [{ key: "header", label: "Include the header row", type: "boolean", default: true }, { key: "sheetName", label: "Sheet name", type: "text", default: "Data" }]
    },
    {
      id: "json",
      label: "JSON",
      extension: ".json",
      mime: "application/json",
      options: [{ key: "pretty", label: "Indent the JSON (easier to read, larger file)", type: "boolean", default: false }]
    }
  ];
  DL.outputFormatById = function(id) {
    for (var i = 0; i < DL.outputFormats.length; i++) if (DL.outputFormats[i].id === id) return DL.outputFormats[i];
    return null;
  };
  DL.defaultFormatOptions = function(format) {
    var out = {};
    format.options.forEach(function(p) {
      out[p.key] = DL.emptyValue(p);
    });
    return out;
  };

  // packages/engine/src/run.ts
  DL.runStep = function(step, upstream) {
    var t0 = Date.now();
    if (step.skip) return { status: "skipped", table: upstream, notes: [DL.SKIPPED_NOTE], error: null, ms: 0 };
    try {
      var params = DL.cleanParams(step.opId, step.params || {});
      var problems = DL.validateParams(step.opId, params, upstream.columns, true);
      if (problems.length) return { status: "invalid", table: null, notes: problems, error: null, ms: 0 };
      var res = DL.runOp(step.opId, params, upstream);
      return { status: res.status, table: res.table, notes: res.notes, error: null, ms: Date.now() - t0 };
    } catch (err) {
      return { status: "error", table: null, notes: [], error: err && err.message ? err.message : String(err), ms: Date.now() - t0 };
    }
  };
  DL.runWorkflow = function(table, steps) {
    var results = [];
    var current = table;
    steps = steps || [];
    for (var i = 0; i < steps.length; i++) {
      var r = DL.runStep(steps[i], current);
      results.push({
        stepId: steps[i].id,
        opId: steps[i].opId,
        status: r.status,
        notes: r.notes,
        error: r.error,
        rowCount: r.table ? r.table.length : 0,
        columns: r.table ? r.table.columns : null,
        ms: r.ms
      });
      if (!r.table) return { table: null, results, failedAt: i };
      current = r.table;
    }
    return { table: current, results, failedAt: -1 };
  };

  // packages/engine/src/io.ts
  DL.platform = {
    readBuffer: function() {
      throw new Error("DL.platform.readBuffer is not set.");
    },
    papa: null,
    // the parser for delimited text
    xlsx: function() {
      throw new Error("DL.platform.xlsx is not set.");
    },
    progress: function(_phase, _percent) {
    },
    // Names the part of the work that follows, so that one file of a list owns one part of a bar.
    // A name of null means that no part is open.
    scope: function(_label, _from, _to) {
    }
  };
  function humanNumber(n) {
    if (n >= 999500) return Math.round(n / 1e5) / 10 + " million";
    if (n >= 1e3) return Math.round(n / 1e3) + " thousand";
    return String(Math.round(n));
  }
  function tooLarge(cells) {
    var err = new Error("This file is too large to work with smoothly. It has about " + humanNumber(cells) + " values, and the safe limit on this computer is about " + humanNumber(DL.maxCells) + ". Try splitting the file, or use a computer with more memory.");
    err.tooLarge = true;
    return err;
  }
  function readBuffer(blob) {
    return DL.platform.readBuffer(blob);
  }
  function detectEncoding(file) {
    var bytes = new Uint8Array(readBuffer(file.slice(0, 1024 * 1024)));
    if (bytes.length >= 3 && bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) return "utf-8";
    if (bytes.length >= 2 && bytes[0] === 255 && bytes[1] === 254) return "utf-16le";
    if (bytes.length >= 2 && bytes[0] === 254 && bytes[1] === 255) return "utf-16be";
    var zerosOdd = 0, zerosEven = 0;
    var span = Math.min(bytes.length, 4096);
    for (var i = 0; i < span; i++) if (bytes[i] === 0) {
      if (i % 2) zerosOdd++;
      else zerosEven++;
    }
    if (zerosOdd + zerosEven > span / 8 && zerosOdd + zerosEven >= 8) return zerosEven > zerosOdd ? "utf-16be" : "utf-16le";
    try {
      var end = bytes.length;
      var cut = 0;
      while (cut < 4 && end > 0 && (bytes[end - 1] & 192) === 128) {
        end--;
        cut++;
      }
      if (end > 0 && bytes[end - 1] & 128) end--;
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
      return "utf-8";
    } catch (e) {
      return "windows-1252";
    }
  }
  function makeDecoder(encoding, notes) {
    try {
      return new TextDecoder(encoding);
    } catch (e) {
      notes.push('The encoding "' + encoding + '" is not supported here. UTF-8 was used.');
      return new TextDecoder("utf-8");
    }
  }
  var readers = {};
  function TextStream() {
    this.readable = true;
    this.handlers = {};
  }
  TextStream.prototype.read = function() {
  };
  TextStream.prototype.pause = function() {
  };
  TextStream.prototype.resume = function() {
  };
  TextStream.prototype.on = function(event, fn) {
    this.handlers[event] = fn;
  };
  TextStream.prototype.removeListener = function(event) {
    delete this.handlers[event];
  };
  TextStream.prototype.emit = function(event, arg) {
    if (this.handlers[event]) this.handlers[event](arg);
  };
  function guessDelimiter(text, quoteChar, skipLines) {
    var sample = text.slice(0, 65536).replace(/\r\n?/g, "\n");
    var cut = sample.lastIndexOf("\n");
    if (cut > 0 && text.length > 65536) sample = sample.slice(0, cut);
    for (var i = 0; i < skipLines; i++) {
      var nl = sample.indexOf("\n");
      if (nl < 0) break;
      sample = sample.slice(nl + 1);
    }
    var res = DL.platform.papa.parse(sample, { quoteChar, escapeChar: quoteChar, skipEmptyLines: "greedy", preview: 50 });
    var failed = res.errors.some(function(e) {
      return e.type === "Delimiter";
    });
    return failed ? "" : res.meta.delimiter;
  }
  function delimiterOf(opts) {
    var d = opts.delimiter;
    if (d === "custom") d = opts.customDelimiter;
    if (!d || d === "auto") return "";
    return DL.unescapeText(d);
  }
  function checkSize(file, decoder, delimiter, quoteChar) {
    var sampleBytes = Math.min(file.size, file.size < 50 * 1024 * 1024 ? 1024 * 1024 : 4 * 1024 * 1024);
    if (sampleBytes === file.size) return;
    var text = new TextDecoder(decoder.encoding).decode(readBuffer(file.slice(0, sampleBytes)));
    var cut = text.lastIndexOf("\n");
    if (cut > 0) text = text.slice(0, cut);
    var cfg = { quoteChar, escapeChar: quoteChar, skipEmptyLines: true };
    if (delimiter) cfg.delimiter = delimiter;
    var res = DL.platform.papa.parse(text, cfg);
    var cells = 0;
    for (var i = 0; i < res.data.length; i++) cells += res.data[i].length;
    var projected = cells * (file.size / Math.max(1, sampleBytes));
    if (projected > DL.maxCells * 1.3) throw tooLarge(projected);
  }
  readers.delimited = function(file, opts) {
    if (!DL.platform.papa) throw new Error("DL.platform.papa is not set.");
    var notes = [];
    var encoding = opts.encoding && opts.encoding !== "auto" ? opts.encoding : detectEncoding(file);
    var decoder = makeDecoder(encoding, notes);
    var delimiter = delimiterOf(opts);
    var quoteChar = opts.quoteChar === "none" ? "\0" : opts.quoteChar || '"';
    checkSize(file, decoder, delimiter, quoteChar);
    var builder = new DL.TableBuilder(opts);
    var errors = { quotes: 0, delimiter: 0, other: 0 };
    var stopped = null;
    var config = {
      quoteChar,
      escapeChar: quoteChar,
      skipEmptyLines: false,
      chunk: function(results, parser) {
        try {
          var data = results.data;
          var strayCR = results.meta && results.meta.linebreak === "\n";
          for (var i = 0; i < data.length; i++) {
            var row = data[i];
            if (strayCR) {
              var lastCell = row[row.length - 1];
              if (typeof lastCell === "string" && lastCell.charCodeAt(lastCell.length - 1) === 13) row[row.length - 1] = lastCell.slice(0, -1);
            }
            builder.add(row);
          }
          var errs = results.errors;
          for (var k = 0; k < errs.length; k++) {
            if (errs[k].type === "Quotes") errors.quotes++;
            else if (errs[k].type !== "FieldMismatch" && errs[k].type !== "Delimiter") errors.other++;
          }
          if (builder.cells > DL.maxCells) {
            stopped = tooLarge(builder.cells * 1.2);
            parser.abort();
          }
        } catch (err) {
          stopped = err;
          parser.abort();
        }
      }
    };
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
          if (!delimiter) {
            errors.delimiter++;
            delimiter = ",";
          }
        }
        config.delimiter = delimiter;
        DL.platform.papa.parse(stream, config);
      }
      stream.emit("data", text);
      DL.platform.progress("Reading file", Math.min(99, Math.round(100 * offset / file.size)));
    }
    if (started && !stopped) stream.emit("end");
    if (stopped) throw stopped;
    var table = builder.finish();
    if (errors.quotes) notes.push(DL.pluralize(errors.quotes, "value") + " had unbalanced quotes. Check the text delimiter setting if data looks wrong.");
    if (errors.other) notes.push(DL.pluralize(errors.other, "problem") + " found while reading the file.");
    if (errors.delimiter && table.columns.length === 1) notes.push("The column separator could not be detected. Choose it in the options if the data looks wrong.");
    return { table, notes, ragged: builder.ragged, meta: { encoding, delimiter } };
  };
  function readWorkbook(file, sheetsOnly) {
    return DL.platform.xlsx().read(readBuffer(file), { type: "array", cellDates: true, dense: true, bookSheets: !!sheetsOnly });
  }
  function sheetNames(file) {
    return readWorkbook(file, true).SheetNames;
  }
  readers.spreadsheet = function(file, opts) {
    DL.platform.progress("Reading workbook", 10);
    var wb = readWorkbook(file, false);
    var found = !opts.sheet || wb.SheetNames.indexOf(opts.sheet) >= 0;
    var sheetName = found ? opts.sheet || wb.SheetNames[0] : wb.SheetNames[0];
    var notes = found ? [] : ['Sheet "' + opts.sheet + '" is not in this workbook. The first sheet "' + sheetName + '" was read.'];
    var ws = wb.Sheets[sheetName];
    DL.platform.progress('Reading sheet "' + sheetName + '"', 40);
    var raw = ws ? DL.platform.xlsx().utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: true }) : [];
    wb = null;
    var builder = new DL.TableBuilder(opts);
    for (var i = 0; i < raw.length; i++) {
      builder.add(raw[i]);
      raw[i] = null;
      if (builder.cells > DL.maxCells) throw tooLarge(builder.cells * (raw.length / (i + 1)));
    }
    DL.platform.progress('Reading sheet "' + sheetName + '"', 95);
    return { table: builder.finish(), notes, ragged: 0, meta: { sheet: sheetName } };
  };
  function RAGGED_NOTE(count) {
    return DL.pluralize(count, "row") + " had a different number of values than the header. Missing values were left empty and extra values were kept in new columns.";
  }
  var CRC_TABLE = (function() {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  function crcAdd(c, bytes) {
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
    return c;
  }
  function crcEnd(c) {
    return (c ^ -1) >>> 0;
  }
  function crc32(bytes) {
    return crcEnd(crcAdd(-1, bytes));
  }
  var ZIP_MAX_BYTES = 4 * 1024 * 1024 * 1024 - 1;
  var ZIP_MAX_ENTRIES = 65535;
  function makeZip(entries) {
    var encoder0 = new TextEncoder();
    var total = 22;
    entries.forEach(function(e) {
      var nameLen = encoder0.encode(e.name).length;
      if (nameLen > 65535) throw new Error('The file name "' + e.name.slice(0, 40) + '\u2026" is too long for a zip file.');
      total += (e.bytes ? e.bytes.length : e.size) + 30 + 46 + 2 * nameLen;
    });
    if (entries.length > ZIP_MAX_ENTRIES || total > ZIP_MAX_BYTES) {
      throw new Error("A zip file can hold at most " + ZIP_MAX_ENTRIES + " files and 4 GB. Apply the workflow to fewer files at one time.");
    }
    var now = /* @__PURE__ */ new Date();
    var dosTime = now.getHours() << 11 | now.getMinutes() << 5 | now.getSeconds() >> 1;
    var dosDate = now.getFullYear() - 1980 << 9 | now.getMonth() + 1 << 5 | now.getDate();
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    entries.forEach(function(e) {
      var size = e.bytes ? e.bytes.length : e.size;
      var name = encoder.encode(e.name);
      var crc = e.bytes ? crc32(e.bytes) : typeof e.crc === "function" ? e.crc() : e.crc;
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 67324752, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 2048, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      parts.push(local.buffer, name, e.bytes || e.part);
      central.push({ name, crc, size, offset });
      offset += 30 + name.length + size;
    });
    var centralStart = offset;
    central.forEach(function(c) {
      var h = new DataView(new ArrayBuffer(46));
      h.setUint32(0, 33639248, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 20, true);
      h.setUint16(8, 2048, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, dosTime, true);
      h.setUint16(14, dosDate, true);
      h.setUint32(16, c.crc, true);
      h.setUint32(20, c.size, true);
      h.setUint32(24, c.size, true);
      h.setUint16(28, c.name.length, true);
      h.setUint16(30, 0, true);
      h.setUint16(32, 0, true);
      h.setUint16(34, 0, true);
      h.setUint16(36, 0, true);
      h.setUint32(38, 0, true);
      h.setUint32(42, c.offset, true);
      parts.push(h.buffer, c.name);
      offset += 46 + c.name.length;
    });
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 101010256, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, central.length, true);
    end.setUint16(10, central.length, true);
    end.setUint32(12, offset - centralStart, true);
    end.setUint32(16, centralStart, true);
    end.setUint16(20, 0, true);
    parts.push(end.buffer);
    return { chunks: parts, mime: "application/zip" };
  }
  var writers = {};
  function quoteValue(v, delimiter, quoteAll) {
    var needs = quoteAll || v.indexOf(delimiter) >= 0 || v.indexOf('"') >= 0 || v.indexOf("\n") >= 0 || v.indexOf("\r") >= 0 || v.indexOf("\uFEFF") >= 0 || v.length > 0 && (v.charCodeAt(0) === 32 || v.charCodeAt(v.length - 1) === 32);
    return needs ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function writeDelimited(table, o, delimiter, mime) {
    var n = table.length;
    var w = table.columns.length;
    var newline = o.newline === "lf" ? "\n" : "\r\n";
    var quoteAll = !!o.quoteAll;
    var chunks = [];
    if (o.bom !== false) chunks.push("\uFEFF");
    if (o.header !== false) chunks.push(table.columns.map(function(c2) {
      return quoteValue(c2, delimiter, quoteAll);
    }).join(delimiter) + newline);
    var get = [];
    for (var c = 0; c < w; c++) get.push(DL.cellGetter(table, c));
    var BLOCK = 5e4;
    for (var start = 0; start < n; start += BLOCK) {
      var end = Math.min(n, start + BLOCK);
      var lines = new Array(end - start);
      for (var i = start; i < end; i++) {
        var line = "";
        for (c = 0; c < w; c++) line += (c ? delimiter : "") + quoteValue(get[c](i), delimiter, quoteAll);
        lines[i - start] = line;
      }
      chunks.push(lines.join(newline) + newline);
      if (n > BLOCK) DL.platform.progress("Preparing download", Math.round(100 * end / n));
    }
    return { chunks, mime };
  }
  writers.csv = function(table, o, format) {
    return writeDelimited(table, o, ",", format.mime);
  };
  writers.tsv = function(table, o, format) {
    return writeDelimited(table, o, "	", format.mime);
  };
  writers.delimited = function(table, o, format) {
    var d = DL.unescapeText(o.delimiter) || ";";
    if (d.indexOf('"') >= 0 || d.indexOf("\n") >= 0 || d.indexOf("\r") >= 0) throw new Error("The separator cannot be a quote or a line break.");
    if (Array.from(d).length > 1) throw new Error("The separator must be one character.");
    return writeDelimited(table, o, d, format.mime);
  };
  writers.xlsx = function(table, o, format) {
    var n = table.length;
    if (n > 1048575) throw new Error("Excel files can hold at most 1,048,576 rows. Use CSV for this data.");
    if (table.columns.length > 16384) throw new Error("Excel files can hold at most 16,384 columns. Use CSV for this data.");
    for (var c = 0; c < table.columns.length; c++) {
      var get = DL.cellGetter(table, c);
      for (var i = 0; i < n; i++) {
        if (get(i).length > 32767) throw new Error("Row " + (i + 1) + ' of column "' + table.columns[c] + '" has more than 32,767 characters. Excel cannot hold it. Use CSV for this data.');
      }
    }
    if (n * table.columns.length > DL.maxCells / 4) throw new Error("This table is too large for an Excel file. Use CSV for this data.");
    var comma = DL.numberStyle === "comma";
    var numeric = function(v) {
      if (v === "" || v.length > 20) return v;
      var c2 = v.charCodeAt(0);
      if (!(c2 >= 48 && c2 <= 57) && c2 !== 45 && c2 !== 46) return v;
      if (comma) {
        var g = DL.toNumber(v);
        if (!isFinite(g)) return v;
        return v.indexOf(",") >= 0 || v.indexOf(".") >= 0 || String(g) === v ? g : v;
      }
      var x = Number(v);
      return isFinite(x) && String(x) === v ? x : v;
    };
    var BLOCK = 2e4;
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
      DL.platform.progress("Building Excel file", Math.round(60 * end / n));
    }
    var wb = DL.platform.xlsx().utils.book_new();
    var sheetName = DL.cleanName(o.sheetName, "Data").replace(/[:\\\/?*\[\]]/g, "_").replace(/^'+|'+$/g, "").slice(0, 31) || "Data";
    if (sheetName.toLowerCase() === "history") sheetName = "History_";
    DL.platform.xlsx().utils.book_append_sheet(wb, ws, sheetName);
    DL.platform.progress("Building Excel file", 80);
    var out = DL.platform.xlsx().write(wb, { type: "array", bookType: "xlsx", compression: true });
    return { chunks: [out], mime: format.mime };
  };
  writers.json = function(table, o, format) {
    var n = table.length;
    var cols = table.columns;
    var parts = ["["];
    var pretty = !!o.pretty;
    var keys = cols.map(function(c2) {
      return JSON.stringify(c2) + (pretty ? ": " : ":");
    });
    var get = [];
    for (var c = 0; c < cols.length; c++) get.push(DL.cellGetter(table, c));
    for (var i = 0; i < n; i++) {
      var obj = pretty ? "\n  {" : "{";
      for (c = 0; c < cols.length; c++) obj += (c ? pretty ? ",\n    " : "," : pretty ? "\n    " : "") + keys[c] + JSON.stringify(get[c](i));
      obj += pretty ? "\n  }" : "}";
      parts.push((i ? "," : "") + obj);
    }
    parts.push((pretty ? "\n" : "") + "]");
    return { chunks: parts, mime: format.mime };
  };
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
  DL.readerFor = function(name) {
    return readers[DL.inputFormatFor(name).id];
  };
  DL.sheetNames = sheetNames;
  DL.readSource = function(files, opts) {
    files = files || [];
    opts = opts || {};
    var started = Date.now();
    var tables = [];
    var names = [];
    var each = [];
    var notes = [];
    var ragged = 0;
    var meta = {};
    var cells = 0;
    var key = "src:";
    var stackOpts = { fileColumn: opts.fileNameColumn && opts.multiFile === "stack" ? "Source file" : null };
    var many = files.length > 1;
    var share = many ? 90 / files.length : 0;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (many) {
        DL.platform.scope(file.name + " (" + (i + 1) + " of " + files.length + ")", share * i, share * (i + 1));
        DL.platform.progress("", 0);
      }
      var result = DL.readerFor(file.name)(file, opts);
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
      key += file.name + ":" + file.size + ":" + file.lastModified + ":";
    }
    DL.platform.scope(null, 0, 0);
    if (tables.length > 1 || stackOpts.fileColumn) {
      var shape = DL.stackedShape(tables, stackOpts);
      var stackedCells = shape.rows * Math.max(1, shape.columns.length);
      if (stackedCells > DL.maxCells) throw DL.tooLarge(stackedCells);
    }
    if (many) DL.platform.progress("Putting the files together", 92);
    var stacked = DL.stackTables(tables, names, stackOpts);
    var table = stacked.table;
    for (var m = 0; m < stacked.notes.length; m++) notes.push(stacked.notes[m]);
    var skip = Math.max(0, Number(opts.skipRows) || 0);
    if (skip) notes.push("Skipped the first " + DL.pluralize(skip, "row") + (files.length > 1 ? " of each file." : "."));
    if (ragged) notes.push(DL.raggedNote(ragged));
    DL.numberStyle = DL.detectNumberStyle(table);
    if (DL.numberStyle === "comma") notes.push("The numbers in this file write 1.234,56, so a comma is the decimal separator.");
    return {
      table,
      key: key + JSON.stringify(opts),
      info: {
        fileName: files.length ? files[0].name : "",
        fileSize: files.length ? files[0].size : 0,
        files: each,
        rowCount: table.length,
        columns: table.columns,
        notes,
        encoding: meta.encoding || null,
        delimiter: meta.delimiter || null,
        sheet: meta.sheet || null,
        ms: Date.now() - started
      }
    };
  };

  // packages/engine/src/workflow.ts
  DL.WORKFLOW_FORMAT = "delimiter-lab-workflow";
  DL.WORKFLOW_VERSION = 1;
  DL.uid = function() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };
  DL.normalizeStep = function(s, keepId) {
    return {
      id: keepId && s.id ? String(s.id) : DL.uid(),
      opId: s.opId,
      params: DL.cleanParams(s.opId, s.params),
      enabled: s.enabled !== false
    };
  };
  DL.cleanStep = function(s) {
    return { id: s.id, opId: s.opId, params: s.params, enabled: s.enabled !== false };
  };
  DL.parseWorkflow = function(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error("This file is not a workflow file.");
    }
    if (!data || data.format !== DL.WORKFLOW_FORMAT || !Array.isArray(data.steps)) {
      throw new Error("This file is not a Delimiter Lab workflow.");
    }
    if (Number(data.version) > DL.WORKFLOW_VERSION) {
      throw new Error("This workflow file comes from a newer version of Delimiter Lab. Update the application to open it.");
    }
    var unknown = data.steps.filter(function(s) {
      return !s || !DL.getOp(s.opId);
    }).map(function(s) {
      return s ? s.opId : "?";
    });
    if (unknown.length) throw new Error("The workflow uses operations this version does not know: " + unknown.join(", "));
    return {
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 80) : "Imported workflow",
      columns: Array.isArray(data.columns) ? data.columns.filter(function(c) {
        return typeof c === "string";
      }) : [],
      sourceOptions: data.sourceOptions && typeof data.sourceOptions === "object" ? DL.cleanSourceOptions(data.sourceOptions) : null,
      steps: data.steps.map(function(s) {
        return DL.normalizeStep(s, false);
      })
    };
  };
  DL.workflowToJSON = function(wf) {
    return JSON.stringify({
      format: DL.WORKFLOW_FORMAT,
      version: DL.WORKFLOW_VERSION,
      name: wf.name,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      columns: wf.columns || [],
      sourceOptions: wf.sourceOptions || null,
      steps: (wf.steps || []).map(DL.cleanStep)
    }, null, 2);
  };
  DL.workerSteps = function(steps) {
    return (steps || []).map(function(s) {
      return { id: s.id, opId: s.opId, params: s.params, skip: s.enabled === false };
    });
  };

  // packages/engine/src/ops/text.ts
  var unescapeText = DL.unescapeText;
  DL.registerOp({
    id: "case",
    name: "Change Case",
    category: "Text",
    icon: "bi-type",
    description: "Change text to UPPER, lower, Title or Sentence case.",
    keywords: "uppercase lowercase capitalize",
    params: [
      { key: "columns", label: "Columns", type: "columns", help: "The columns to change." },
      {
        key: "mode",
        label: "Case",
        type: "select",
        default: "upper",
        options: [
          { value: "upper", label: "UPPER CASE" },
          { value: "lower", label: "lower case" },
          { value: "title", label: "Title Case" },
          { value: "sentence", label: "Sentence case" }
        ]
      }
    ],
    summary: function(p) {
      return p.mode + " case: " + p.columns.join(", ");
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var fn = p.mode === "upper" ? function(s) {
        return s.toUpperCase();
      } : p.mode === "lower" ? function(s) {
        return s.toLowerCase();
      } : p.mode === "title" ? DL.titleCase : DL.sentenceCase;
      return { table: DL.mapColumns(table, idxs, function(v) {
        return v ? fn(v) : v;
      }) };
    }
  });
  var COMBINED = "Combined";
  DL.registerOp({
    id: "concat",
    name: "Combine Columns",
    category: "Text",
    icon: "bi-intersect",
    description: "Join several columns into one new column, for example First + Last name.",
    keywords: "concatenate merge join",
    params: [
      { key: "columns", label: "Columns to join (in order)", type: "columns", ordered: true, help: "Drag to change the order." },
      { key: "separator", label: "Separator", type: "text", default: " ", help: "Text placed between the values. Use \\t for a tab." },
      { key: "output", label: "New column name", type: "text", default: COMBINED, notBlank: true },
      { key: "skipEmpty", label: "Skip empty values", type: "boolean", default: true, help: "Avoids double separators when a value is empty." },
      { key: "removeSource", label: "Remove the original columns", type: "boolean", default: false }
    ],
    summary: function(p) {
      return p.columns.join(" + ") + " \u2192 " + p.output;
    },
    outputColumns: function(cols, p) {
      var out = p.removeSource ? cols.filter(function(c) {
        return p.columns.indexOf(c) < 0;
      }) : cols;
      return out.concat([DL.newColumnName(out, p.output, COMBINED)]);
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var sep = unescapeText(p.separator);
      var n = table.length;
      var skipEmpty = !!p.skipEmpty;
      var srcCols = idxs.map(function(i2) {
        return DL.col(table, i2);
      });
      var k = srcCols.length;
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var out = "";
        var count = 0;
        for (var j = 0; j < k; j++) {
          var v = srcCols[j][i];
          if (skipEmpty && DL.isBlank(v)) continue;
          out = count++ ? out + sep + v : v;
        }
        values[i] = out;
      }
      var base = p.removeSource ? DL.dropColumns(table, idxs) : table;
      return { table: DL.addColumn(base, DL.newColumnName(base.columns, p.output, COMBINED), values) };
    }
  });
  function splitText(s, sep, max) {
    var out = [];
    var at = 0;
    for (; ; ) {
      if (max && out.length === max - 1) break;
      var pos, len;
      if (sep instanceof RegExp) {
        sep.lastIndex = at;
        var m = sep.exec(s);
        if (!m || m[0].length === 0) break;
        pos = m.index;
        len = m[0].length;
      } else {
        pos = s.indexOf(sep, at);
        len = sep.length;
        if (pos < 0) break;
      }
      out.push(s.slice(at, pos));
      at = pos + len;
    }
    out.push(s.slice(at));
    return out;
  }
  function splitNames(p) {
    var custom = (p.names || "").split(",").map(function(s) {
      return s.trim();
    }).filter(Boolean);
    var max = p.maxParts !== "" && p.maxParts != null ? Math.max(1, Math.round(Number(p.maxParts))) : 0;
    return { custom, max, column: p.column };
  }
  function splitColumnName(names, c) {
    return names.custom[c] || names.column + " - " + (c + 1);
  }
  DL.registerOp({
    id: "split",
    name: "Split Column",
    category: "Text",
    icon: "bi-layout-split",
    description: "Break one column into several columns at a separator.",
    keywords: "divide separate delimiter",
    params: [
      { key: "column", label: "Column to split", type: "column" },
      { key: "separator", label: "Separator", type: "text", default: ",", required: true, help: "Text to split on. Use \\t for a tab." },
      { key: "regex", label: "Separator is a regular expression", type: "boolean", default: false },
      { key: "maxParts", label: "Maximum parts", type: "number", default: "", min: 1, max: 1e3, integer: true, help: "Leave empty to split into as many parts as needed. The last part keeps the rest of the text." },
      { key: "names", label: "New column names", type: "text", default: "", help: 'Comma separated names for the new columns. Leave empty to use "Column - 1", "Column - 2", \u2026' },
      { key: "trim", label: "Trim spaces around each part", type: "boolean", default: true },
      { key: "removeSource", label: "Remove the original column", type: "boolean", default: false }
    ],
    summary: function(p) {
      return 'Split "' + p.column + '" on "' + p.separator + '"';
    },
    validate: function(p) {
      return p.regex && DL.regexProblem(p.separator, "g") ? [DL.regexProblem(p.separator, "g")] : [];
    },
    outputColumns: function(cols, p) {
      var names = splitNames(p);
      if (!names.max) return null;
      var out = p.removeSource ? cols.filter(function(c2) {
        return c2 !== p.column;
      }) : cols.slice();
      for (var c = 0; c < names.max; c++) out.push(DL.uniqueName(out, splitColumnName(names, c)));
      return out;
    },
    apply: function(table, p) {
      var idx = DL.requireCol(table, p.column);
      var sep = p.regex ? new RegExp(p.separator, "g") : unescapeText(p.separator);
      var names = splitNames(p);
      var src = DL.col(table, idx);
      var n = table.length;
      var values = [];
      var trim = !!p.trim;
      for (var i = 0; i < n; i++) {
        var v = src[i];
        var parts = v === "" ? [""] : splitText(v, sep, names.max);
        for (var c = 0; c < parts.length; c++) {
          if (c === values.length) values.push(new Array(n).fill(""));
          values[c][i] = trim ? parts[c].trim() : parts[c];
        }
      }
      while (values.length < names.max) values.push(new Array(n).fill(""));
      var out = p.removeSource ? DL.dropColumns(table, [idx]) : table;
      for (c = 0; c < values.length; c++) out = DL.addColumn(out, DL.uniqueName(out.columns, splitColumnName(names, c)), values[c]);
      return { table: out, notes: ["Split into " + DL.pluralize(values.length, "column") + "."] };
    }
  });
  var PREFIXES = Object.assign(/* @__PURE__ */ Object.create(null), { "mr": 1, "mrs": 1, "ms": 1, "miss": 1, "mx": 1, "dr": 1, "prof": 1, "rev": 1, "sir": 1, "dame": 1, "hon": 1, "capt": 1, "col": 1, "lt": 1, "sgt": 1, "fr": 1 });
  var SUFFIXES = Object.assign(/* @__PURE__ */ Object.create(null), { "jr": 1, "sr": 1, "ii": 1, "iii": 1, "iv": 1, "v": 1, "phd": 1, "md": 1, "esq": 1, "dds": 1, "cpa": 1, "mba": 1, "ra": 1 });
  var PARTICLES = Object.assign(/* @__PURE__ */ Object.create(null), { "van": 1, "von": 1, "de": 1, "del": 1, "della": 1, "di": 1, "da": 1, "la": 1, "le": 1, "du": 1, "der": 1, "den": 1, "ter": 1, "ten": 1, "st": 1, "san": 1, "bin": 1, "ibn": 1, "al": 1, "el": 1, "y": 1, "e": 1 });
  DL.splitName = function(full) {
    var res = { prefix: "", first: "", middle: "", last: "", suffix: "" };
    var s = (full || "").replace(/\s+/g, " ").trim();
    if (!s) return res;
    var norm = function(t) {
      return t.toLowerCase().replace(/\./g, "");
    };
    var lastName = null;
    if (s.indexOf(",") >= 0) {
      var parts = s.split(",").map(function(x) {
        return x.trim();
      }).filter(Boolean);
      if (!parts.length) return res;
      var tail = parts.slice(1);
      var suffixParts = [];
      var others = [];
      tail.forEach(function(t) {
        if (SUFFIXES[norm(t)]) suffixParts.push(t);
        else others.push(t);
      });
      if (suffixParts.length) res.suffix = suffixParts.join(" ");
      if (others.length) {
        lastName = parts[0];
        s = others.join(" ");
      } else if (suffixParts.length) {
        lastName = parts[0];
        s = "";
      } else {
        s = parts[0];
      }
    }
    var tokens = s.split(" ");
    var hadPrefix = false;
    while (tokens.length > 1 && PREFIXES[norm(tokens[0])]) {
      res.prefix = (res.prefix ? res.prefix + " " : "") + tokens.shift();
      hadPrefix = true;
    }
    while (tokens.length > 1 && SUFFIXES[norm(tokens[tokens.length - 1])]) {
      var suf = tokens.pop();
      res.suffix = res.suffix ? suf + " " + res.suffix : suf;
    }
    if (lastName !== null) {
      res.last = lastName;
      res.first = tokens.shift() || "";
      res.middle = tokens.join(" ");
      return res;
    }
    if (tokens.length === 1) {
      if (hadPrefix) res.last = tokens[0];
      else res.first = tokens[0];
      return res;
    }
    var lastTokens = [tokens.pop()];
    while (tokens.length > 1 && PARTICLES[norm(tokens[tokens.length - 1])]) {
      lastTokens.unshift(tokens.pop());
    }
    res.last = lastTokens.join(" ");
    res.first = tokens.shift() || "";
    res.middle = tokens.join(" ");
    return res;
  };
  var NAME_LABELS = { prefix: "Title", first: "First Name", middle: "Middle Name", last: "Last Name", suffix: "Suffix" };
  var NAME_ORDER = ["prefix", "first", "middle", "last", "suffix"];
  DL.registerOp({
    id: "splitName",
    name: "Split Name",
    category: "Text",
    icon: "bi-person-lines-fill",
    description: 'Split a full name into First, Middle and Last name columns. Handles "Last, First", titles like Dr., and suffixes like Jr.',
    keywords: "first last middle name parse",
    params: [
      { key: "column", label: "Full name column", type: "column" },
      {
        key: "parts",
        label: "Columns to create",
        type: "checkboxes",
        default: ["first", "middle", "last"],
        options: [
          { value: "prefix", label: "Title (Mr, Dr, \u2026)" },
          { value: "first", label: "First name" },
          { value: "middle", label: "Middle name" },
          { value: "last", label: "Last name" },
          { value: "suffix", label: "Suffix (Jr, III, \u2026)" }
        ]
      },
      { key: "prefixNames", label: "Name prefix for new columns", type: "text", default: "", help: 'For example "Contact" gives "Contact First Name". Leave empty for "First Name".' },
      { key: "removeSource", label: "Remove the original column", type: "boolean", default: false }
    ],
    summary: function(p) {
      return 'Split "' + p.column + '" into name parts';
    },
    validate: function(p) {
      return p.parts.length ? [] : ["Choose at least one column to create."];
    },
    outputColumns: function(cols, p) {
      var base = p.removeSource ? cols.filter(function(c) {
        return c !== p.column;
      }) : cols;
      return base.concat(namePartColumns(base, p));
    },
    apply: function(table, p) {
      var idx = DL.requireCol(table, p.column);
      var order = NAME_ORDER.filter(function(k2) {
        return p.parts.indexOf(k2) >= 0;
      });
      var src = DL.col(table, idx);
      var n = table.length;
      var values = order.map(function() {
        return new Array(n);
      });
      var split = DL.mapValues(src, n, DL.splitName);
      for (var i = 0; i < n; i++) {
        var parts = split[i];
        for (var k = 0; k < order.length; k++) values[k][i] = parts[order[k]];
      }
      var out = p.removeSource ? DL.dropColumns(table, [idx]) : table;
      var names = namePartColumns(out.columns, p);
      for (k = 0; k < order.length; k++) out = DL.addColumn(out, names[k], values[k]);
      return { table: out };
    }
  });
  function namePartColumns(base, p) {
    var order = NAME_ORDER.filter(function(k) {
      return p.parts.indexOf(k) >= 0;
    });
    var pre = (p.prefixNames || "").trim();
    var out = [];
    order.forEach(function(k) {
      out.push(DL.uniqueName(base.concat(out), (pre ? pre + " " : "") + NAME_LABELS[k]));
    });
    return out;
  }
  DL.registerOp({
    id: "replace",
    name: "Find & Replace",
    category: "Text",
    icon: "bi-search",
    description: 'Replace text in one or more columns. Leave "Replace with" empty to remove the text.',
    keywords: "substitute remove clear text regex",
    params: [
      { key: "columns", label: "Columns", type: "columns", required: false, help: "Leave empty to search all columns." },
      { key: "find", label: "Find", type: "text", default: "", required: true },
      { key: "replace", label: "Replace with", type: "text", default: "", help: "With regular expressions you can use $1, $2 for captured groups." },
      { key: "matchCase", label: "Match case", type: "boolean", default: false },
      { key: "wholeWord", label: "Whole words only", type: "boolean", default: false },
      { key: "wholeCell", label: "Whole cell must match", type: "boolean", default: false },
      { key: "regex", label: "Use regular expression", type: "boolean", default: false }
    ],
    summary: function(p) {
      return '"' + p.find + '" \u2192 "' + p.replace + '"';
    },
    validate: function(p) {
      return p.regex && DL.regexProblem(p.find) ? [DL.regexProblem(p.find)] : [];
    },
    apply: function(table, p) {
      var idxs = DL.colIndexesOrAll(table, p.columns);
      var find = p.regex ? p.find : unescapeText(p.find);
      var replacement = p.regex ? unescapeText(p.replace) : unescapeText(p.replace).replace(/\$/g, "$$$$");
      var stats = {};
      var out;
      if (p.wholeCell) {
        var test = p.regex ? new RegExp("^(?:" + find + ")$", p.matchCase ? "u" : "iu") : null;
        var target = p.matchCase ? find : find.toLowerCase();
        var plain = unescapeText(p.replace);
        out = DL.mapColumns(table, idxs, function(v, ctx) {
          var hit = test ? test.test(v) : p.matchCase ? v === target : v.toLowerCase() === target;
          if (!hit) return v;
          var r = test ? v.replace(test, replacement) : plain;
          if (r !== v) ctx.tag();
          return r;
        }, stats);
      } else {
        var re = DL.buildRegex(find, { matchCase: p.matchCase, wholeWord: p.wholeWord, regex: p.regex });
        var quick = !p.regex && !p.wholeWord && p.matchCase ? find : null;
        out = DL.mapColumns(table, idxs, function(v, ctx) {
          if (!v) return v;
          if (quick !== null && v.indexOf(quick) < 0) return v;
          re.lastIndex = 0;
          if (!re.test(v)) return v;
          re.lastIndex = 0;
          var r = v.replace(re, replacement);
          if (r !== v) ctx.tag();
          return r;
        }, stats);
      }
      return { table: out, notes: ["Changed " + DL.pluralize(stats.tagged, "cell") + "."] };
    }
  });
  DL.registerOp({
    id: "substitute",
    name: "Substitute Values",
    category: "Text",
    icon: "bi-arrow-left-right",
    description: 'Swap whole values using a lookup list, for example "CA" \u2192 "California".',
    keywords: "map lookup dictionary translate recode",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      { key: "mapping", label: "Lookup list", type: "mapping", help: "Each row swaps one value for another. Paste two columns from a spreadsheet to fill the list." },
      { key: "matchCase", label: "Match case", type: "boolean", default: false },
      { key: "trim", label: "Ignore spaces around values", type: "boolean", default: true },
      {
        key: "noMatch",
        label: "When a value is not in the list",
        type: "select",
        default: "keep",
        options: [
          { value: "keep", label: "Keep the value" },
          { value: "blank", label: "Make it empty" },
          { value: "value", label: "Use a fixed value" }
        ]
      },
      { key: "noMatchValue", label: "Fixed value", type: "text", default: "", showIf: function(p) {
        return p.noMatch === "value";
      } }
    ],
    summary: function(p) {
      return DL.pluralize(p.mapping.filter(function(m) {
        return m.from !== "";
      }).length, "value") + " in " + p.columns.join(", ");
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var map = /* @__PURE__ */ new Map();
      p.mapping.forEach(function(m) {
        if (m.from === "") return;
        var k = p.trim ? m.from.trim() : m.from;
        if (!p.matchCase) k = k.toLowerCase();
        map.set(k, unescapeText(m.to));
      });
      var stats = {};
      var noMatch = p.noMatch;
      var fixed = p.noMatchValue;
      var out = DL.mapColumns(table, idxs, function(v, ctx) {
        var key = p.trim ? v.trim() : v;
        if (!p.matchCase) key = key.toLowerCase();
        var hit = map.get(key);
        if (hit !== void 0) {
          ctx.tag();
          return hit;
        }
        if (noMatch === "blank") return "";
        if (noMatch === "value") return fixed;
        return v;
      }, stats);
      return { table: out, notes: ["Swapped " + DL.pluralize(stats.tagged, "value") + "."] };
    }
  });
  DL.registerOp({
    id: "padTrim",
    name: "Pad / Trim",
    category: "Text",
    icon: "bi-arrows-collapse-vertical",
    description: "Remove extra spaces, or pad values to a fixed length (for example add leading zeros).",
    keywords: "whitespace strip clean zeros",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      {
        key: "trim",
        label: "Trim",
        type: "select",
        default: "both",
        options: [
          { value: "both", label: "Spaces at both ends" },
          { value: "left", label: "Spaces at the start" },
          { value: "right", label: "Spaces at the end" },
          { value: "none", label: "Do not trim" }
        ]
      },
      { key: "collapse", label: "Collapse repeated spaces inside the text", type: "boolean", default: false },
      {
        key: "pad",
        label: "Pad",
        type: "select",
        default: "none",
        options: [
          { value: "none", label: "Do not pad" },
          { value: "left", label: "Add at the start (e.g. leading zeros)" },
          { value: "right", label: "Add at the end" }
        ]
      },
      { key: "length", label: "Pad to length", type: "number", default: 5, min: 1, max: 1e4, integer: true, required: true, showIf: function(p) {
        return p.pad !== "none";
      } },
      { key: "char", label: "Pad character", type: "text", default: "0", showIf: function(p) {
        return p.pad !== "none";
      } }
    ],
    summary: function(p) {
      var bits = [];
      if (p.trim !== "none") bits.push("trim");
      if (p.pad !== "none") bits.push("pad to " + p.length);
      return bits.join(", ") + ": " + p.columns.join(", ");
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var ch = Array.from(String(p.char || " "))[0] || " ";
      var len = Number(p.length) || 0;
      var trim = p.trim, pad = p.pad, collapse = !!p.collapse;
      var out = DL.mapColumns(table, idxs, function(v) {
        if (trim === "both") v = v.trim();
        else if (trim === "left") v = v.replace(/^\s+/, "");
        else if (trim === "right") v = v.replace(/\s+$/, "");
        if (collapse) v = v.replace(/\s{2,}/g, " ");
        if (DL.isBlank(v) && ch !== " ") return v;
        var missing = pad === "none" ? 0 : len - DL.charCount(v);
        if (missing > 0) v = pad === "left" ? ch.repeat(missing) + v : v + ch.repeat(missing);
        return v;
      });
      return { table: out };
    }
  });
  var EXTRACTED = "Extracted";
  DL.registerOp({
    id: "extract",
    name: "Extract Text",
    category: "Text",
    icon: "bi-braces-asterisk",
    description: "Pull a part of the text into a new column with a pattern, for example the digits of a product code or the domain of an email address.",
    keywords: "regex pattern capture group substring match",
    params: [
      { key: "column", label: "Column", type: "column" },
      { key: "pattern", label: "Pattern (regular expression)", type: "text", default: "", required: true, help: "For example \\d+ for the first number, or @(.+)$ with group 1 for an email domain." },
      { key: "group", label: "Group", type: "number", default: 0, min: 0, max: 20, integer: true, required: true, help: "0 gives the whole match. 1, 2, \u2026 give the text inside the first, second, \u2026 pair of parentheses." },
      { key: "matchCase", label: "Match case", type: "boolean", default: false },
      { key: "all", label: "All matches", type: "boolean", default: false, help: "Join every match in the text instead of the first one only." },
      { key: "joiner", label: "Separator between matches", type: "text", default: ", ", showIf: function(p) {
        return p.all;
      } },
      {
        key: "noMatch",
        label: "When nothing matches",
        type: "select",
        default: "blank",
        options: [{ value: "blank", label: "Leave the result empty" }, { value: "keep", label: "Keep the original text" }]
      },
      { key: "output", label: "New column name", type: "text", default: EXTRACTED, notBlank: true }
    ],
    summary: function(p) {
      return p.output + " = /" + p.pattern + "/ from " + p.column;
    },
    validate: function(p) {
      var problem = DL.regexProblem(p.pattern, "gu");
      if (problem) return [problem];
      var groups = new RegExp(p.pattern + "|", "u").exec("").length - 1;
      if (Number(p.group) > groups) return ["The pattern has only " + DL.pluralize(groups, "group") + ". Choose a smaller group number."];
      return [];
    },
    outputColumns: function(cols, p) {
      return cols.concat([DL.newColumnName(cols, p.output, EXTRACTED)]);
    },
    apply: function(table, p) {
      var idx = DL.requireCol(table, p.column);
      var re = new RegExp(p.pattern, (p.matchCase ? "" : "i") + "gu");
      var group = Number(p.group) || 0;
      var joiner = unescapeText(p.joiner);
      var keep = p.noMatch === "keep";
      var stats = {};
      var all = !!p.all;
      var values = DL.mapValues(DL.col(table, idx), table.length, function(v, ctx) {
        re.lastIndex = 0;
        var parts = [];
        var hit;
        while ((hit = re.exec(v)) !== null) {
          if (hit[0].length === 0) {
            re.lastIndex += v.codePointAt(re.lastIndex) > 65535 ? 2 : 1;
            continue;
          }
          parts.push(hit[group] == null ? "" : hit[group]);
          if (!all) break;
        }
        if (!parts.length) {
          ctx.tag();
          return keep ? v : "";
        }
        return parts.join(joiner);
      }, stats);
      var out = DL.addColumn(table, DL.newColumnName(table.columns, p.output, EXTRACTED), values);
      return { table: out, notes: stats.tagged ? [DL.pluralize(stats.tagged, "value") + " had no match."] : [] };
    }
  });
  var HTML_ENTITIES = Object.assign(/* @__PURE__ */ Object.create(null), { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", copy: "\xA9", reg: "\xAE", euro: "\u20AC", pound: "\xA3" });
  function stripHtml(s) {
    if (s.indexOf("<") < 0 && s.indexOf("&") < 0) return s;
    return s.replace(/<br\s*\/?>/gi, " ").replace(/<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|[!?][^>]*|\/?[a-z][a-z0-9-]*(?:\s+[^<>=]*=[^<>]*)?\s*\/?)>/gi, "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, function(m, code) {
      var c = code.toLowerCase();
      if (c.charAt(0) === "#") {
        var n = c.charAt(1) === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
        return n > 0 && n <= 1114111 && (n < 55296 || n > 57343) ? String.fromCodePoint(n) : m;
      }
      return HTML_ENTITIES[c] !== void 0 ? HTML_ENTITIES[c] : m;
    });
  }
  var CLEAN_STEPS = [
    { value: "html", label: "Remove HTML tags and decode &amp;, &lt;, \u2026", fn: stripHtml },
    { value: "control", label: "Remove hidden control characters", fn: function(s) {
      return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B\u200C\u2060-\u2064\uFEFF]/g, "");
    } },
    { value: "quotes", label: "Make curly quotes and dashes plain", fn: function(s) {
      return s.replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...");
    } },
    // Only Latin letters lose their marks. Other scripts, such as Cyrillic, keep their letters.
    { value: "accents", label: "Remove accents from Latin letters (\xE9 \u2192 e)", fn: function(s) {
      return s.normalize("NFD").replace(/([A-Za-z])[\u0300-\u036f]+/g, "$1").normalize("NFC");
    } },
    { value: "unicode", label: "Normalize Unicode (same letter, one code)", fn: function(s) {
      return s.normalize("NFC");
    } },
    { value: "spaces", label: "Replace odd spaces and line breaks with one space, trim", fn: function(s) {
      return s.replace(/\s+/g, " ").trim();
    } }
  ];
  DL.registerOp({
    id: "textClean",
    name: "Clean Text",
    category: "Text",
    icon: "bi-stars",
    description: "Remove accents, HTML tags, hidden control characters and odd spaces, and make quotes plain.",
    keywords: "accent diacritic html tags entities unicode normalize whitespace nbsp smart quotes control characters",
    params: [
      { key: "columns", label: "Columns", type: "columns", required: false, help: "Leave empty to clean all columns." },
      {
        key: "steps",
        label: "Clean",
        type: "checkboxes",
        default: ["html", "control", "spaces", "unicode"],
        options: CLEAN_STEPS.map(function(s) {
          return { value: s.value, label: s.label };
        })
      }
    ],
    summary: function(p) {
      return p.steps.join(", ") + ": " + (p.columns.length ? p.columns.join(", ") : "all columns");
    },
    validate: function(p) {
      return p.steps.length ? [] : ["Choose at least one clean step."];
    },
    apply: function(table, p) {
      var idxs = DL.colIndexesOrAll(table, p.columns);
      var fns = CLEAN_STEPS.filter(function(s) {
        return p.steps.indexOf(s.value) >= 0;
      }).map(function(s) {
        return s.fn;
      });
      var stats = {};
      var out = DL.mapColumns(table, idxs, function(v, ctx) {
        if (v === "") return v;
        var r = v;
        for (var i = 0; i < fns.length; i++) r = fns[i](r);
        if (r !== v) ctx.tag();
        return r;
      }, stats);
      return { table: out, notes: ["Changed " + DL.pluralize(stats.tagged, "cell") + "."] };
    }
  });

  // packages/engine/src/ops/rows.ts
  function keyGetters(table, idxs, opts) {
    var trim = !!opts.trim, ignoreCase = !!opts.ignoreCase;
    return idxs.map(function(i) {
      var col = DL.col(table, i);
      if (trim || ignoreCase) {
        col = DL.mapValues(col, col.length, function(v) {
          return DL.normalizeKey(v, trim, ignoreCase);
        });
      }
      return function(r) {
        return col[r];
      };
    });
  }
  DL.keyGetters = keyGetters;
  DL.registerOp({
    id: "dedupe",
    name: "Remove Duplicates",
    category: "Rows",
    icon: "bi-files",
    description: "Remove rows that repeat the same values in the chosen columns.",
    keywords: "duplicate distinct unique rows",
    params: [
      { key: "columns", label: "Compare these columns", type: "columns", required: false, help: "Leave empty to compare whole rows." },
      {
        key: "keep",
        label: "Keep",
        type: "select",
        default: "first",
        options: [{ value: "first", label: "First occurrence" }, { value: "last", label: "Last occurrence" }, { value: "none", label: "Only rows that never repeat" }]
      },
      { key: "ignoreCase", label: "Ignore case", type: "boolean", default: true },
      { key: "trim", label: "Ignore spaces around values", type: "boolean", default: true }
    ],
    summary: function(p) {
      return p.columns.length ? "By " + p.columns.join(", ") : "Whole rows";
    },
    apply: function(table, p) {
      var idxs = DL.colIndexesOrAll(table, p.columns);
      var n = table.length;
      var g = DL.groupRows(keyGetters(table, idxs, p), n);
      var first = g.first, count = g.count;
      var keep = [];
      var i;
      if (p.keep === "none") {
        for (i = 0; i < n; i++) if (count[first[i]] === 1) keep.push(i);
      } else if (p.keep === "last") {
        var lastOf = new Int32Array(n);
        for (i = 0; i < n; i++) lastOf[first[i]] = i;
        for (i = 0; i < n; i++) if (lastOf[first[i]] === i) keep.push(i);
      } else {
        for (i = 0; i < n; i++) if (first[i] === i) keep.push(i);
      }
      return { table: DL.selectRows(table, keep), notes: ["Removed " + DL.pluralize(n - keep.length, "duplicate row") + "."] };
    }
  });
  DL.FILTER_OPERATORS = [
    { value: "contains", label: "contains", needs: "text" },
    { value: "notContains", label: "does not contain", needs: "text" },
    { value: "equals", label: "is exactly", needs: "text" },
    { value: "notEquals", label: "is not", needs: "text" },
    { value: "startsWith", label: "starts with", needs: "text" },
    { value: "endsWith", label: "ends with", needs: "text" },
    { value: "empty", label: "is empty", needs: "none" },
    { value: "notEmpty", label: "is not empty", needs: "none" },
    { value: "regex", label: "matches regular expression", needs: "text" },
    { value: "gt", label: "number is greater than", needs: "number" },
    { value: "gte", label: "number is at least", needs: "number" },
    { value: "lt", label: "number is less than", needs: "number" },
    { value: "lte", label: "number is at most", needs: "number" },
    { value: "between", label: "number is between", needs: "range" },
    { value: "isNumber", label: "is a number", needs: "none" },
    { value: "notNumber", label: "is not a number", needs: "none" },
    { value: "dateBefore", label: "date is before", needs: "date" },
    { value: "dateAfter", label: "date is after", needs: "date" },
    { value: "inList", label: "is one of (comma separated)", needs: "text" },
    { value: "notInList", label: "is not one of (comma separated)", needs: "text" }
  ];
  function memoDate(test, dayFirst) {
    var read = DL.memoDate(dayFirst);
    return function(v) {
      return test(read(v));
    };
  }
  DL.buildCondition = function(c, opts) {
    var matchCase = !!(opts && opts.matchCase);
    var val = c.value == null ? "" : String(c.value);
    var cmp = matchCase ? val : val.toLowerCase();
    var norm = matchCase ? function(s) {
      return s;
    } : function(s) {
      return s.toLowerCase();
    };
    var dayFirst = !!(opts && opts.dayFirst);
    var n = DL.toNumber(val), n2 = DL.toNumber(c.value2), d = DL.toDate(val, dayFirst);
    var toNumber = DL.toNumber;
    var list;
    switch (c.op) {
      case "contains":
        return function(v) {
          return norm(v).indexOf(cmp) >= 0;
        };
      case "notContains":
        return function(v) {
          return norm(v).indexOf(cmp) < 0;
        };
      case "equals":
        cmp = cmp.trim();
        return function(v) {
          return norm(v.trim()) === cmp;
        };
      case "notEquals":
        cmp = cmp.trim();
        return function(v) {
          return norm(v.trim()) !== cmp;
        };
      case "startsWith":
        return function(v) {
          return norm(v).indexOf(cmp) === 0;
        };
      case "endsWith":
        return function(v) {
          var s = norm(v);
          return s.length >= cmp.length && s.lastIndexOf(cmp) === s.length - cmp.length;
        };
      case "empty":
        return function(v) {
          return DL.isBlank(v);
        };
      case "notEmpty":
        return function(v) {
          return v.trim() !== "";
        };
      case "regex":
        var re = new RegExp(val, matchCase ? "u" : "iu");
        return function(v) {
          return re.test(v);
        };
      case "gt":
        return function(v) {
          return toNumber(v) > n;
        };
      case "gte":
        return function(v) {
          return toNumber(v) >= n;
        };
      case "lt":
        return function(v) {
          return toNumber(v) < n;
        };
      case "lte":
        return function(v) {
          return toNumber(v) <= n;
        };
      case "between":
        var lo = Math.min(n, n2), hi = Math.max(n, n2);
        return function(v) {
          var x = toNumber(v);
          return x >= lo && x <= hi;
        };
      case "isNumber":
        return function(v) {
          return !isNaN(toNumber(v));
        };
      case "notNumber":
        return function(v) {
          return v.trim() !== "" && isNaN(toNumber(v));
        };
      case "dateBefore":
        return memoDate(function(t) {
          return t < d;
        }, dayFirst);
      case "dateAfter":
        return memoDate(function(t) {
          return t > d;
        }, dayFirst);
      case "inList":
      case "notInList":
        list = new Set(val.split(",").map(function(s) {
          return norm(s.trim());
        }).filter(function(s) {
          return s !== "";
        }));
        if (c.op === "inList") return function(v) {
          return list.has(norm(v.trim()));
        };
        return function(v) {
          return !list.has(norm(v.trim()));
        };
      default:
        throw new Error('Unknown filter rule "' + c.op + '".');
    }
  };
  DL.registerOp({
    id: "filter",
    name: "Filter Rows",
    category: "Rows",
    icon: "bi-funnel",
    description: "Keep or remove rows that match one or more rules.",
    keywords: "where condition exclude include search rows",
    params: [
      {
        key: "action",
        label: "Action",
        type: "select",
        default: "keep",
        options: [{ value: "keep", label: "Keep matching rows" }, { value: "remove", label: "Remove matching rows" }]
      },
      {
        key: "logic",
        label: "A row matches when",
        type: "select",
        default: "all",
        options: [{ value: "all", label: "All rules are true" }, { value: "any", label: "Any rule is true" }]
      },
      { key: "conditions", label: "Rules", type: "conditions" },
      { key: "matchCase", label: "Match case", type: "boolean", default: false },
      DL.DAY_FIRST
    ],
    summary: function(p) {
      return (p.action === "remove" ? "Remove" : "Keep") + " rows where " + p.conditions.map(function(x) {
        var def = DL.findOption(DL.FILTER_OPERATORS, x.op);
        return x.column + " " + (def ? def.label : x.op) + (x.value ? ' "' + x.value + '"' : "") + (def && def.needs === "range" && x.value2 ? ' and "' + x.value2 + '"' : "");
      }).join(p.logic === "any" ? " or " : " and ");
    },
    apply: function(table, p) {
      var tests = p.conditions.map(function(c) {
        return { col: DL.col(table, DL.requireCol(table, c.column)), fn: DL.buildCondition(c, p) };
      });
      var any = p.logic === "any";
      var keepMatch = p.action !== "remove";
      var n = table.length;
      var m = tests.length;
      var keep = [];
      for (var i = 0; i < n; i++) {
        var match;
        if (any) {
          match = false;
          for (var k = 0; k < m; k++) if (tests[k].fn(tests[k].col[i])) {
            match = true;
            break;
          }
        } else {
          match = true;
          for (k = 0; k < m; k++) if (!tests[k].fn(tests[k].col[i])) {
            match = false;
            break;
          }
        }
        if (match === keepMatch) keep.push(i);
      }
      return { table: DL.selectRows(table, keep), notes: [(keepMatch ? "Kept " : "Removed ") + DL.pluralize(keepMatch ? keep.length : n - keep.length, "row") + " of " + n + "."] };
    }
  });
  function textRanks(col, n, dir, emptyLast) {
    var g = DL.groupRows([function(i2) {
      return col[i2];
    }], n);
    var reps = [];
    for (var i = 0; i < n; i++) if (g.first[i] === i) reps.push(i);
    var keys = new Array(n);
    var allKeys = true;
    for (i = 0; i < reps.length && allKeys; i++) {
      var k = DL.sortKey(col[reps[i]]);
      if (k === null) allKeys = false;
      else keys[reps[i]] = k;
    }
    var cmp = DL.compareText;
    var compare = function(a, b) {
      var va = col[a], vb = col[b];
      var ea = va === "", eb = vb === "";
      if (ea || eb) {
        if (ea && eb) return 0;
        return (ea ? 1 : -1) * emptyLast;
      }
      if (allKeys) {
        var ka = keys[a], kb = keys[b];
        return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
      }
      return cmp(va, vb) * dir;
    };
    reps.sort(compare);
    var rankOf = new Int32Array(n);
    var rank = 0;
    for (i = 0; i < reps.length; i++) {
      if (i > 0 && compare(reps[i - 1], reps[i]) !== 0) rank++;
      rankOf[reps[i]] = rank;
    }
    var ranks = new Int32Array(n);
    for (i = 0; i < n; i++) ranks[i] = rankOf[g.first[i]];
    return { ranks, groups: rank + 1 };
  }
  function numberRanks(vals, n, dir, emptyLast) {
    var picked = [];
    for (var i = 0; i < n; i++) if (vals[i] === vals[i]) picked.push(vals[i]);
    var sorted = Float64Array.from(picked).sort();
    var distinct = [];
    for (i = 0; i < sorted.length; i++) if (i === 0 || sorted[i] !== sorted[i - 1]) distinct.push(sorted[i]);
    var groups = distinct.length;
    var ranks = new Int32Array(n);
    var emptyRank = emptyLast > 0 ? groups : 0;
    var offset = emptyLast > 0 ? 0 : 1;
    for (i = 0; i < n; i++) {
      var v = vals[i];
      if (v !== v) {
        ranks[i] = emptyRank;
        continue;
      }
      var lo = 0, hi = groups - 1;
      while (lo < hi) {
        var mid = lo + hi >> 1;
        if (distinct[mid] < v) lo = mid + 1;
        else hi = mid;
      }
      ranks[i] = offset + (dir > 0 ? lo : groups - 1 - lo);
    }
    return { ranks, groups: groups + 1 };
  }
  function countingSort(order, ranks, groups) {
    var n = order.length;
    var starts = new Int32Array(groups + 1);
    for (var i = 0; i < n; i++) starts[ranks[order[i]] + 1]++;
    for (i = 0; i < groups; i++) starts[i + 1] += starts[i];
    var out = new Uint32Array(n);
    for (i = 0; i < n; i++) {
      var r = order[i];
      out[starts[ranks[r]]++] = r;
    }
    return out;
  }
  DL.registerOp({
    id: "sort",
    name: "Sort Rows",
    category: "Rows",
    icon: "bi-sort-alpha-down",
    description: "Order rows by one or more columns as text, numbers or dates.",
    keywords: "order arrange ascending descending",
    params: [
      { key: "keys", label: "Sort by", type: "sortKeys" },
      { key: "emptyLast", label: "Put empty values last", type: "boolean", default: true },
      DL.DAY_FIRST
    ],
    summary: function(p) {
      return p.keys.map(function(k) {
        return k.column + " " + (k.dir === "desc" ? "\u2193" : "\u2191");
      }).join(", ");
    },
    apply: function(table, p) {
      var n = table.length;
      var emptyLast = p.emptyLast !== false ? 1 : -1;
      var keys = p.keys.map(function(k2) {
        var col = DL.col(table, DL.requireCol(table, k2.column));
        var type = k2.type === "auto" ? DL.detectType(col) : k2.type;
        var dir = k2.dir === "desc" ? -1 : 1;
        var ranked;
        if (type === "text") ranked = textRanks(col, n, dir, emptyLast);
        else {
          var dayFirst = !!p.dayFirst;
          var parse = type === "number" ? DL.toNumber : function(v) {
            return DL.toDate(v, dayFirst);
          };
          var parsed = DL.mapValues(col, n, function(v) {
            return v === "" ? NaN : parse(v);
          });
          var vals = new Float64Array(n);
          for (var i = 0; i < n; i++) vals[i] = parsed[i];
          ranked = numberRanks(vals, n, dir, emptyLast);
        }
        return { column: k2.column, type, ranks: ranked.ranks, groups: ranked.groups };
      });
      var order = new Uint32Array(n);
      for (var j = 0; j < n; j++) order[j] = j;
      for (var k = keys.length - 1; k >= 0; k--) order = countingSort(order, keys[k].ranks, keys[k].groups);
      return { table: DL.selectRows(table, order), notes: keys.map(function(k2) {
        return k2.column + " sorted as " + k2.type;
      }) };
    }
  });
  var OUTLIER = "Outlier";
  DL.registerOp({
    id: "outliers",
    name: "Find Outliers",
    category: "Rows",
    icon: "bi-graph-up-arrow",
    description: "Find unusually high or low numbers in a column. Keep them, remove them or flag them.",
    keywords: "anomaly extreme statistics iqr",
    params: [
      { key: "column", label: "Number column", type: "column" },
      {
        key: "method",
        label: "Method",
        type: "select",
        default: "iqr",
        options: [
          { value: "iqr", label: "Quartiles (IQR) - good for most data" },
          { value: "zscore", label: "Standard deviations from the mean" },
          { value: "percentile", label: "Top and bottom percent" }
        ]
      },
      { key: "factor", label: "IQR multiplier", type: "number", default: 1.5, min: 0, required: true, help: "1.5 is the usual choice. Use 3 to only find extreme values.", showIf: function(p) {
        return p.method === "iqr";
      } },
      { key: "zthreshold", label: "Standard deviations", type: "number", default: 3, min: 0, required: true, showIf: function(p) {
        return p.method === "zscore";
      } },
      { key: "percent", label: "Percent at each end", type: "number", default: 1, min: 0, max: 50, required: true, showIf: function(p) {
        return p.method === "percentile";
      } },
      {
        key: "action",
        label: "Then",
        type: "select",
        default: "keep",
        options: [
          { value: "keep", label: "Keep only the outliers (to review them)" },
          { value: "remove", label: "Remove the outliers" },
          { value: "flag", label: "Add a column that marks outliers" }
        ]
      },
      { key: "flagColumn", label: "Flag column name", type: "text", default: OUTLIER, notBlank: true, showIf: function(p) {
        return p.action === "flag";
      } }
    ],
    summary: function(p) {
      return p.action + ' outliers in "' + p.column + '" (' + p.method + ")";
    },
    outputColumns: function(cols, p) {
      return p.action === "flag" ? cols.concat([DL.newColumnName(cols, p.flagColumn, OUTLIER)]) : cols;
    },
    apply: function(table, p) {
      var col = DL.col(table, DL.requireCol(table, p.column));
      var n = table.length;
      var nums = new Float64Array(n);
      var validCount = 0;
      for (var i = 0; i < n; i++) {
        var x = DL.toNumber(col[i]);
        nums[i] = x;
        if (x === x) validCount++;
      }
      if (!validCount) {
        var none = p.action === "flag" ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, OUTLIER), new Array(n).fill("")) : p.action === "keep" ? DL.selectRows(table, []) : table;
        return { table: none, notes: ['Column "' + p.column + '" has no numbers.'], status: n ? "warning" : "ok" };
      }
      var sorted = new Float64Array(validCount);
      for (i = 0, validCount = 0; i < n; i++) if (nums[i] === nums[i]) sorted[validCount++] = nums[i];
      sorted.sort();
      var lo, hi, notes = [];
      var q = function(f2) {
        var pos = (sorted.length - 1) * f2;
        var b = Math.floor(pos), r = pos - b;
        return b + 1 < sorted.length ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
      };
      if (p.method === "zscore") {
        var mean = 0;
        for (i = 0; i < sorted.length; i++) mean += sorted[i];
        mean /= sorted.length;
        var sd = 0;
        for (i = 0; i < sorted.length; i++) sd += (sorted[i] - mean) * (sorted[i] - mean);
        sd = Math.sqrt(sd / sorted.length);
        var z = Number(p.zthreshold);
        lo = mean - z * sd;
        hi = mean + z * sd;
        notes.push("Mean " + round(mean) + ", standard deviation " + round(sd) + ".");
      } else if (p.method === "percentile") {
        var pc = Math.min(50, Math.max(0, Number(p.percent))) / 100;
        lo = q(pc);
        hi = q(1 - pc);
      } else {
        var q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
        var f = Number(p.factor);
        lo = q1 - f * iqr;
        hi = q3 + f * iqr;
      }
      notes.push("Normal range: " + round(lo) + " to " + round(hi) + ".");
      var count = 0;
      var flags = p.action === "flag" ? new Array(n) : null;
      var keepOut = p.action === "keep";
      var keep = [];
      for (i = 0; i < n; i++) {
        var v = nums[i];
        var isOut = v === v && (v < lo || v > hi);
        if (isOut) count++;
        if (flags) flags[i] = isOut ? v < lo ? "low" : "high" : "";
        else if (isOut === keepOut) keep.push(i);
      }
      var out = flags ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, OUTLIER), flags) : DL.selectRows(table, keep);
      notes.unshift("Found " + DL.pluralize(count, "outlier") + ".");
      return { table: out, notes };
    }
  });
  function round(x) {
    return Math.round(x * 1e3) / 1e3;
  }
  DL.registerOp({
    id: "unique",
    name: "Unique Values",
    category: "Rows",
    icon: "bi-list-check",
    description: "List each different value (or combination of values) once, with how often it appears.",
    keywords: "distinct count group summary frequency",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      { key: "count", label: 'Add a "Count" column', type: "boolean", default: true },
      { key: "ignoreCase", label: "Ignore case", type: "boolean", default: false },
      { key: "trim", label: "Ignore spaces around values", type: "boolean", default: true },
      {
        key: "sortBy",
        label: "Order",
        type: "select",
        default: "first",
        options: [{ value: "first", label: "First appearance" }, { value: "count", label: "Most common first" }, { value: "value", label: "Value A \u2192 Z" }]
      }
    ],
    summary: function(p) {
      return "Unique " + p.columns.join(" + ");
    },
    outputColumns: function(cols, p) {
      var out = p.columns.filter(function(c) {
        return cols.indexOf(c) >= 0;
      });
      if (p.count) out.push(DL.uniqueName(out, "Count"));
      return out;
    },
    apply: function(table, p) {
      var idxs = p.columns.map(function(c) {
        return DL.requireCol(table, c);
      });
      var n = table.length;
      var getters = keyGetters(table, idxs, p);
      var g = DL.groupRows(getters, n);
      var entries = [];
      for (var i = 0; i < n; i++) if (g.first[i] === i) entries.push({ row: i, count: g.count[i] });
      var keyText = function(row) {
        return getters.map(function(get) {
          return get(row);
        }).join("\0");
      };
      if (p.sortBy === "count") entries.sort(function(a, b) {
        return b.count - a.count || a.row - b.row;
      });
      else if (p.sortBy === "value") entries.sort(function(a, b) {
        return DL.compareText(keyText(a.row), keyText(b.row));
      });
      var out = DL.selectRows(DL.pickColumns(table, idxs), entries.map(function(e) {
        return e.row;
      }));
      if (p.trim) out = DL.mapColumns(out, DL.allIndexes(out), function(v) {
        return v.trim();
      });
      if (p.count) out = DL.addColumn(out, DL.uniqueName(out.columns, "Count"), entries.map(function(e) {
        return String(e.count);
      }));
      return { table: out, notes: [DL.pluralize(out.length, "unique value") + " in " + DL.pluralize(n, "row") + "."] };
    }
  });

  // packages/engine/src/ops/columns.ts
  var hasOwn = Object.prototype.hasOwnProperty;
  DL.registerOp({
    id: "rename",
    name: "Rename Columns",
    category: "Columns",
    icon: "bi-input-cursor-text",
    description: "Change column headers.",
    keywords: "header title label",
    params: [
      { key: "map", label: "New names", type: "renameMap", help: "Leave a name empty to keep it unchanged." }
    ],
    summary: function(p) {
      var m = p.map;
      return Object.keys(m).filter(function(k) {
        return m[k];
      }).map(function(k) {
        return k + " \u2192 " + m[k];
      }).join(", ");
    },
    validate: function(p, cols) {
      var m = p.map;
      var changed = Object.keys(m).filter(function(k) {
        return m[k].trim() !== "" && m[k] !== k;
      });
      if (!changed.length) return ["Enter at least one new name."];
      if (!cols) return [];
      return duplicateNames(renameColumns(cols, m).columns).map(function(c) {
        return 'Two columns would be named "' + c + '". Names must be unique.';
      });
    },
    outputColumns: function(cols, p) {
      return renameColumns(cols, p.map).columns;
    },
    apply: function(table, p) {
      var res = renameColumns(table.columns, p.map);
      var dup = duplicateNames(res.columns);
      if (dup.length) throw new Error('Two columns would be named "' + dup[0] + '".');
      return { table: DL.makeTable(res.columns, table.cols, table.length), notes: ["Renamed " + DL.pluralize(res.count, "column") + "."] };
    }
  });
  function renameColumns(cols, map) {
    var count = 0;
    var out = cols.map(function(c) {
      var n = hasOwn.call(map, c) ? map[c].trim() : "";
      if (n !== "" && n !== c) {
        count++;
        return n;
      }
      return c;
    });
    return { columns: out, count };
  }
  function duplicateNames(cols) {
    var seen = /* @__PURE__ */ Object.create(null);
    var out = [];
    cols.forEach(function(c) {
      if (seen[c] && out.indexOf(c) < 0) out.push(c);
      seen[c] = true;
    });
    return out;
  }
  DL.registerOp({
    id: "reorder",
    name: "Reorder Columns",
    category: "Columns",
    icon: "bi-arrow-down-up",
    description: "Change the order of the columns. Drag to move.",
    keywords: "move arrange position",
    params: [
      { key: "order", label: "Column order", type: "columnOrder", help: "Columns not in this list are placed at the end in their original order." }
    ],
    summary: function(p) {
      return p.order.join(", ");
    },
    outputColumns: function(cols, p) {
      return reorder(cols, p.order);
    },
    apply: function(table, p) {
      var cols = reorder(table.columns, p.order);
      return { table: DL.pickColumns(table, cols.map(function(c) {
        return table.columns.indexOf(c);
      })) };
    }
  });
  function reorder(cols, order) {
    var out = order.filter(function(c) {
      return cols.indexOf(c) >= 0;
    });
    cols.forEach(function(c) {
      if (out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }
  DL.registerOp({
    id: "remove",
    name: "Remove Columns",
    category: "Columns",
    icon: "bi-x-square",
    description: "Delete columns you do not need.",
    keywords: "delete drop keep select",
    params: [
      {
        key: "mode",
        label: "Mode",
        type: "select",
        default: "remove",
        options: [{ value: "remove", label: "Remove the chosen columns" }, { value: "keep", label: "Keep only the chosen columns" }]
      },
      { key: "columns", label: "Columns", type: "columns" }
    ],
    summary: function(p) {
      return (p.mode === "keep" ? "Keep only " : "Remove ") + p.columns.join(", ");
    },
    validate: function(p, cols) {
      if (!cols || p.mode === "keep") return [];
      var present = p.columns.filter(function(c) {
        return cols.indexOf(c) >= 0;
      });
      if (cols.length && present.length >= cols.length) return ["You cannot remove every column."];
      return [];
    },
    outputColumns: function(cols, p) {
      var set = p.columns;
      return p.mode === "keep" ? cols.filter(function(c) {
        return set.indexOf(c) >= 0;
      }) : cols.filter(function(c) {
        return set.indexOf(c) < 0;
      });
    },
    apply: function(table, p) {
      var chosen = DL.colIndexes(table, p.columns);
      var drop = p.mode === "keep" ? DL.allIndexes(table).filter(function(i) {
        return chosen.indexOf(i) < 0;
      }) : chosen;
      if (drop.length >= table.columns.length) throw new Error("You cannot remove every column.");
      return { table: DL.dropColumns(table, drop) };
    }
  });
  var NEW_COLUMN = "New Column";
  DL.registerOp({
    id: "addColumn",
    name: "Add Column",
    category: "Columns",
    icon: "bi-plus-square",
    description: "Add a new column with a fixed value, a row number, or today's date.",
    keywords: "constant static new field index",
    params: [
      { key: "name", label: "Column name", type: "text", default: NEW_COLUMN, notBlank: true },
      {
        key: "kind",
        label: "Fill with",
        type: "select",
        default: "value",
        options: [
          { value: "value", label: "A fixed value" },
          { value: "rowNumber", label: "Row number" },
          { value: "today", label: "Today's date" },
          { value: "empty", label: "Nothing (empty)" }
        ]
      },
      { key: "value", label: "Value", type: "text", default: "", showIf: function(p) {
        return p.kind === "value";
      } },
      { key: "start", label: "Start at", type: "number", default: 1, required: true, integer: true, showIf: function(p) {
        return p.kind === "rowNumber";
      } },
      {
        key: "position",
        label: "Position",
        type: "select",
        default: "end",
        options: [{ value: "end", label: "Last column" }, { value: "start", label: "First column" }]
      }
    ],
    summary: function(p) {
      return '"' + p.name + '"' + (p.kind === "value" ? ' = "' + p.value + '"' : " (" + p.kind + ")");
    },
    outputColumns: function(cols, p) {
      var n = DL.newColumnName(cols, p.name, NEW_COLUMN);
      return p.position === "start" ? [n].concat(cols) : cols.concat([n]);
    },
    // "Today" changes with the day, so the cached result must change too.
    hashExtra: function(p) {
      return p.kind === "today" ? DL.formatDateISO(DL.startOfDay(Date.now())) : "";
    },
    apply: function(table, p) {
      var name = DL.newColumnName(table.columns, p.name, NEW_COLUMN);
      var n = table.length;
      var values = new Array(n);
      var i;
      if (p.kind === "rowNumber") {
        var start = Number(p.start) || 0;
        for (i = 0; i < n; i++) values[i] = String(start + i);
      } else {
        var val = p.kind === "value" ? DL.unescapeText(p.value) : p.kind === "today" ? DL.formatDateISO(DL.startOfDay(Date.now())) : "";
        for (i = 0; i < n; i++) values[i] = val;
      }
      return { table: DL.addColumn(table, name, values, p.position) };
    }
  });
  DL.registerOp({
    id: "fill",
    name: "Fill Empty Values",
    category: "Columns",
    icon: "bi-arrow-bar-down",
    description: "Fill empty cells with the value above, a fixed value, the average or the most common value.",
    keywords: "fill down blank missing null default impute",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      {
        key: "mode",
        label: "Fill with",
        type: "select",
        default: "above",
        options: [
          { value: "above", label: "The value above (fill down)" },
          { value: "below", label: "The value below (fill up)" },
          { value: "value", label: "A fixed value" },
          { value: "average", label: "The average of the column" },
          { value: "common", label: "The most common value" }
        ]
      },
      { key: "value", label: "Fixed value", type: "text", default: "", showIf: function(p) {
        return p.mode === "value";
      } },
      { key: "decimals", label: "Decimals for the average", type: "number", default: 2, min: 0, max: 15, integer: true, required: true, showIf: function(p) {
        return p.mode === "average";
      } },
      { key: "blankIsEmpty", label: "Treat cells with only spaces as empty", type: "boolean", default: true }
    ],
    summary: function(p) {
      return p.mode + ": " + p.columns.join(", ");
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var n = table.length;
      var blankIsEmpty = !!p.blankIsEmpty;
      var isEmpty = function(v) {
        return v === "" || blankIsEmpty && DL.isBlank(v);
      };
      var cols = table.cols.slice();
      var filled = 0;
      idxs.forEach(function(c) {
        var src = DL.col(table, c);
        var out = new Array(n);
        var i, v;
        if (p.mode === "above" || p.mode === "below") {
          var last = "";
          var start = p.mode === "above" ? 0 : n - 1, step = p.mode === "above" ? 1 : -1;
          for (i = start; i >= 0 && i < n; i += step) {
            v = src[i];
            if (isEmpty(v)) {
              out[i] = last;
              if (last !== v) filled++;
            } else {
              out[i] = v;
              last = v;
            }
          }
        } else {
          var fillValue = DL.unescapeText(p.value);
          if (p.mode === "average") {
            var sum = 0, count = 0;
            for (i = 0; i < n; i++) {
              var x = DL.toNumber(src[i]);
              if (x === x) {
                sum += x;
                count++;
              }
            }
            fillValue = count ? DL.formatFixed(sum / count, Number(p.decimals)) : "";
          } else if (p.mode === "common") {
            var g = DL.groupRows([function(r) {
              return src[r];
            }], n);
            var best = -1, bestCount = 0;
            for (i = 0; i < n; i++) if (g.first[i] === i && !isEmpty(src[i]) && g.count[i] > bestCount) {
              best = i;
              bestCount = g.count[i];
            }
            fillValue = best >= 0 ? src[best] : "";
          }
          for (i = 0; i < n; i++) {
            v = src[i];
            if (isEmpty(v)) {
              out[i] = fillValue;
              if (fillValue !== v) filled++;
            } else out[i] = v;
          }
        }
        cols[c] = out;
      });
      return { table: DL.makeTable(table.columns, cols, n), notes: ["Changed " + DL.pluralize(filled, "cell") + "."] };
    }
  });
  var RESULT = "Result";
  var CALC = {
    "+": function(a, b) {
      return a + b;
    },
    "-": function(a, b) {
      return a - b;
    },
    "*": function(a, b) {
      return a * b;
    },
    "/": function(a, b) {
      return b === 0 ? NaN : a / b;
    },
    "%": function(a, b) {
      return b === 0 ? NaN : a % b;
    },
    "pct": function(a, b) {
      return b === 0 ? NaN : a / b * 100;
    }
  };
  DL.registerOp({
    id: "calculate",
    name: "Calculate",
    category: "Columns",
    icon: "bi-calculator",
    description: "Add, subtract, multiply or divide two columns (or a column and a number) into a new column.",
    keywords: "math arithmetic sum product formula",
    params: [
      { key: "left", label: "First column", type: "column" },
      {
        key: "operator",
        label: "Operation",
        type: "select",
        default: "+",
        options: [
          { value: "+", label: "+  add" },
          { value: "-", label: "\u2212  subtract" },
          { value: "*", label: "\xD7  multiply" },
          { value: "/", label: "\xF7  divide" },
          { value: "%", label: "%  remainder" },
          { value: "pct", label: "% of (first as percent of second)" }
        ]
      },
      {
        key: "rightKind",
        label: "Second value",
        type: "select",
        default: "column",
        options: [{ value: "column", label: "Another column" }, { value: "number", label: "A fixed number" }]
      },
      { key: "right", label: "Second column", type: "column", showIf: function(p) {
        return p.rightKind !== "number";
      } },
      { key: "rightNumber", label: "Number", type: "number", default: 1, required: true, showIf: function(p) {
        return p.rightKind === "number";
      } },
      { key: "output", label: "New column name", type: "text", default: RESULT, notBlank: true },
      { key: "decimals", label: "Round to decimals", type: "number", default: "", min: 0, max: 15, integer: true, help: "Leave empty to keep all decimals." },
      {
        key: "onError",
        label: "When a value is not a number",
        type: "select",
        default: "blank",
        options: [{ value: "blank", label: "Leave the result empty" }, { value: "zero", label: "Treat it as 0" }, { value: "text", label: 'Write "error"' }]
      }
    ],
    summary: function(p) {
      return p.output + " = " + p.left + " " + p.operator + " " + (p.rightKind === "number" ? p.rightNumber : p.right);
    },
    outputColumns: function(cols, p) {
      return cols.concat([DL.newColumnName(cols, p.output, RESULT)]);
    },
    apply: function(table, p) {
      var useNum = p.rightKind === "number";
      var left = DL.col(table, DL.requireCol(table, p.left));
      var right = useNum ? null : DL.col(table, DL.requireCol(table, p.right));
      var constant = DL.toNumber(p.rightNumber);
      var dec = p.decimals === "" ? -1 : Math.max(0, Math.min(15, Number(p.decimals)));
      var calc = CALC[p.operator] || CALC["+"];
      var errText = p.onError === "text" ? "error" : "";
      var zeroOnError = p.onError === "zero";
      var bad = 0;
      var n = table.length;
      var toNumber = DL.toNumber;
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var a = toNumber(left[i]);
        var b = useNum ? constant : toNumber(right[i]);
        if (a !== a || b !== b) {
          if (zeroOnError) {
            if (a !== a) a = 0;
            if (b !== b) b = 0;
          } else {
            bad++;
            values[i] = errText;
            continue;
          }
        }
        var v = calc(a, b);
        if (v !== v || v === Infinity || v === -Infinity) {
          bad++;
          values[i] = errText;
        } else values[i] = dec >= 0 ? DL.formatFixed(v, dec) : DL.numberText(v);
      }
      var notes = bad ? [DL.pluralize(bad, "row") + " could not be calculated."] : [];
      return { table: DL.addColumn(table, DL.newColumnName(table.columns, p.output, RESULT), values), notes };
    }
  });
  DL.registerOp({
    id: "numFormat",
    name: "Format Numbers",
    category: "Columns",
    icon: "bi-123",
    description: "Clean up numbers: fixed decimals, thousands separators, currency symbols and percent signs.",
    keywords: "decimal round currency thousands separator numeric",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      { key: "decimals", label: "Decimals", type: "number", default: 2, min: 0, max: 15, integer: true, required: true },
      {
        key: "thousands",
        label: "Thousands separator",
        type: "select",
        default: "",
        options: [{ value: "", label: "None (1234567)" }, { value: ",", label: "Comma (1,234,567)" }, { value: ".", label: "Period (1.234.567)" }, { value: " ", label: "Space (1 234 567)" }, { value: "'", label: "Apostrophe (1'234'567)" }]
      },
      {
        key: "decimalSep",
        label: "Decimal separator",
        type: "select",
        default: ".",
        options: [{ value: ".", label: "Period (3.14)" }, { value: ",", label: "Comma (3,14)" }]
      },
      { key: "prefix", label: "Prefix", type: "text", default: "", help: 'For example "$".' },
      { key: "suffix", label: "Suffix", type: "text", default: "", help: 'For example "%".' },
      {
        key: "negative",
        label: "Negative numbers",
        type: "select",
        default: "minus",
        options: [{ value: "minus", label: "-1,234.50" }, { value: "parens", label: "(1,234.50)" }]
      },
      {
        key: "onError",
        label: "When a value is not a number",
        type: "select",
        default: "keep",
        options: [{ value: "keep", label: "Keep the text as it is" }, { value: "blank", label: "Make it empty" }]
      }
    ],
    summary: function(p) {
      return p.decimals + " decimals: " + p.columns.join(", ");
    },
    validate: function(p) {
      return p.thousands && p.thousands === p.decimalSep ? ["Thousands and decimal separators must be different."] : [];
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var dec = Math.max(0, Math.min(15, Number(p.decimals) || 0));
      var stats = {};
      var blankOnError = p.onError === "blank";
      var parens = p.negative === "parens";
      var out = DL.mapColumns(table, idxs, function(v, ctx) {
        if (v === "") return v;
        var n = DL.toNumber(v);
        if (n !== n) {
          if (DL.isBlank(v)) return v;
          ctx.tag();
          return blankOnError ? "" : v;
        }
        return DL.formatNumber(n, dec, p.thousands, p.decimalSep, p.prefix, p.suffix, parens);
      }, stats);
      return { table: out, notes: stats.tagged ? [DL.pluralize(stats.tagged, "value") + " could not be read as a number."] : [] };
    }
  });
  DL.registerOp({
    id: "javascript",
    name: "Custom JavaScript",
    category: "Advanced",
    icon: "bi-code-slash",
    description: 'Write a small JavaScript function that returns the value for a new column. Use row["Column name"] to read values.',
    keywords: "code script formula custom function",
    params: [
      { key: "output", label: "New column name", type: "text", default: RESULT, notBlank: true },
      {
        key: "code",
        label: "Code",
        type: "code",
        default: '// row is an object with one property per column.\n// index is the row number, starting at 0.\n// Return the value for the new column.\nreturn row["Column name"];',
        help: "The code runs once per row as the body of a function (row, index, num, date). num(x) and date(x) turn text into a number or a date."
      },
      { key: "replaceColumn", label: "Write into an existing column instead", type: "column", required: false, help: "Leave empty to create a new column." }
    ],
    summary: function(p) {
      return p.replaceColumn ? "Update " + p.replaceColumn : "Add " + p.output;
    },
    validate: function(p) {
      if (!p.code.trim()) return ["Write some code."];
      try {
        new Function("row", "index", "num", "date", p.code);
      } catch (e) {
        return ["The code has a syntax error: " + e.message];
      }
      return [];
    },
    outputColumns: function(cols, p) {
      return p.replaceColumn ? cols : cols.concat([DL.newColumnName(cols, p.output, RESULT)]);
    },
    apply: function(table, p) {
      var fn = new Function("row", "index", "num", "date", p.code);
      var cols = table.columns;
      var target = p.replaceColumn ? DL.requireCol(table, p.replaceColumn) : -1;
      var errors = 0, firstError = "";
      var dateFn = function(x) {
        var t = DL.toDate(x);
        return isNaN(t) ? null : new Date(t);
      };
      var n = table.length;
      var w = cols.length;
      var get = cols.map(function(name, c2) {
        return DL.cellGetter(table, c2);
      });
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var row = new Row();
        for (var c = 0; c < w; c++) row[cols[c]] = get[c](i);
        var v;
        try {
          v = fn(row, i, DL.toNumber, dateFn);
        } catch (e) {
          errors++;
          if (!firstError) firstError = e.message;
          v = "";
        }
        values[i] = v != null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : DL.cellText(v);
      }
      var notes = errors ? [DL.pluralize(errors, "row") + " caused an error. First error: " + firstError] : [];
      var out;
      if (target >= 0) {
        var newCols = table.cols.slice();
        newCols[target] = values;
        out = DL.makeTable(cols, newCols, n);
      } else out = DL.addColumn(table, DL.newColumnName(cols, p.output, "Result"), values);
      return { table: out, notes };
    }
  });
  function Row() {
  }
  Row.prototype = /* @__PURE__ */ Object.create(null);

  // packages/engine/src/ops/dates.ts
  var OUTPUT_FORMATS = [
    { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2024-01-31)" },
    { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss" },
    { value: "DD/MM/YYYY", label: "DD/MM/YYYY (31/01/2024)" },
    { value: "MM/DD/YYYY", label: "MM/DD/YYYY (01/31/2024)" },
    { value: "DD.MM.YYYY", label: "DD.MM.YYYY (31.01.2024)" },
    { value: "YYYYMMDD", label: "YYYYMMDD (20240131)" },
    { value: "D MMM YYYY", label: "D MMM YYYY (31 Jan 2024)" },
    { value: "MMMM D, YYYY", label: "MMMM D, YYYY (January 31, 2024)" },
    { value: "DDD D MMM YYYY", label: "DDD D MMM YYYY (Wed 31 Jan 2024)" },
    { value: "custom", label: "Custom pattern\u2026" }
  ];
  function outputPattern(p) {
    return p.format === "custom" ? p.pattern : p.format;
  }
  DL.registerOp({
    id: "dateFormat",
    name: "Format Dates",
    category: "Dates",
    icon: "bi-calendar3",
    description: "Read dates written in many ways and write them all in one format.",
    keywords: "date time parse convert iso",
    params: [
      { key: "columns", label: "Columns", type: "columns" },
      DL.DAY_FIRST,
      { key: "format", label: "Write as", type: "select", default: "YYYY-MM-DD", options: OUTPUT_FORMATS },
      {
        key: "pattern",
        label: "Custom pattern",
        type: "text",
        default: "YYYY-MM-DD",
        required: true,
        showIf: function(p) {
          return p.format === "custom";
        },
        help: "Tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D HH H mm ss A a. Put other letters in square brackets, for example [at]. Other characters stay as they are."
      },
      {
        key: "onError",
        label: "When a value is not a date",
        type: "select",
        default: "keep",
        options: [{ value: "keep", label: "Keep the text as it is" }, { value: "blank", label: "Make it empty" }]
      }
    ],
    summary: function(p) {
      return outputPattern(p) + ": " + p.columns.join(", ");
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var pattern = outputPattern(p);
      var blankOnError = p.onError === "blank";
      var dayFirst = !!p.dayFirst;
      var stats = {};
      var out = DL.mapColumns(table, idxs, function(v, ctx) {
        if (DL.isBlank(v)) return v;
        var t = DL.toDate(v, dayFirst);
        if (t !== t) {
          ctx.tag();
          return blankOnError ? "" : v;
        }
        return DL.formatDate(t, pattern);
      }, stats);
      return { table: out, notes: stats.tagged ? [DL.pluralize(stats.tagged, "value") + " could not be read as a date."] : [] };
    }
  });
  var UNITS = [{ value: "days", label: "Days" }, { value: "weeks", label: "Weeks" }, { value: "months", label: "Months" }, { value: "years", label: "Years" }];
  var PARTS = [
    { value: "year", label: "Year" },
    { value: "month", label: "Month number" },
    { value: "monthName", label: "Month name" },
    { value: "day", label: "Day of month" },
    { value: "weekday", label: "Weekday name" },
    { value: "weekdayNumber", label: "Weekday number (1 = Monday)" },
    { value: "week", label: "Week of year (ISO)" },
    { value: "quarter", label: "Quarter" },
    { value: "dayOfYear", label: "Day of year" },
    { value: "hour", label: "Hour" },
    { value: "minute", label: "Minute" }
  ];
  function addUnits(ts, n, unit) {
    var d = new Date(ts);
    if (unit === "days") d.setDate(d.getDate() + n);
    else if (unit === "weeks") d.setDate(d.getDate() + n * 7);
    else if (unit === "months") addMonths(d, n);
    else addMonths(d, n * 12);
    return d.getTime();
  }
  function addMonths(d, n) {
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var last = DL.localDate(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }
  function inRange(ts) {
    if (ts !== ts) return false;
    var y = new Date(ts).getFullYear();
    return y >= 0 && y <= 9999;
  }
  var startOfDay = DL.startOfDay;
  function diffUnits(a, b, unit) {
    if (unit === "days" || unit === "weeks") {
      var days = Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
      return unit === "days" ? days : Math.trunc(days / 7);
    }
    if (b < a) return -diffUnits(b, a, unit);
    var da = new Date(a), db = new Date(b);
    var months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
    var lastA = da.getDate() === DL.localDate(da.getFullYear(), da.getMonth() + 1, 0).getDate();
    var lastB = db.getDate() === DL.localDate(db.getFullYear(), db.getMonth() + 1, 0).getDate();
    if (db.getDate() < da.getDate() && !(lastA && lastB) && months > 0) months--;
    return unit === "months" ? months : Math.trunc(months / 12);
  }
  function isoWeek(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    var firstThursday = DL.localDate(d.getFullYear(), 0, 4);
    return 1 + Math.round(((+d - +firstThursday) / 864e5 - 3 + (firstThursday.getDay() + 6) % 7) / 7);
  }
  function datePart(ts, part) {
    var d = new Date(ts);
    switch (part) {
      case "year":
        return String(d.getFullYear());
      case "month":
        return String(d.getMonth() + 1);
      case "monthName":
        return DL.MONTH_NAMES[d.getMonth()];
      case "day":
        return String(d.getDate());
      case "weekday":
        return DL.DAY_NAMES[d.getDay()];
      case "weekdayNumber":
        return String((d.getDay() + 6) % 7 + 1);
      case "week":
        return String(isoWeek(ts));
      case "quarter":
        return String(Math.floor(d.getMonth() / 3) + 1);
      case "dayOfYear":
        return String(Math.round((startOfDay(ts) - DL.localDate(d.getFullYear(), 0, 1).getTime()) / 864e5) + 1);
      case "hour":
        return String(d.getHours());
      case "minute":
        return String(d.getMinutes());
      default:
        return "";
    }
  }
  var RESULT2 = "Result";
  DL.registerOp({
    id: "dateMath",
    name: "Date Math",
    category: "Dates",
    icon: "bi-calendar-plus",
    description: "Add or subtract time, find the days between two dates, or take a part of a date such as the year or weekday.",
    keywords: "date add subtract difference age days between year month weekday",
    params: [
      { key: "column", label: "Date column", type: "column" },
      DL.DAY_FIRST,
      {
        key: "mode",
        label: "Calculate",
        type: "select",
        default: "add",
        options: [
          { value: "add", label: "Add or subtract time" },
          { value: "diff", label: "Time between two dates" },
          { value: "part", label: "A part of the date" }
        ]
      },
      { key: "amount", label: "Amount (negative to subtract)", type: "number", default: 1, required: true, integer: true, min: -1e6, max: 1e6, showIf: function(p) {
        return p.mode === "add";
      } },
      { key: "unit", label: "Unit", type: "select", default: "days", options: UNITS, showIf: function(p) {
        return p.mode !== "part";
      } },
      {
        key: "otherKind",
        label: "Second date",
        type: "select",
        default: "column",
        showIf: function(p) {
          return p.mode === "diff";
        },
        options: [{ value: "column", label: "Another column" }, { value: "today", label: "Today" }, { value: "fixed", label: "A fixed date" }]
      },
      { key: "other", label: "Second date column", type: "column", showIf: function(p) {
        return p.mode === "diff" && p.otherKind === "column";
      } },
      { key: "fixedDate", label: "Fixed date", type: "text", default: "", required: true, showIf: function(p) {
        return p.mode === "diff" && p.otherKind === "fixed";
      }, help: "For example 2024-12-31." },
      { key: "part", label: "Part", type: "select", default: "year", options: PARTS, showIf: function(p) {
        return p.mode === "part";
      } },
      { key: "format", label: "Write dates as", type: "select", default: "YYYY-MM-DD", options: OUTPUT_FORMATS.filter(function(o) {
        return o.value !== "custom";
      }), showIf: function(p) {
        return p.mode === "add";
      } },
      { key: "output", label: "New column name", type: "text", default: RESULT2, notBlank: true }
    ],
    summary: function(p) {
      if (p.mode === "add") return p.output + " = " + p.column + " " + (Number(p.amount) < 0 ? "-" : "+") + " " + Math.abs(Number(p.amount)) + " " + p.unit;
      if (p.mode === "diff") return p.output + " = " + p.unit + " from " + p.column + " to " + (p.otherKind === "column" ? p.other : p.otherKind === "today" ? "today" : p.fixedDate);
      return p.output + " = " + p.part + " of " + p.column;
    },
    validate: function(p) {
      if (p.mode === "diff" && p.otherKind === "fixed" && isNaN(DL.toDate(p.fixedDate, p.dayFirst))) return ['Enter a date such as 2024-12-31 for "Fixed date".'];
      return [];
    },
    outputColumns: function(cols, p) {
      return cols.concat([DL.newColumnName(cols, p.output, RESULT2)]);
    },
    // "Today" changes with the day, so the cached result must change too.
    hashExtra: function(p) {
      return p.mode === "diff" && p.otherKind === "today" ? DL.formatDateISO(startOfDay(Date.now())) : "";
    },
    apply: function(table, p) {
      var col = DL.col(table, DL.requireCol(table, p.column));
      var dayFirst = !!p.dayFirst;
      var n = table.length;
      var stats = {};
      var values;
      var parse = function(v, ctx) {
        var t = DL.toDate(v, dayFirst);
        if (t !== t && v.trim() !== "") ctx.tag();
        return t;
      };
      if (p.mode === "add") {
        var amount = Number(p.amount);
        values = DL.mapValues(col, n, function(v, ctx) {
          var t = parse(v, ctx);
          if (t !== t) return "";
          var r = addUnits(t, amount, p.unit);
          if (!inRange(r)) {
            ctx.tag();
            return "";
          }
          return DL.formatDate(r, p.format);
        }, stats);
      } else if (p.mode === "diff" && p.otherKind === "column") {
        var otherCol = DL.col(table, DL.requireCol(table, p.other));
        var statsB = {};
        var ta = DL.mapValues(col, n, parse, stats);
        var tb = DL.mapValues(otherCol, n, parse, statsB);
        stats.tagged += statsB.tagged;
        values = new Array(n);
        for (var i = 0; i < n; i++) values[i] = ta[i] !== ta[i] || tb[i] !== tb[i] ? "" : String(diffUnits(ta[i], tb[i], p.unit));
      } else if (p.mode === "diff") {
        var fixed = p.otherKind === "today" ? startOfDay(Date.now()) : DL.toDate(p.fixedDate, dayFirst);
        values = DL.mapValues(col, n, function(v, ctx) {
          var t = parse(v, ctx);
          return t !== t ? "" : String(diffUnits(t, fixed, p.unit));
        }, stats);
      } else {
        values = DL.mapValues(col, n, function(v, ctx) {
          var t = parse(v, ctx);
          return t !== t ? "" : datePart(t, p.part);
        }, stats);
      }
      var notes = stats.tagged ? [DL.pluralize(stats.tagged, "value") + (p.mode === "add" ? " could not be read as a date, or the result is outside the years 0 to 9999." : " could not be read as a date.")] : [];
      return { table: DL.addColumn(table, DL.newColumnName(table.columns, p.output, RESULT2), values), notes };
    }
  });

  // packages/engine/src/ops/reshape.ts
  var MAX_PIVOT_COLUMNS = 1e3;
  var AGGREGATES = [
    { value: "sum", label: "Sum" },
    { value: "count", label: "Count" },
    { value: "avg", label: "Average" },
    { value: "min", label: "Minimum" },
    { value: "max", label: "Maximum" },
    { value: "first", label: "First value" },
    { value: "list", label: "All values, separated by a comma" }
  ];
  function isNumeric(agg) {
    return agg === "sum" || agg === "avg" || agg === "min" || agg === "max";
  }
  function Cell() {
    this.sum = 0;
    this.n = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.first = null;
    this.list = null;
  }
  function addValue(cell, v, agg) {
    if (DL.isBlank(v)) return true;
    if (isNumeric(agg)) {
      var x = DL.toNumber(v);
      if (x !== x) return false;
      cell.n++;
      cell.sum += x;
      if (x < cell.min) cell.min = x;
      if (x > cell.max) cell.max = x;
      return true;
    }
    cell.n++;
    if (cell.first === null) cell.first = v;
    if (agg === "list") (cell.list || (cell.list = [])).push(v);
    return true;
  }
  function cellText(cell, agg, decimals) {
    if (cell === void 0 || cell.n === 0) return agg === "count" ? "0" : "";
    switch (agg) {
      case "sum":
        return DL.formatFixed(cell.sum, decimals);
      case "avg":
        return DL.formatFixed(cell.sum / cell.n, decimals);
      case "min":
        return DL.formatFixed(cell.min, decimals);
      case "max":
        return DL.formatFixed(cell.max, decimals);
      case "count":
        return String(cell.n);
      case "first":
        return cell.first;
      default:
        return cell.list.join(", ");
    }
  }
  DL.registerOp({
    id: "pivot",
    name: "Pivot",
    category: "Rows",
    icon: "bi-grid-3x3",
    description: "Make a summary table: one row for each group, one column for each different value of a column, and a total in each cell.",
    keywords: "pivot summary crosstab group aggregate sum count average wide",
    params: [
      { key: "rows", label: "Group rows by", type: "columns", required: false, help: "The result has one row for each different combination of these values. Leave it empty for one total row." },
      { key: "columnKey", label: "Make a column for each value of", type: "column", help: "Each different value in this column becomes a new column. Leave it empty for one total column.", required: false },
      { key: "value", label: "Values to calculate", type: "column", required: false, help: "Leave it empty to count rows." },
      { key: "aggregate", label: "Calculate", type: "select", default: "sum", options: AGGREGATES },
      { key: "decimals", label: "Decimals", type: "number", default: 2, min: 0, max: 15, integer: true, required: true, showIf: function(p) {
        return isNumeric(p.aggregate);
      } }
    ],
    summary: function(p) {
      return p.aggregate + (p.value ? " of " + p.value : "") + (p.rows.length ? " by " + p.rows.join(", ") : "") + (p.columnKey ? " \xD7 " + p.columnKey : "");
    },
    validate: function(p) {
      var problems = [];
      if (!p.value && p.aggregate !== "count") problems.push('Choose a column for "Values to calculate", or set "Calculate" to Count.');
      if (p.columnKey && p.rows.indexOf(p.columnKey) >= 0) problems.push("The column for the new columns cannot also be a group column.");
      return problems;
    },
    outputColumns: function() {
      return null;
    },
    apply: function(table, p) {
      var n = table.length;
      var rowIdxs = DL.colIndexes(table, p.rows);
      var rowGetters = rowIdxs.map(function(c) {
        return DL.cellGetter(table, c);
      });
      var keyGetter = p.columnKey ? DL.cellGetter(table, DL.requireCol(table, p.columnKey)) : null;
      var valueGetter = p.value ? DL.cellGetter(table, DL.requireCol(table, p.value)) : function() {
        return "1";
      };
      var agg = p.value ? p.aggregate : "count";
      var decimals = Number(p.decimals);
      var groups = DL.groupRows(rowGetters, n);
      var groupOrder = [];
      var groupSlot = new Int32Array(n);
      var i;
      for (i = 0; i < n; i++) {
        if (groups.first[i] === i) {
          groupSlot[i] = groupOrder.length;
          groupOrder.push(i);
        }
      }
      var keyNames = [];
      var keySlot = /* @__PURE__ */ Object.create(null);
      var cells = [];
      var ignored = 0;
      if (!keyGetter) {
        keySlot[""] = 0;
        keyNames.push("");
      }
      for (i = 0; i < n; i++) {
        var key = keyGetter ? keyGetter(i) : "";
        var ks = keySlot[key];
        if (ks === void 0) {
          if (keyNames.length >= MAX_PIVOT_COLUMNS) {
            throw new Error('"' + p.columnKey + '" has more than ' + MAX_PIVOT_COLUMNS + " different values. Choose a column with fewer values.");
          }
          if ((keyNames.length + 1 + rowIdxs.length) * groupOrder.length > DL.maxCells) {
            throw new Error("The result would have more than " + DL.pluralize(DL.maxCells, "cell") + ", which is too many. Choose fewer group columns or a key column with fewer values.");
          }
          ks = keySlot[key] = keyNames.length;
          keyNames.push(key);
        }
        var gs = groupSlot[groups.first[i]];
        var row = cells[gs] || (cells[gs] = []);
        var cell = row[ks] || (row[ks] = new Cell());
        if (!addValue(cell, valueGetter(i), agg)) ignored++;
      }
      var columns = rowIdxs.map(function(c) {
        return table.columns[c];
      });
      var valueName = keyGetter ? null : DL.cleanName(p.value ? agg + " of " + p.value : "Count", "Total");
      var cols = [];
      var g, k;
      for (k = 0; k < rowIdxs.length; k++) {
        var out = new Array(groupOrder.length);
        for (g = 0; g < groupOrder.length; g++) out[g] = rowGetters[k](groupOrder[g]);
        cols.push(out);
      }
      var headers = keyGetter ? keyNames.map(function(name2) {
        return name2 === "" ? "(empty)" : DL.cleanName(name2, "(blank)");
      }) : [valueName];
      var names = new Array(keyNames.length);
      var emptyAt = keyGetter ? keyNames.indexOf("") : -1;
      if (emptyAt >= 0) names[emptyAt] = DL.uniqueName(columns, "(empty)");
      for (k = 0; k < keyNames.length; k++) {
        if (k !== emptyAt) names[k] = DL.uniqueName(columns.concat(names.filter(Boolean)), headers[k]);
      }
      for (k = 0; k < keyNames.length; k++) {
        var name = names[k];
        columns.push(name);
        var col = new Array(groupOrder.length);
        for (g = 0; g < groupOrder.length; g++) col[g] = cellText(cells[g][k], agg, decimals);
        cols.push(col);
      }
      var notes = [DL.pluralize(n, "row") + " became " + DL.pluralize(groupOrder.length, "row") + " and " + DL.pluralize(keyNames.length, "value column") + "."];
      if (ignored) notes.push(DL.pluralize(ignored, "value") + ' in "' + p.value + '" ' + (ignored === 1 ? "is" : "are") + " not a number and " + (ignored === 1 ? "was" : "were") + " ignored.");
      return { table: DL.makeTable(columns, cols, groupOrder.length), notes };
    }
  });
  var NAME = "Name";
  var VALUE = "Value";
  DL.registerOp({
    id: "unpivot",
    name: "Unpivot",
    category: "Rows",
    icon: "bi-layout-three-columns",
    description: "Turn columns into rows: each chosen column becomes a row with the column name and the value.",
    keywords: "unpivot melt long narrow columns to rows",
    params: [
      { key: "columns", label: "Columns to turn into rows", type: "columns" },
      { key: "nameColumn", label: "Column for the names", type: "text", default: NAME, notBlank: true },
      { key: "valueColumn", label: "Column for the values", type: "text", default: VALUE, notBlank: true },
      { key: "skipEmpty", label: "Skip empty values", type: "boolean", default: true }
    ],
    summary: function(p) {
      return p.columns.join(", ") + " \u2192 " + p.nameColumn + " / " + p.valueColumn;
    },
    outputColumns: function(cols, p) {
      var kept = cols.filter(function(c) {
        return p.columns.indexOf(c) < 0;
      });
      var nameCol = DL.newColumnName(kept, p.nameColumn, NAME);
      kept.push(nameCol);
      kept.push(DL.newColumnName(kept, p.valueColumn, VALUE));
      return kept;
    },
    apply: function(table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var keptIdxs = DL.allIndexes(table).filter(function(c) {
        return idxs.indexOf(c) < 0;
      });
      var n = table.length;
      var m = idxs.length;
      var skipEmpty = !!p.skipEmpty;
      var valueGetters = idxs.map(function(c) {
        return DL.cellGetter(table, c);
      });
      var i, j;
      var count = 0;
      var keep = skipEmpty ? new Uint8Array(n * m) : null;
      for (i = 0; i < n; i++) {
        for (j = 0; j < m; j++) {
          if (skipEmpty && DL.isBlank(valueGetters[j](i))) continue;
          if (keep) keep[i * m + j] = 1;
          count++;
        }
      }
      if (count * (keptIdxs.length + 2) > DL.maxCells) throw new Error("The result would have " + DL.pluralize(count, "row") + ", which is too many.");
      var srcRow = new Uint32Array(count);
      var names = new Array(count);
      var values = new Array(count);
      var r = 0;
      for (i = 0; i < n; i++) {
        for (j = 0; j < m; j++) {
          if (keep && keep[i * m + j] === 0) continue;
          srcRow[r] = i;
          names[r] = table.columns[idxs[j]];
          values[r] = valueGetters[j](i);
          r++;
        }
      }
      var columns = this.outputColumns(table.columns, p);
      var cols = keptIdxs.map(function(c) {
        return { src: DL.col(table, c), idx: srcRow };
      });
      cols.push(names);
      cols.push(values);
      return { table: DL.makeTable(columns, cols, count), notes: [DL.pluralize(n, "row") + " became " + DL.pluralize(count, "row") + "."] };
    }
  });

  // packages/engine/src/ops/verify.ts
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
  var PHONE_RE = /^\+?[\d\s().-]{7,}$/;
  DL.VERIFY_RULES = [
    { value: "notEmpty", label: "must not be empty", needs: "none" },
    { value: "isEmpty", label: "must be empty", needs: "none" },
    { value: "isNumber", label: "must be a number", needs: "none" },
    { value: "isInteger", label: "must be a whole number", needs: "none" },
    { value: "noNumbers", label: "must not contain digits", needs: "none" },
    { value: "isDate", label: "must be a date", needs: "none" },
    { value: "isEmail", label: "must be an email address", needs: "none" },
    { value: "isUrl", label: "must be a web address", needs: "none" },
    { value: "isPhone", label: "must look like a phone number", needs: "none" },
    { value: "noSpaces", label: "must not contain spaces", needs: "none" },
    { value: "noWhitespace", label: "must not have spaces at the start or end", needs: "none" },
    { value: "noUnicode", label: "must be plain ASCII (no accents or symbols)", needs: "none" },
    { value: "gt", label: "number must be greater than", needs: "number" },
    { value: "gte", label: "number must be at least", needs: "number" },
    { value: "lt", label: "number must be less than", needs: "number" },
    { value: "lte", label: "number must be at most", needs: "number" },
    { value: "eq", label: "number must equal", needs: "number" },
    { value: "minLength", label: "must have at least this many characters", needs: "number" },
    { value: "maxLength", label: "must have at most this many characters", needs: "number" },
    { value: "exactLength", label: "must have exactly this many characters", needs: "number" },
    { value: "inList", label: "must be one of (comma separated)", needs: "text" },
    { value: "regex", label: "must match regular expression", needs: "text" },
    { value: "unique", label: "must be unique in the column (case and spaces at the ends do not count)", needs: "none" }
  ];
  var EMPTY_MATTERS = { notEmpty: true, isEmpty: true, noWhitespace: true };
  DL.buildVerifyRule = function(table, rule, dayFirst) {
    var col = DL.col(table, DL.requireCol(table, rule.column));
    var val = rule.value == null ? "" : String(rule.value);
    var n = DL.toNumber(val);
    var num = DL.toNumber;
    var def = DL.findOption(DL.VERIFY_RULES, rule.op);
    var label = rule.column + " " + (def ? def.label : rule.op) + (def && def.needs !== "none" ? " " + val : "");
    var test;
    switch (rule.op) {
      case "notEmpty":
        test = function(v) {
          return v.trim() !== "";
        };
        break;
      case "isEmpty":
        test = function(v) {
          return DL.isBlank(v);
        };
        break;
      case "isNumber":
        test = function(v) {
          return !isNaN(num(v));
        };
        break;
      case "isInteger":
        test = function(v) {
          var x = num(v);
          return !isNaN(x) && Math.floor(x) === x;
        };
        break;
      case "noNumbers":
        test = function(v) {
          return !/\d/.test(v);
        };
        break;
      case "isDate":
        var readDate = DL.memoDate(dayFirst);
        test = function(v) {
          var t = readDate(v);
          return t === t;
        };
        break;
      case "isEmail":
        test = function(v) {
          return EMAIL_RE.test(v.trim());
        };
        break;
      case "isUrl":
        test = function(v) {
          return URL_RE.test(v.trim());
        };
        break;
      case "isPhone":
        test = function(v) {
          return PHONE_RE.test(v.trim()) && v.replace(/\D/g, "").length >= 7;
        };
        break;
      case "noSpaces":
        test = function(v) {
          return !/\s/.test(v);
        };
        break;
      case "noWhitespace":
        test = function(v) {
          return v === v.trim();
        };
        break;
      case "noUnicode":
        test = function(v) {
          return !/[^\x00-\x7F]/.test(v);
        };
        break;
      case "gt":
        test = function(v) {
          return num(v) > n;
        };
        break;
      case "gte":
        test = function(v) {
          return num(v) >= n;
        };
        break;
      case "lt":
        test = function(v) {
          return num(v) < n;
        };
        break;
      case "lte":
        test = function(v) {
          return num(v) <= n;
        };
        break;
      case "eq":
        test = function(v) {
          return num(v) === n;
        };
        break;
      case "minLength":
        test = function(v) {
          return DL.charCount(v) >= n;
        };
        break;
      case "maxLength":
        test = function(v) {
          return DL.charCount(v) <= n;
        };
        break;
      case "exactLength":
        test = function(v) {
          return DL.charCount(v) === n;
        };
        break;
      case "inList":
        var set = new Set(val.split(",").map(function(s) {
          return s.trim().toLowerCase();
        }));
        test = function(v) {
          return set.has(v.trim().toLowerCase());
        };
        break;
      case "regex":
        var re = new RegExp(val, "u");
        test = function(v) {
          return re.test(v);
        };
        break;
      case "unique":
        var groups = DL.groupRows(DL.keyGetters(table, [DL.requireCol(table, rule.column)], { trim: true, ignoreCase: true }), col.length);
        var uniqueRow = function(i) {
          return groups.count[groups.first[i]] === 1;
        };
        return {
          label,
          test: rule.allowEmpty ? function(i) {
            return DL.isBlank(col[i]) || uniqueRow(i);
          } : uniqueRow
        };
      default:
        throw new Error('Unknown rule "' + rule.op + '".');
    }
    var skipEmpty = !EMPTY_MATTERS[rule.op] && !!rule.allowEmpty;
    return {
      label,
      test: function(i) {
        var v = col[i];
        if (skipEmpty && DL.isBlank(v)) return true;
        return test(v);
      }
    };
  };
  var PROBLEMS = "Problems";
  DL.registerOp({
    id: "verify",
    name: "Verify Values",
    category: "Quality",
    icon: "bi-shield-check",
    description: "Check that values follow your rules. See which rows fail, and why.",
    keywords: "validate check quality rules email",
    params: [
      { key: "rules", label: "Rules", type: "rules" },
      DL.DAY_FIRST,
      {
        key: "action",
        label: "Then",
        type: "select",
        default: "flag",
        options: [
          { value: "flag", label: 'Keep all rows and add a "Problems" column' },
          { value: "failed", label: "Keep only rows with problems" },
          { value: "passed", label: "Keep only rows without problems" }
        ]
      },
      { key: "flagColumn", label: "Problems column name", type: "text", default: PROBLEMS, notBlank: true, showIf: function(p) {
        return p.action === "flag";
      } }
    ],
    summary: function(p) {
      return DL.pluralize(p.rules.length, "rule") + ", " + p.action;
    },
    outputColumns: function(cols, p) {
      return p.action === "flag" ? cols.concat([DL.newColumnName(cols, p.flagColumn, PROBLEMS)]) : cols;
    },
    apply: function(table, p) {
      var n = table.length;
      var rules = p.rules.map(function(r) {
        return DL.buildVerifyRule(table, r, !!p.dayFirst);
      });
      var failCounts = rules.map(function() {
        return 0;
      });
      var failedRows = 0;
      var flag = p.action === "flag";
      var flags = flag ? new Array(n) : null;
      var keep = flag ? null : [];
      var wantFailed = p.action === "failed";
      for (var i = 0; i < n; i++) {
        var problems = null;
        for (var k = 0; k < rules.length; k++) {
          if (!rules[k].test(i)) {
            failCounts[k]++;
            (problems || (problems = [])).push(rules[k].label);
          }
        }
        if (problems) failedRows++;
        if (flag) flags[i] = problems ? problems.join("; ") : "";
        else if (wantFailed ? !!problems : !problems) keep.push(i);
      }
      var out = flag ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, PROBLEMS), flags) : DL.selectRows(table, keep);
      var notes = [];
      if (failedRows === 0) notes.push("All " + DL.pluralize(n, "row") + " passed.");
      else notes.push(DL.pluralize(failedRows, "row") + " of " + n + " failed at least one rule.");
      rules.forEach(function(r, k2) {
        if (failCounts[k2]) notes.push({ text: DL.pluralize(failCounts[k2], "row") + " failed: " + r.label, rows: { rule: k2 } });
      });
      return { table: out, notes, status: failedRows ? "warning" : "ok" };
    },
    // Finds the rows of the output that failed one rule (lookup.rule). See DL.findRows.
    findRows: function(table, p, lookup, limit) {
      var n = table.length;
      var k = lookup ? Number(lookup.rule) : -1;
      if (!p.rules[k]) return { matches: [], total: 0 };
      if (p.action === "passed") return { matches: [], total: 0, removed: true };
      var rule = DL.buildVerifyRule(table, p.rules[k], !!p.dayFirst);
      var others = p.action === "failed" ? p.rules.filter(function(r, j2) {
        return j2 !== k;
      }).map(function(r) {
        return DL.buildVerifyRule(table, r, !!p.dayFirst);
      }) : [];
      var col = DL.requireCol(table, p.rules[k].column);
      var matches = [];
      var total = 0;
      var outRow = 0;
      for (var i = 0; i < n; i++) {
        var failed = !rule.test(i);
        if (failed) {
          total++;
          if (matches.length < limit) matches.push([outRow, col]);
        }
        if (p.action === "flag" || failed) {
          outRow++;
          continue;
        }
        for (var j = 0; j < others.length; j++) if (!others[j].test(i)) {
          outRow++;
          break;
        }
      }
      return { matches, total };
    }
  });

  // packages/engine/src/browser.ts
  var before = self.DL;
  if (before) {
    Object.keys(before).forEach(function(key) {
      if (!(key in DL)) DL[key] = before[key];
    });
    if (before.VERSION && before.VERSION !== DL.VERSION) {
      if (typeof console !== "undefined") {
        console.error("Delimiter Lab: the page is version " + before.VERSION + " but the engine is version " + DL.VERSION + ". Empty the cache of the browser, or run npm run build.");
      }
      DL.VERSION = before.VERSION;
    }
  }
  self.DL = DL;
})();
