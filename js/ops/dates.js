/* Date operations: Format Dates, Date Math. */
(function (root) {
  'use strict';
  var DL = root.DL;

  var DAY_FIRST = { key: 'dayFirst', label: 'Read 01/02/2024 as 1 February', type: 'boolean', default: false, help: 'Turn this on for day-first dates (common outside the USA). Dates with a four-digit year first are always read correctly. A value with a time zone, such as 2024-01-01T00:00:00Z, is converted to the local time of this computer.' };

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
        help: 'Tokens: YYYY YY MMMM MMM MM M DDDD DDD DD D HH H mm ss A a. Put other letters in square brackets, for example [at]. Other characters stay as they are.' },
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
    var last = DL.localDate(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  }

  // True when a timestamp is a date that the application can write (years 0 to 9999).
  function inRange(ts) {
    if (ts !== ts) return false;
    var y = new Date(ts).getFullYear();
    return y >= 0 && y <= 9999;
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // Gives b minus a in whole units. For days and weeks, the function ignores the time of day and daylight saving changes.
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
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Move d to the Thursday of the same week.
    var firstThursday = DL.localDate(d.getFullYear(), 0, 4);
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
      case 'dayOfYear': return String(Math.round((startOfDay(ts) - DL.localDate(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1);
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
      { key: 'amount', label: 'Amount (negative to subtract)', type: 'number', default: 1, required: true, integer: true, min: -1000000, max: 1000000, showIf: function (p) { return p.mode === 'add'; } },
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
    outputColumns: function (cols, p) { return cols.concat([DL.newColumnName(cols, p.output, RESULT)]); },
    // "Today" changes with the day, so the cached result must change too.
    hashExtra: function (p) { return p.mode === 'diff' && p.otherKind === 'today' ? DL.formatDateISO(startOfDay(Date.now())) : ''; },
    apply: function (table, p) {
      var col = DL.col(table, DL.requireCol(table, p.column));
      var dayFirst = !!p.dayFirst;
      var n = table.length;
      var stats = {};
      var values;
      // The parse function tags a cell that is not empty and not a date. The note counts the tagged cells.
      var parse = function (v, ctx) {
        var t = DL.toDate(v, dayFirst);
        if (t !== t && v.trim() !== '') ctx.tag();
        return t;
      };
      if (p.mode === 'add') {
        var amount = Number(p.amount);
        values = DL.mapValues(col, n, function (v, ctx) {
          var t = parse(v, ctx);
          if (t !== t) return '';
          var r = addUnits(t, amount, p.unit);
          if (!inRange(r)) { ctx.tag(); return ''; }
          return DL.formatDate(r, p.format);
        }, stats);
      } else if (p.mode === 'diff' && p.otherKind === 'column') {
        // Each column is parsed once per different value; the two timestamp arrays are then combined.
        var otherCol = DL.col(table, DL.requireCol(table, p.other));
        var statsB = {};
        var ta = DL.mapValues(col, n, parse, stats);
        var tb = DL.mapValues(otherCol, n, parse, statsB);
        stats.tagged += statsB.tagged;
        values = new Array(n);
        for (var i = 0; i < n; i++) values[i] = ta[i] !== ta[i] || tb[i] !== tb[i] ? '' : String(diffUnits(ta[i], tb[i], p.unit));
      } else if (p.mode === 'diff') {
        var fixed = p.otherKind === 'today' ? startOfDay(Date.now()) : DL.toDate(p.fixedDate, dayFirst);
        values = DL.mapValues(col, n, function (v, ctx) {
          var t = parse(v, ctx);
          return t !== t ? '' : String(diffUnits(t, fixed, p.unit));
        }, stats);
      } else {
        values = DL.mapValues(col, n, function (v, ctx) {
          var t = parse(v, ctx);
          return t !== t ? '' : datePart(t, p.part);
        }, stats);
      }
      var notes = stats.tagged ? [DL.pluralize(stats.tagged, 'value') + (p.mode === 'add' ? ' could not be read as a date, or the result is outside the years 0 to 9999.' : ' could not be read as a date.')] : [];
      return { table: DL.addColumn(table, DL.newColumnName(table.columns, p.output, RESULT), values), notes: notes };
    }
  });
})(typeof self !== 'undefined' ? self : this);
