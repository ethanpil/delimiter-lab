/* Row operations: Dedupe, Filter, Sort, Outliers, Unique. */
import { DL } from '../dl.js';

// Makes one key function(rowIndex) -> text per column, with the requested normalization.
// The function normalizes each column once, so the hash and the comparisons read plain arrays.
function keyGetters(table, idxs, opts) {
  var trim = !!opts.trim, ignoreCase = !!opts.ignoreCase;
  return idxs.map(function (i) {
    var col = DL.col(table, i);
    if (trim || ignoreCase) {
      col = DL.mapValues(col, col.length, function (v) { return DL.normalizeKey(v, trim, ignoreCase); });
    }
    return function (r) { return col[r]; };
  });
}
DL.keyGetters = keyGetters; // Verify uses the same normalized keys for its "unique" rule

/* ---------- Dedupe ---------- */
DL.registerOp({
  id: 'dedupe',
  name: 'Remove Duplicates',
  category: 'Rows',
  icon: 'bi-files',
  description: 'Remove rows that repeat the same values in the chosen columns.',
  keywords: 'duplicate distinct unique rows',
  params: [
    { key: 'columns', label: 'Compare these columns', type: 'columns', required: false, help: 'Leave empty to compare whole rows.' },
    { key: 'keep', label: 'Keep', type: 'select', default: 'first',
      options: [{ value: 'first', label: 'First occurrence' }, { value: 'last', label: 'Last occurrence' }, { value: 'none', label: 'Only rows that never repeat' }] },
    { key: 'ignoreCase', label: 'Ignore case', type: 'boolean', default: true },
    { key: 'trim', label: 'Ignore spaces around values', type: 'boolean', default: true }
  ],
  summary: function (p) { return p.columns.length ? 'By ' + p.columns.join(', ') : 'Whole rows'; },
  apply: function (table, p) {
    var idxs = DL.colIndexesOrAll(table, p.columns);
    var n = table.length;
    var g = DL.groupRows(keyGetters(table, idxs, p), n);
    var first = g.first, count = g.count;
    var keep = [];
    var i;
    if (p.keep === 'none') {
      for (i = 0; i < n; i++) if (count[first[i]] === 1) keep.push(i);
    } else if (p.keep === 'last') {
      var lastOf = new Int32Array(n);
      for (i = 0; i < n; i++) lastOf[first[i]] = i;
      for (i = 0; i < n; i++) if (lastOf[first[i]] === i) keep.push(i);
    } else {
      for (i = 0; i < n; i++) if (first[i] === i) keep.push(i);
    }
    return { table: DL.selectRows(table, keep), notes: ['Removed ' + DL.pluralize(n - keep.length, 'duplicate row') + '.'] };
  }
});

/* ---------- Filter ---------- */
DL.FILTER_OPERATORS = [
  { value: 'contains', label: 'contains', needs: 'text' },
  { value: 'notContains', label: 'does not contain', needs: 'text' },
  { value: 'equals', label: 'is exactly', needs: 'text' },
  { value: 'notEquals', label: 'is not', needs: 'text' },
  { value: 'startsWith', label: 'starts with', needs: 'text' },
  { value: 'endsWith', label: 'ends with', needs: 'text' },
  { value: 'empty', label: 'is empty', needs: 'none' },
  { value: 'notEmpty', label: 'is not empty', needs: 'none' },
  { value: 'regex', label: 'matches regular expression', needs: 'text' },
  { value: 'gt', label: 'number is greater than', needs: 'number' },
  { value: 'gte', label: 'number is at least', needs: 'number' },
  { value: 'lt', label: 'number is less than', needs: 'number' },
  { value: 'lte', label: 'number is at most', needs: 'number' },
  { value: 'between', label: 'number is between', needs: 'range' },
  { value: 'isNumber', label: 'is a number', needs: 'none' },
  { value: 'notNumber', label: 'is not a number', needs: 'none' },
  { value: 'dateBefore', label: 'date is before', needs: 'date' },
  { value: 'dateAfter', label: 'date is after', needs: 'date' },
  { value: 'inList', label: 'is one of (comma separated)', needs: 'text' },
  { value: 'notInList', label: 'is not one of (comma separated)', needs: 'text' }
];

