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
    { value: 'unique', label: 'must be unique in the column', needs: 'none' }
  ];

  // Returns { label, test(rowIndex) -> boolean, prepare() } for one rule on a table column.
  DL.buildVerifyRule = function (table, rule) {
    var idx = DL.colIndex(table, rule.column);
    if (idx < 0) throw new Error('Column "' + rule.column + '" was not found.');
    var col = DL.col(table, idx);
    var val = rule.value == null ? '' : String(rule.value);
    var n = DL.toNumber(val);
    var num = DL.toNumber;
    var def = DL.VERIFY_RULES.filter(function (r) { return r.value === rule.op; })[0];
    var label = rule.column + ' ' + (def ? def.label : rule.op) + (def && def.needs !== 'none' ? ' ' + val : '');
    var test;
    switch (rule.op) {
      case 'notEmpty': test = function (v) { return v.trim() !== ''; }; break;
      case 'isEmpty': test = function (v) { return v.trim() === ''; }; break;
      case 'isNumber': test = function (v) { return !isNaN(num(v)); }; break;
      case 'isInteger': test = function (v) { var x = num(v); return !isNaN(x) && Math.floor(x) === x; }; break;
      case 'noNumbers': test = function (v) { return !/\d/.test(v); }; break;
      case 'isDate': test = function (v) { return !isNaN(DL.toDate(v)); }; break;
      case 'isEmail': test = function (v) { return EMAIL_RE.test(v.trim()); }; break;
      case 'isUrl': test = function (v) { return URL_RE.test(v.trim()); }; break;
      case 'isPhone': test = function (v) { return PHONE_RE.test(v.trim()) && v.replace(/\D/g, '').length >= 7; }; break;
      case 'noSpaces': test = function (v) { return !/\s/.test(v); }; break;
      case 'noWhitespace': test = function (v) { return v === v.trim(); }; break;
      case 'noUnicode': test = function (v) { return !/[^\x00-\x7F]/.test(v); }; break;
      case 'gt': test = function (v) { var x = num(v); return !isNaN(x) && x > n; }; break;
      case 'gte': test = function (v) { var x = num(v); return !isNaN(x) && x >= n; }; break;
      case 'lt': test = function (v) { var x = num(v); return !isNaN(x) && x < n; }; break;
      case 'lte': test = function (v) { var x = num(v); return !isNaN(x) && x <= n; }; break;
      case 'eq': test = function (v) { var x = num(v); return !isNaN(x) && x === n; }; break;
      case 'minLength': test = function (v) { return v.length >= n; }; break;
      case 'maxLength': test = function (v) { return v.length <= n; }; break;
      case 'exactLength': test = function (v) { return v.length === n; }; break;
      case 'inList':
        var set = new Set(val.split(',').map(function (s) { return s.trim().toLowerCase(); }));
        test = function (v) { return set.has(v.trim().toLowerCase()); };
        break;
      case 'regex':
        var re = new RegExp(val, 'u');
        test = function (v) { return re.test(v); };
        break;
      case 'unique':
        // Needs a first pass over the data; handled by the caller through prepare().
        var groups = null;
        return {
          label: label,
          prepare: function () {
            groups = DL.groupRows(function (i) { return DL.normalizeKey(col[i], true, true); }, col.length);
          },
          test: function (i) { return groups.count[groups.first[i]] === 1; }
        };
      default: throw new Error('Unknown rule "' + rule.op + '".');
    }
    var skipEmpty = rule.op !== 'notEmpty' && rule.op !== 'isEmpty' && rule.op !== 'noWhitespace' && !!rule.allowEmpty;
    return {
      label: label,
      test: function (i) {
        var v = col[i];
        if (skipEmpty && v.trim() === '') return true;
        return test(v);
      }
    };
  };

  DL.validateVerifyRules = function (rules, cols) {
    var out = [];
    if (!rules || !rules.length) return ['Add at least one rule.'];
    rules.forEach(function (r, i) {
      var label = 'Rule ' + (i + 1);
      if (!r.column) out.push(label + ': choose a column.');
      else if (cols && cols.length && cols.indexOf(r.column) < 0) out.push(label + ': column "' + r.column + '" is not in the input.');
      var def = DL.VERIFY_RULES.filter(function (o) { return o.value === r.op; })[0];
      if (!def) { out.push(label + ': choose a check.'); return; }
      if (def.needs === 'text' && (r.value == null || r.value === '')) out.push(label + ': enter a value.');
      if (def.needs === 'number' && isNaN(DL.toNumber(r.value))) out.push(label + ': enter a number.');
      if (r.op === 'regex') { try { new RegExp(r.value, 'u'); } catch (e) { out.push(label + ': the regular expression is not valid.'); } }
    });
    return out;
  };

  DL.registerOp({
    id: 'verify',
    name: 'Verify Values',
    category: 'Quality',
    icon: 'bi-shield-check',
    description: 'Check that values follow your rules. See which rows fail, and why.',
    params: [
      { key: 'rules', label: 'Rules', type: 'rules', default: [{ column: '', op: 'notEmpty', value: '', allowEmpty: true }] },
      { key: 'action', label: 'Then', type: 'select', default: 'flag',
        options: [
          { value: 'flag', label: 'Keep all rows and add a "Problems" column' },
          { value: 'failed', label: 'Keep only rows with problems' },
          { value: 'passed', label: 'Keep only rows without problems' }
        ] },
      { key: 'flagColumn', label: 'Problems column name', type: 'text', default: 'Problems', showIf: function (p) { return p.action === 'flag'; } }
    ],
    summary: function (p) { return DL.pluralize((p.rules || []).length, 'rule') + ', ' + p.action; },
    validate: function (p, cols) { return DL.validateVerifyRules(p.rules, cols); },
    outputColumns: function (cols, p) {
      return p.action === 'flag' ? cols.concat([DL.uniqueName(cols, p.flagColumn || 'Problems')]) : cols;
    },
    apply: function (table, p) {
      var n = table.length;
      var rules = (p.rules || []).map(function (r) { return DL.buildVerifyRule(table, r); });
      rules.forEach(function (r) { if (r.prepare) r.prepare(); });
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
        ? DL.addColumn(table, DL.uniqueName(table.columns, p.flagColumn || 'Problems'), flags)
        : DL.selectRows(table, keep);
      var notes = [];
      if (failedRows === 0) notes.push('All ' + DL.pluralize(n, 'row') + ' passed.');
      else notes.push(DL.pluralize(failedRows, 'row') + ' of ' + n + ' failed at least one rule.');
      rules.forEach(function (r, k) { if (failCounts[k]) notes.push(DL.pluralize(failCounts[k], 'row') + ' failed: ' + r.label); });
      return { table: out, notes: notes, status: failedRows ? 'warning' : 'ok' };
    }
  });
})(typeof self !== 'undefined' ? self : this);
