/* Column operations: Rename, Reorder, Remove, Add Column, Calculate, Number Format, JavaScript. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var hasOwn = Object.prototype.hasOwnProperty;

  /* ---------- Rename ---------- */
  DL.registerOp({
    id: 'rename',
    name: 'Rename Columns',
    category: 'Columns',
    icon: 'bi-input-cursor-text',
    description: 'Change column headers.',
    keywords: 'header title label',
    params: [
      { key: 'map', label: 'New names', type: 'renameMap', help: 'Leave a name empty to keep it unchanged.' }
    ],
    summary: function (p) {
      var m = p.map;
      return Object.keys(m).filter(function (k) { return m[k]; }).map(function (k) { return k + ' → ' + m[k]; }).join(', ');
    },
    validate: function (p, cols) {
      var m = p.map;
      var changed = Object.keys(m).filter(function (k) { return m[k].trim() !== '' && m[k] !== k; });
      if (!changed.length) return ['Enter at least one new name.'];
      if (!cols) return [];
      return duplicateNames(renameColumns(cols, m).columns).map(function (c) { return 'Two columns would be named "' + c + '". Names must be unique.'; });
    },
    outputColumns: function (cols, p) { return renameColumns(cols, p.map).columns; },
    apply: function (table, p) {
      var res = renameColumns(table.columns, p.map);
      var dup = duplicateNames(res.columns);
      if (dup.length) throw new Error('Two columns would be named "' + dup[0] + '".');
      return { table: DL.makeTable(res.columns, table.cols, table.length), notes: ['Renamed ' + DL.pluralize(res.count, 'column') + '.'] };
    }
  });

  function renameColumns(cols, map) {
    var count = 0;
    var out = cols.map(function (c) {
      var n = hasOwn.call(map, c) ? map[c].trim() : '';
      if (n !== '' && n !== c) { count++; return n; }
      return c;
    });
    return { columns: out, count: count };
  }

  function duplicateNames(cols) {
    var seen = Object.create(null);
    var out = [];
    cols.forEach(function (c) {
      if (seen[c] && out.indexOf(c) < 0) out.push(c);
      seen[c] = true;
    });
    return out;
  }

  /* ---------- Reorder ---------- */
  DL.registerOp({
    id: 'reorder',
    name: 'Reorder Columns',
    category: 'Columns',
    icon: 'bi-arrow-down-up',
    description: 'Change the order of the columns. Drag to move.',
    keywords: 'move arrange position',
    params: [
      { key: 'order', label: 'Column order', type: 'columnOrder', help: 'Columns not in this list are placed at the end in their original order.' }
    ],
    summary: function (p) { return p.order.join(', '); },
    outputColumns: function (cols, p) { return reorder(cols, p.order); },
    apply: function (table, p) {
      var cols = reorder(table.columns, p.order);
      return { table: DL.pickColumns(table, cols.map(function (c) { return table.columns.indexOf(c); })) };
    }
  });

  function reorder(cols, order) {
    var out = order.filter(function (c) { return cols.indexOf(c) >= 0; });
    cols.forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); });
    return out;
  }

  /* ---------- Remove ---------- */
  DL.registerOp({
    id: 'remove',
    name: 'Remove Columns',
    category: 'Columns',
    icon: 'bi-x-square',
    description: 'Delete columns you do not need.',
    keywords: 'delete drop keep select',
    params: [
      { key: 'mode', label: 'Mode', type: 'select', default: 'remove',
        options: [{ value: 'remove', label: 'Remove the chosen columns' }, { value: 'keep', label: 'Keep only the chosen columns' }] },
      { key: 'columns', label: 'Columns', type: 'columns' }
    ],
    summary: function (p) { return (p.mode === 'keep' ? 'Keep only ' : 'Remove ') + p.columns.join(', '); },
    validate: function (p, cols) {
      if (!cols || p.mode === 'keep') return [];
      var present = p.columns.filter(function (c) { return cols.indexOf(c) >= 0; });
      if (cols.length && present.length >= cols.length) return ['You cannot remove every column.'];
      return [];
    },
    outputColumns: function (cols, p) {
      var set = p.columns;
      return p.mode === 'keep' ? cols.filter(function (c) { return set.indexOf(c) >= 0; }) : cols.filter(function (c) { return set.indexOf(c) < 0; });
    },
    apply: function (table, p) {
      var chosen = DL.colIndexes(table, p.columns);
      var drop = p.mode === 'keep'
        ? DL.allIndexes(table).filter(function (i) { return chosen.indexOf(i) < 0; })
        : chosen;
      if (drop.length >= table.columns.length) throw new Error('You cannot remove every column.');
      return { table: DL.dropColumns(table, drop) };
    }
  });

  /* ---------- Add column ---------- */
  var NEW_COLUMN = 'New Column';
  DL.registerOp({
    id: 'addColumn',
    name: 'Add Column',
    category: 'Columns',
    icon: 'bi-plus-square',
    description: 'Add a new column with a fixed value, a row number, or today\'s date.',
    keywords: 'constant static new field index',
    params: [
      { key: 'name', label: 'Column name', type: 'text', default: NEW_COLUMN, notBlank: true },
      { key: 'kind', label: 'Fill with', type: 'select', default: 'value',
        options: [
          { value: 'value', label: 'A fixed value' },
          { value: 'rowNumber', label: 'Row number' },
          { value: 'today', label: 'Today\'s date' },
          { value: 'empty', label: 'Nothing (empty)' }
        ] },
      { key: 'value', label: 'Value', type: 'text', default: '', showIf: function (p) { return p.kind === 'value'; } },
      { key: 'start', label: 'Start at', type: 'number', default: 1, required: true, integer: true, showIf: function (p) { return p.kind === 'rowNumber'; } },
      { key: 'position', label: 'Position', type: 'select', default: 'end',
        options: [{ value: 'end', label: 'Last column' }, { value: 'start', label: 'First column' }] }
    ],
    summary: function (p) { return '"' + p.name + '"' + (p.kind === 'value' ? ' = "' + p.value + '"' : ' (' + p.kind + ')'); },
    outputColumns: function (cols, p) {
      var n = DL.newColumnName(cols, p.name, NEW_COLUMN);
      return p.position === 'start' ? [n].concat(cols) : cols.concat([n]);
    },
    // "Today" changes with the day, so the cached result must change too.
    hashExtra: function (p) { return p.kind === 'today' ? DL.formatDateISO(DL.startOfDay(Date.now())) : ''; },
    apply: function (table, p) {
      var name = DL.newColumnName(table.columns, p.name, NEW_COLUMN);
      var n = table.length;
      var values = new Array(n);
      var i;
      if (p.kind === 'rowNumber') {
        var start = Number(p.start) || 0;
        for (i = 0; i < n; i++) values[i] = String(start + i);
      } else {
        var val = p.kind === 'value' ? DL.unescapeText(p.value) : p.kind === 'today' ? DL.formatDateISO(DL.startOfDay(Date.now())) : '';
        for (i = 0; i < n; i++) values[i] = val;
      }
      return { table: DL.addColumn(table, name, values, p.position) };
    }
  });

  /* ---------- Fill empty values ---------- */
  DL.registerOp({
    id: 'fill',
    name: 'Fill Empty Values',
    category: 'Columns',
    icon: 'bi-arrow-bar-down',
    description: 'Fill empty cells with the value above, a fixed value, the average or the most common value.',
    keywords: 'fill down blank missing null default impute',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns' },
      { key: 'mode', label: 'Fill with', type: 'select', default: 'above',
        options: [
          { value: 'above', label: 'The value above (fill down)' },
          { value: 'below', label: 'The value below (fill up)' },
          { value: 'value', label: 'A fixed value' },
          { value: 'average', label: 'The average of the column' },
          { value: 'common', label: 'The most common value' }
        ] },
      { key: 'value', label: 'Fixed value', type: 'text', default: '', showIf: function (p) { return p.mode === 'value'; } },
      { key: 'decimals', label: 'Decimals for the average', type: 'number', default: 2, min: 0, max: 15, integer: true, required: true, showIf: function (p) { return p.mode === 'average'; } },
      { key: 'blankIsEmpty', label: 'Treat cells with only spaces as empty', type: 'boolean', default: true }
    ],
    summary: function (p) { return p.mode + ': ' + p.columns.join(', '); },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var n = table.length;
      var blankIsEmpty = !!p.blankIsEmpty;
      var isEmpty = function (v) { return v === '' || (blankIsEmpty && DL.isBlank(v)); };
      var cols = table.cols.slice();
      var filled = 0;
      idxs.forEach(function (c) {
        var src = DL.col(table, c);
        var out = new Array(n);
        var i, v;
        if (p.mode === 'above' || p.mode === 'below') {
          var last = '';
          var start = p.mode === 'above' ? 0 : n - 1, step = p.mode === 'above' ? 1 : -1;
          for (i = start; i >= 0 && i < n; i += step) {
            v = src[i];
            if (isEmpty(v)) { out[i] = last; if (last !== v) filled++; } else { out[i] = v; last = v; }
          }
        } else {
          var fillValue = DL.unescapeText(p.value);
          if (p.mode === 'average') {
            var sum = 0, count = 0;
            for (i = 0; i < n; i++) { var x = DL.toNumber(src[i]); if (x === x) { sum += x; count++; } }
            fillValue = count ? DL.formatFixed(sum / count, Number(p.decimals)) : '';
          } else if (p.mode === 'common') {
            var g = DL.groupRows([function (r) { return src[r]; }], n);
            var best = -1, bestCount = 0;
            for (i = 0; i < n; i++) if (g.first[i] === i && !isEmpty(src[i]) && g.count[i] > bestCount) { best = i; bestCount = g.count[i]; }
            fillValue = best >= 0 ? src[best] : '';
          }
          for (i = 0; i < n; i++) {
            v = src[i];
            if (isEmpty(v)) { out[i] = fillValue; if (fillValue !== v) filled++; } else out[i] = v;
          }
        }
        cols[c] = out;
      });
      return { table: DL.makeTable(table.columns, cols, n), notes: ['Changed ' + DL.pluralize(filled, 'cell') + '.'] };
    }
  });

  /* ---------- Calculate ---------- */
  var RESULT = 'Result';
  var CALC = {
    '+': function (a, b) { return a + b; },
    '-': function (a, b) { return a - b; },
    '*': function (a, b) { return a * b; },
    '/': function (a, b) { return b === 0 ? NaN : a / b; },
    '%': function (a, b) { return b === 0 ? NaN : a % b; },
    'pct': function (a, b) { return b === 0 ? NaN : (a / b) * 100; }
  };

  DL.registerOp({
    id: 'calculate',
    name: 'Calculate',
    category: 'Columns',
    icon: 'bi-calculator',
    description: 'Add, subtract, multiply or divide two columns (or a column and a number) into a new column.',
    keywords: 'math arithmetic sum product formula',
    params: [
      { key: 'left', label: 'First column', type: 'column' },
      { key: 'operator', label: 'Operation', type: 'select', default: '+',
        options: [
          { value: '+', label: '+  add' }, { value: '-', label: '−  subtract' }, { value: '*', label: '×  multiply' }, { value: '/', label: '÷  divide' },
          { value: '%', label: '%  remainder' }, { value: 'pct', label: '% of (first as percent of second)' }
        ] },
      { key: 'rightKind', label: 'Second value', type: 'select', default: 'column',
        options: [{ value: 'column', label: 'Another column' }, { value: 'number', label: 'A fixed number' }] },
      { key: 'right', label: 'Second column', type: 'column', showIf: function (p) { return p.rightKind !== 'number'; } },
      { key: 'rightNumber', label: 'Number', type: 'number', default: 1, required: true, showIf: function (p) { return p.rightKind === 'number'; } },
      { key: 'output', label: 'New column name', type: 'text', default: RESULT, notBlank: true },
      { key: 'decimals', label: 'Round to decimals', type: 'number', default: '', min: 0, max: 15, integer: true, help: 'Leave empty to keep all decimals.' },
      { key: 'onError', label: 'When a value is not a number', type: 'select', default: 'blank',
        options: [{ value: 'blank', label: 'Leave the result empty' }, { value: 'zero', label: 'Treat it as 0' }, { value: 'text', label: 'Write "error"' }] }
    ],
    summary: function (p) { return p.output + ' = ' + p.left + ' ' + p.operator + ' ' + (p.rightKind === 'number' ? p.rightNumber : p.right); },
    outputColumns: function (cols, p) { return cols.concat([DL.newColumnName(cols, p.output, RESULT)]); },
    apply: function (table, p) {
      var useNum = p.rightKind === 'number';
      var left = DL.col(table, DL.requireCol(table, p.left));
      var right = useNum ? null : DL.col(table, DL.requireCol(table, p.right));
      var constant = DL.toNumber(p.rightNumber);
      var dec = p.decimals === '' ? -1 : Math.max(0, Math.min(15, Number(p.decimals)));
      var calc = CALC[p.operator] || CALC['+'];
      var errText = p.onError === 'text' ? 'error' : '';
      var zeroOnError = p.onError === 'zero';
      var bad = 0;
      var n = table.length;
      var toNumber = DL.toNumber;
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var a = toNumber(left[i]);
        var b = useNum ? constant : toNumber(right[i]);
        if (a !== a || b !== b) {
          if (zeroOnError) { if (a !== a) a = 0; if (b !== b) b = 0; }
          else { bad++; values[i] = errText; continue; }
        }
        var v = calc(a, b);
        if (v !== v || v === Infinity || v === -Infinity) { bad++; values[i] = errText; }
        else values[i] = dec >= 0 ? DL.formatFixed(v, dec) : DL.numberText(v);
      }
      var notes = bad ? [DL.pluralize(bad, 'row') + ' could not be calculated.'] : [];
      return { table: DL.addColumn(table, DL.newColumnName(table.columns, p.output, RESULT), values), notes: notes };
    }
  });

  /* ---------- Number format ---------- */
  DL.registerOp({
    id: 'numFormat',
    name: 'Format Numbers',
    category: 'Columns',
    icon: 'bi-123',
    description: 'Clean up numbers: fixed decimals, thousands separators, currency symbols and percent signs.',
    keywords: 'decimal round currency thousands separator numeric',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns' },
      { key: 'decimals', label: 'Decimals', type: 'number', default: 2, min: 0, max: 15, integer: true, required: true },
      { key: 'thousands', label: 'Thousands separator', type: 'select', default: '',
        options: [{ value: '', label: 'None (1234567)' }, { value: ',', label: 'Comma (1,234,567)' }, { value: '.', label: 'Period (1.234.567)' }, { value: ' ', label: 'Space (1 234 567)' }, { value: "'", label: "Apostrophe (1'234'567)" }] },
      { key: 'decimalSep', label: 'Decimal separator', type: 'select', default: '.',
        options: [{ value: '.', label: 'Period (3.14)' }, { value: ',', label: 'Comma (3,14)' }] },
      { key: 'prefix', label: 'Prefix', type: 'text', default: '', help: 'For example "$".' },
      { key: 'suffix', label: 'Suffix', type: 'text', default: '', help: 'For example "%".' },
      { key: 'negative', label: 'Negative numbers', type: 'select', default: 'minus',
        options: [{ value: 'minus', label: '-1,234.50' }, { value: 'parens', label: '(1,234.50)' }] },
      { key: 'onError', label: 'When a value is not a number', type: 'select', default: 'keep',
        options: [{ value: 'keep', label: 'Keep the text as it is' }, { value: 'blank', label: 'Make it empty' }] }
    ],
    summary: function (p) { return p.decimals + ' decimals: ' + p.columns.join(', '); },
    validate: function (p) { return p.thousands && p.thousands === p.decimalSep ? ['Thousands and decimal separators must be different.'] : []; },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var dec = Math.max(0, Math.min(15, Number(p.decimals) || 0));
      var stats = {};
      var blankOnError = p.onError === 'blank';
      var parens = p.negative === 'parens';
      var out = DL.mapColumns(table, idxs, function (v, ctx) {
        if (v === '') return v;
        var n = DL.toNumber(v);
        if (n !== n) {
          if (DL.isBlank(v)) return v;
          ctx.tag();
          return blankOnError ? '' : v;
        }
        return DL.formatNumber(n, dec, p.thousands, p.decimalSep, p.prefix, p.suffix, parens);
      }, stats);
      return { table: out, notes: stats.tagged ? [DL.pluralize(stats.tagged, 'value') + ' could not be read as a number.'] : [] };
    }
  });

  /* ---------- JavaScript ---------- */
  DL.registerOp({
    id: 'javascript',
    name: 'Custom JavaScript',
    category: 'Advanced',
    icon: 'bi-code-slash',
    description: 'Write a small JavaScript function that returns the value for a new column. Use row["Column name"] to read values.',
    keywords: 'code script formula custom function',
    params: [
      { key: 'output', label: 'New column name', type: 'text', default: RESULT, notBlank: true },
      { key: 'code', label: 'Code', type: 'code', default: '// row is an object with one property per column.\n// index is the row number, starting at 0.\n// Return the value for the new column.\nreturn row["Column name"];',
        help: 'The code runs once per row as the body of a function (row, index, num, date). num(x) and date(x) turn text into a number or a date.' },
      { key: 'replaceColumn', label: 'Write into an existing column instead', type: 'column', required: false, help: 'Leave empty to create a new column.' }
    ],
    summary: function (p) { return (p.replaceColumn ? 'Update ' + p.replaceColumn : 'Add ' + p.output); },
    validate: function (p) {
      if (!p.code.trim()) return ['Write some code.'];
      try { new Function('row', 'index', 'num', 'date', p.code); } catch (e) { return ['The code has a syntax error: ' + e.message]; }
      return [];
    },
    outputColumns: function (cols, p) { return p.replaceColumn ? cols : cols.concat([DL.newColumnName(cols, p.output, RESULT)]); },
    apply: function (table, p) {
      var fn = new Function('row', 'index', 'num', 'date', p.code);
      var cols = table.columns;
      var target = p.replaceColumn ? DL.requireCol(table, p.replaceColumn) : -1;
      var errors = 0, firstError = '';
      var dateFn = function (x) { var t = DL.toDate(x); return isNaN(t) ? null : new Date(t); };
      var n = table.length;
      var w = cols.length;
      var get = cols.map(function (name, c) { return DL.cellGetter(table, c); });
      var values = new Array(n);
      for (var i = 0; i < n; i++) {
        var row = new Row(); // no inherited names such as "constructor"; fast properties
        for (var c = 0; c < w; c++) row[cols[c]] = get[c](i);
        var v;
        try {
          v = fn(row, i, DL.toNumber, dateFn);
        } catch (e) {
          errors++;
          if (!firstError) firstError = e.message;
          v = '';
        }
        values[i] = v != null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : DL.cellText(v);
      }
      var notes = errors ? [DL.pluralize(errors, 'row') + ' caused an error. First error: ' + firstError] : [];
      var out;
      if (target >= 0) {
        var newCols = table.cols.slice();
        newCols[target] = values;
        out = DL.makeTable(cols, newCols, n);
      } else out = DL.addColumn(table, DL.newColumnName(cols, p.output, 'Result'), values);
      return { table: out, notes: notes };
    }
  });

  // Row objects for the JavaScript operation: no prototype, so column names never clash with Object members.
  function Row() {}
  Row.prototype = Object.create(null);
})(typeof self !== 'undefined' ? self : this);
