/* Engine unit tests. Run: node test/engine.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// The engine runs in this realm (not a vm sandbox): cross-realm calls make the timings wrong.
global.self = global;
require('../js/manifest.js');
const manifest = global.DL;
manifest.FILES.engine.concat(manifest.FILES.ops).forEach((f) => {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
});
const DL = global.DL;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); }
}
const T = (cols, rows) => DL.fromRows(cols, rows);
// Tests read results as rows for readability.
const rowsOf = (t) => DL.rowsSlice(t, 0, t.length);
// Compare by value for short, clear failure messages.
assert.deepStrictEqual = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m || "deep equal");
const run = (op, params, table) => DL.runOp(op, Object.assign(DL.defaultParams(op), params), table);

/* ---- core ---- */
test('toNumber handles formats', () => {
  assert.strictEqual(DL.toNumber('1,234.56'), 1234.56);
  assert.strictEqual(DL.toNumber('1.234,56'), 1234.56);
  assert.strictEqual(DL.toNumber('1,234'), 1234);
  assert.strictEqual(DL.toNumber('1,5'), 1.5);
  assert.strictEqual(DL.toNumber('$1,000'), 1000);
  assert.strictEqual(DL.toNumber('(12)'), -12);
  assert.strictEqual(DL.toNumber('12%'), 12);
  assert.strictEqual(DL.toNumber('-3.5e2'), -350);
  assert.ok(isNaN(DL.toNumber('abc')));
  assert.ok(isNaN(DL.toNumber('')));
  assert.ok(isNaN(DL.toNumber('1.2.3')));
  assert.ok(isNaN(DL.toNumber('12a')));
});
test('toDate handles formats', () => {
  assert.ok(!isNaN(DL.toDate('2024-01-31')));
  assert.ok(!isNaN(DL.toDate('01/31/2024')));
  assert.ok(!isNaN(DL.toDate('31/01/2024')));
  assert.ok(!isNaN(DL.toDate('March 5, 2024')));
  assert.ok(isNaN(DL.toDate('hello')));
  assert.ok(isNaN(DL.toDate('12')));
  assert.strictEqual(new Date(DL.toDate('2024-02-03')).getDate(), 3);
});
test('cleanHeaders makes unique non-empty names', () => {
  assert.deepStrictEqual(DL.cleanHeaders(['a', '', 'a', ' b ']), ['a', 'Column 2', 'a 2', 'b']);
});
test('titleCase and sentenceCase', () => {
  assert.strictEqual(DL.titleCase('hello wORLD o\'neil-smith'), 'Hello World O\'Neil-Smith');
  assert.strictEqual(DL.sentenceCase('hello. this IS a test! ok'), 'Hello. This is a test! Ok');
});

/* ---- text ops ---- */
const people = T(['First', 'Last', 'Age', 'Email'], [
  ['john', 'SMITH', '34', 'john@x.com'],
  ['  Jane ', 'doe', '2,000', 'bad email'],
  ['', 'Lee', '', ''],
  ['john', 'smith', '34', 'john@x.com']
]);

