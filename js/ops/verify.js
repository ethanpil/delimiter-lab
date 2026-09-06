/* Verify operation: check that values follow rules and report problems. */
(function (root) {
  'use strict';
  var DL = root.DL;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;
  var PHONE_RE = /^\+?[\d\s().-]{7,}$/;

  DL.VERIFY_RULES = [
    { value: 'notEmpty', label: 'must not be empty', needs: 'none' },
    { value: 'isEmpty', label: 'must be empty', needs: 'none' },
    { value: 'isNumber', label: 'must be a number', needs: 'none' },
    { value: 'isInteger', label: 'must be a whole number', needs: 'none' },
    { value: 'noNumbers', label: 'must not contain digits', needs: 'none' },
    { value: 'isDate', label: 'must be a date', needs: 'none' },
    { value: 'isEmail', label: 'must be an email address', needs: 'none' },
    { value: 'isUrl', label: 'must be a web address', needs: 'none' },
    { value: 'isPhone', label: 'must look like a phone number', needs: 'none' },
    { value: 'noSpaces', label: 'must not contain spaces', needs: 'none' },
    { value: 'noWhitespace', label: 'must not have spaces at the start or end', needs: 'none' },
    { value: 'noUnicode', label: 'must be plain ASCII (no accents or symbols)', needs: 'none' },
    { value: 'gt', label: 'number must be greater than', needs: 'number' },
    { value: 'gte', label: 'number must be at least', needs: 'number' },
    { value: 'lt', label: 'number must be less than', needs: 'number' },
    { value: 'lte', label: 'number must be at most', needs: 'number' },
    { value: 'eq', label: 'number must equal', needs: 'number' },
    { value: 'minLength', label: 'must have at least this many characters', needs: 'number' },
    { value: 'maxLength', label: 'must have at most this many characters', needs: 'number' },
    { value: 'exactLength', label: 'must have exactly this many characters', needs: 'number' },
    { value: 'inList', label: 'must be one of (comma separated)', needs: 'text' },
    { value: 'regex', label: 'must match regular expression', needs: 'text' },
    { value: 'unique', label: 'must be unique in the column (case and spaces at the ends do not count)', needs: 'none' }
  ];

  // Rules where an empty value is a result in itself, so "Skip empty" does not apply.
  var EMPTY_MATTERS = { notEmpty: true, isEmpty: true, noWhitespace: true };

  // Gives { label, test(rowIndex) -> boolean } for one rule on a table column.
  DL.buildVerifyRule = function (table, rule) {
    var col = DL.col(table, DL.requireCol(table, rule.column));
    var val = rule.value == null ? '' : String(rule.value);
    var n = DL.toNumber(val);
    var num = DL.toNumber;
    var def = DL.findOption(DL.VERIFY_RULES, rule.op);
    var label = rule.column + ' ' + (def ? def.label : rule.op) + (def && def.needs !== 'none' ? ' ' + val : '');
    var test;
    switch (rule.op) {
      case 'notEmpty': test = function (v) { return v.trim() !== ''; }; break;
      case 'isEmpty': test = function (v) { return DL.isBlank(v); }; break;
      case 'isNumber': test = function (v) { return !isNaN(num(v)); }; break;
      case 'isInteger': test = function (v) { var x = num(v); return !isNaN(x) && Math.floor(x) === x; }; break;
      case 'noNumbers': test = function (v) { return !/\d/.test(v); }; break;
      case 'isDate':
        var dates = new Map(); // each different value parses once
        test = function (v) { var t = dates.get(v); if (t === undefined) { t = DL.toDate(v); if (dates.size < 50000) dates.set(v, t); } return t === t; };
        break;
      case 'isEmail': test = function (v) { return EMAIL_RE.test(v.trim()); }; break;
      case 'isUrl': test = function (v) { return URL_RE.test(v.trim()); }; break;
      case 'isPhone': test = function (v) { return PHONE_RE.test(v.trim()) && v.replace(/\D/g, '').length >= 7; }; break;
      case 'noSpaces': test = function (v) { return !/\s/.test(v); }; break;
      case 'noWhitespace': test = function (v) { return v === v.trim(); }; break;
      case 'noUnicode': test = function (v) { return !/[^\x00-\x7F]/.test(v); }; break;
      case 'gt': test = function (v) { return num(v) > n; }; break;
      case 'gte': test = function (v) { return num(v) >= n; }; break;
      case 'lt': test = function (v) { return num(v) < n; }; break;
      case 'lte': test = function (v) { return num(v) <= n; }; break;
      case 'eq': test = function (v) { return num(v) === n; }; break;
      case 'minLength': test = function (v) { return DL.charCount(v) >= n; }; break;
      case 'maxLength': test = function (v) { return DL.charCount(v) <= n; }; break;
      case 'exactLength': test = function (v) { return DL.charCount(v) === n; }; break;
      case 'inList':
        var set = new Set(val.split(',').map(function (s) { return s.trim().toLowerCase(); }));
        test = function (v) { return set.has(v.trim().toLowerCase()); };
        break;
      case 'regex':
        var re = new RegExp(val, 'u');
        test = function (v) { return re.test(v); };
        break;
      case 'unique':
        var groups = DL.groupRows(DL.keyGetters(table, [DL.requireCol(table, rule.column)], { trim: true, ignoreCase: true }), col.length);
        var uniqueRow = function (i) { return groups.count[groups.first[i]] === 1; };
        return {
          label: label,
          test: rule.allowEmpty ? function (i) { return DL.isBlank(col[i]) || uniqueRow(i); } : uniqueRow
        };
      default: throw new Error('Unknown rule "' + rule.op + '".');
    }
    var skipEmpty = !EMPTY_MATTERS[rule.op] && !!rule.allowEmpty;
    return {
      label: label,
      test: function (i) {
        var v = col[i];
        if (skipEmpty && DL.isBlank(v)) return true;
        return test(v);
      }
    };
  };

  var PROBLEMS = 'Problems';

  DL.registerOp({
    id: 'verify',
    name: 'Verify Values',
    category: 'Quality',
    icon: 'bi-shield-check',
    description: 'Check that values follow your rules. See which rows fail, and why.',
    keywords: 'validate check quality rules email',
    params: [
      { key: 'rules', label: 'Rules', type: 'rules' },
      { key: 'action', label: 'Then', type: 'select', default: 'flag',
        options: [
          { value: 'flag', label: 'Keep all rows and add a "Problems" column' },
          { value: 'failed', label: 'Keep only rows with problems' },
          { value: 'passed', label: 'Keep only rows without problems' }
        ] },
      { key: 'flagColumn', label: 'Problems column name', type: 'text', default: PROBLEMS, notBlank: true, showIf: function (p) { return p.action === 'flag'; } }
    ],
    summary: function (p) { return DL.pluralize(p.rules.length, 'rule') + ', ' + p.action; },
    outputColumns: function (cols, p) {
      return p.action === 'flag' ? cols.concat([DL.newColumnName(cols, p.flagColumn, PROBLEMS)]) : cols;
    },
    apply: function (table, p) {
      var n = table.length;
      var rules = p.rules.map(function (r) { return DL.buildVerifyRule(table, r); });
      var failCounts = rules.map(function () { return 0; });
      var failedRows = 0;
      var flag = p.action === 'flag';
      var flags = flag ? new Array(n) : null;
      var keep = flag ? null : [];
      var wantFailed = p.action === 'failed';
      for (var i = 0; i < n; i++) {
        var problems = null;
        for (var k = 0; k < rules.length; k++) {
          if (!rules[k].test(i)) {
            failCounts[k]++;
            (problems || (problems = [])).push(rules[k].label);
          }
        }
        if (problems) failedRows++;
        if (flag) flags[i] = problems ? problems.join('; ') : '';
        else if (wantFailed ? !!problems : !problems) keep.push(i);
      }
      var out = flag
        ? DL.addColumn(table, DL.newColumnName(table.columns, p.flagColumn, PROBLEMS), flags)
        : DL.selectRows(table, keep);
      var notes = [];
      if (failedRows === 0) notes.push('All ' + DL.pluralize(n, 'row') + ' passed.');
      else notes.push(DL.pluralize(failedRows, 'row') + ' of ' + n + ' failed at least one rule.');
      rules.forEach(function (r, k) {
        if (failCounts[k]) notes.push({ text: DL.pluralize(failCounts[k], 'row') + ' failed: ' + r.label, rows: { rule: k } });
      });
      return { table: out, notes: notes, status: failedRows ? 'warning' : 'ok' };
    },
    // Finds the rows of the output that failed one rule (lookup.rule). See DL.findRows.
    findRows: function (table, p, lookup, limit) {
      var n = table.length;
      var k = lookup ? Number(lookup.rule) : -1;
      if (!p.rules[k]) return { matches: [], total: 0 };
      if (p.action === 'passed') return { matches: [], total: 0, removed: true };
      var rule = DL.buildVerifyRule(table, p.rules[k]);
      // With "keep only rows with problems", the output row of a row depends on the other rules too.
      var others = p.action === 'failed' ? p.rules.filter(function (r, j) { return j !== k; }).map(function (r) { return DL.buildVerifyRule(table, r); }) : [];
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
        if (p.action === 'flag' || failed) { outRow++; continue; }
        for (var j = 0; j < others.length; j++) if (!others[j].test(i)) { outRow++; break; }
      }
      return { matches: matches, total: total };
    }
  });
})(typeof self !== 'undefined' ? self : this);
