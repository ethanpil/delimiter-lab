/* Worker tests. Run: node test/worker.test.js
   The worker runs in this process with a fake File, the real PapaParse and the real SheetJS. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
global.self = global;
global.location = { search: '' };
global.importScripts = function () {
  for (const f of arguments) {
    if (/manifest/.test(f)) { vm.runInThisContext(fs.readFileSync(path.join(root, 'js/manifest.js'), 'utf8')); continue; }
    if (/papaparse/.test(f)) { global.Papa = require(path.join(root, 'vendor/papaparse.min.js')); continue; }
    if (/xlsx/.test(f)) { global.XLSX = require(path.join(root, 'vendor/xlsx.full.min.js')); continue; }
    let text = fs.readFileSync(path.join(root, f.replace(/^\.\.\/\.\.\//, '')), 'utf8');
    if (/engine\.global/.test(f)) {
      const before = text;
      // A small slice lets a test send a character across the edge of two slices.
      text = text.replace('var SLICE = 8 * 1024 * 1024;', 'var SLICE = globalThis.SLICE_OVERRIDE || 8 * 1024 * 1024;');
      if (text === before) throw new Error('The reader slice size was not found in the engine build.');
    }
    vm.runInThisContext(text, { filename: f });
  }
};
class FakeFile extends Blob {
  constructor(buf, name) { buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); super([buf]); this.buf = buf; this.name = name || 'a.csv'; this.lastModified = 1; }
  slice(a, b) { return new FakeFile(this.buf.subarray(a, b), this.name); }
}
global.FileReaderSync = function () {};
FileReaderSync.prototype.readAsArrayBuffer = function (f) {
  if (f instanceof FakeFile) return f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.length);
  throw new Error('readAsArrayBuffer on ' + (f && f.constructor.name));
};
const posted = [];
global.postMessage = (m) => posted.push(m);
let src = fs.readFileSync(path.join(root, 'js/engine/worker.js'), 'utf8');
src = src.replace(/importScripts\.apply\(self[\s\S]*?\}\)\);/, "importScripts.apply(self, ['../../vendor/papaparse.min.js'].concat(DL.FILES.engine, DL.FILES.ops));");
vm.runInThisContext(src, { filename: 'worker.js' });

let passed = 0, failed = 0;
const pending = [];
// Runs one test. A test that gives a promise is awaited; its result counts when it settles.
function test(name, fn) {
  const fail = (e) => { failed++; console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') { const p = r.then(() => { passed++; }, fail); pending.push(p); return p; }
    passed++;
  } catch (e) { fail(e); }
}
let nextId = 1;
// Sends one message and gives the reply. A run is asynchronous: drain the timers first.
function send(m) {
  m.requestId = nextId++;
  onmessage({ data: m });
  return posted.filter((p) => p.requestId === m.requestId)[0];
}
function flushTimers() {
  // The run loop uses setTimeout(fn, 0); Node runs those on the next turn. Spin until the reply exists.
  return new Promise((resolve) => setImmediate(resolve));
}
async function run(steps, protect) {
  const m = { type: 'run', steps, protect: protect || [], requestId: nextId++ };
  onmessage({ data: m });
  for (let i = 0; i < 1000; i++) {
    const r = posted.filter((p) => p.requestId === m.requestId)[0];
    if (r) return r;
    await flushTimers();
  }
  throw new Error('no run reply');
}
const rows = (data) => data.rows;
async function blobText(b) { return Buffer.from(await b.arrayBuffer()).toString('utf8'); }

(async () => {
  send({ type: 'config', maxCells: 8e6 });

  await (async () => {
    const file = new FakeFile('a,b\n1,2\n3,4\r\n5,6\r\n', 'mixed.csv');
    test('mixed line endings leave no CR in the last column', () => {
      const r = send({ type: 'load', file, options: {} });
      assert.strictEqual(r.type, 'loaded');
      const s = send({ type: 'slice', stepId: 'source', start: 0, count: 5 });
      assert.deepStrictEqual(JSON.stringify(rows(s.data)), JSON.stringify([['1', '2'], ['3', '4'], ['5', '6']]));
    });
  })();

  test('the cell limit counts the table that stacking makes, not the files on their own', () => {
    // Two files, each small on its own, whose columns have no name in common. The stacked table is
    // twice as wide as either file, so it holds twice the cells that the two files hold.
    const rows = 300;
    const make = (h1, h2, name) => {
      let text = h1 + ',' + h2 + "\n";
      for (let i = 0; i < rows; i++) text += 'x,y\n';
      return new FakeFile(text, name);
    };
    const a = make('a1', 'a2', 'a.csv');
    const b = make('b1', 'b2', 'b.csv');

    send({ type: 'config', maxCells: 1500 });
    // Each file is 600 cells, so the sum is 1200 and passes. The stacked table is 600 x 4 = 2400.
    const r = send({ type: 'load', files: [a, b], options: {} });
    assert.strictEqual(r.type, 'error', 'a stacked table above the limit must be refused');
    assert.ok(r.tooLarge, 'the refusal must say that the table is too large');

    // The same two files pass when the limit has room for the stacked table.
    send({ type: 'config', maxCells: 8e6 });
    const ok = send({ type: 'load', files: [a, b], options: {} });
    assert.strictEqual(ok.type, 'loaded');
    assert.deepStrictEqual(ok.info.columns, ['a1', 'a2', 'b1', 'b2']);
    assert.strictEqual(ok.info.rowCount, rows * 2);
  });

  test('a character that crosses the edge of two slices stays whole', () => {
    // The reader takes the bytes in slices and decodes them with one decoder that carries its
    // state from slice to slice. Without that, a character of several bytes on the edge would
    // come out as two broken characters.
    const name = 'Zo\u00eb Ma\u00f1ana \u65e5\u672c\u8a9e';
    let text = 'a,b\n';
    for (let i = 0; i < 400; i++) text += name + i + ',' + name + i + '\n';
    globalThis.SLICE_OVERRIDE = 64;   // many slices, and most edges fall inside a character
    try {
      const r = send({ type: 'load', file: new FakeFile(text, 'wide.csv'), options: {} });
      assert.strictEqual(r.type, 'loaded');
      assert.strictEqual(r.info.rowCount, 400);
      const got = rows(send({ type: 'slice', stepId: 'source', start: 0, count: 400 }).data);
      for (let i = 0; i < 400; i++) {
        assert.strictEqual(got[i][0], name + i, 'row ' + i + ' came back broken');
      }
      assert.ok(!JSON.stringify(got).includes('\ufffd'), 'no value may hold a replacement character');
    } finally {
      globalThis.SLICE_OVERRIDE = 0;
    }
  });

  test('load stacks many files into one source', () => {
    const one = new FakeFile('name,city\nAda,London\nAlan,Cambridge\n', 'one.csv');
    const two = new FakeFile('name,city\nGrace,New York\n', 'two.csv');
    const three = new FakeFile('name,age\nKay,31\n', 'three.csv');

    let r = send({ type: 'load', files: [one, two], options: {} });
    assert.strictEqual(r.info.rowCount, 3);
    assert.deepStrictEqual(r.info.columns, ['name', 'city']);
    assert.deepStrictEqual(r.info.files.map((f) => f.name), ['one.csv', 'two.csv']);
    assert.deepStrictEqual(r.info.files.map((f) => f.rowCount), [2, 1]);
    assert.strictEqual(r.info.fileName, 'one.csv');
    let got = rows(send({ type: 'slice', stepId: 'source', start: 0, count: 10 }).data);
    assert.deepStrictEqual(got, [['Ada', 'London'], ['Alan', 'Cambridge'], ['Grace', 'New York']]);

    // A file with another column widens the result, and a note names each file that lacks one.
    r = send({ type: 'load', files: [one, three], options: {} });
    assert.deepStrictEqual(r.info.columns, ['name', 'city', 'age']);
    assert.strictEqual(r.info.rowCount, 3);
    got = rows(send({ type: 'slice', stepId: 'source', start: 0, count: 10 }).data);
    assert.deepStrictEqual(got, [['Ada', 'London', ''], ['Alan', 'Cambridge', ''], ['Kay', '', '31']]);
    assert.strictEqual(r.info.notes.filter((n) => n.indexOf('does not have') > 0).length, 2);

    // One file in the list behaves as one file on its own, and the older message still works.
    r = send({ type: 'load', files: [two], options: {} });
    assert.strictEqual(r.info.rowCount, 1);
    assert.deepStrictEqual(r.info.files.map((f) => f.name), ['two.csv']);
    r = send({ type: 'load', file: two, options: {} });
    assert.strictEqual(r.info.rowCount, 1);
  });

  test('a blank line kept on request is not a ragged row', () => {
    const r = send({ type: 'load', file: new FakeFile('a,b\n1,2\n\n3,4\n', 'blank.csv'), options: { skipEmptyLines: false } });
    assert.strictEqual(r.info.rowCount, 3);
    assert.ok(!r.info.notes.some((n) => /different number/.test(n)), r.info.notes.join('; '));
  });

  test('UTF-16 without a byte order mark is read in both byte orders', () => {
    const le = Buffer.from('a,b\n1,2\n', 'utf16le');
    const be = Buffer.alloc(le.length);
    for (let i = 0; i < le.length; i += 2) { be[i] = le[i + 1]; be[i + 1] = le[i]; }
    const r1 = send({ type: 'load', file: new FakeFile(le, 'le.csv'), options: {} });
    assert.strictEqual(r1.info.encoding, 'utf-16le');
    const r2 = send({ type: 'load', file: new FakeFile(be, 'be.csv'), options: {} });
    assert.strictEqual(r2.info.encoding, 'utf-16be');
    assert.deepStrictEqual(r2.info.columns, ['a', 'b']);
  });

  test('a file with CR line endings finds its separator', () => {
    const r = send({ type: 'load', file: new FakeFile('title\ra;b\r1;2\r', 'cr.csv'), options: { skipRows: 1 } });
    assert.strictEqual(r.info.delimiter, ';');
    assert.deepStrictEqual(r.info.columns, ['a', 'b']);
  });

  await (async () => {
    const lines = ['id,name'];
    for (let i = 0; i < 300; i++) lines.push(i + ',n' + (i % 7));
    send({ type: 'load', file: new FakeFile(lines.join('\n'), 'chain.csv'), options: {} });
    const steps = [
      { id: 's1', opId: 'case', params: { columns: ['name'], mode: 'upper' } },
      { id: 's2', opId: 'sort', params: { keys: [{ column: 'name', type: 'text', dir: 'asc' }], emptyLast: true } },
      { id: 's3', opId: 'addColumn', params: { name: 'X', kind: 'value', value: 'x', position: 'end' } }
    ];
    const r = await run(steps);
    test('a chain runs and every step has a table', () => {
      assert.deepStrictEqual(r.results.map((x) => x.status), ['ok', 'ok', 'ok']);
    });
    test('an evicted step is computed again on demand', () => {
      send({ type: 'config', maxCells: 100 }); // a budget of 300 cells: the chain does not fit
      state.cache.forEach((e) => { e.table = null; });
      const s = send({ type: 'slice', stepId: 's3', start: 0, count: 2 });
      assert.strictEqual(s.type, 'slice', JSON.stringify(s));
      assert.strictEqual(s.data.total, 300);
      assert.strictEqual(s.data.columns[2], 'X');
      send({ type: 'config', maxCells: 8e6 });
    });
    test('the Changes view follows a sort and marks a new column', () => {
      const d = send({ type: 'diffSummary', stepId: 's2' }).summary;
      assert.strictEqual(d.sameRows, true);
      assert.deepStrictEqual(d.columns.map((c) => c.changed), [0, 0]);
      const d3 = send({ type: 'diffSummary', stepId: 's3' }).summary;
      assert.strictEqual(d3.columns[2].isNew, true);
    });
    test('the profile is kept per column name', () => {
      const a = send({ type: 'columnStats', stepId: 's2', col: 1 }).stats;
      const b = send({ type: 'columnStats', stepId: 's1', col: 1 }).stats;
      assert.strictEqual(a.distinct, 7);
      assert.strictEqual(b.distinct, 7);
      assert.strictEqual(send({ type: 'columnStats', stepId: 's1', col: 1 }).stats, b, 'the second request comes from the memo');
    });
    await test('a cancelled run keeps the cached steps and blocks the rest', async () => {
      const slow = steps.concat([
        { id: 's4', opId: 'javascript', params: { code: 'var x = 0; for (var i = 0; i < 2e6; i++) x += i; return String(x);', output: 'J', mode: 'add' } },
        { id: 's5', opId: 'addColumn', params: { name: 'Y', kind: 'value', value: 'y', position: 'end' } }
      ]);
      const m = { type: 'run', steps: slow, protect: [], requestId: nextId++ };
      onmessage({ data: m });
      onmessage({ data: { type: 'cancel', requestId: nextId++ } });
      let reply;
      for (let i = 0; i < 1000 && !reply; i++) { reply = posted.filter((p) => p.requestId === m.requestId)[0]; await flushTimers(); }
      assert.ok(reply.cancelled);
      assert.deepStrictEqual(reply.results.map((x) => x.status), ['ok', 'ok', 'ok', 'ok', 'blocked']);
      const s = send({ type: 'slice', stepId: 's5', start: 0, count: 1 });
      assert.strictEqual(s.data.total, 0, 'a cancelled step is not computed on demand');
    });
  })();

  await test('the CSV writer quotes like PapaParse and the JSON writer keeps every column name', () => {
    send({ type: 'load', file: new FakeFile('__proto__,b\n"x,y","he said ""hi"""\n lead,trail \n', 'q.csv'), options: {} });
    const csv = send({ type: 'export', stepId: 'source', options: { format: 'csv', bom: false, newline: 'lf' } });
    assert.strictEqual(csv && csv.type, 'exported', 'busy=' + busy + ' queue=' + queue.length + ' reply=' + JSON.stringify(csv));
    return blobText(csv.blob).then((t) => {
      assert.strictEqual(t, '__proto__,b\n"x,y","he said ""hi"""\n" lead","trail "\n');
    }).then(() => {
      const json = send({ type: 'export', stepId: 'source', options: { format: 'json' } });
      return blobText(json.blob);
    }).then((t) => {
      const parsed = JSON.parse(t);
      assert.strictEqual(Object.keys(parsed[0]).length, 2);
      assert.strictEqual(parsed[0].b, 'he said "hi"');
    });
  });
  await flushTimers();

  test('the output separator cannot be a quote', () => {
    const r = send({ type: 'export', stepId: 'source', options: { format: 'delimited', delimiter: '"' } });
    assert.strictEqual(r.type, 'error');
  });

  test('the Excel writer refuses cells and sheet names that Excel cannot hold', () => {
    const bad = send({ type: 'export', stepId: 'source', options: { format: 'xlsx', sheetName: "'History'" } });
    assert.strictEqual(bad.type, 'exported');
    send({ type: 'load', file: new FakeFile('a\n' + 'x'.repeat(40000) + '\n', 'long.csv'), options: {} });
    const r = send({ type: 'export', stepId: 'source', options: { format: 'xlsx' } });
    assert.strictEqual(r.type, 'error');
    assert.ok(/32,767/.test(r.message));
  });

  test('a spreadsheet cell with a time only becomes a time', () => {
    const ws = XLSX.utils.aoa_to_sheet([['t', 'd'], [{ t: 'n', v: 0.5, z: 'hh:mm' }, { t: 'n', v: 45321, z: 'yyyy-mm-dd' }]]);
    ws.A2 = { t: 'n', v: 0.5, z: 'hh:mm' }; ws.B2 = { t: 'n', v: 45321, z: 'yyyy-mm-dd' };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
    const r = send({ type: 'load', file: new FakeFile(buf, 'w.xlsx'), options: {} });
    assert.strictEqual(r.type, 'loaded', JSON.stringify(r));
    const s = send({ type: 'slice', stepId: 'source', start: 0, count: 1 });
    assert.strictEqual(s.data.rows[0][0], '12:00:00');
    assert.strictEqual(s.data.rows[0][1], '2024-01-30');
  });

  await test('the zip holds the files and refers to their blobs', async () => {
    const z = send({ type: 'zip', entries: [{ name: 'a.csv', blob: new FakeFile('x,y\n') }, { name: 'süß.csv', blob: new FakeFile('hello') }] });
    assert.strictEqual(z.type, 'zip');
    const bytes = Buffer.from(await z.blob.arrayBuffer());
    assert.strictEqual(bytes.readUInt32LE(0), 0x04034b50);
    const crc = zlib.crc32 ? zlib.crc32(Buffer.from('hello')) : null;
    if (crc !== null) assert.ok(bytes.indexOf(Buffer.from([crc & 255, (crc >> 8) & 255, (crc >> 16) & 255, (crc >>> 24) & 255])) > 0);
  });
  await flushTimers();

  test('a batch beyond 4 GB is refused', () => {
    const big = { name: 'a.csv', blob: { size: 5 * 1024 * 1024 * 1024 } };
    const r = send({ type: 'zip', entries: [big] });
    assert.strictEqual(r.type, 'error');
  });

  await Promise.all(pending);
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})();