test('case op', () => {
  const r = run('case', { columns: ['First'], mode: 'title' }, people);
  assert.strictEqual(rowsOf(r.table)[0][0], 'John');
  assert.strictEqual(rowsOf(people)[0][0], 'john', 'input unchanged');
});
test('concat op', () => {
  const r = run('concat', { columns: ['First', 'Last'], separator: ' ', output: 'Full', skipEmpty: true }, people);
  assert.deepStrictEqual(r.table.columns, ['First', 'Last', 'Age', 'Email', 'Full']);
  assert.strictEqual(rowsOf(r.table)[0][4], 'john SMITH');
  assert.strictEqual(rowsOf(r.table)[2][4], 'Lee');
  const r2 = run('concat', { columns: ['First', 'Last'], separator: '\\t', output: 'First', removeSource: true }, people);
  assert.deepStrictEqual(r2.table.columns, ['Age', 'Email', 'First']);
  assert.strictEqual(rowsOf(r2.table)[0][2], 'john\tSMITH');
});
test('split op', () => {
  const t = T(['A'], [['x,y,z'], ['only'], [''], ['a,b']]);
  const r = run('split', { column: 'A', separator: ',' }, t);
  assert.deepStrictEqual(r.table.columns, ['A', 'A - 1', 'A - 2', 'A - 3']);
  assert.deepStrictEqual(rowsOf(r.table)[1], ['only', 'only', '', '']);
  const r2 = run('split', { column: 'A', separator: ',', maxParts: 2, names: 'P, Q', removeSource: true }, t);
  assert.deepStrictEqual(r2.table.columns, ['P', 'Q']);
  assert.deepStrictEqual(rowsOf(r2.table)[0], ['x', 'y,z']);
  const r3 = run('split', { column: 'A', separator: '[,;]', regex: true }, T(['A'], [['1;2,3']]));
  assert.deepStrictEqual(rowsOf(r3.table)[0], ['1;2,3', '1', '2', '3']);
});
test('splitName', () => {
  assert.deepStrictEqual(DL.splitName('Dr. John A. Smith Jr.'), { prefix: 'Dr.', first: 'John', middle: 'A.', last: 'Smith', suffix: 'Jr.' });
  assert.deepStrictEqual(DL.splitName('Smith, John'), { prefix: '', first: 'John', middle: '', last: 'Smith', suffix: '' });
  assert.deepStrictEqual(DL.splitName('Ludwig van Beethoven'), { prefix: '', first: 'Ludwig', middle: '', last: 'van Beethoven', suffix: '' });
  assert.deepStrictEqual(DL.splitName('Madonna'), { prefix: '', first: 'Madonna', middle: '', last: '', suffix: '' });
  assert.deepStrictEqual(DL.splitName(''), { prefix: '', first: '', middle: '', last: '', suffix: '' });
  assert.deepStrictEqual(DL.splitName('Smith, John, Jr.').suffix, 'Jr.');
  const r = run('splitName', { column: 'First', parts: ['first', 'last'] }, T(['First'], [['Mary Ann Jones']]));
  assert.deepStrictEqual(r.table.columns, ['First', 'First Name', 'Last Name']);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['Mary Ann Jones', 'Mary', 'Jones']);
});
test('replace op', () => {
  const r = run('replace', { columns: ['Last'], find: 'smith', replace: 'S.' }, people);
  assert.strictEqual(rowsOf(r.table)[0][1], 'S.');
  assert.strictEqual(rowsOf(r.table)[3][1], 'S.');
  const r2 = run('replace', { columns: ['Last'], find: 'smith', replace: 'S.', matchCase: true }, people);
  assert.strictEqual(rowsOf(r2.table)[0][1], 'SMITH');
  const r3 = run('replace', { columns: [], find: '(\\d+)', replace: '<$1>', regex: true }, people);
  assert.strictEqual(rowsOf(r3.table)[0][2], '<34>');
  const r4 = run('replace', { columns: ['Email'], find: 'bad email', replace: '', wholeCell: true }, people);
  assert.strictEqual(rowsOf(r4.table)[1][3], '');
  const r5 = run('replace', { columns: ['Email'], find: 'x', replace: 'y', wholeWord: true }, people);
  assert.strictEqual(rowsOf(r5.table)[0][3], 'john@y.com');
  const r6 = run('replace', { columns: ['Age'], find: '3', replace: '$' }, people);
  assert.strictEqual(rowsOf(r6.table)[0][2], '$4');
});
test('substitute op', () => {
  const r = run('substitute', { columns: ['Last'], mapping: [{ from: 'smith', to: 'Smyth' }], noMatch: 'keep' }, people);
  assert.strictEqual(rowsOf(r.table)[0][1], 'Smyth');
  assert.strictEqual(rowsOf(r.table)[1][1], 'doe');
  const r2 = run('substitute', { columns: ['Last'], mapping: [{ from: 'smith', to: 'Smyth' }], noMatch: 'value', noMatchValue: '?' }, people);
  assert.strictEqual(rowsOf(r2.table)[1][1], '?');
});
test('padTrim op', () => {
  const r = run('padTrim', { columns: ['First'], trim: 'both', pad: 'left', length: 6, char: '*' }, people);
  assert.strictEqual(rowsOf(r.table)[1][0], '**Jane');
  assert.strictEqual(rowsOf(r.table)[2][0], '******');
});

