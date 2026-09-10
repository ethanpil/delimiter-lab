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
  // An empty value stays empty. This test asked for '******' before, which made a value that the
  // file does not hold: a person who zero-pads a postcode gets 00000 for a missing one.
  assert.strictEqual(rowsOf(r.table)[2][0], '');
});

// Values that come from a file must never reach a key of Object.prototype, and a value that is
// only spaces must count as empty, as it does in every other operation.
test('operations do not invent values or answer with Object.prototype', () => {
  const blank = T(['A', 'B', 'C'], [['1 Main', '  ', 'NY']]);
  const j = run('concat', { columns: ['A', 'B', 'C'], separator: ', ', skipEmpty: true, output: 'Addr' }, blank);
  assert.strictEqual(rowsOf(j.table)[0][3], '1 Main, NY');

  const ent = run('textClean', { columns: ['A'], steps: ['html'] }, T(['A'], [['Acme &constructor; Ltd']]));
  assert.strictEqual(rowsOf(ent.table)[0][0], 'Acme &constructor; Ltd');

  const n = DL.splitName('John Constructor');
  assert.strictEqual(n.last, 'Constructor');
  assert.strictEqual(n.suffix, '');
});

// "Smith, Jr." holds only a suffix after the comma, so Smith is still the last name.
test('splitName keeps the last name when only a suffix follows the comma', () => {
  const a = DL.splitName('Smith, Jr.');
  assert.strictEqual(a.last, 'Smith');
  assert.strictEqual(a.first, '');
  assert.strictEqual(a.suffix, 'Jr.');
  const b = DL.splitName('Smith, John, Jr.');
  assert.strictEqual(b.last, 'Smith');
  assert.strictEqual(b.first, 'John');
});

