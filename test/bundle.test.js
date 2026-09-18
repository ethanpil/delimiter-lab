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
const url = require('url');
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

// Loads an application file and the files it needs, in the order of the manifest. A file that the
// manifest does not name fails here, because the page would not load it either.
const appFiles = DL.FILES.app.concat(DL.LOCALES.map((l) => 'js/i18n/' + l + '.js'));
const loaded = new Set();
function loadApp(file) {
  assert.ok(appFiles.indexOf(file) >= 0, file + ' is not in DL.FILES.app of js/manifest.js');
  DL.FILES.app.slice(0, DL.FILES.app.indexOf(file) + 1).forEach((f) => {
    if (loaded.has(f)) return;
    loaded.add(f);
    vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
  });
}

// The tests put a storage of their own in place of the one of this process. withStorage gives it
// back afterwards, so no test starts with the storage of the test before it.
function withStorage(fake, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
  try { fn(); }
  finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
}

// A browser storage with the parts that the application reads: length, key() and the three item
// calls. quota is the most characters that the keys and the values can hold together, as in a
// browser.
function fakeStorage(init, quota) {
  const m = new Map(Object.entries(init));
  const size = () => Array.from(m).reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() { return m.size; },
    key: (i) => (i < m.size ? Array.from(m.keys())[i] : null),
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const old = m.get(k);
      m.set(k, String(v));
      if (quota !== undefined && size() > quota) { if (old === undefined) m.delete(k); else m.set(k, old); throw new Error('QuotaExceededError'); }
    },
    removeItem: (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m)
  };
}

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