/* ---- row ops ---- */
test('dedupe op', () => {
  const r = run('dedupe', { columns: ['First', 'Last'], ignoreCase: true }, people);
  assert.strictEqual(rowsOf(r.table).length, 3);
  const r2 = run('dedupe', { columns: ['First', 'Last'], ignoreCase: false }, people);
  assert.strictEqual(rowsOf(r2.table).length, 4);
  const r3 = run('dedupe', { columns: ['First'], keep: 'none', trim: true }, people);
  assert.strictEqual(rowsOf(r3.table).length, 2);
  const r4 = run('dedupe', { columns: ['First'], keep: 'last' }, people);
  assert.strictEqual(rowsOf(r4.table)[2][1], 'smith');
});
test('filter op', () => {
  const r = run('filter', { conditions: [{ column: 'Age', op: 'gt', value: '30' }] }, people);
  assert.strictEqual(rowsOf(r.table).length, 3);
  const r2 = run('filter', { action: 'remove', conditions: [{ column: 'Email', op: 'empty' }] }, people);
  assert.strictEqual(rowsOf(r2.table).length, 3);
  const r3 = run('filter', { logic: 'any', conditions: [{ column: 'Last', op: 'equals', value: 'lee' }, { column: 'First', op: 'startsWith', value: 'jo' }] }, people);
  assert.strictEqual(rowsOf(r3.table).length, 3);
  const r4 = run('filter', { conditions: [{ column: 'Age', op: 'between', value: '100', value2: '10' }] }, people);
  assert.strictEqual(rowsOf(r4.table).length, 2);
  const r5 = run('filter', { conditions: [{ column: 'Last', op: 'inList', value: 'doe, LEE' }] }, people);
  assert.strictEqual(rowsOf(r5.table).length, 2);
  const r6 = run('filter', { conditions: [{ column: 'Email', op: 'regex', value: '^\\S+@\\S+$' }] }, people);
  assert.strictEqual(rowsOf(r6.table).length, 2);
  assert.ok(DL.validateParams('filter', Object.assign(DL.defaultParams('filter'), { conditions: [{ column: '', op: 'gt', value: 'x' }] }), ['A']).length >= 2);
  assert.deepStrictEqual(DL.validateParams('filter', Object.assign(DL.defaultParams('filter'), { conditions: [{ column: 'Zip', op: 'contains', value: 'x' }] }), ['A']), ['Rule 1: Column "Zip" is not in the input.']);
  assert.deepStrictEqual(DL.validateParams('filter', Object.assign(DL.defaultParams('filter'), { conditions: [{ column: 'Zip', op: 'contains', value: 'x' }] }), null), []);
});
test('sort op', () => {
  const t = T(['N', 'S', 'D'], [['10', 'b', '2024-03-01'], ['9', 'a', '01/15/2023'], ['', 'C', ''], ['100', 'á', '2022-12-31']]);
  const r = run('sort', { keys: [{ column: 'N', type: 'auto', dir: 'asc' }] }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['9', '10', '100', '']);
  const r2 = run('sort', { keys: [{ column: 'S', type: 'text', dir: 'desc' }] }, t);
  assert.strictEqual(rowsOf(r2.table)[0][1], 'C');
  const r3 = run('sort', { keys: [{ column: 'D', type: 'date', dir: 'asc' }], emptyLast: false }, t);
  assert.deepStrictEqual(rowsOf(r3.table).map((x) => x[2]), ['', '2022-12-31', '01/15/2023', '2024-03-01']);
  assert.strictEqual(rowsOf(t)[0][0], '10', 'input unchanged');
});
test('outliers op', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push([String(50 + (i % 10))]);
  rows.push(['1000']); rows.push(['-500']); rows.push(['n/a']);
  const t = T(['V'], rows);
  const r = run('outliers', { column: 'V', method: 'iqr', action: 'keep' }, t);
  assert.strictEqual(rowsOf(r.table).length, 2);
  const r2 = run('outliers', { column: 'V', method: 'zscore', zthreshold: 3, action: 'flag', flagColumn: 'Flag' }, t);
  assert.deepStrictEqual(r2.table.columns, ['V', 'Flag']);
  assert.strictEqual(rowsOf(r2.table)[100][1], 'high');
  assert.strictEqual(rowsOf(r2.table)[102][1], '');
  const r3 = run('outliers', { column: 'V', method: 'iqr', action: 'remove' }, t);
  assert.strictEqual(rowsOf(r3.table).length, 101);
});
test('unique op', () => {
  const r = run('unique', { columns: ['Last'], count: true, ignoreCase: true, sortBy: 'count' }, people);
  assert.deepStrictEqual(r.table.columns, ['Last', 'Count']);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['SMITH', '2']);
  assert.strictEqual(rowsOf(r.table).length, 3);
});

