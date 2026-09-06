/* Date operations: Format Dates, Date Math. */
(function (root) {
  'use strict';
  var DL = root.DL;

  var DAY_FIRST = { key: 'dayFirst', label: 'Read 01/02/2024 as 1 February', type: 'boolean', default: false, help: 'Turn this on for day-first dates (common outside the USA). Dates with a four-digit year first are always read correctly.' };

  var OUTPUT_FORMATS = [
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-01-31)' },
    { value: 'YYYY-MM-DD HH:mm:ss', label: 'YYYY-MM-DD HH:mm:ss' },
    { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/01/2024)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (01/31/2024)' },
    { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY (31.01.2024)' },
    { value: 'YYYYMMDD', label: 'YYYYMMDD (20240131)' },
    { value: 'D MMM YYYY', label: 'D MMM YYYY (31 Jan 2024)' },
    { value: 'MMMM D, YYYY', label: 'MMMM D, YYYY (January 31, 2024)' },
    { value: 'DDD D MMM YYYY', label: 'DDD D MMM YYYY (Wed 31 Jan 2024)' },
    { value: 'custom', label: 'Custom pattern…' }
  ];

  function outputPattern(p) {
    return p.format === 'custom' ? p.pattern : p.format;
  }

  /* ---------- Format dates ---------- */
  DL.registerOp({
    id: 'dateFormat',
    name: 'Format Dates',
    category: 'Dates',
    icon: 'bi-calendar3',
    description: 'Read dates written in many ways and write them all in one format.',
    keywords: 'date time parse convert iso',
    params: [
      { key: 'columns', label: 'Columns', type: 'columns' },
      DAY_FIRST,
      { key: 'format', label: 'Write as', type: 'select', default: 'YYYY-MM-DD', options: OUTPUT_FORMATS },
      { key: 'pattern', label: 'Custom pattern', type: 'text', default: 'YYYY-MM-DD', required: true, showIf: function (p) { return p.format === 'custom'; },
        help: 'Tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D HH H mm ss A. Other characters are kept as they are.' },
      { key: 'onError', label: 'When a value is not a date', type: 'select', default: 'keep',
        options: [{ value: 'keep', label: 'Keep the text as it is' }, { value: 'blank', label: 'Make it empty' }] }
    ],
    summary: function (p) { return outputPattern(p) + ': ' + p.columns.join(', '); },
    apply: function (table, p) {
      var idxs = DL.colIndexes(table, p.columns);
      var pattern = outputPattern(p);
      var blankOnError = p.onError === 'blank';
      var dayFirst = !!p.dayFirst;
      var stats = {};
      var out = DL.mapColumns(table, idxs, function (v, ctx) {
        if (v.trim() === '') return v;
        var t = DL.toDate(v, dayFirst);
        if (t !== t) { ctx.tag(); return blankOnError ? '' : v; }
        return DL.formatDate(t, pattern);
      }, stats);
      return { table: out, notes: stats.tagged ? [DL.pluralize(stats.tagged, 'value') + ' could not be read as a date.'] : [] };
    }
  });

  /* ---------- Date math ---------- */
  var UNITS = [{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }, { value: 'years', label: 'Years' }];
  var PARTS = [
    { value: 'year', label: 'Year' }, { value: 'month', label: 'Month number' }, { value: 'monthName', label: 'Month name' },
    { value: 'day', label: 'Day of month' }, { value: 'weekday', label: 'Weekday name' }, { value: 'weekdayNumber', label: 'Weekday number (1 = Monday)' },
    { value: 'week', label: 'Week of year (ISO)' }, { value: 'quarter', label: 'Quarter' }, { value: 'dayOfYear', label: 'Day of year' },
    { value: 'hour', label: 'Hour' }, { value: 'minute', label: 'Minute' }
  ];

  function addUnits(ts, n, unit) {
    var d = new Date(ts);
    if (unit === 'days') d.setDate(d.getDate() + n);
    else if (unit === 'weeks') d.setDate(d.getDate() + n * 7);
    else if (unit === 'months') addMonths(d, n);
    else addMonths(d, n * 12);
    return d.getTime();
  }

  // Adds months and keeps the day inside the new month (31 Jan + 1 month = 28/29 Feb).
  function addMonths(d, n) {
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Difference b - a in whole units. Days ignore the time of day and daylight saving changes.
  function diffUnits(a, b, unit) {
    if (unit === 'days' || unit === 'weeks') {
      var days = Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
      return unit === 'days' ? days : Math.trunc(days / 7);
    }
    var da = new Date(a), db = new Date(b);
    var months = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
    if (db.getDate() < da.getDate() && months > 0) months--;
    if (db.getDate() > da.getDate() && months < 0) months++;
    return unit === 'months' ? months : Math.trunc(months / 12);
  }

  function isoWeek(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Thursday of this week
    var firstThursday = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  }

  function datePart(ts, part) {
    var d = new Date(ts);
    switch (part) {
      case 'year': return String(d.getFullYear());
      case 'month': return String(d.getMonth() + 1);
      case 'monthName': return DL.MONTH_NAMES[d.getMonth()];
      case 'day': return String(d.getDate());
      case 'weekday': return DL.DAY_NAMES[d.getDay()];
      case 'weekdayNumber': return String((d.getDay() + 6) % 7 + 1);
      case 'week': return String(isoWeek(ts));
      case 'quarter': return String(Math.floor(d.getMonth() / 3) + 1);
      case 'dayOfYear': return String(Math.round((startOfDay(ts) - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1);
      case 'hour': return String(d.getHours());
      case 'minute': return String(d.getMinutes());
      default: return '';
    }
  }

  var RESULT = 'Result';

  DL.registerOp({
    id: 'dateMath',
    name: 'Date Math',
    category: 'Dates',
    icon: 'bi-calendar-plus',
    description: 'Add or subtract time, find the days between two dates, or take a part of a date such as the year or weekday.',
    keywords: 'date add subtract difference age days between year month weekday',
    params: [
      { key: 'column', label: 'Date column', type: 'column' },
      DAY_FIRST,
      { key: 'mode', label: 'Calculate', type: 'select', default: 'add',
        options: [
          { value: 'add', label: 'Add or subtract time' },
          { value: 'diff', label: 'Time between two dates' },
          { value: 'part', label: 'A part of the date' }
        ] },
      { key: 'amount', label: 'Amount (negative to subtract)', type: 'number', default: 1, required: true, integer: true, showIf: function (p) { return p.mode === 'add'; } },
      { key: 'unit', label: 'Unit', type: 'select', default: 'days', options: UNITS, showIf: function (p) { return p.mode !== 'part'; } },
      { key: 'otherKind', label: 'Second date', type: 'select', default: 'column', showIf: function (p) { return p.mode === 'diff'; },
        options: [{ value: 'column', label: 'Another column' }, { value: 'today', label: 'Today' }, { value: 'fixed', label: 'A fixed date' }] },
      { key: 'other', label: 'Second date column', type: 'column', showIf: function (p) { return p.mode === 'diff' && p.otherKind === 'column'; } },
      { key: 'fixedDate', label: 'Fixed date', type: 'text', default: '', required: true, showIf: function (p) { return p.mode === 'diff' && p.otherKind === 'fixed'; }, help: 'For example 2024-12-31.' },
      { key: 'part', label: 'Part', type: 'select', default: 'year', options: PARTS, showIf: function (p) { return p.mode === 'part'; } },
      { key: 'format', label: 'Write dates as', type: 'select', default: 'YYYY-MM-DD', options: OUTPUT_FORMATS.filter(function (o) { return o.value !== 'custom'; }), showIf: function (p) { return p.mode === 'add'; } },
      { key: 'output', label: 'New column name', type: 'text', default: RESULT, notBlank: true }
    ],
    summary: function (p) {
      if (p.mode === 'add') return p.output + ' = ' + p.column + ' ' + (Number(p.amount) < 0 ? '-' : '+') + ' ' + Math.abs(Number(p.amount)) + ' ' + p.unit;
      if (p.mode === 'diff') return p.output + ' = ' + p.unit + ' from ' + p.column + ' to ' + (p.otherKind === 'column' ? p.other : p.otherKind === 'today' ? 'today' : p.fixedDate);
      return p.output + ' = ' + p.part + ' of ' + p.column;
    },
    validate: function (p) {
      if (p.mode === 'diff' && p.otherKind === 'fixed' && isNaN(DL.toDate(p.fixedDate, p.dayFirst))) return ['Enter a date such as 2024-12-31 for "Fixed date".'];
      return [];
    },
    outputColumns: function (cols, p) { return cols.concat([DL.uniqueName(cols, DL.cleanName(p.output, RESULT))]); },
    apply: function (table, p) {
      var col = DL.col(table, DL.requireCol(table, p.column));
      var dayFirst = !!p.dayFirst;
      var n = table.length;
      var values = new Array(n);
      var bad = 0;
      var i, t;
      if (p.mode === 'add') {
        var amount = Number(p.amount);
        for (i = 0; i < n; i++) {
          t = DL.toDate(col[i], dayFirst);
          if (t !== t) { if (col[i].trim() !== '') bad++; values[i] = ''; continue; }
          values[i] = DL.formatDate(addUnits(t, amount, p.unit), p.format);
        }
      } else if (p.mode === 'diff') {
        var otherCol = p.otherKind === 'column' ? DL.col(table, DL.requireCol(table, p.other)) : null;
        var fixed = p.otherKind === 'today' ? startOfDay(Date.now()) : p.otherKind === 'fixed' ? DL.toDate(p.fixedDate, dayFirst) : NaN;
        for (i = 0; i < n; i++) {
          t = DL.toDate(col[i], dayFirst);
          var u = otherCol ? DL.toDate(otherCol[i], dayFirst) : fixed;
          if (t !== t || u !== u) { if (col[i].trim() !== '' && (!otherCol || otherCol[i].trim() !== '')) bad++; values[i] = ''; continue; }
          values[i] = String(diffUnits(t, u, p.unit));
        }
      } else {
        for (i = 0; i < n; i++) {
          t = DL.toDate(col[i], dayFirst);
          if (t !== t) { if (col[i].trim() !== '') bad++; values[i] = ''; continue; }
          values[i] = datePart(t, p.part);
        }
      }
      var notes = bad ? [DL.pluralize(bad, 'value') + ' could not be read as a date.'] : [];
      return { table: DL.addColumn(table, DL.uniqueName(table.columns, DL.cleanName(p.output, RESULT)), values), notes: notes };
    }
  });
})(typeof self !== 'undefined' ? self : this);