// One file, one rule for its numbers. Without this, 1.234,56 read as 1234.56 while 1.000 in the
// same column read as 1, and a sum came out 2.7 times too large.
test('the style of the numbers of a file holds for every value in it', () => {
  const german = ['1.234,56', '1,50', '1.000', '12,345', '3.500,00'];
  const us = ['1,234.56', '1.50', '1000', '12.345', '3500.00'];
  assert.strictEqual(DL.detectNumberStyle(T(['P'], german.map((v) => [v]))), 'comma');
  assert.strictEqual(DL.detectNumberStyle(T(['P'], us.map((v) => [v]))), 'dot');
  // Two conventions in one file mean that neither can be trusted.
  assert.strictEqual(DL.detectNumberStyle(T(['P'], german.concat(us).map((v) => [v]))), '');

  try {
    DL.numberStyle = 'comma';
    assert.deepStrictEqual(german.map(DL.toNumber), [1234.56, 1.5, 1000, 12.345, 3500]);
  } finally { DL.numberStyle = ''; }
  // A file with no sign keeps the answers it always gave.
  assert.deepStrictEqual(us.map(DL.toNumber), [1234.56, 1.5, 1000, 12.345, 3500]);
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

// Sort and Filter must read a column of dates by one rule. Day-first was not an answer they
// had before, so a column was read half day-first and half month-first.
test('sort and filter read dates day-first when asked', () => {
  const d = T(['D'], [['13/01/2024'], ['01/02/2024'], ['05/01/2024'], ['20/03/2024']]);
  const s1 = run('sort', { keys: [{ column: 'D', type: 'date', dir: 'asc' }], dayFirst: true }, d);
  assert.deepStrictEqual(rowsOf(s1.table).map((r) => r[0]),
    ['05/01/2024', '13/01/2024', '01/02/2024', '20/03/2024']);

  const f = run('filter', { action: 'keep', logic: 'all', dayFirst: true,
    conditions: [{ column: 'D', op: 'dateBefore', value: '01/02/2024' }] }, d);
  assert.deepStrictEqual(rowsOf(f.table).map((r) => r[0]), ['13/01/2024', '05/01/2024']);
});

// The key of a run of digits must stay below the letters, or a long number sorts as a word.
test('a long number sorts before letters, as the collator puts it', () => {
  const t = T(['A'], [['a1'], ['12345678901234567'], ['a9']]);
  const r = run('sort', { keys: [{ column: 'A', type: 'text', dir: 'asc' }] }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['12345678901234567', 'a1', 'a9']);
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
  assert.strictEqual(rowsOf(r.table)[0][4], 'First must be unique in the column (case and spaces at the ends do not count)');
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

test('stackTables puts tables one after the other and matches columns by name', () => {
  const mk = (columns, rows) => DL.makeTable(columns, columns.map((_, c) => rows.map((r) => r[c])), rows.length);
  const a = mk(['name', 'city'], [['Ada', 'London'], ['Alan', 'Cambridge']]);
  const b = mk(['name', 'city'], [['Grace', 'New York']]);
  const one = DL.stackTables([a, b], ['a.csv', 'b.csv']);
  assert.deepStrictEqual(one.table.columns, ['name', 'city']);
  assert.strictEqual(one.table.length, 3);
  assert.deepStrictEqual(rowsOf(one.table), [['Ada', 'London'], ['Alan', 'Cambridge'], ['Grace', 'New York']]);
  assert.deepStrictEqual(one.notes, []);

  // A column that only one file has: the other rows are empty, and a note names the file.
  const c = mk(['name', 'age'], [['Kay', '31']]);
  const two = DL.stackTables([a, c], ['a.csv', 'c.csv']);
  assert.deepStrictEqual(two.table.columns, ['name', 'city', 'age']);
  assert.deepStrictEqual(rowsOf(two.table), [['Ada', 'London', ''], ['Alan', 'Cambridge', ''], ['Kay', '', '31']]);
  assert.strictEqual(two.notes.length, 2);
  assert.ok(two.notes[0].indexOf('a.csv') === 1, two.notes[0]);
  assert.ok(two.notes[0].indexOf('age') > 0, two.notes[0]);
  assert.ok(two.notes[1].indexOf('c.csv') === 1, two.notes[1]);

  // A different order of the same names is the same column.
  const d = mk(['city', 'name'], [['Paris', 'Zoe']]);
  assert.deepStrictEqual(rowsOf(DL.stackTables([a, d], ['a', 'd']).table),
    [['Ada', 'London'], ['Alan', 'Cambridge'], ['Zoe', 'Paris']]);

  // One table comes back as it is; no table gives an empty table.
  assert.strictEqual(DL.stackTables([a], ['a']).table, a);
  assert.strictEqual(DL.stackTables([], []).table.length, 0);

  // An empty table adds no rows.
  const empty = mk(['name', 'city'], []);
  assert.strictEqual(DL.stackTables([a, empty], ['a', 'e']).table.length, 2);
});

test('stackTables joins names that differ only in case or spaces', () => {
  const mk = (columns, rows) => DL.makeTable(columns, columns.map((_, c) => rows.map((r) => r[c])), rows.length);
  const a = mk(['Name', 'City'], [['Ada', 'London'], ['Alan', 'Cambridge']]);
  const b = mk(['name', ' CITY '], [['Grace', 'New York']]);
  const r = DL.stackTables([a, b], ['a.csv', 'b.csv']);
  assert.strictEqual(r.table.columns.length, 2, 'one column for each name');
  assert.deepStrictEqual(rowsOf(r.table), [['Ada', 'London'], ['Alan', 'Cambridge'], ['Grace', 'New York']]);
  assert.strictEqual(r.notes.filter((n) => n.indexOf('more than one way') > 0).length, 1, 'one note, not one for each column');

  // The names do not depend on the order of the files. A workflow keeps its column names when the
  // files arrive in another order.
  const back = DL.stackTables([b, a], ['b.csv', 'a.csv']);
  assert.deepStrictEqual(back.table.columns, r.table.columns);
  // The spaces at the ends never reach the name.
  r.table.columns.forEach((n) => assert.strictEqual(n, n.trim()));

  // The spelling that the most files write wins, whatever the order.
  const c1 = mk(['City'], [['x']]);
  const c2 = mk(['City'], [['y']]);
  const c3 = mk(['CITY'], [['z']]);
  assert.deepStrictEqual(DL.stackTables([c3, c1, c2], ['3', '1', '2']).table.columns, ['City']);

  // A letter and its mark join the one character that means the same.
  const nfc = mk(['Caf\u00e9'], [['x']]);
  const nfd = mk(['Cafe\u0301'], [['y']]);
  const joined = DL.stackTables([nfc, nfd], ['nfc.csv', 'nfd.csv']);
  assert.strictEqual(joined.table.columns.length, 1);
  assert.deepStrictEqual(rowsOf(joined.table), [['x'], ['y']]);

  // Two columns of ONE file that differ only in case stay two columns, and they line up with the
  // same pair in another file whatever the order inside that file.
  const dup = mk(['Email', 'email'], [['A', 'B']]);
  const swapped = mk(['email', 'Email'], [['C', 'D']]);
  const d = DL.stackTables([dup, swapped], ['d.csv', 'e.csv']);
  assert.strictEqual(d.table.columns.length, 2);
  assert.strictEqual(d.table.columns[0], d.table.columns[0].trim());
  assert.notStrictEqual(d.table.columns[0], d.table.columns[1], 'two columns never take one name');
  assert.deepStrictEqual(rowsOf(d.table), [['A', 'B'], ['C', 'D']]);
});

test('stackTables can add a column with the name of the file', () => {
  const mk = (columns, rows) => DL.makeTable(columns, columns.map((_, c) => rows.map((r) => r[c])), rows.length);
  const a = mk(['name'], [['Ada'], ['Alan']]);
  const b = mk(['name'], [['Grace']]);
  const r = DL.stackTables([a, b], ['jan.csv', 'feb.csv'], { fileColumn: 'Source file' });
  assert.deepStrictEqual(r.table.columns, ['Source file', 'name']);
  assert.deepStrictEqual(rowsOf(r.table), [['jan.csv', 'Ada'], ['jan.csv', 'Alan'], ['feb.csv', 'Grace']]);

  // One file also gets the column, and the shape agrees with the table that comes out.
  const one = DL.stackTables([a], ['jan.csv'], { fileColumn: 'Source file' });
  assert.deepStrictEqual(one.table.columns, ['Source file', 'name']);
  assert.deepStrictEqual(rowsOf(one.table), [['jan.csv', 'Ada'], ['jan.csv', 'Alan']]);
  assert.deepStrictEqual(DL.stackedShape([a, b], { fileColumn: 'Source file' }).columns, ['Source file', 'name']);

  // A data column of that name keeps its place; the new column takes another name.
  const clash = mk(['Source file', 'v'], [['x', '1']]);
  const c = DL.stackTables([clash, mk(['v'], [['2']])], ['one.csv', 'two.csv'], { fileColumn: 'Source file' });
  assert.deepStrictEqual(c.table.columns, ['Source file 2', 'Source file', 'v']);
  assert.deepStrictEqual(rowsOf(c.table), [['one.csv', 'x', '1'], ['two.csv', '', '2']]);
});

test('TableBuilder skips rows at the bottom', () => {
  const rows = [['a', 'b'], ['1', 'x'], ['2', 'y'], ['3', 'z'], ['total', '-']];
  const build = (opts) => { const b = new DL.TableBuilder(opts); rows.forEach((r) => b.add(r)); return b.finish(); };
  const one = build({ headers: true, skipRowsBottom: 1 });
  assert.deepStrictEqual(one.columns, ['a', 'b']);
  assert.deepStrictEqual(rowsOf(one), [['1', 'x'], ['2', 'y'], ['3', 'z']]);
  assert.strictEqual(build({ headers: true, skipRowsBottom: 0 }).length, 4);
  assert.strictEqual(build({ headers: true }).length, 4);
  // More than the file holds leaves an empty table, not a negative length.
  const over = build({ headers: true, skipRowsBottom: 99 });
  assert.strictEqual(over.length, 0);
  assert.deepStrictEqual(rowsOf(over), []);
  // The two skips work together, and the count is of the rows that are left.
  const both = build({ headers: true, skipRows: 1, skipRowsBottom: 1 });
  assert.deepStrictEqual(both.columns, ['1', 'x']);
  assert.deepStrictEqual(rowsOf(both), [['2', 'y'], ['3', 'z']]);
  // An empty row that the rule drops does not count against the rows at the bottom.
  const blanks = new DL.TableBuilder({ headers: true, skipRowsBottom: 1, skipEmptyLines: true });
  [['a'], ['1'], ['2'], ['', ''], ['3']].forEach((r) => blanks.add(r));
  assert.deepStrictEqual(rowsOf(blanks.finish()), [['1'], ['2']]);
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
  assert.strictEqual(Number(so.skipRows) || 0, 0);
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
test('TableBuilder says which rows are ragged, and a row that the bottom skip takes away does not count', () => {
  const b = new DL.TableBuilder({ headers: true });
  assert.deepStrictEqual([['a', 'b'], ['1', '2'], ['3'], ['4', '5', '6'], ['', '']].map((r) => b.add(r)), [false, false, true, true, false]);
  // A totals row at the bottom with fewer values goes away. The count is of the rows that stay.
  const c = new DL.TableBuilder({ headers: true, skipRowsBottom: 1 });
  [['a', 'b', 'c'], ['1', '2'], ['3', '4', '5'], ['total', '9']].forEach((r) => c.add(r));
  assert.strictEqual(c.ragged, 2);
  c.finish();
  assert.strictEqual(c.ragged, 1);
  c.finish();
  assert.strictEqual(c.ragged, 1, 'a second call takes nothing away again');
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
  assert.strictEqual(DL.ops.length, 27);
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
    split: { column: 'Full Name', separator: ' ', maxParts: 2 },
    extract: { column: 'Email', pattern: '@(.+)$', group: 1, output: 'Domain' },
    dateMath: { column: 'Amount', mode: 'part', part: 'year', output: 'Y' },
    unpivot: { columns: ['Email', 'Amount'], nameColumn: 'Full Name', valueColumn: 'V' }
  };
  Object.keys(cases).forEach((id) => {
    const params = Object.assign(DL.defaultParams(id), cases[id]);
    const predicted = DL.predictColumns(id, params, fixture.columns);
    const actual = DL.runOp(id, params, fixture).table.columns;
    if (predicted !== null) assert.deepStrictEqual(predicted, actual, id + ' prediction');
  });
});

/* ---- new operations ---- */
test('formatDate writes tokens', () => {
  const t = new Date(2024, 0, 3, 9, 5, 7).getTime();
  assert.strictEqual(DL.formatDate(t, 'YYYY-MM-DD HH:mm:ss'), '2024-01-03 09:05:07');
  assert.strictEqual(DL.formatDate(t, 'D MMM YYYY'), '3 Jan 2024');
  assert.strictEqual(DL.formatDate(t, 'DDDD, MMMM D, YY [at] H a'), 'Wednesday, January 3, 24 at 9 am');
  assert.strictEqual(DL.formatDate(new Date(50, 1, 28).setFullYear(50), 'YYYY-MM-DD'), '0050-02-28');
});

test('dateFormat reads many formats and writes one', () => {
  const t = T(['D'], [['2024-01-31'], ['31/01/2024'], ['Jan 31, 2024'], ['not a date'], ['']]);
  const r = run('dateFormat', { columns: ['D'], dayFirst: true, format: 'DD.MM.YYYY' }, t);
  assert.deepStrictEqual(rowsOf(r.table), [['31.01.2024'], ['31.01.2024'], ['31.01.2024'], ['not a date'], ['']]);
  assert.ok(r.notes[0].indexOf('1 value') === 0);
  const b = run('dateFormat', { columns: ['D'], format: 'custom', pattern: 'YYYYMMDD', onError: 'blank' }, t);
  assert.strictEqual(rowsOf(b.table)[3][0], '');
});

test('dateMath adds, differs and takes parts', () => {
  const t = T(['A', 'B'], [['2024-01-31', '2024-03-01'], ['2023-12-31', '2024-01-01'], ['x', '2024-01-01']]);
  const add = run('dateMath', { column: 'A', mode: 'add', amount: 1, unit: 'months', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(add.table).map((r) => r[2]), ['2024-02-29', '2024-01-31', '']);
  const diff = run('dateMath', { column: 'A', mode: 'diff', otherKind: 'column', other: 'B', unit: 'days', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(diff.table).map((r) => r[2]), ['30', '1', '']);
  assert.ok(diff.notes[0].indexOf('1 value') === 0);
  const half = run('dateMath', { column: 'A', mode: 'diff', otherKind: 'column', other: 'B', unit: 'days', output: 'R' }, T(['A', 'B'], [['x', '']]));
  assert.ok(half.notes[0].indexOf('1 value') === 0);
  const months = run('dateMath', { column: 'A', mode: 'diff', otherKind: 'fixed', fixedDate: '2025-01-30', unit: 'months', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(months.table).map((r) => r[2]), ['11', '12', '']);
  const part = run('dateMath', { column: 'A', mode: 'part', part: 'week', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(part.table).map((r) => r[2]), ['5', '52', '']);
  const wd = run('dateMath', { column: 'A', mode: 'part', part: 'weekday', output: 'R' }, t);
  assert.strictEqual(rowsOf(wd.table)[0][2], 'Wednesday');
  assert.ok(DL.validateParams('dateMath', Object.assign(DL.defaultParams('dateMath'), { column: 'A', mode: 'diff', otherKind: 'fixed', fixedDate: 'nope' }), ['A']).length);
});

test('extract takes groups and all matches', () => {
  const t = T(['E'], [['a@x.com'], ['none'], ['1 and 22 and 333']]);
  const r = run('extract', { column: 'E', pattern: '@(.+)$', group: 1, output: 'Dom' }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((r) => r[1]), ['x.com', '', '']);
  const all = run('extract', { column: 'E', pattern: '\\d+', all: true, joiner: '|', noMatch: 'keep', output: 'N' }, t);
  assert.deepStrictEqual(rowsOf(all.table).map((r) => r[1]), ['a@x.com', 'none', '1|22|333']);
  const empty = run('extract', { column: 'E', pattern: 'x*', all: true, joiner: '', output: 'N' }, T(['E'], [['\u{1F600}x']]));
  assert.strictEqual(rowsOf(empty.table)[0][1], 'x');
  const bad = DL.validateParams('extract', Object.assign(DL.defaultParams('extract'), { column: 'E', pattern: 'x', group: 1 }), ['E']);
  assert.ok(bad.length, 'group beyond count');
  assert.ok(DL.validateParams('extract', Object.assign(DL.defaultParams('extract'), { column: 'E', pattern: '(' }), ['E']).length, 'bad regex');
});

test('fill fills empty cells in several ways', () => {
  const t = T(['A', 'N'], [['x', '1'], ['', '3'], [' ', ''], ['y', '2'], ['', 'x']]);
  const down = run('fill', { columns: ['A'], mode: 'above' }, t);
  assert.deepStrictEqual(rowsOf(down.table).map((r) => r[0]), ['x', 'x', 'x', 'y', 'y']);
  const up = run('fill', { columns: ['A'], mode: 'below' }, t);
  assert.deepStrictEqual(rowsOf(up.table).map((r) => r[0]), ['x', 'y', 'y', 'y', '']);
  const fixed = run('fill', { columns: ['A'], mode: 'value', value: '-', blankIsEmpty: false }, t);
  assert.deepStrictEqual(rowsOf(fixed.table).map((r) => r[0]), ['x', '-', ' ', 'y', '-']);
  const avg = run('fill', { columns: ['N'], mode: 'average', decimals: 1 }, t);
  assert.deepStrictEqual(rowsOf(avg.table).map((r) => r[1]), ['1', '3', '2.0', '2', 'x']);
  const common = run('fill', { columns: ['A'], mode: 'common' }, T(['A'], [['b'], [''], ['a'], ['b'], ['']]));
  assert.deepStrictEqual(rowsOf(common.table).map((r) => r[0]), ['b', 'b', 'a', 'b', 'b']);
});

test('textClean removes html, accents, control characters and odd spaces', () => {
  const t = T(['A'], [['<b>Caf\u00e9</b>&amp;\u00a0 bar\u0007'], ['\u201cHi\u201d \u2014 ok'], ['e\u0301']]);
  const r = run('textClean', { steps: ['html', 'control', 'spaces', 'quotes', 'accents', 'unicode'] }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((r) => r[0]), ['Cafe& bar', '"Hi" - ok', 'e']);
  const nfc = run('textClean', { steps: ['unicode'] }, t);
  assert.strictEqual(rowsOf(nfc.table)[2][0], '\u00e9');
  assert.ok(r.notes[0].indexOf('3 cells') > 0);
  const keep = run('textClean', { steps: ['html', 'control'] }, T(['A'], [['a < b and c > d'], ['\ud83d\udc68\u200d\ud83d\udc69']]));
  assert.deepStrictEqual(rowsOf(keep.table).map((r) => r[0]), ['a < b and c > d', '\ud83d\udc68\u200d\ud83d\udc69']);
});

test('pivot groups, spreads a key column and aggregates', () => {
  const t = T(['Region', 'Q', 'Sales'], [['N', 'Q1', '10'], ['N', 'Q2', '5.5'], ['S', 'Q1', 'x'], ['N', 'Q1', '2'], ['S', '', '4']]);
  const sum = run('pivot', { rows: ['Region'], columnKey: 'Q', value: 'Sales', aggregate: 'sum', decimals: 1 }, t);
  assert.deepStrictEqual(sum.table.columns, ['Region', 'Q1', 'Q2', '(empty)']);
  assert.deepStrictEqual(rowsOf(sum.table), [['N', '12.0', '5.5', ''], ['S', '', '', '4.0']]);
  const count = run('pivot', { rows: ['Region'], columnKey: '', value: '', aggregate: 'count' }, t);
  assert.deepStrictEqual(count.table.columns, ['Region', 'Count']);
  assert.deepStrictEqual(rowsOf(count.table), [['N', '3'], ['S', '2']]);
  const list = run('pivot', { rows: ['Region', 'Q'], columnKey: '', value: 'Sales', aggregate: 'list' }, t);
  assert.deepStrictEqual(rowsOf(list.table), [['N', 'Q1', '10, 2'], ['N', 'Q2', '5.5'], ['S', 'Q1', 'x'], ['S', '', '4']]);
  const avg = run('pivot', { rows: [], columnKey: 'Q', value: 'Sales', aggregate: 'avg', decimals: 0 }, t);
  assert.deepStrictEqual(rowsOf(avg.table), [['6', '6', '4']]);
  assert.ok(sum.notes[1].indexOf('1 value') === 0, 'ignored values note');
  assert.strictEqual(avg.notes.length, 2);
  assert.ok(DL.validateParams('pivot', Object.assign(DL.defaultParams('pivot'), { rows: ['Region'], columnKey: 'Region' }), ['Region']).length);
  assert.strictEqual(DL.predictColumns('pivot', DL.defaultParams('pivot'), ['Region']), null);
});

test('unpivot turns columns into rows', () => {
  const t = T(['Id', 'Jan', 'Feb'], [['a', '1', ''], ['b', '', '']]);
  const r = run('unpivot', { columns: ['Jan', 'Feb'], nameColumn: 'Month', valueColumn: 'Amount' }, t);
  assert.deepStrictEqual(r.table.columns, ['Id', 'Month', 'Amount']);
  assert.deepStrictEqual(rowsOf(r.table), [['a', 'Jan', '1']]);
  const all = run('unpivot', { columns: ['Jan', 'Feb'], nameColumn: 'Id', valueColumn: 'Id', skipEmpty: false }, t);
  assert.deepStrictEqual(all.table.columns, ['Id', 'Id 2', 'Id 3']);
  assert.strictEqual(rowsOf(all.table).length, 4);
  assert.deepStrictEqual(rowsOf(all.table)[3], ['b', 'Feb', '']);
});

test('verify findRows gives the failing rows of one rule', () => {
  const p = Object.assign(DL.defaultParams('verify'), { rules: [{ column: 'Email', op: 'isEmail' }, { column: 'First', op: 'notEmpty' }], action: 'flag' });
  const r = DL.findRows('verify', p, people, { rule: 0 }, 10);
  assert.deepStrictEqual(r.matches, [[1, 3], [2, 3]]);
  assert.strictEqual(r.total, 2);
  const failed = DL.findRows('verify', Object.assign({}, p, { action: 'failed' }), people, { rule: 1 }, 10);
  assert.deepStrictEqual(failed.matches, [[1, 0]], 'row index in the output with only failed rows');
  assert.ok(DL.findRows('verify', Object.assign({}, p, { action: 'passed' }), people, { rule: 0 }, 10).removed);
  const notes = run('verify', p, people).notes;
  assert.strictEqual(DL.noteText(notes[1]).indexOf('2 rows failed'), 0);
  assert.deepStrictEqual(notes[1].rows, { rule: 0 });
  assert.deepStrictEqual(DL.findRows('case', {}, people, {}, 10), { matches: [], total: 0 });
});

test('date math handles years 0 to 99, the year range, and YYYYMMDD', () => {
  const t = T(['A'], [['0001-01-01'], ['9999-12-31'], ['20240131']]);
  const doy = run('dateMath', { column: 'A', mode: 'part', part: 'dayOfYear', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(doy.table).map((r) => r[1]), ['1', '365', '31']);
  const wk = run('dateMath', { column: 'A', mode: 'part', part: 'week', output: 'R' }, t);
  assert.strictEqual(rowsOf(wk.table)[0][1], '1');
  const add = run('dateMath', { column: 'A', mode: 'add', amount: 1, unit: 'days', output: 'R' }, t);
  assert.deepStrictEqual(rowsOf(add.table).map((r) => r[1]), ['0001-01-02', '', '2024-02-01']);
  assert.ok(add.notes[0].indexOf('1 value') === 0, 'out of range counted');
  assert.strictEqual(DL.formatDate(DL.localDate(50, 1, 28).getTime(), 'YYYY-MM-DD [at] H'), '0050-02-28 at 0');
});

test('pivot keeps the total column for an empty input and names blank keys first', () => {
  const empty = run('pivot', { rows: ['R'], columnKey: '', value: 'V', aggregate: 'sum' }, T(['R', 'V'], []));
  assert.deepStrictEqual(empty.table.columns, ['R', 'sum of V']);
  const t = T(['R', 'K', 'V'], [['a', '(empty)', '1'], ['a', '', '2'], ['a', '  ', '3']]);
  const r = run('pivot', { rows: ['R'], columnKey: 'K', value: 'V', aggregate: 'sum', decimals: 0 }, t);
  assert.deepStrictEqual(r.table.columns, ['R', '(empty) 2', '(empty)', '(blank)']);
  assert.deepStrictEqual(rowsOf(r.table), [['a', '1', '2', '3']]);
});

test('clean text keeps other scripts, decodes entities safely and collapses line breaks', () => {
  const t = T(['A'], [['\u0439\u0451 \ud55c\uae00 \u00e9'], ['&#12abc; &#0; a<?xml x?>b'], ['a\nb\t\tc']]);
  const acc = run('textClean', { steps: ['accents'] }, t);
  assert.strictEqual(rowsOf(acc.table)[0][0], '\u0439\u0451 \ud55c\uae00 e');
  const html = run('textClean', { steps: ['html'] }, t);
  assert.strictEqual(rowsOf(html.table)[1][0], '&#12abc; &#0; ab');
  const prose = run('textClean', { steps: ['html'] }, T(['A'], [['a<b and c>d <b>bold</b> <a href="x">y</a> <!-- c --> <br/>z']]));
  assert.strictEqual(rowsOf(prose.table)[0][0], 'a<b and c>d bold y   z');
  const sp = run('textClean', { steps: ['spaces'] }, t);
  assert.strictEqual(rowsOf(sp.table)[2][0], 'a b c');
  const ex = run('extract', { column: 'A', pattern: '\\d*', all: true, joiner: '|', output: 'N' }, T(['A'], [['a1b22']]));
  assert.strictEqual(rowsOf(ex.table)[0][1], '1|22');
});

test('fill counts every changed cell and unescapes the fixed value', () => {
  const t = T(['A'], [['  '], ['x'], ['']]);
  const r = run('fill', { columns: ['A'], mode: 'value', value: '\\t' }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['\t', 'x', '\t']);
  assert.ok(r.notes[0].indexOf('2 cells') > 0);
});

/* ---- whole-codebase review: engine ---- */
test('toNumber rejects malformed groups, infinities and double negatives', () => {
  assert.ok(isNaN(DL.toNumber('1e400')));
  assert.ok(isNaN(DL.toNumber('1,234,56')));
  assert.strictEqual(DL.toNumber('1.234.567'), 1234567);
  assert.strictEqual(DL.toNumber('1,234,567.89'), 1234567.89);
  assert.ok(isNaN(DL.toNumber('12,34.5')));
  assert.ok(isNaN(DL.toNumber('(-5)')));
  assert.strictEqual(DL.toNumber('(5)'), -5);
});

test('number formatting stays sane for huge, tiny and bad values', () => {
  assert.strictEqual(DL.formatFixed(Infinity, 2), '');
  assert.strictEqual(DL.formatFixed(NaN, 2), '');
  assert.strictEqual(DL.formatFixed(1e21, 2), '1e+21');
  assert.strictEqual(DL.formatFixed(1e15, 0), '1000000000000000');
  assert.strictEqual(DL.formatFixed(2.5, 99), '2.500000000000000');
  assert.strictEqual(DL.formatNumber(1e21, 0, ','), '1e+21');
  assert.strictEqual(DL.formatNumber(1234567.891, 2, ',', '.'), '1,234,567.89');
});

test('toDate refuses versions, identifiers, year-less month text and 13 PM', () => {
  assert.ok(isNaN(DL.toDate('1.5.3')));
  assert.ok(isNaN(DL.toDate('3-4-5')));
  assert.ok(isNaN(DL.toDate('10000101')));
  assert.ok(!isNaN(DL.toDate('20240131')));
  assert.ok(isNaN(DL.toDate('5 March')));
  assert.ok(isNaN(DL.toDate('Decade 5, 2024')));
  assert.ok(isNaN(DL.toDate('Room 12 march')));
  assert.ok(!isNaN(DL.toDate('March 5, 2024')));
  assert.ok(!isNaN(DL.toDate('5 Mar 2024')));
  assert.ok(isNaN(DL.toDate('05/01/2024 13:04 PM')));
  assert.ok(!isNaN(DL.toDate('31.01.2024')));
  assert.ok(!isNaN(DL.toDate('1/2/24')));
  assert.strictEqual(DL.formatDateISO(DL.localDate(50, 0, 1).getTime()), '0050-01-01');
  assert.ok(!isNaN(DL.toDate('0050-01-01')));
});

test('title and sentence case handle contractions and quotes', () => {
  assert.strictEqual(DL.titleCase("don't stop o'neil d'angelo hello_world"), "Don't Stop O'Neil D'Angelo Hello_World");
  assert.strictEqual(DL.sentenceCase('"hello there." said he. (yes) ok'), '"Hello there." Said he. (Yes) ok');
});

test('detectType is not fooled by a periodic column', () => {
  const col = [];
  for (let i = 0; i < 1000; i++) col.push(i % 2 ? '2024-01-01' : '1');
  assert.strictEqual(DL.detectType(col), 'text');
});

test('validateParams cleans raw params and keeps unknown columns unknown', () => {
  assert.deepStrictEqual(DL.validateParams('case', { columns: 'A' }, ['A']).length > 0, true);
  assert.deepStrictEqual(DL.validateParams('remove', { columns: ['A', 'Z'] }, null), []);
  assert.deepStrictEqual(DL.validateParams('remove', { columns: ['A', 'Z'] }, ['A', 'B']).length, 1);
  assert.ok(DL.validateParams('padTrim', { columns: ['A'], pad: 'left', length: '0x10' }, ['A']).length);
  assert.strictEqual(DL.cleanParams('calculate', { rightNumber: '1,5' }).rightNumber, '1,5');
  assert.ok(DL.validateParams('calculate', { left: 'A', rightKind: 'number', rightNumber: '1,5', output: 'X' }, ['A']).some((m) => m.indexOf('number') >= 0));
  assert.deepStrictEqual(DL.cleanParams('splitName', { parts: ['first', 'first', 'last'] }).parts, ['first', 'last']);
  assert.strictEqual(DL.cleanParams('sort', { keys: [{ column: 'A', value2: 'x' }] }).keys[0].value2, undefined);
});

test('TableBuilder counts back-filled cells', () => {
  const b = new DL.TableBuilder({ headers: false, skipRows: 1.5 });
  b.add(['skip']); b.add(['1']); b.add(['2', '3']);
  assert.strictEqual(b.cells, 4);
  assert.strictEqual(b.finish().length, 2);
});

/* ---- whole-codebase review: operations ---- */
test('splitName keeps a multi-word last name before the comma and reads a title with one name', () => {
  assert.deepStrictEqual(DL.splitName('van der Berg, Jan'), { prefix: '', first: 'Jan', middle: '', last: 'van der Berg', suffix: '' });
  assert.deepStrictEqual(DL.splitName('de la Cruz, Maria Elena, Jr.'), { prefix: '', first: 'Maria', middle: 'Elena', last: 'de la Cruz', suffix: 'Jr.' });
  assert.deepStrictEqual(DL.splitName('Dr. Smith').last, 'Smith');
});

test('split with an anchored regex, replace escapes and counts, pad with an emoji', () => {
  const t = T(['A'], [['aaa']]);
  const r = run('split', { column: 'A', separator: '^a', regex: true }, t);
  assert.deepStrictEqual(rowsOf(r.table)[0], ['aaa', '', 'aa']);
  const rep = run('replace', { columns: ['A'], find: ' ', replace: '\\n', regex: true }, T(['A'], [['a b']]));
  assert.strictEqual(rowsOf(rep.table)[0][0], 'a\nb');
  const same = run('replace', { columns: ['A'], find: 'x', replace: 'x' }, T(['A'], [['x']]));
  assert.ok(same.notes[0].indexOf('0 cells') > 0);
  const pad = run('padTrim', { columns: ['A'], pad: 'left', length: 4, char: '\u{1F600}' }, T(['A'], [['ab']]));
  assert.strictEqual(Array.from(rowsOf(pad.table)[0][0]).length, 4);
  const sub = run('substitute', { columns: ['A'], mapping: [{ from: 'x', to: 'a\\tb' }] }, T(['A'], [['x']]));
  assert.strictEqual(rowsOf(sub.table)[0][0], 'a\tb');
});

test('whole word replace matches punctuation finds', () => {
  const r = run('replace', { columns: ['A'], find: '-', replace: '_', wholeWord: true }, T(['A'], [['a-b']]));
  assert.strictEqual(rowsOf(r.table)[0][0], 'a_b');
  const w = run('replace', { columns: ['A'], find: 'cat', replace: 'dog', wholeWord: true }, T(['A'], [['cat concat']]));
  assert.strictEqual(rowsOf(w.table)[0][0], 'dog concat');
});

test('outliers ignore infinities and pass an empty input through', () => {
  const r = run('outliers', { column: 'V', action: 'flag' }, T(['V'], [['1'], ['2'], ['3'], ['1e400'], ['1000']]));
  assert.ok(r.notes.join(' ').indexOf('NaN') < 0);
  const empty = run('outliers', { column: 'V', action: 'flag' }, T(['V'], []));
  assert.strictEqual(empty.status, 'ok');
  assert.strictEqual(empty.table.length, 0);
});

test('verify length rules count characters; remove validation counts present columns', () => {
  const p = Object.assign(DL.defaultParams('verify'), { rules: [{ column: 'A', op: 'maxLength', value: '2', allowEmpty: false }], action: 'flag' });
  const r = DL.runOp('verify', p, T(['A'], [['\u{1F600}\u{1F600}']]));
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(DL.validateParams('remove', { columns: ['A', 'Z', 'Q'] }, ['A', 'B', 'C']).filter((m) => m.indexOf('every') >= 0), []);
});

test('date math months is symmetric and counts month ends', () => {
  const t = T(['A', 'B'], [['2024-01-31', '2024-02-29'], ['2024-02-29', '2024-01-31'], ['2024-03-31', '2024-04-30']]);
  const r = run('dateMath', { column: 'A', mode: 'diff', otherKind: 'column', other: 'B', unit: 'months', output: 'M' }, t);
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[2]), ['1', '-1', '1']);
});

test('filter summary shows both bounds of between', () => {
  const p = Object.assign(DL.defaultParams('filter'), { conditions: [{ column: 'V', op: 'between', value: '1', value2: '5' }] });
  assert.ok(DL.getOp('filter').summary(p).indexOf('"5"') > 0);
});

test('sort keys give the collator order for plain Latin text', () => {
  if (!DL.sortKey('a')) return; // another locale: the collator is used
  const words = ['a', 'A', 'a 1', 'a1', 'a01', 'a10', 'a2', '1', '01', '10', '9', 'ab', 'a b', 'B', 'b', 'abc 100', 'abc 99', 'x0001', 'x1', 'x10', 'z', 'Z0', 'z00', '0a', '00a', 'a0', 'a00'];
  for (const x of words) for (const y of words) {
    const k = DL.sortKey(x) < DL.sortKey(y) ? -1 : DL.sortKey(x) > DL.sortKey(y) ? 1 : 0;
    const c = Math.sign(DL.compareText(x, y));
    assert.strictEqual(k, c, x + ' vs ' + y);
  }
  assert.strictEqual(DL.sortKey('a@b'), null);
  const r = run('sort', { keys: [{ column: 'A', type: 'text', dir: 'asc' }] }, T(['A'], [['b2'], ['B10'], ['a'], [''], ['b1']]));
  assert.deepStrictEqual(rowsOf(r.table).map((x) => x[0]), ['a', 'b1', 'b2', 'B10', '']);
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