// Makes a function(value) -> boolean for one condition.
// A test on the parsed date of a value. Each different value is parsed once.
function memoDate(test) {
  var cache = new Map();
  return function (v) {
    var t = cache.get(v);
    if (t === undefined) { t = DL.toDate(v); if (cache.size < 50000) cache.set(v, t); }
    return test(t);
  };
}

DL.buildCondition = function (c, opts) {
  var matchCase = !!(opts && opts.matchCase);
  var val = c.value == null ? '' : String(c.value);
  var cmp = matchCase ? val : val.toLowerCase();
  var norm = matchCase ? function (s) { return s; } : function (s) { return s.toLowerCase(); };
  var n = DL.toNumber(val), n2 = DL.toNumber(c.value2), d = DL.toDate(val);
  var toNumber = DL.toNumber;
  var list;
  switch (c.op) {
    case 'contains': return function (v) { return norm(v).indexOf(cmp) >= 0; };
    case 'notContains': return function (v) { return norm(v).indexOf(cmp) < 0; };
    case 'equals': cmp = cmp.trim(); return function (v) { return norm(v.trim()) === cmp; };
    case 'notEquals': cmp = cmp.trim(); return function (v) { return norm(v.trim()) !== cmp; };
    case 'startsWith': return function (v) { return norm(v).indexOf(cmp) === 0; };
    case 'endsWith': return function (v) { var s = norm(v); return s.length >= cmp.length && s.lastIndexOf(cmp) === s.length - cmp.length; };
    case 'empty': return function (v) { return DL.isBlank(v); };
    case 'notEmpty': return function (v) { return v.trim() !== ''; };
    case 'regex':
      var re = new RegExp(val, matchCase ? 'u' : 'iu');
      return function (v) { return re.test(v); };
    case 'gt': return function (v) { return toNumber(v) > n; };
    case 'gte': return function (v) { return toNumber(v) >= n; };
    case 'lt': return function (v) { return toNumber(v) < n; };
    case 'lte': return function (v) { return toNumber(v) <= n; };
    case 'between':
      var lo = Math.min(n, n2), hi = Math.max(n, n2);
      return function (v) { var x = toNumber(v); return x >= lo && x <= hi; };
    case 'isNumber': return function (v) { return !isNaN(toNumber(v)); };
    case 'notNumber': return function (v) { return v.trim() !== '' && isNaN(toNumber(v)); };
    case 'dateBefore': return memoDate(function (t) { return t < d; });
    case 'dateAfter': return memoDate(function (t) { return t > d; });
    case 'inList':
    case 'notInList':
      list = new Set(val.split(',').map(function (s) { return norm(s.trim()); }).filter(function (s) { return s !== ''; }));
      if (c.op === 'inList') return function (v) { return list.has(norm(v.trim())); };
      return function (v) { return !list.has(norm(v.trim())); };
    default: throw new Error('Unknown filter rule "' + c.op + '".');
  }
};

DL.registerOp({
  id: 'filter',
  name: 'Filter Rows',
  category: 'Rows',
  icon: 'bi-funnel',
  description: 'Keep or remove rows that match one or more rules.',
  keywords: 'where condition exclude include search rows',
  params: [
    { key: 'action', label: 'Action', type: 'select', default: 'keep',
      options: [{ value: 'keep', label: 'Keep matching rows' }, { value: 'remove', label: 'Remove matching rows' }] },
    { key: 'logic', label: 'A row matches when', type: 'select', default: 'all',
      options: [{ value: 'all', label: 'All rules are true' }, { value: 'any', label: 'Any rule is true' }] },
    { key: 'conditions', label: 'Rules', type: 'conditions' },
    { key: 'matchCase', label: 'Match case', type: 'boolean', default: false }
  ],
  summary: function (p) {
    return (p.action === 'remove' ? 'Remove' : 'Keep') + ' rows where ' + p.conditions.map(function (x) {
      var def = DL.findOption(DL.FILTER_OPERATORS, x.op);
      return x.column + ' ' + (def ? def.label : x.op) + (x.value ? ' "' + x.value + '"' : '') + (def && def.needs === 'range' && x.value2 ? ' and "' + x.value2 + '"' : '');
    }).join(p.logic === 'any' ? ' or ' : ' and ');
  },
  apply: function (table, p) {
    var tests = p.conditions.map(function (c) {
      return { col: DL.col(table, DL.requireCol(table, c.column)), fn: DL.buildCondition(c, p) };
    });
    var any = p.logic === 'any';
    var keepMatch = p.action !== 'remove';
    var n = table.length;
    var m = tests.length;
    var keep = [];
    for (var i = 0; i < n; i++) {
      var match;
      if (any) {
        match = false;
        for (var k = 0; k < m; k++) if (tests[k].fn(tests[k].col[i])) { match = true; break; }
      } else {
        match = true;
        for (k = 0; k < m; k++) if (!tests[k].fn(tests[k].col[i])) { match = false; break; }
      }
      if (match === keepMatch) keep.push(i);
    }
    return { table: DL.selectRows(table, keep), notes: [(keepMatch ? 'Kept ' : 'Removed ') + DL.pluralize(keepMatch ? keep.length : n - keep.length, 'row') + ' of ' + n + '.'] };
  }
});