/* ---- column ops ---- */
test('rename op', () => {
  const r = run('rename', { map: { First: 'Given', Last: '' } }, people);
  assert.deepStrictEqual(r.table.columns, ['Given', 'Last', 'Age', 'Email']);
  assert.ok(DL.validateParams('rename', { map: { First: 'Last' } }, people.columns).length === 1);
  const r2 = run('rename', { map: { First: 'B' } }, T(['First', 'constructor', 'toString'], [['a', 'b', 'c']]));
  assert.deepStrictEqual(r2.table.columns, ['B', 'constructor', 'toString']);
  assert.deepStrictEqual(DL.validateParams('rename', { map: { First: 'constructor' } }, ['First', 'x']), []);
});
test('reorder op', () => {
  const r = run('reorder', { order: ['Email', 'Age'] }, people);
  assert.deepStrictEqual(r.table.columns, ['Email', 'Age', 'First', 'Last']);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['john@x.com', '34', 'john', 'SMITH']);
});
test('remove op', () => {
  const r = run('remove', { columns: ['Age'] }, people);
  assert.deepStrictEqual(r.table.columns, ['First', 'Last', 'Email']);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['john', 'SMITH', 'john@x.com']);
  const r2 = run('remove', { mode: 'keep', columns: ['Age'] }, people);
  assert.deepStrictEqual(r2.table.columns, ['Age']);
  assert.throws(() => run('remove', { columns: people.columns }, people));
});
test('addColumn op', () => {
  const r = run('addColumn', { name: 'Age', kind: 'rowNumber', start: 1, position: 'start' }, people);
  assert.deepStrictEqual(r.table.columns, ['Age 2', 'First', 'Last', 'Age', 'Email']);
  assert.strictEqual(rowsOf(r.table)[3][0], '4');
});
test('calculate op', () => {
  const t = T(['A', 'B'], [['1', '2'], ['0.1', '0.2'], ['x', '1'], ['5', '0']]);
  const r = run('calculate', { left: 'A', operator: '+', right: 'B', output: 'C' }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[2]), ['3', '0.3', '', '5']);
  const r2 = run('calculate', { left: 'A', operator: '/', right: 'B', output: 'C', decimals: 2, onError: 'text' }, t);
  assert.deepStrictEqual(rowsOf(r2.table).map((x) => x[2]), ['0.50', '0.50', 'error', 'error']);
  const r4 = run('calculate', { left: 'A', operator: '*', rightKind: 'number', rightNumber: '-1', output: 'C', decimals: 0 }, T(['A'], [['2.5'], ['0.125'], ['-2.5']]));
  assert.deepStrictEqual(rowsOf(r4.table).map((x) => x[1]), ['-3', '0', '3']);
  const r3 = run('calculate', { left: 'A', operator: '*', rightKind: 'number', rightNumber: '3', output: 'C' }, t);
  assert.strictEqual(rowsOf(r3.table)[0][2], '3');
});
test('numFormat op', () => {
  const t = T(['A'], [['1234.567'], ['-1.234,5'], ['abc'], ['']]);
  const r = run('numFormat', { columns: ['A'], decimals: 2, thousands: ',', decimalSep: '.', prefix: '$', negative: 'parens' }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['$1,234.57', '($1,234.50)', 'abc', '']);
  const r2 = run('numFormat', { columns: ['A'], decimals: 0, thousands: '.', decimalSep: ',', onError: 'blank' }, t);
  assert.deepStrictEqual(rowsOf(r2.table).map((x) => x[0]), ['1.235', '-1.235', '', '']);
});
test('javascript op', () => {
  const r = run('javascript', { output: 'Out', code: 'return num(row.Age) * 2;' }, people);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[4]), ['68', '4000', '', '68']);
  const r2 = run('javascript', { output: 'Out', code: 'return row.Nope.x;' }, people);
  assert.ok(r2.notes[0].indexOf('4 rows') === 0);
  const r3 = run('javascript', { output: 'Out', code: 'return row.First.toUpperCase();', replaceColumn: 'First' }, people);
  assert.strictEqual(r3.table.columns.length, 4);
  assert.strictEqual(rowsOf(r3.table)[0][0], 'JOHN');
});