test('index.html asks for every file with the stamp of its deploy', () => {
  // GitHub Pages lets a browser keep a file for ten minutes. With one fixed ?v= for every deploy, a
  // new index.html ran beside an older copy of js/i18n/en.js, and a button showed the name of a
  // text in place of the text. css/app.css and js/manifest.js come before DL.BUILD exists, so
  // index.html writes their tags with DL.STAMP itself; every other file carries DL.BUILD.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ['css/app.css', 'js/manifest.js'].forEach((f) => {
    assert.ok(html.indexOf(f + "?v=' + (DL.STAMP") >= 0, f + ' must be asked for with the stamp of the deploy');
  });
  assert.ok(!/\?v=\d/.test(html), 'no file of index.html may carry a fixed version');
  assert.ok(/document\.lastModified/.test(html), 'the stamp comes from the time of the deploy');
  // The pattern that finds the files of index.html finds these two in the script as well.
  const named = [...html.matchAll(/(?:src|href)="([^"#?:]+)(?:\?[^"]*)?"/g)].map((m) => m[1]);
  assert.ok(named.indexOf('css/app.css') >= 0 && named.indexOf('js/manifest.js') >= 0);
  // The manifest puts the stamp into DL.BUILD, the number that every other file carries.
  const ctx = { self: { DL: { STAMP: '1789750982000' } }, location: { hostname: 'ethanpil.github.io' } };
  ctx.self.location = ctx.location;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/manifest.js'), 'utf8'), ctx);
  assert.strictEqual(ctx.self.DL.BUILD, manifestVersion + '.1789750982000');
  // With no stamp, as in the desktop application and the worker, the number is the version.
  const app = { self: { location: { hostname: 'delimiter-lab' } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/manifest.js'), 'utf8'), app);
  assert.strictEqual(app.self.DL.BUILD, manifestVersion);
});

test('every file that the page loads is on disk, with the same letters', () => {
  // GitHub Pages serves the files of the repository as they are. A file that the page names can
  // be absent, or can have other letters in its name. Such a file gives a page that loads nothing
  // after it, and no other test reads the app, ui, main and locale files. Windows and macOS find a
  // file whose case differs; the server of GitHub Pages does not, so this test compares the names
  // as text. The manifest names most files. index.html and the worker name the others themselves.
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'js/engine/worker.js'), 'utf8');
  const needed = ['js/engine/worker.js']
    .concat(...Object.values(DL.FILES))
    .concat(DL.LOCALES.map((l) => 'js/i18n/' + l + '.js'))
    .concat([...html.matchAll(/(?:src|href)="([^"#?:]+)(?:\?[^"]*)?"/g)].map((m) => m[1]))
    .concat([...worker.matchAll(/'\.\.\/\.\.\/([^'?]+)'/g)].map((m) => m[1]));
  const onDisk = new Set();
  new Set(needed.map((f) => f.split('/')[0])).forEach((dir) => {
    fs.readdirSync(path.join(root, dir), { recursive: true }).forEach((f) => onDisk.add(dir + '/' + f.split(path.sep).join('/')));
  });
  needed.forEach((f) => assert.ok(onDisk.has(f), f + ' is named by the page but not on disk with these letters'));
});

test('the width where a field with fill moves beside the field before it agrees with the grid', () => {
  // css/app.css puts a field with fill in the second column when the grid has two columns. The
  // query cannot read the grid, so it holds a number made from the track and the gap of the grid.
  const css = fs.readFileSync(path.join(root, 'css/app.css'), 'utf8');
  const track = Number(/grid-template-columns: repeat\(auto-fill, minmax\((\d+)px, 1fr\)\)/.exec(css)[1]);
  const gap = Number(/\.field-grid \{[^}]*gap: \d+px (\d+)px/.exec(css)[1]);
  const query = Number(/@container \(min-width: (\d+)px\)/.exec(css)[1]);
  assert.strictEqual(query, 2 * track + gap, 'two tracks and one gap');
});

test('the build brings every operation', () => {
  assert.strictEqual(DL.ops.length, 28);
  assert.strictEqual(DL.getOp('unpivot').id, 'unpivot');
});

test('the build runs under the strict rules, as the module build does', () => {
  // Every file of the engine was strict before it became a package. An IIFE is not strict by
  // itself, so the build says so at the top. Without it the two builds do not agree.
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

test('saved workflows of 1.0 stay readable, and a link finds them with no write', () => {
  // The page keeps the saved workflows in localStorage under dl.workflows.v1. A record of 1.0 has
  // no link name, and the link name is never stored, so these records must work as they are.
  const records = [
    { id: 's1', name: 'Clean Contacts (2024)', steps: [{ id: 'a', opId: 'case', params: { columns: ['Email'], mode: 'lower' }, enabled: true }], columns: ['Email'], sourceOptions: null, createdAt: 1, updatedAt: 5, lastUsedAt: 0 },
    { id: 's2', name: 'Café / Report', steps: [{ id: 'b', opId: 'javascript', params: { code: 'return row.a;', output: 'J', mode: 'add' }, enabled: false }], columns: [], sourceOptions: { delimiter: ';' }, createdAt: 2, updatedAt: 2 },
    { id: 's3', name: 'clean contacts 2024', steps: [], columns: [], sourceOptions: null, createdAt: 3, updatedAt: 3, lastUsedAt: 9 },
    { id: 's4', name: 'Cafe', steps: [], columns: [], sourceOptions: null, createdAt: 4, updatedAt: 20, lastUsedAt: 0 },
    { id: 's5', name: 'Café', steps: [], columns: [], sourceOptions: null, createdAt: 5, updatedAt: 30, lastUsedAt: 10 },
    { id: 'later', name: 'From a later build', steps: [{ opId: 42 }] } // this build cannot read it, so it stays untouched
  ];
  const text = JSON.stringify(records);
  const ls = fakeStorage({ 'dl.workflows.v1': text });
  withStorage(ls, () => {
  loadApp('js/app/workflows.js');
  const W = DL.workflows;
  assert.deepStrictEqual(W.list().map((w) => w.id), ['s1', 's2', 's3', 's4', 's5']);
  // Two names give one link name: the workflow used or saved last wins.
  assert.strictEqual(W.findBySlug('clean-contacts-2024').id, 's3');
  assert.strictEqual(W.findBySlug('cafe').id, 's5', 'a save after the last use counts');
  assert.strictEqual(W.findBySlug('Clean Contacts (2024)').id, 's3', 'the plain name finds it too');
  assert.strictEqual(W.findBySlug('cafe-report').id, 's2');
  assert.strictEqual(W.findBySlug('no-such-name'), null);
  assert.strictEqual(W.findBySlug(''), null);
  assert.strictEqual(W.findBySlug('***'), null);
  assert.strictEqual(ls.getItem('dl.workflows.v1'), text, 'to read and to find writes nothing');
  });
});

test('a copy of a saved workflow is a new record, and the first record does not change', () => {
  const first = { id: 'c1', name: 'Clean', steps: [{ id: 'a', opId: 'case', params: { columns: ['Email'], mode: 'lower' }, enabled: false }], columns: ['Email'], sourceOptions: { delimiter: ';' }, createdAt: 1, updatedAt: 2, lastUsedAt: 3 };
  const later = { id: 'later', name: 'From a later build', steps: [{ opId: 42 }] };
  const ls = fakeStorage({ 'dl.workflows.v1': JSON.stringify([first, later]) });
  withStorage(ls, () => {
  loadApp('js/app/workflows.js');
  const W = DL.workflows;
  const copy = W.copy('c1', 'Clean for Europe');
  assert.ok(copy && copy.id !== 'c1');
  assert.strictEqual(copy.name, 'Clean for Europe');
  assert.deepStrictEqual(copy.steps, first.steps);
  assert.deepStrictEqual(copy.columns, first.columns);
  assert.deepStrictEqual(copy.sourceOptions, first.sourceOptions);
  assert.ok(!copy.lastUsedAt, 'the copy was never used');
  assert.deepStrictEqual(W.get('c1'), first, 'the first record is as it was');
  assert.deepStrictEqual(W.list().map((w) => w.id), [copy.id, 'c1']);
  assert.ok(ls.getItem('dl.workflows.v1').indexOf('From a later build') >= 0, 'a record of a later build stays');
  // A change to the copy does not reach the first record.
  W.rename(copy.id, 'Clean for Asia');
  assert.strictEqual(W.get('c1').name, 'Clean');
  assert.strictEqual(W.copy('no-such-id', 'X'), null);
  });
});

test('a full backup restores every key of the application, and no key of another application', () => {
  loadApp('js/app/backup.js');
  const B = DL.backup;
  // A workflow of 1.0 and one with a note that holds text that could break a file.
  const note = 'quotes " \\ </script> line' + String.fromCharCode(10, 0, 0x2028) + String.fromCharCode(0xD83D, 0xDC4D) + String.fromCharCode(0xD800);
  const workflows = JSON.stringify([
    { id: 'w1', name: 'From 1.0', steps: [{ id: 'a', opId: 'case', params: { columns: ['Email'], mode: 'lower' }, enabled: true }], columns: ['Email'], sourceOptions: null, createdAt: 1, updatedAt: 2 },
    { id: 'w2', name: 'With a note', steps: [{ id: 'b', opId: 'case', params: {}, enabled: true, note: note }], columns: [], sourceOptions: null, createdAt: 3, updatedAt: 4 }
  ]);
  const before = { 'dl.workflows.v1': workflows, 'dl.session.v1': '{"workflow":{"steps":[]}}', 'dl.theme': 'dark', 'dl.autosave': '1', 'other.app': 'keep me' };
  let ls = fakeStorage(before);
  withStorage(ls, () => {
  const made = B.make();
  assert.strictEqual(made.workflows, 2);
  const file = JSON.parse(made.text);
  assert.strictEqual(file.format, 'delimiter-lab-backup');
  assert.strictEqual(file.version, 1);
  assert.strictEqual(file.appVersion, DL.VERSION);
  assert.ok(!('other.app' in file.storage), 'the keys of other applications stay out');

  // Later changes, and a key that the backup does not have.
  ls.setItem('dl.theme', 'light');
  ls.setItem('dl.workflows.v1', '[]');
  ls.setItem('dl.later.v2', 'x');
  const parsed = B.parse(made.text);
  assert.strictEqual(parsed.workflows, 2);
  assert.deepStrictEqual(B.restore(parsed), { ok: true });
  const after = ls.dump();
  assert.deepStrictEqual(after, before, 'every key comes back as it was, and the key that came later is gone');
  assert.strictEqual(DL.workflows.get('w2').steps[0].note, note);
  assert.deepStrictEqual(DL.workflows.list().map((w) => w.id), ['w1', 'w2']);

  // Files that are refused. parse() writes nothing.
  const refuse = (text, re) => assert.throws(() => B.parse(text), re);
  refuse('not json', /not a Delimiter Lab backup/);
  refuse(DL.workflowToJSON({ name: 'x', steps: [] }), /workflow file, not a backup/);
  refuse(JSON.stringify({ format: 'delimiter-lab-backup', version: 2, storage: {} }), /newer version/);
  refuse(JSON.stringify({ format: 'delimiter-lab-backup', storage: {} }), /not a Delimiter Lab backup/);
  refuse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: [] }), /not a Delimiter Lab backup/);
  refuse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: { 'dl.theme': 5 } }), /damaged/);
  refuse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: { 'dl.workflows.v1': '{broken' } }), /damaged/);
  assert.deepStrictEqual(ls.dump(), before);
  // A key of another application in a file does not go into the storage.
  const foreign = B.parse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: { 'dl.theme': 'light', 'other.app': 'no' } }));
  assert.deepStrictEqual(Object.keys(foreign.storage), ['dl.theme']);
  assert.strictEqual(foreign.workflows, 0);
  // An empty text is an empty store, as DL.workflows reads it. It is not a damaged list.
  assert.strictEqual(B.parse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: { 'dl.workflows.v1': '' } })).workflows, 0);
  // The version of the file goes into a question on the screen, so only plain characters pass.
  const version = (v) => B.parse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, appVersion: v, storage: {} })).appVersion;
  assert.strictEqual(version('1.2'), '1.2');
  assert.strictEqual(version('1.0' + String.fromCharCode(0x202E) + 'evil'), '', 'a character that turns the text around gives no version');
  assert.strictEqual(version(5), '');

  // A backup with code in a saved workflow or in the session says so, because it can come from
  // another person. A step with code that is turned off does not run.
  const withSteps = (key, steps) => B.parse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: {
    [key]: key === 'dl.session.v1' ? JSON.stringify({ workflow: { steps } }) : JSON.stringify([{ id: 'x', name: 'x', steps }]) } }));
  const js = { opId: 'javascriptRow', params: { code: 'return false;' }, enabled: true };
  assert.strictEqual(parsed.runsCode, false);
  assert.strictEqual(withSteps('dl.workflows.v1', [js]).runsCode, true);
  assert.strictEqual(withSteps('dl.session.v1', [js]).runsCode, true);
  assert.strictEqual(withSteps('dl.workflows.v1', [Object.assign({}, js, { enabled: false })]).runsCode, false);
  // A backup of a list of workflows that does not read says so, because parse() refuses it.
  withStorage(fakeStorage({ 'dl.workflows.v1': '{broken', 'dl.theme': 'dark' }), () => {
    assert.strictEqual(B.make().workflows, -1);
    assert.strictEqual(B.currentWorkflows(), -1, 'the question must say that the list cannot be read');
  });

  // A storage that fills up during the restore gets the keys of before back.
  const big = B.parse(JSON.stringify({ format: 'delimiter-lab-backup', version: 1, storage: { 'dl.theme': 'light', 'dl.session.v1': 'x'.repeat(5000) } }));
  const tight = fakeStorage(before, 2000);
  withStorage(tight, () => {
    assert.deepStrictEqual(B.restore(big), { ok: false }, 'the keys of before come back');
    assert.deepStrictEqual(tight.dump(), before, 'a failed restore changes nothing');
  });
  // A storage that takes neither the backup nor the keys of before says that the work is lost, so
  // that the page can tell the user. Here every write after the first one fails.
  const hostile = fakeStorage(before, 0);
  withStorage(hostile, () => {
    assert.deepStrictEqual(B.restore(big), { ok: false, lost: true });
  });
  });
});

// The page reads the IIFE build; a program that takes the engine as a module reads the other one.
// Both come from one source, so both must hold the same engine.
(async () => {
  try {
    const mod = await import(url.pathToFileURL(path.join(root, 'dist/engine.mjs')).href);
    assert.strictEqual(mod.DL.ops.length, DL.ops.length);
    assert.strictEqual(mod.DL.VERSION, DL.VERSION);
    passed++;
  } catch (e) {
    failed++;
    console.error('FAIL the module build holds the same engine\n  ' + (e && e.stack ? e.stack : e));
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