/* ---------- Sort ---------- */

// Ranks a text column: the different values are compared once, so that equal values
// (as the collator sees them) share a rank. Direction and empty placement are part of the rank.
function textRanks(col, n, dir, emptyLast) {
  var g = DL.groupRows([function (i) { return col[i]; }], n);
  var reps = [];
  for (var i = 0; i < n; i++) if (g.first[i] === i) reps.push(i);
  // Plain Latin text sorts by a key with "<", which is several times faster than the collator.
  var keys = new Array(n);
  var allKeys = true;
  for (i = 0; i < reps.length && allKeys; i++) {
    var k = DL.sortKey(col[reps[i]]);
    if (k === null) allKeys = false; else keys[reps[i]] = k;
  }
  var cmp = DL.compareText;
  var compare = function (a, b) {
    var va = col[a], vb = col[b];
    var ea = va === '', eb = vb === '';
    if (ea || eb) { if (ea && eb) return 0; return (ea ? 1 : -1) * emptyLast; }
    if (allKeys) { var ka = keys[a], kb = keys[b]; return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir; }
    return cmp(va, vb) * dir;
  };
  reps.sort(compare);
  var rankOf = new Int32Array(n); // first row of a group -> rank
  var rank = 0;
  for (i = 0; i < reps.length; i++) {
    if (i > 0 && compare(reps[i - 1], reps[i]) !== 0) rank++;
    rankOf[reps[i]] = rank;
  }
  var ranks = new Int32Array(n);
  for (i = 0; i < n; i++) ranks[i] = rankOf[g.first[i]];
  return { ranks: ranks, groups: rank + 1 };
}

// Ranks a number or date column with a native typed-array sort. Equal values share a rank.
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
    if (v !== v) { ranks[i] = emptyRank; continue; }
    // Binary search for the rank of v.
    var lo = 0, hi = groups - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (distinct[mid] < v) lo = mid + 1; else hi = mid; }
    ranks[i] = offset + (dir > 0 ? lo : groups - 1 - lo);
  }
  return { ranks: ranks, groups: groups + 1 };
}

// A stable counting sort of the order by rank.
function countingSort(order, ranks, groups) {
  var n = order.length;
  var starts = new Int32Array(groups + 1);
  for (var i = 0; i < n; i++) starts[ranks[order[i]] + 1]++;
  for (i = 0; i < groups; i++) starts[i + 1] += starts[i];
  var out = new Uint32Array(n);
  for (i = 0; i < n; i++) { var r = order[i]; out[starts[ranks[r]]++] = r; }
  return out;
}

