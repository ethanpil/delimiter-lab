/* Micro benchmark for operations on a large table. Run: node test/bench.js [rows] */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = { self: null, console };
ctx.self = ctx;
vm.createContext(ctx);
['js/engine/core.js', 'js/ops/text.js', 'js/ops/rows.js', 'js/ops/columns.js', 'js/ops/verify.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
});
const DL = ctx.DL;
const N = parseInt(process.argv[2], 10) || 1200000;
const first = ['john', 'JANE', 'maría', 'Li', 'Amara', 'Sam', 'Zoë', 'Ludwig'];
const rows = new Array(N);
for (let i = 0; i < N; i++) {
  rows[i] = [String(i + 1), first[i % 8], 'smith', 'x' + i + '@example.com', 'New York', (i % 977 * 1.37 - 200).toFixed(2), '2024-01-15', i % 3 ? 'active' : 'inactive', String(i % 100), ''];
}
const table = DL.fromRows(['id', 'first', 'last', 'email', 'city', 'amount', 'date', 'status', 'score', 'notes'], rows);
const run = (op, params) => {
  const t0 = Date.now();
  const r = DL.runOp(op, Object.assign(DL.defaultParams(op), params), table);
  console.log(op.padEnd(12), String(Date.now() - t0).padStart(6) + ' ms', r.table.length + ' rows');
};
run('case', { columns: ['first', 'last'], mode: 'title' });
run('case', { columns: ['first', 'last'], mode: 'upper' });
run('concat', { columns: ['first', 'last'], separator: ' ', output: 'name' });
run('replace', { columns: ['status'], find: 'active', replace: 'ACTIVE', wholeCell: true });
run('replace', { columns: ['status'], find: 'act', replace: 'ACT' });
run('numFormat', { columns: ['amount'], decimals: 2, thousands: ',', decimalSep: '.' });
run('filter', { conditions: [{ column: 'amount', op: 'gt', value: '0' }] });
run('sort', { keys: [{ column: 'amount', type: 'number', dir: 'desc' }] });
run('dedupe', { columns: ['email'] });
run('dedupe', { columns: ['first', 'last'] });
run('verify', { rules: [{ column: 'email', op: 'isEmail' }], action: 'flag' });
run('padTrim', { columns: ['city'], trim: 'both' });
run('calculate', { left: 'amount', operator: '*', rightKind: 'number', rightNumber: 2, output: 'x' });
run('splitName', { column: 'first', parts: ['first', 'last'] });
run('unique', { columns: ['city'] });
run('outliers', { column: 'score', action: 'flag' });
