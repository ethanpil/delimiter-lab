/* Reshape operations: Pivot, Unpivot. */
(function (root) {
  'use strict';
  var DL = root.DL;

  var MAX_PIVOT_COLUMNS = 1000;

  var AGGREGATES = [
    { value: 'sum', label: 'Sum' },
    { value: 'count', label: 'Count' },
    { value: 'avg', label: 'Average' },
    { value: 'min', label: 'Minimum' },
    { value: 'max', label: 'Maximum' },
    { value: 'first', label: 'First value' },
    { value: 'list', label: 'All values, separated by a comma' }
  ];

  function isNumeric(agg) {
    return agg === 'sum' || agg === 'avg' || agg === 'min' || agg === 'max';
  }

  // One cell of the pivot result. It keeps the sum, the count, the minimum, the maximum, the first value and the list of values.
  function Cell() {
    this.sum = 0;
    this.n = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.first = null;
    this.list = null;
  }

  // Adds one value to a cell. Gives false when a numeric aggregate cannot use the value.
  function addValue(cell, v, agg) {
    if (v.trim() === '') return true;
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
    if (agg === 'list') (cell.list || (cell.list = [])).push(v);
    return true;
  }

  function cellText(cell, agg, decimals) {
    if (cell === undefined || cell.n === 0) return agg === 'count' ? '0' : '';
    switch (agg) {
      case 'sum': return DL.formatFixed(cell.sum, decimals);
      case 'avg': return DL.formatFixed(cell.sum / cell.n, decimals);
      case 'min': return DL.formatFixed(cell.min, decimals);
      case 'max': return DL.formatFixed(cell.max, decimals);
      case 'count': return String(cell.n);
      case 'first': return cell.first;
      default: return cell.list.join(', ');
    }
  }

  /* ---------- Pivot ---------- */
  DL.registerOp({
    id: 'pivot',
    name: 'Pivot',
    category: 'Rows',
    icon: 'bi-grid-3x3',
    description: 'Make a summary table: one row for each group, one column for each different value of a column, and a total in each cell.',
    keywords: 'pivot summary crosstab group aggregate sum count average wide',
    params: [
      { key: 'rows', label: 'Group rows by', type: 'columns', required: false, help: 'The result has one row for each different combination of these values. Leave it empty for one total row.' },
      { key: 'columnKey', label: 'Make a column for each value of', type: 'column', help: 'Each different value in this column becomes a new column. Leave it empty for one total column.', required: false },
      { key: 'value', label: 'Values to calculate', type: 'column', required: false, help: 'Leave it empty to count rows.' },
      { key: 'aggregate', label: 'Calculate', type: 'select', default: 'sum', options: AGGREGATES },
      { key: 'decimals', label: 'Decimals', type: 'number', default: 2, min: 0, max: 15, integer: true, required: true, showIf: function (p) { return isNumeric(p.aggregate); } }
    ],
    summary: function (p) {
      return p.aggregate + (p.value ? ' of ' + p.value : '') + (p.rows.length ? ' by ' + p.rows.join(', ') : '') + (p.columnKey ? ' × ' + p.columnKey : '');
    },
    validate: function (p) {
      var problems = [];
      if (!p.value && p.aggregate !== 'count') problems.push('Choose a column for "Values to calculate", or set "Calculate" to Count.');
      if (p.columnKey && p.rows.indexOf(p.columnKey) >= 0) problems.push('The column for the new columns cannot also be a group column.');
      return problems;
    },
    outputColumns: function () { return null; },
    apply: function (table, p) {
      var n = table.length;
      var rowIdxs = DL.colIndexes(table, p.rows);
      var rowGetters = rowIdxs.map(function (c) { return DL.cellGetter(table, c); });
      var keyGetter = p.columnKey ? DL.cellGetter(table, DL.requireCol(table, p.columnKey)) : null;
      var valueGetter = p.value ? DL.cellGetter(table, DL.requireCol(table, p.value)) : function () { return '1'; };
      var agg = p.value ? p.aggregate : 'count';
      var decimals = Number(p.decimals);

      var groups = DL.groupRows(rowGetters, n);
      var groupOrder = [];
      var groupSlot = new Int32Array(n);
      var i;
      for (i = 0; i < n; i++) {
        if (groups.first[i] === i) { groupSlot[i] = groupOrder.length; groupOrder.push(i); }
      }

      var keyNames = [];
      var keySlot = Object.create(null);
      var cells = []; // cells[group][key]
      var ignored = 0;
      if (!keyGetter) { keySlot[''] = 0; keyNames.push(''); } // the one total column exists also for an empty input
      for (i = 0; i < n; i++) {
        var key = keyGetter ? keyGetter(i) : '';
        var ks = keySlot[key];
        if (ks === undefined) {
          if (keyNames.length >= MAX_PIVOT_COLUMNS) {
            throw new Error('"' + p.columnKey + '" has more than ' + MAX_PIVOT_COLUMNS + ' different values. Choose a column with fewer values.');
          }
          if ((keyNames.length + 1 + rowIdxs.length) * groupOrder.length > DL.maxCells) {
            throw new Error('The result would have more than ' + DL.pluralize(DL.maxCells, 'cell') + ', which is too many for the browser. Choose fewer group columns or a key column with fewer values.');
          }
          ks = keySlot[key] = keyNames.length;
          keyNames.push(key);
        }
        var gs = groupSlot[groups.first[i]];
        var row = cells[gs] || (cells[gs] = []);
        var cell = row[ks] || (row[ks] = new Cell());
        if (!addValue(cell, valueGetter(i), agg)) ignored++;
      }

      var columns = rowIdxs.map(function (c) { return table.columns[c]; });
      var valueName = keyGetter ? null : DL.cleanName(p.value ? agg + ' of ' + p.value : 'Count', 'Total');
      var cols = [];
      var g, k;
      for (k = 0; k < rowIdxs.length; k++) {
        var out = new Array(groupOrder.length);
        for (g = 0; g < groupOrder.length; g++) out[g] = rowGetters[k](groupOrder[g]);
        cols.push(out);
      }
      // The empty key gets "(empty)" first, so a real "(empty)" value cannot take that name.
      var headers = keyGetter ? keyNames.map(function (name) { return name === '' ? '(empty)' : DL.cleanName(name, '(blank)'); }) : [valueName];
      var names = new Array(keyNames.length);
      var emptyAt = keyGetter ? keyNames.indexOf('') : -1;
      if (emptyAt >= 0) names[emptyAt] = DL.uniqueName(columns, '(empty)');
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
      var notes = [DL.pluralize(n, 'row') + ' became ' + DL.pluralize(groupOrder.length, 'row') + ' and ' + DL.pluralize(keyNames.length, 'value column') + '.'];
      if (ignored) notes.push(DL.pluralize(ignored, 'value') + ' in "' + p.value + '" ' + (ignored === 1 ? 'is' : 'are') + ' not a number and ' + (ignored === 1 ? 'was' : 'were') + ' ignored.');
      return { table: DL.makeTable(columns, cols, groupOrder.length), notes: notes };
    }
  });

  /* ---------- Unpivot ---------- */
  var NAME = 'Name';
  var VALUE = 'Value';

  DL.registerOp({
    id: 'unpivot',
    name: 'Unpivot',
    category: 'Rows',
    icon: 'bi-layout-three-columns',
    description: 'Turn columns into rows: each chosen column becomes a row with the column name and the value.',
    keywords: 'unpivot melt long narrow columns to rows',
    params: [
      { key: 'columns', label: 'Columns to turn into rows', type: 'columns' },
      { key: 'nameColumn', label: 'Column for the names', type: 'text', default: NAME, notBlank: true },
      { key: 'valueColumn', label: 'Column for the values', type: 'text', default: VALUE, notBlank: true },
      { key: 'skipEmpty', label: 'Skip empty values', type: 'boolean', default: true }
    ],
    summary: function (p) { return p.columns.join(', ') + ' → ' + p.nameColumn + ' / ' + p.valueColumn; },
    outputColumns: function (cols, p) {
      var kept = cols.filter(function (c) { return p.columns.indexOf(c) < 0; });
      var nameCol = DL.newColumnName(kept, p.nameColumn, NAME);
      kept.push(nameCol);
      kept.push(DL.newColumnName(kept, p.valueColumn, VALUE));
      return kept;
    },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var keptIdxs = DL.allIndexes(table).filter(function (c) { return idxs.indexOf(c) < 0; });
      var n = table.length;
      var m = idxs.length;
      var skipEmpty = !!p.skipEmpty;
      var valueGetters = idxs.map(function (c) { return DL.cellGetter(table, c); });
      var i, j;

      // Pass 1: decide which output rows exist, so the arrays get their final size once.
      var count = 0;
      var keep = skipEmpty ? new Uint8Array(n * m) : null;
      for (i = 0; i < n; i++) {
        for (j = 0; j < m; j++) {
          if (skipEmpty && valueGetters[j](i).trim() === '') continue;
          if (keep) keep[i * m + j] = 1;
          count++;
        }
      }
      if (count * (keptIdxs.length + 2) > DL.maxCells) throw new Error('The result would have ' + DL.pluralize(count, 'row') + ', which is too many for the browser.');

      // Pass 2: fill the output columns.
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
      var cols = keptIdxs.map(function (c) { return { src: DL.col(table, c), idx: srcRow }; });
      cols.push(names);
      cols.push(values);
      return { table: DL.makeTable(columns, cols, count), notes: [DL.pluralize(n, 'row') + ' became ' + DL.pluralize(count, 'row') + '.'] };
    }
  });
})(typeof self !== 'undefined' ? self : this);