DL.registerOp({
  id: 'sort',
  name: 'Sort Rows',
  category: 'Rows',
  icon: 'bi-sort-alpha-down',
  description: 'Order rows by one or more columns as text, numbers or dates.',
  keywords: 'order arrange ascending descending',
  params: [
    { key: 'keys', label: 'Sort by', type: 'sortKeys' },
    { key: 'emptyLast', label: 'Put empty values last', type: 'boolean', default: true }
  ],
  summary: function (p) { return p.keys.map(function (k) { return k.column + ' ' + (k.dir === 'desc' ? '↓' : '↑'); }).join(', '); },
  apply: function (table, p) {
    var n = table.length;
    var emptyLast = p.emptyLast !== false ? 1 : -1;
    var keys = p.keys.map(function (k) {
      var col = DL.col(table, DL.requireCol(table, k.column));
      var type = k.type === 'auto' ? DL.detectType(col) : k.type;
      var dir = k.dir === 'desc' ? -1 : 1;
      var ranked;
      if (type === 'text') ranked = textRanks(col, n, dir, emptyLast);
      else {
        var parse = type === 'number' ? DL.toNumber : DL.toDate;
        var parsed = DL.mapValues(col, n, function (v) { return v === '' ? NaN : parse(v); }); // each different value once
        var vals = new Float64Array(n);
        for (var i = 0; i < n; i++) vals[i] = parsed[i];
        ranked = numberRanks(vals, n, dir, emptyLast);
      }
      return { column: k.column, type: type, ranks: ranked.ranks, groups: ranked.groups };
    });
    // Stable counting sorts from the last key to the first give the same order as a comparator.
    var order = new Uint32Array(n);
    for (var j = 0; j < n; j++) order[j] = j;
    for (var k = keys.length - 1; k >= 0; k--) order = countingSort(order, keys[k].ranks, keys[k].groups);
    return { table: DL.selectRows(table, order), notes: keys.map(function (k) { return k.column + ' sorted as ' + k.type; }) };
  }
});

/* ---------- Outliers ---------- */
var OUTLIER = 'Outlier';
DL.registerOp({
  id: 'outliers',
  name: 'Find Outliers',
  category: 'Rows',
  icon: 'bi-graph-up-arrow',
  description: 'Find unusually high or low numbers in a column. Keep them, remove them or flag them.',
  keywords: 'anomaly extreme statistics iqr',
  params: [
    { key: 'column', label: 'Number column', type: 'column' },
    { key: 'method', label: 'Method', type: 'select', default: 'iqr',
      options: [
        { value: 'iqr', label: 'Quartiles (IQR) - good for most data' },
        { value: 'zscore', label: 'Standard deviations from the mean' },
        { value: 'percentile', label: 'Top and bottom percent' }
      ] },
    { key: 'factor', label: 'IQR multiplier', type: 'number', default: 1.5, min: 0, required: true, help: '1.5 is the usual choice. Use 3 to only find extreme values.', showIf: function (p) { return p.method === 'iqr'; } },
    { key: 'zthreshold', label: 'Standard deviations', type: 'number', default: 3, min: 0, required: true, showIf: function (p) { return p.method === 'zscore'; } },
    { key: 'percent', label: 'Percent at each end', type: 'number', default: 1, min: 0, max: 50, required: true, showIf: function (p) { return p.method === 'percentile'; } },
    { key: 'action', label: 'Then', type: 'select', default: 'keep',
      options: [
        { value: 'keep', label: 'Keep only the outliers (to review them)' },
        { value: 'remove', label: 'Remove the outliers' },
        { value: 'flag', label: 'Add a column that marks outliers' }
      ] },
    { key: 'flagColumn', label: 'Flag column name', type: 'text', default: OUTLIER, notBlank: true, showIf: function (p) { return p.action === 'flag'; } }
  ],
  summary: function (p) { return p.action + ' outliers in "' + p.column + '" (' + p.method + ')'; },
  outputColumns: function (cols, p) {
    return p.action === 'flag' ? cols.concat([DL.newColumnName(cols, p.flagColumn, OUTLIER)]) : cols;
  },
  apply: function (table, p) {
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
      var none = p.action === 'flag' ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, OUTLIER), new Array(n).fill('')) : p.action === 'keep' ? DL.selectRows(table, []) : table;
      return { table: none, notes: ['Column "' + p.column + '" has no numbers.'], status: n ? 'warning' : 'ok' };
    }
    var sorted = new Float64Array(validCount);
    for (i = 0, validCount = 0; i < n; i++) if (nums[i] === nums[i]) sorted[validCount++] = nums[i];
    sorted.sort();
    var lo, hi, notes = [];
    var q = function (f) {
      var pos = (sorted.length - 1) * f;
      var b = Math.floor(pos), r = pos - b;
      return b + 1 < sorted.length ? sorted[b] + r * (sorted[b + 1] - sorted[b]) : sorted[b];
    };
    if (p.method === 'zscore') {
      var mean = 0;
      for (i = 0; i < sorted.length; i++) mean += sorted[i];
      mean /= sorted.length;
      var sd = 0;
      for (i = 0; i < sorted.length; i++) sd += (sorted[i] - mean) * (sorted[i] - mean);
      sd = Math.sqrt(sd / sorted.length);
      var z = Number(p.zthreshold);
      lo = mean - z * sd; hi = mean + z * sd;
      notes.push('Mean ' + round(mean) + ', standard deviation ' + round(sd) + '.');
    } else if (p.method === 'percentile') {
      var pc = Math.min(50, Math.max(0, Number(p.percent))) / 100;
      lo = q(pc); hi = q(1 - pc);
    } else {
      var q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
      var f = Number(p.factor);
      lo = q1 - f * iqr; hi = q3 + f * iqr;
    }
    notes.push('Normal range: ' + round(lo) + ' to ' + round(hi) + '.');
    var count = 0;
    var flags = p.action === 'flag' ? new Array(n) : null;
    var keepOut = p.action === 'keep';
    var keep = [];
    for (i = 0; i < n; i++) {
      var v = nums[i];
      var isOut = v === v && (v < lo || v > hi);
      if (isOut) count++;
      if (flags) flags[i] = isOut ? (v < lo ? 'low' : 'high') : '';
      else if (isOut === keepOut) keep.push(i);
    }
    var out = flags
      ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, OUTLIER), flags)
      : DL.selectRows(table, keep);
    notes.unshift('Found ' + DL.pluralize(count, 'outlier') + '.');
    return { table: out, notes: notes };
  }
});