/* ---- verify ---- */
test('verify op', () => {
  const r = run('verify', { rules: [{ column: 'Email', op: 'isEmail', allowEmpty: false }, { column: 'Age', op: 'gt', value: '18', allowEmpty: true }, { column: 'First', op: 'unique' }], action: 'flag' }, people);
  assert.deepStrictEqual(r.table.columns, ['First', 'Last', 'Age', 'Email', 'Problems']);
  assert.strictEqual(rowsOf(r.table)[0][4], 'First must be unique in the column');
  assert.ok(rowsOf(r.table)[1][4].indexOf('Email must be an email address') === 0);
  assert.strictEqual(r.status, 'warning');
  const r2 = run('verify', { rules: [{ column: 'Email', op: 'isEmail' }], action: 'passed' }, people);
  assert.strictEqual(rowsOf(r2.table).length, 2);
  const r3 = run('verify', { rules: [{ column: 'First', op: 'noWhitespace' }], action: 'failed' }, people);
  assert.strictEqual(rowsOf(r3.table).length, 1);
});

/* ---- fixes from the code review ---- */
test('groupRows groups empty keys and multi-column keys', () => {
  const t = T(['A', 'B'], [['', 'x'], ['', 'x'], ['a', ''], ['', 'x'], ['a', '']]);
  const r = run('unique', { columns: ['A'], count: true }, t);
  assert.deepStrictEqual(rowsOf(r.table), [['', '3'], ['a', '2']]);
  const r2 = run('dedupe', { columns: ['A', 'B'] }, t);
  assert.strictEqual(r2.table.length, 2);
  const r3 = run('dedupe', { columns: [] }, T(['A', 'B'], [['a b', 'c'], ['a', 'b c']]));
  assert.strictEqual(r3.table.length, 2, 'keys of different columns must not collide');
  const r4 = run('verify', { rules: [{ column: 'A', op: 'unique', allowEmpty: true }], action: 'failed' }, t);
  assert.strictEqual(r4.table.length, 2, 'empty values are skipped, "a" repeats');
});
test('toDate rejects impossible dates', () => {
  assert.ok(isNaN(DL.toDate('2024-02-30')));
  assert.ok(isNaN(DL.toDate('2024-13-01')));
  assert.ok(isNaN(DL.toDate('02/31/2024')));
  assert.ok(!isNaN(DL.toDate('2024-02-29')));
  assert.strictEqual(new Date(DL.toDate('0050-01-01')).getFullYear(), 50);
});
test('splitName never throws', () => {
  assert.deepStrictEqual(DL.splitName(','), { prefix: '', first: '', middle: '', last: '', suffix: '' });
  assert.deepStrictEqual(DL.splitName(' , '), { prefix: '', first: '', middle: '', last: '', suffix: '' });
});
test('split ignores capture groups and predicts columns', () => {
  const t = T(['A'], [['x, y, z'], ['q']]);
  const r = run('split', { column: 'A', separator: '(\\s*,\\s*)', regex: true, trim: false }, t);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['x, y, z', 'x', 'y', 'z']);
  const r2 = run('split', { column: 'A', separator: ',', maxParts: 2, trim: true }, t);
  assert.deepStrictEqual(rowsOf(r2.table)[0], ['x, y, z', 'x', 'y, z']);
  assert.strictEqual(DL.predictColumns('split', Object.assign(DL.defaultParams('split'), { column: 'A', separator: ',' }), ['A']), null);
  assert.deepStrictEqual(DL.predictColumns('split', Object.assign(DL.defaultParams('split'), { column: 'A', separator: ',', maxParts: 2, removeSource: true }), ['A', 'B']), ['B', 'A - 1', 'A - 2']);
});
test('prototype names are safe in JavaScript rows', () => {
  const t = T(['constructor', '__proto__'], [['a', 'b']]);
  const r = run('javascript', { output: 'Out', code: 'return row["constructor"] + row["__proto__"];' }, t);
  assert.strictEqual(rowsOf(r.table)[0][2], 'ab');
});
test('cleanParams repairs wrong shapes', () => {
  const p = DL.cleanParams('case', { columns: 'Email', mode: 'nope', extra: 1 });
  assert.deepStrictEqual(p, { columns: [], mode: 'upper' });
  const f = DL.cleanParams('filter', { conditions: 'x' });
  assert.strictEqual(f.conditions.length, 1);
  const v = DL.cleanParams('verify', { rules: [{ column: 'E', op: 'isEmail' }] });
  assert.strictEqual(v.rules[0].allowEmpty, true);
  const m = DL.cleanParams('substitute', { columns: ['A'], mapping: [{ from: 1, to: null }, 'bad'] });
  assert.deepStrictEqual(m.mapping, [{ from: '1', to: '' }]);
});
test('columnsUsedByStep and addColumn prediction', () => {
  assert.deepStrictEqual(DL.columnsUsedByStep('filter', Object.assign(DL.defaultParams('filter'), { conditions: [{ column: 'A', op: 'empty' }] })), ['A']);
  assert.deepStrictEqual(DL.columnsUsedByStep('calculate', Object.assign(DL.defaultParams('calculate'), { left: 'A', rightKind: 'number' })), ['A']);
  assert.deepStrictEqual(DL.predictColumns('addColumn', Object.assign(DL.defaultParams('addColumn'), { name: ' Total ' }), ['A']), ['A', 'Total']);
  const r = run('addColumn', { name: ' Total ' }, T(['A'], [['1']]));
  assert.deepStrictEqual(r.table.columns, ['A', 'Total']);
});
test('formatNumber has no negative zero and rounds half away from zero', () => {
  assert.strictEqual(DL.formatNumber(-0.004, 2, ',', '.', '', '', false), '0.00');
  assert.strictEqual(DL.formatNumber(-2.5, 0, '', '.', '', '', false), '-3');
  assert.strictEqual(DL.formatFixed(-2.5, 0), '-3');
});
test('hasEdgeSpace sees unicode spaces', () => {
  assert.ok(DL.hasEdgeSpace('\u3000abc'));
  assert.ok(DL.hasEdgeSpace('abc\u2003'));
  assert.ok(!DL.hasEdgeSpace('abc'));
});
test('sort text uses ranks with direction and empties', () => {
  const t = T(['S'], [['b'], [''], ['a'], ['B'], ['c']]);
  const r = run('sort', { keys: [{ column: 'S', type: 'text', dir: 'desc' }] }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['c', 'b', 'B', 'a', '']);
  const r2 = run('sort', { keys: [{ column: 'S', type: 'text', dir: 'asc' }], emptyLast: false }, t);
  assert.deepStrictEqual(rowsOf(r2.table).map((x) => x[0]), ['', 'a', 'b', 'B', 'c']);
});

