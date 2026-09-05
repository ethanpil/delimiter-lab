/* Text operations: Case, Concat, Split, Split Name, Replace, Substitute, Pad / Trim. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var unescapeText = DL.unescapeText;

  /* ---------- Case ---------- */
  DL.registerOp({
    id: 'case',
    name: 'Change Case',
    category: 'Text',
    icon: 'bi-type',
    description: 'Change text to UPPER, lower, Title or Sentence case.',
    keywords: 'uppercase lowercase capitalize',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns', help: 'The columns to change.' },
      { key: 'mode', label: 'Case', type: 'select', default: 'upper',
        options: [
          { value: 'upper', label: 'UPPER CASE' },
          { value: 'lower', label: 'lower case' },
          { value: 'title', label: 'Title Case' },
          { value: 'sentence', label: 'Sentence case' }
        ] }
    ],
    summary: function (p) { return p.mode + ' case: ' + p.columns.join(', '); },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var fn = p.mode === 'upper' ? function (s) { return s.toUpperCase(); }
        : p.mode === 'lower' ? function (s) { return s.toLowerCase(); }
        : p.mode === 'title' ? DL.titleCase
        : DL.sentenceCase;
      return { table: DL.mapColumns(table, idxs, function (v) { return v ? fn(v) : v; }) };
    }
  });

  /* ---------- Concat ---------- */
  var COMBINED = 'Combined';
  DL.registerOp({
    id: 'concat',
    name: 'Combine Columns',
    category: 'Text',
    icon: 'bi-intersect',
    description: 'Join several columns into one new column, for example First + Last name.',
    keywords: 'concatenate merge join',
    params: [
      { key: 'columns', label: 'Columns to join (in order)', type: 'columns', ordered: true, help: 'Drag to change the order.' },
      { key: 'separator', label: 'Separator', type: 'text', default: ' ', help: 'Text placed between the values. Use \\t for a tab.' },
      { key: 'output', label: 'New column name', type: 'text', default: COMBINED, notBlank: true },
      { key: 'skipEmpty', label: 'Skip empty values', type: 'boolean', default: true, help: 'Avoids double separators when a value is empty.' },
      { key: 'removeSource', label: 'Remove the original columns', type: 'boolean', default: false }
    ],
    summary: function (p) { return p.columns.join(' + ') + ' → ' + p.output; },
    outputColumns: function (cols, p) {
      var out = p.removeSource ? cols.filter(function (c) { return p.columns.indexOf(c) < 0; }) : cols;
      return out.concat([DL.uniqueName(out, DL.cleanName(p.output, COMBINED))]);
    },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var sep = unescapeText(p.separator);
      var n = table.length;
      var skipEmpty = !!p.skipEmpty;
      var srcCols = idxs.map(function (i) { return DL.col(table, i); });
      var k = srcCols.length;
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var out = '';
        var count = 0;
        for (var j = 0; j < k; j++) {
          var v = srcCols[j][i];
          if (skipEmpty && v === '') continue;
          out = count++ ? out + sep + v : v;
        }
        values[i] = out;
      }
      var base = p.removeSource ? DL.dropColumns(table, idxs) : table;
      return { table: DL.addColumn(base, DL.uniqueName(base.columns, DL.cleanName(p.output, COMBINED)), values) };
    }
  });

  /* ---------- Split column ---------- */

  // Splits text at a separator (text or regular expression). Capture groups do not add parts.
  // max = 0 means: as many parts as needed. The last part keeps the rest of the text.
  function splitText(s, sep, max) {
    var out = [];
    var rest = s;
    for (;;) {
      if (max && out.length === max - 1) break;
      var pos, len;
      if (sep instanceof RegExp) {
        sep.lastIndex = 0;
        var m = sep.exec(rest);
        if (!m || m[0].length === 0) break;
        pos = m.index; len = m[0].length;
      } else {
        pos = rest.indexOf(sep); len = sep.length;
        if (pos < 0) break;
      }
      out.push(rest.slice(0, pos));
      rest = rest.slice(pos + len);
    }
    out.push(rest);
    return out;
  }

  function splitNames(p) {
    var custom = (p.names || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var max = p.maxParts !== '' && p.maxParts != null ? Math.max(1, Math.round(Number(p.maxParts))) : 0;
    return { custom: custom, max: max, column: p.column }; // with a maximum, the number of new columns is known
  }

  function splitColumnName(names, c) {
    return names.custom[c] || (names.column + ' - ' + (c + 1));
  }

  DL.registerOp({
    id: 'split',
    name: 'Split Column',
    category: 'Text',
    icon: 'bi-layout-split',
    description: 'Break one column into several columns at a separator.',
    keywords: 'divide separate delimiter',
    params: [
      { key: 'column', label: 'Column to split', type: 'column' },
      { key: 'separator', label: 'Separator', type: 'text', default: ',', required: true, help: 'Text to split on. Use \\t for a tab.' },
      { key: 'regex', label: 'Separator is a regular expression', type: 'boolean', default: false },
      { key: 'maxParts', label: 'Maximum parts', type: 'number', default: '', min: 1, max: 1000, integer: true, help: 'Leave empty to split into as many parts as needed. The last part keeps the rest of the text.' },
      { key: 'names', label: 'New column names', type: 'text', default: '', help: 'Comma separated names for the new columns. Leave empty to use "Column - 1", "Column - 2", …' },
      { key: 'trim', label: 'Trim spaces around each part', type: 'boolean', default: true },
      { key: 'removeSource', label: 'Remove the original column', type: 'boolean', default: false }
    ],
    summary: function (p) { return 'Split "' + p.column + '" on "' + p.separator + '"'; },
    validate: function (p) {
      return p.regex && DL.regexProblem(p.separator, 'g') ? [DL.regexProblem(p.separator, 'g')] : [];
    },
    outputColumns: function (cols, p) {
      var names = splitNames(p);
      if (!names.max) return null; // the number of parts depends on the data
      var out = p.removeSource ? cols.filter(function (c) { return c !== p.column; }) : cols.slice();
      for (var c = 0; c < names.max; c++) out.push(DL.uniqueName(out, splitColumnName(names, c)));
      return out;
    },
    apply: function (table, p) {
      var idx = DL.requireCol(table, p.column);
      var sep = p.regex ? new RegExp(p.separator, 'g') : unescapeText(p.separator);
      var names = splitNames(p);
      var src = DL.col(table, idx);
      var n = table.length;
      var values = []; // one array per new column, made when a row has that many parts
      var trim = !!p.trim;
      for (var i = 0; i < n; i++) {
        var v = src[i];
        var parts = v === '' ? [''] : splitText(v, sep, names.max);
        for (var c = 0; c < parts.length; c++) {
          if (c === values.length) values.push(new Array(n).fill(''));
          values[c][i] = trim ? parts[c].trim() : parts[c];
        }
      }
      while (values.length < names.max) values.push(new Array(n).fill(''));
      var out = p.removeSource ? DL.dropColumns(table, [idx]) : table;
      for (c = 0; c < values.length; c++) out = DL.addColumn(out, DL.uniqueName(out.columns, splitColumnName(names, c)), values[c]);
      return { table: out, notes: ['Split into ' + DL.pluralize(values.length, 'column') + '.'] };
    }
  });

  /* ---------- Split name ---------- */
  var PREFIXES = { 'mr': 1, 'mrs': 1, 'ms': 1, 'miss': 1, 'mx': 1, 'dr': 1, 'prof': 1, 'rev': 1, 'sir': 1, 'dame': 1, 'hon': 1, 'capt': 1, 'col': 1, 'lt': 1, 'sgt': 1, 'fr': 1 };
  var SUFFIXES = { 'jr': 1, 'sr': 1, 'ii': 1, 'iii': 1, 'iv': 1, 'v': 1, 'phd': 1, 'md': 1, 'esq': 1, 'dds': 1, 'cpa': 1, 'mba': 1, 'ra': 1 };
  var PARTICLES = { 'van': 1, 'von': 1, 'de': 1, 'del': 1, 'della': 1, 'di': 1, 'da': 1, 'la': 1, 'le': 1, 'du': 1, 'der': 1, 'den': 1, 'ter': 1, 'ten': 1, 'st': 1, 'san': 1, 'bin': 1, 'ibn': 1, 'al': 1, 'el': 1, 'y': 1, 'e': 1 };

  DL.splitName = function (full) {
    var res = { prefix: '', first: '', middle: '', last: '', suffix: '' };
    var s = (full || '').replace(/\s+/g, ' ').trim();
    if (!s) return res;
    var lastFirst = false;
    if (s.indexOf(',') >= 0) {
      var parts = s.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      if (!parts.length) return res;
      // "Smith, John A." or "Smith, John, Jr."
      var tail = parts.slice(1);
      var suffixParts = [];
      var others = [];
      tail.forEach(function (t) {
        if (SUFFIXES[t.toLowerCase().replace(/\./g, '')]) suffixParts.push(t); else others.push(t);
      });
      if (others.length) {
        lastFirst = true;
        s = others.join(' ') + ' ' + parts[0];
      } else {
        s = parts[0];
      }
      if (suffixParts.length) res.suffix = suffixParts.join(' ');
    }
    var tokens = s.split(' ');
    var norm = function (t) { return t.toLowerCase().replace(/\./g, ''); };
    while (tokens.length > 1 && PREFIXES[norm(tokens[0])]) {
      res.prefix = (res.prefix ? res.prefix + ' ' : '') + tokens.shift();
    }
    while (tokens.length > 1 && SUFFIXES[norm(tokens[tokens.length - 1])]) {
      var suf = tokens.pop();
      res.suffix = res.suffix ? suf + ' ' + res.suffix : suf;
    }
    if (tokens.length === 1) {
      if (lastFirst) res.last = tokens[0]; else res.first = tokens[0];
      return res;
    }
    if (lastFirst) {
      // The part before the comma is the last name. The rest is "First Middle…".
      res.last = tokens[tokens.length - 1];
      var firstMid = tokens.slice(0, tokens.length - 1);
      res.first = firstMid[0] || '';
      res.middle = firstMid.slice(1).join(' ');
      return res;
    }
    // The last token is the last name. Particles ("van", "de") go into the last name.
    var lastTokens = [tokens.pop()];
    while (tokens.length > 1 && PARTICLES[norm(tokens[tokens.length - 1])]) {
      lastTokens.unshift(tokens.pop());
    }
    res.last = lastTokens.join(' ');
    res.first = tokens.shift() || '';
    res.middle = tokens.join(' ');
    return res;
  };

  var NAME_LABELS = { prefix: 'Title', first: 'First Name', middle: 'Middle Name', last: 'Last Name', suffix: 'Suffix' };
  var NAME_ORDER = ['prefix', 'first', 'middle', 'last', 'suffix'];

  DL.registerOp({
    id: 'splitName',
    name: 'Split Name',
    category: 'Text',
    icon: 'bi-person-lines-fill',
    description: 'Split a full name into First, Middle and Last name columns. Handles "Last, First", titles like Dr., and suffixes like Jr.',
    keywords: 'first last middle name parse',
    params: [
      { key: 'column', label: 'Full name column', type: 'column' },
      { key: 'parts', label: 'Columns to create', type: 'checkboxes', default: ['first', 'middle', 'last'],
        options: [
          { value: 'prefix', label: 'Title (Mr, Dr, …)' },
          { value: 'first', label: 'First name' },
          { value: 'middle', label: 'Middle name' },
          { value: 'last', label: 'Last name' },
          { value: 'suffix', label: 'Suffix (Jr, III, …)' }
        ] },
      { key: 'prefixNames', label: 'Name prefix for new columns', type: 'text', default: '', help: 'For example "Contact" gives "Contact First Name". Leave empty for "First Name".' },
      { key: 'removeSource', label: 'Remove the original column', type: 'boolean', default: false }
    ],
    summary: function (p) { return 'Split "' + p.column + '" into name parts'; },
    validate: function (p) { return p.parts.length ? [] : ['Choose at least one column to create.']; },
    outputColumns: function (cols, p) {
      var base = p.removeSource ? cols.filter(function (c) { return c !== p.column; }) : cols;
      return base.concat(namePartColumns(base, p));
    },
    apply: function (table, p) {
      var idx = DL.requireCol(table, p.column);
      var order = NAME_ORDER.filter(function (k) { return p.parts.indexOf(k) >= 0; });
      var src = DL.col(table, idx);
      var n = table.length;
      var values = order.map(function () { return new Array(n); });
      var cache = new Map(); // names repeat often: split each different value once
      for (var i = 0; i < n; i++) {
        var v = src[i];
        var parts = cache.get(v);
        if (!parts) { parts = DL.splitName(v); if (cache.size < 50000) cache.set(v, parts); }
        for (var k = 0; k < order.length; k++) values[k][i] = parts[order[k]];
      }
      var out = p.removeSource ? DL.dropColumns(table, [idx]) : table;
      var names = namePartColumns(out.columns, p);
      for (k = 0; k < order.length; k++) out = DL.addColumn(out, names[k], values[k]);
      return { table: out };
    }
  });

  function namePartColumns(base, p) {
    var order = NAME_ORDER.filter(function (k) { return p.parts.indexOf(k) >= 0; });
    var pre = (p.prefixNames || '').trim();
    var out = [];
    order.forEach(function (k) {
      out.push(DL.uniqueName(base.concat(out), (pre ? pre + ' ' : '') + NAME_LABELS[k]));
    });
    return out;
  }

  /* ---------- Replace ---------- */
  DL.registerOp({
    id: 'replace',
    name: 'Find & Replace',
    category: 'Text',
    icon: 'bi-search',
    description: 'Replace text in one or more columns. Leave "Replace with" empty to remove the text.',
    keywords: 'substitute remove clear text regex',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns', required: false, help: 'Leave empty to search all columns.' },
      { key: 'find', label: 'Find', type: 'text', default: '', required: true },
      { key: 'replace', label: 'Replace with', type: 'text', default: '', help: 'With regular expressions you can use $1, $2 for captured groups.' },
      { key: 'matchCase', label: 'Match case', type: 'boolean', default: false },
      { key: 'wholeWord', label: 'Whole words only', type: 'boolean', default: false },
      { key: 'wholeCell', label: 'Whole cell must match', type: 'boolean', default: false },
      { key: 'regex', label: 'Use regular expression', type: 'boolean', default: false }
    ],
    summary: function (p) { return '"' + p.find + '" → "' + p.replace + '"'; },
    validate: function (p) {
      return p.regex && DL.regexProblem(p.find) ? [DL.regexProblem(p.find)] : [];
    },
    apply: function (table, p) {
      var idxs = DL.colIndexesOrAll(table, p.columns);
      var find = p.regex ? p.find : unescapeText(p.find);
      var replacement = p.regex ? p.replace : unescapeText(p.replace).replace(/\$/g, '$$$$');
      var stats = {};
      var out;
      if (p.wholeCell) {
        var test = p.regex ? new RegExp('^(?:' + find + ')$', p.matchCase ? 'u' : 'iu') : null;
        var target = p.matchCase ? find : find.toLowerCase();
        var plain = unescapeText(p.replace);
        out = DL.mapColumns(table, idxs, function (v, ctx) {
          var hit = test ? test.test(v) : (p.matchCase ? v === target : v.toLowerCase() === target);
          if (!hit) return v;
          ctx.tag();
          return test ? v.replace(test, replacement) : plain;
        }, stats);
      } else {
        var re = DL.buildRegex(find, { matchCase: p.matchCase, wholeWord: p.wholeWord, regex: p.regex });
        var quick = !p.regex && !p.wholeWord && p.matchCase ? find : null; // fast check with indexOf
        out = DL.mapColumns(table, idxs, function (v, ctx) {
          if (!v) return v;
          if (quick !== null && v.indexOf(quick) < 0) return v;
          re.lastIndex = 0;
          if (!re.test(v)) return v;
          re.lastIndex = 0;
          ctx.tag();
          return v.replace(re, replacement);
        }, stats);
      }
      return { table: out, notes: ['Changed ' + DL.pluralize(stats.tagged, 'cell') + '.'] };
    }
  });

  /* ---------- Substitute (mapping) ---------- */
  DL.registerOp({
    id: 'substitute',
    name: 'Substitute Values',
    category: 'Text',
    icon: 'bi-arrow-left-right',
    description: 'Swap whole values using a lookup list, for example "CA" → "California".',
    keywords: 'map lookup dictionary translate recode',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns' },
      { key: 'mapping', label: 'Lookup list', type: 'mapping', help: 'Each row swaps one value for another. Paste two columns from a spreadsheet to fill the list.' },
      { key: 'matchCase', label: 'Match case', type: 'boolean', default: false },
      { key: 'trim', label: 'Ignore spaces around values', type: 'boolean', default: true },
      { key: 'noMatch', label: 'When a value is not in the list', type: 'select', default: 'keep',
        options: [
          { value: 'keep', label: 'Keep the value' },
          { value: 'blank', label: 'Make it empty' },
          { value: 'value', label: 'Use a fixed value' }
        ] },
      { key: 'noMatchValue', label: 'Fixed value', type: 'text', default: '', showIf: function (p) { return p.noMatch === 'value'; } }
    ],
    summary: function (p) { return DL.pluralize(p.mapping.filter(function (m) { return m.from !== ''; }).length, 'value') + ' in ' + p.columns.join(', '); },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var map = new Map();
      p.mapping.forEach(function (m) {
        if (m.from === '') return;
        var k = p.trim ? m.from.trim() : m.from;
        if (!p.matchCase) k = k.toLowerCase();
        map.set(k, m.to);
      });
      var stats = {};
      var noMatch = p.noMatch;
      var fixed = p.noMatchValue;
      var out = DL.mapColumns(table, idxs, function (v, ctx) {
        var key = p.trim ? v.trim() : v;
        if (!p.matchCase) key = key.toLowerCase();
        var hit = map.get(key);
        if (hit !== undefined) { ctx.tag(); return hit; }
        if (noMatch === 'blank') return '';
        if (noMatch === 'value') return fixed;
        return v;
      }, stats);
      return { table: out, notes: ['Swapped ' + DL.pluralize(stats.tagged, 'value') + '.'] };
    }
  });

  /* ---------- Pad / Trim ---------- */
  DL.registerOp({
    id: 'padTrim',
    name: 'Pad / Trim',
    category: 'Text',
    icon: 'bi-arrows-collapse-vertical',
    description: 'Remove extra spaces, or pad values to a fixed length (for example add leading zeros).',
    keywords: 'whitespace strip clean zeros',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns' },
      { key: 'trim', label: 'Trim', type: 'select', default: 'both',
        options: [
          { value: 'both', label: 'Spaces at both ends' },
          { value: 'left', label: 'Spaces at the start' },
          { value: 'right', label: 'Spaces at the end' },
          { value: 'none', label: 'Do not trim' }
        ] },
      { key: 'collapse', label: 'Collapse repeated spaces inside the text', type: 'boolean', default: false },
      { key: 'pad', label: 'Pad', type: 'select', default: 'none',
        options: [
          { value: 'none', label: 'Do not pad' },
          { value: 'left', label: 'Add at the start (e.g. leading zeros)' },
          { value: 'right', label: 'Add at the end' }
        ] },
      { key: 'length', label: 'Pad to length', type: 'number', default: 5, min: 1, max: 10000, integer: true, required: true, showIf: function (p) { return p.pad !== 'none'; } },
      { key: 'char', label: 'Pad character', type: 'text', default: '0', showIf: function (p) { return p.pad !== 'none'; } }
    ],
    summary: function (p) {
      var bits = [];
      if (p.trim !== 'none') bits.push('trim');
      if (p.pad !== 'none') bits.push('pad to ' + p.length);
      return bits.join(', ') + ': ' + p.columns.join(', ');
    },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var ch = String(p.char || ' ').charAt(0) || ' ';
      var len = Number(p.length) || 0;
      var trim = p.trim, pad = p.pad, collapse = !!p.collapse;
      var out = DL.mapColumns(table, idxs, function (v) {
        if (trim === 'both') v = v.trim();
        else if (trim === 'left') v = v.replace(/^\s+/, '');
        else if (trim === 'right') v = v.replace(/\s+$/, '');
        if (collapse) v = v.replace(/\s{2,}/g, ' ');
        if (pad === 'left') v = v.padStart(len, ch);
        else if (pad === 'right') v = v.padEnd(len, ch);
        return v;
      });
      return { table: out };
    }
  });
})(typeof self !== 'undefined' ? self : this);
