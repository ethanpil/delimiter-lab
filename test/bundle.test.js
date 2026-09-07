/* Tests of the browser build. Run: node test/bundle.test.js
 *
 * The page loads js/manifest.js and then dist/engine.global.js, and after that it reads and writes
 * one name: self.DL. These tests load the same two files in the same order and check the promises
 * that the page depends on.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
global.self = global;

vm.runInThisContext(fs.readFileSync(path.join(root, 'js/manifest.js'), 'utf8'), { filename: 'manifest.js' });
const manifestKeys = Object.keys(global.DL).slice();
const manifestVersion = global.DL.VERSION;
const bundlePath = path.join(root, 'dist/engine.global.js');
assert.ok(fs.existsSync(bundlePath), 'dist/engine.global.js is missing. Run: npm run build');
const bundleText = fs.readFileSync(bundlePath, 'utf8');
vm.runInThisContext(bundleText, { filename: 'engine.global.js' });
const DL = global.DL;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack : e)); }
}

test('the build keeps what the manifest put on the name', () => {
  manifestKeys.forEach((k) => assert.ok(k in DL, 'the build dropped DL.' + k));
  assert.strictEqual(typeof DL.VERSION, 'string');
  assert.ok(Array.isArray(DL.FILES.engine));
});

test('the version of the build is the version of the manifest', () => {
  // The build reads the number out of js/manifest.js. When the two differ, the page holds an engine
  // from another version and can give old answers with no sign of it. Run: npm run build
  assert.strictEqual(DL.VERSION, manifestVersion);
});

test('the build brings every operation', () => {
  assert.strictEqual(DL.ops.length, 27);
  assert.strictEqual(DL.getOp('unpivot').id, 'unpivot');
});

test('the build runs under the strict rules, as the module build does', () => {
  // Every file of the engine was strict before it became a package. An IIFE is not strict by
  // itself, so the build says so at the top. Without it the two builds would not agree.
  assert.ok(/^"use strict";/.test(bundleText), 'the build must start with the strict directive');
});

test('an operation reads the memory limit that the page writes', () => {
  // js/main.js asks the worker for a limit that fits the machine, and js/engine/worker.js writes
  // it as DL.maxCells. The operations read DL.maxCells. The page and the engine must therefore
  // hold ONE object. When the build copies the keys onto another object, the operations keep the
  // value that the engine started with, and every guard answers to a limit nobody asked for.
  const table = DL.fromRows(['id', 'a', 'b'], Array.from({ length: 40 }, (_, i) => [String(i), '1', '2']));
  const params = { keep: ['id'], columns: ['a', 'b'], nameColumn: 'k', valueColumn: 'v' };
  const run = (limit) => {
    DL.maxCells = limit;
    try { DL.runOp('unpivot', params, table); return 'ran'; }
    catch (e) { return e.message; }
  };
  // 40 rows and two columns give 80 rows of three cells, which is above a limit of 100.
  assert.match(run(100), /too many/, 'the operation must answer to the limit that the page set');
  assert.strictEqual(run(8e6), 'ran');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