test('TableBuilder handles headers, skipped rows, blank rows and ragged rows', () => {
  const b = new DL.TableBuilder({ headers: true, skipRows: 1, skipEmptyLines: true });
  [['title line'], ['a', 'b'], ['', ''], ['1', '2'], ['3'], ['4', '5', '6']].forEach((r) => b.add(r));
  const t = b.finish();
  assert.deepStrictEqual(t.columns, ['a', 'b', 'Column 3']);
  assert.deepStrictEqual(rowsOf(t), [['1', '2', ''], ['3', '', ''], ['4', '5', '6']]);
  assert.strictEqual(b.ragged, 2);
  const h = new DL.TableBuilder({ headers: true });
  h.add(['Name', new Date(2025, 0, 1), 1.5]);
  h.add(['x', new Date(2025, 1, 15), 2]);
  assert.deepStrictEqual(h.finish().columns, ['Name', '2025-01-01', '1.5']);
  const n = new DL.TableBuilder({ headers: false });
  n.add(['x', 'y']);
  assert.deepStrictEqual(n.finish().columns, ['Column 1', 'Column 2']);
  const e = new DL.TableBuilder({ headers: true });
  assert.deepStrictEqual(e.finish().columns, []);
  const wide = new DL.TableBuilder({ headers: true });
  wide.add(['a', 'b', 'c']);
  wide.add(['1']);
  assert.deepStrictEqual(wide.finish().columns, ['a', 'b', 'c']);
  assert.deepStrictEqual(rowsOf(wide.finish()), [['1', '', '']]);
});
test('param type coercion rejects wrong shapes', () => {
  assert.strictEqual(DL.cleanParams('padTrim', { length: true }).length, 5);
  assert.strictEqual(DL.cleanParams('padTrim', { length: '7' }).length, '7');
  assert.strictEqual(DL.cleanParams('case', { mode: 'lower' }).mode, 'lower');
  assert.strictEqual(DL.cleanParams('concat', { skipEmpty: 'yes' }).skipEmpty, true);
  assert.deepStrictEqual(DL.cleanParams('splitName', { parts: ['first', 'bogus'] }).parts, ['first']);
  assert.deepStrictEqual(DL.cleanParams('reorder', { order: [1, 'A'] }).order, ['1', 'A']);
  const so = DL.cleanSourceOptions({ headers: undefined, skipRows: 'x', delimiter: 'bogus', sheet: 'S' });
  assert.strictEqual(so.headers, true);
  assert.strictEqual(so.skipRows, 0);
  assert.strictEqual(so.delimiter, 'auto');
  assert.strictEqual(so.sheet, 'S');
  assert.deepStrictEqual(DL.validateParams('reorder', { order: [] }, ['A']), []);
  assert.strictEqual(DL.inputFormatFor('x.XLSX').id, 'spreadsheet');
  assert.strictEqual(DL.inputFormatFor('x.csv').id, 'delimited');
  assert.strictEqual(DL.inputFormatFor('noext').id, 'delimited');
});
test('addColumn today gives a date without time', () => {
  const r = run('addColumn', { name: 'D', kind: 'today' }, T(['A'], [['1']]));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(rowsOf(r.table)[0][1]));
});