function round(x) { return Math.round(x * 1000) / 1000; }

/* ---------- Unique values ---------- */
DL.registerOp({
  id: 'unique',
  name: 'Unique Values',
  category: 'Rows',
  icon: 'bi-list-check',
  description: 'List each different value (or combination of values) once, with how often it appears.',
  keywords: 'distinct count group summary frequency',
  params: [
    { key: 'columns', label: 'Columns', type: 'columns' },
    { key: 'count', label: 'Add a "Count" column', type: 'boolean', default: true },
    { key: 'ignoreCase', label: 'Ignore case', type: 'boolean', default: false },
    { key: 'trim', label: 'Ignore spaces around values', type: 'boolean', default: true },
    { key: 'sortBy', label: 'Order', type: 'select', default: 'first',
      options: [{ value: 'first', label: 'First appearance' }, { value: 'count', label: 'Most common first' }, { value: 'value', label: 'Value A → Z' }] }
  ],
  summary: function (p) { return 'Unique ' + p.columns.join(' + '); },
  outputColumns: function (cols, p) {
    var out = p.columns.filter(function (c) { return cols.indexOf(c) >= 0; });
    if (p.count) out.push(DL.uniqueName(out, 'Count'));
    return out;
  },
  apply: function (table, p) {
    var idxs = p.columns.map(function (c) { return DL.requireCol(table, c); });
    var n = table.length;
    var getters = keyGetters(table, idxs, p);
    var g = DL.groupRows(getters, n);
    var entries = [];
    for (var i = 0; i < n; i++) if (g.first[i] === i) entries.push({ row: i, count: g.count[i] });
    var keyText = function (row) { return getters.map(function (get) { return get(row); }).join('\u0000'); };
    if (p.sortBy === 'count') entries.sort(function (a, b) { return b.count - a.count || a.row - b.row; });
    else if (p.sortBy === 'value') entries.sort(function (a, b) { return DL.compareText(keyText(a.row), keyText(b.row)); });
    var out = DL.selectRows(DL.pickColumns(table, idxs), entries.map(function (e) { return e.row; }));
    if (p.trim) out = DL.mapColumns(out, DL.allIndexes(out), function (v) { return v.trim(); });
    if (p.count) out = DL.addColumn(out, DL.uniqueName(out.columns, 'Count'), entries.map(function (e) { return String(e.count); }));
    return { table: out, notes: [DL.pluralize(out.length, 'unique value') + ' in ' + DL.pluralize(n, 'row') + '.'] };
  }
});