test('toDate needs a month name for browser parsing and reads zones', () => {
  assert.ok(isNaN(DL.toDate('Room 12')));
  assert.ok(isNaN(DL.toDate('Ref 300')));
  assert.ok(!isNaN(DL.toDate('March 5, 2024')));
  assert.ok(!isNaN(DL.toDate('5 Mar 2024')));
  assert.strictEqual(DL.toDate('2024-01-05T10:30:00Z'), Date.UTC(2024, 0, 5, 10, 30));
  assert.strictEqual(DL.toDate('2024-01-05T10:30:00 +0100'), Date.UTC(2024, 0, 5, 9, 30));
  assert.ok(isNaN(DL.toDate('2024-01-05T25:30:00Z')));
});
test('number fields can require whole numbers', () => {
  const p = Object.assign(DL.defaultParams('calculate'), { left: 'A', rightKind: 'number', rightNumber: 1, decimals: '2.5' });
  assert.ok(DL.validateParams('calculate', p, ['A']).some((m) => m.indexOf('whole number') >= 0));
  p.decimals = '2';
  assert.deepStrictEqual(DL.validateParams('calculate', p, ['A']), []);
  assert.ok(DL.validateParams('padTrim', Object.assign(DL.defaultParams('padTrim'), { columns: ['A'], pad: 'left', length: '99999' }), ['A']).length === 1);
});
test('columns coerce drops repeated names, rule enums are checked', () => {
  assert.deepStrictEqual(DL.cleanParams('case', { columns: ['A', 'A', 'B'] }).columns, ['A', 'B']);
  const k = DL.cleanParams('sort', { keys: [{ column: 'A', type: 'bogus', dir: 'up' }] }).keys[0];
  assert.strictEqual(k.type, 'auto');
  assert.strictEqual(k.dir, 'asc');
  assert.strictEqual(DL.regexProblem('(a'), 'The regular expression is not valid: Invalid regular expression: /(a/u: Unterminated group');
  assert.strictEqual(DL.regexProblem('a+'), '');
});
test('sort treats collator-equal values as equal and keeps rows stable', () => {
  const t = T(['S', 'N'], [['active', '3'], ['Active', '1'], ['ACTIVE', '2'], ['b', '0']]);
  const r = run('sort', { keys: [{ column: 'S', type: 'text', dir: 'asc' }, { column: 'N', type: 'number', dir: 'asc' }] }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[1]), ['1', '2', '3', '0']);
  const r2 = run('sort', { keys: [{ column: 'S', type: 'text', dir: 'asc' }] }, T(['S'], [['a'], ['A'], ['a']]));
  assert.deepStrictEqual(rowsOf(r2.table).map((x) => x[0]), ['a', 'A', 'a']);
  const r3 = run('sort', { keys: [{ column: 'N', type: 'number', dir: 'desc' }] }, T(['N'], [['1'], [''], ['10'], ['2']]));
  assert.deepStrictEqual(rowsOf(r3.table).map((x) => x[0]), ['10', '2', '1', '']);
  const r4 = run('sort', { keys: [{ column: 'N', type: 'number', dir: 'asc' }], emptyLast: false }, T(['N'], [['1'], [''], ['10'], ['2']]));
  assert.deepStrictEqual(rowsOf(r4.table).map((x) => x[0]), ['', '1', '2', '10']);
});
test('TableBuilder counts rows that differ from the header', () => {
  const b = new DL.TableBuilder({ headers: true });
  [['a', 'b'], ['1', '2', '3'], ['4', '5', '6'], ['7', '8']].forEach((r) => b.add(r));
  assert.strictEqual(b.ragged, 2);
  const c = new DL.TableBuilder({ headers: true });
  [['a', 'b', 'c'], ['1', '2'], ['3', '4']].forEach((r) => c.add(r));
  assert.strictEqual(c.ragged, 2);
});
test('split with names but no maximum has unknown columns', () => {
  const p = Object.assign(DL.defaultParams('split'), { column: 'A', separator: ',', names: 'P, Q' });
  assert.strictEqual(DL.predictColumns('split', p, ['A']), null);
  const r = run('split', { column: 'A', separator: ',', names: 'P, Q' }, T(['A'], [['x,y,z']]));
  assert.deepStrictEqual(r.table.columns, ['A', 'P', 'Q', 'A - 3']);
});

/* ---- registry ---- */
test('every op has metadata and defaults', () => {
  DL.ops.forEach((op) => {
    assert.ok(op.id && op.name && op.description && op.category, op.id);
    const d = DL.defaultParams(op.id);
    assert.ok(typeof d === 'object');
    assert.ok(typeof op.summary === 'function', op.id + ' summary');
    op.params.forEach((p) => assert.ok(p.key && p.label && p.type, op.id + ' param'));
  });
  assert.strictEqual(DL.ops.length, 20);
  // Every operation that changes the columns must predict them correctly (or say null).
  const fixture = T(['Full Name', 'Email', 'Amount'], [['John Smith', 'j@x.com', '1'], ['Ann Lee', 'a@y.com', '2']]);
  const cases = {
    concat: { columns: ['Full Name', 'Email'], output: 'X', removeSource: true },
    splitName: { column: 'Full Name', parts: ['first', 'last'] },
    outliers: { column: 'Amount', action: 'flag' },
    unique: { columns: ['Email'] },
    rename: { map: { Email: 'Mail' } },
    reorder: { order: ['Amount'] },
    remove: { columns: ['Amount'] },
    addColumn: { name: 'N' },
    calculate: { left: 'Amount', rightKind: 'number', rightNumber: 2, output: 'D' },
    javascript: { output: 'J', code: 'return 1;' },
    verify: { rules: [{ column: 'Email', op: 'isEmail' }], action: 'flag' },
    split: { column: 'Full Name', separator: ' ', maxParts: 2 }
  };
  Object.keys(cases).forEach((id) => {
    const params = Object.assign(DL.defaultParams(id), cases[id]);
    const predicted = DL.predictColumns(id, params, fixture.columns);
    const actual = DL.runOp(id, params, fixture).table.columns;
    if (predicted !== null) assert.deepStrictEqual(predicted, actual, id + ' prediction');
  });
});

/* ---- performance smoke ---- */
test('performance on 200k rows', () => {
  const rows = new Array(200000);
  for (let i = 0; i < rows.length; i++) rows[i] = ['name ' + (i % 5000), String(i % 977), 'x' + i + '@mail.com', i % 3 ? 'yes' : 'no'];
  const big = T(['Name', 'Num', 'Email', 'Flag'], rows);
  const t0 = Date.now();
  let t = run('case', { columns: ['Name'], mode: 'title' }, big).table;
  t = run('filter', { conditions: [{ column: 'Flag', op: 'equals', value: 'yes' }] }, t).table;
  t = run('sort', { keys: [{ column: 'Num', type: 'number', dir: 'desc' }] }, t).table;
  t = run('dedupe', { columns: ['Name'] }, t).table;
  t = run('calculate', { left: 'Num', operator: '*', rightKind: 'number', rightNumber: 2, output: 'Double' }, t).table;
  t = run('verify', { rules: [{ column: 'Email', op: 'isEmail' }], action: 'flag' }, t).table;
  const ms = Date.now() - t0;
  assert.ok(rowsOf(t).length === 5000, 'rows ' + rowsOf(t).length);
  console.log('  6 ops on 200k rows: ' + ms + ' ms');
  assert.ok(ms < 5000, 'too slow: ' + ms);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
