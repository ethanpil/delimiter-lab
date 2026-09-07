/* Parity: the page and the command line must give the same bytes. Run: node test/parity.test.js
 *
 * Both sides run the same workflow over the same files. The browser side loads the engine exactly
 * as the page does, through js/manifest.js and dist/engine.global.js, and drives it through the
 * worker's own message protocol. The terminal side runs the real dl command as a separate process.
 * The two outputs are then compared byte for byte.
 *
 * This is the test that holds the promise: one engine, the same answer on every platform.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-parity-'));

/* ---------- the files that both sides read ---------- */

const INPUT_A = [
  'name,city,amount,when',
  ' ada ,London,1234.5,2024-01-15',
  'GRACE,"New York, NY",20,2024-02-29',
  'alan,Cambridge,-7.25,2023-12-31',
  'Zoë,Kraków,0,2024-06-01'
].join('\n') + '\n';

const INPUT_B = [
  'name,city,amount,when',
  'kai,Osaka,99.999,2024-03-10',
  ' MEI ,Taipei,,2024-04-02'
].join('\n') + '\n';

const WORKFLOW = {
  format: 'delimiter-lab-workflow',
  version: 1,
  name: 'Parity',
  columns: ['name', 'city', 'amount', 'when'],
  sourceOptions: null,
  steps: [
    { id: 's1', opId: 'padTrim', params: { columns: ['name'], trim: 'both' }, enabled: true },
    { id: 's2', opId: 'case', params: { columns: ['name'], mode: 'title' }, enabled: true },
    { id: 's3', opId: 'numFormat', params: { columns: ['amount'], decimals: 2, thousands: ',' }, enabled: true },
    { id: 's4', opId: 'dateFormat', params: { columns: ['when'], format: 'D MMM YYYY', pattern: 'D MMM YYYY' }, enabled: true },
    { id: 's5', opId: 'sort', params: { keys: [{ column: 'name', type: 'auto', dir: 'asc' }] }, enabled: true }
  ]
};

const aPath = path.join(tmp, 'a.csv');
const bPath = path.join(tmp, 'b.csv');
const wfPath = path.join(tmp, 'wf.json');
fs.writeFileSync(aPath, INPUT_A);
fs.writeFileSync(bPath, INPUT_B);
fs.writeFileSync(wfPath, JSON.stringify(WORKFLOW, null, 2));

/* ---------- the browser side ---------- */

global.self = global;
global.location = { search: '' };
global.importScripts = function () {
  for (const f of arguments) {
    if (/manifest/.test(f)) { vm.runInThisContext(fs.readFileSync(path.join(root, 'js/manifest.js'), 'utf8')); continue; }
    if (/papaparse/.test(f)) { global.Papa = require(path.join(root, 'vendor/papaparse.min.js')); continue; }
    if (/xlsx/.test(f)) { global.XLSX = require(path.join(root, 'vendor/xlsx.full.min.js')); continue; }
    vm.runInThisContext(fs.readFileSync(path.join(root, f.replace(/^\.\.\/\.\.\//, '')), 'utf8'), { filename: f });
  }
};
// A file in the shape a browser gives the worker.
class BrowserFile extends Blob {
  constructor(buf, name) {
    buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    super([buf]);
    this.buf = buf;
    this.name = name;
    this.lastModified = 1;
  }
  slice(a, b) { return new BrowserFile(this.buf.subarray(a, b), this.name); }
}
global.FileReaderSync = function () {};
FileReaderSync.prototype.readAsArrayBuffer = function (f) {
  return f.buf.buffer.slice(f.buf.byteOffset, f.buf.byteOffset + f.buf.length);
};
const posted = [];
global.postMessage = (m) => posted.push(m);
let workerSrc = fs.readFileSync(path.join(root, 'js/engine/worker.js'), 'utf8');
workerSrc = workerSrc.replace(/importScripts\.apply\(self[\s\S]*?\}\)\);/,
  "importScripts.apply(self, ['../../vendor/papaparse.min.js'].concat(DL.FILES.engine, DL.FILES.ops));");
vm.runInThisContext(workerSrc, { filename: 'worker.js' });

let nextId = 1;
// Sends one message and gives its reply. The run and the write answer on a later turn, so wait.
function send(msg) {
  msg.requestId = nextId++;
  global.onmessage({ data: msg });
  return posted.filter((p) => p.requestId === msg.requestId)[0];
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
async function sendAsync(msg) {
  msg.requestId = nextId++;
  global.onmessage({ data: msg });
  for (let i = 0; i < 2000; i++) {
    const r = posted.filter((p) => p.requestId === msg.requestId)[0];
    if (r) return r;
    await nextTurn();
  }
  throw new Error('the worker gave no reply to ' + msg.type);
}

async function browserBytes(files, format) {
  send({ type: 'config', maxCells: 8e6 });
  // The settings come from the workflow and are completed the same way on both sides, so that the
  // comparison is of the engine and not of two different sets of settings.
  const options = global.DL.cleanSourceOptions(WORKFLOW.sourceOptions || {});
  if (files.length > 1) options.multiFile = 'stack';
  const loaded = send({
    type: 'load',
    files: files.map((f) => new BrowserFile(fs.readFileSync(f), path.basename(f))),
    options: options
  });
  assert.strictEqual(loaded.type, 'loaded', 'the browser side could not read the files');
  const steps = WORKFLOW.steps.map((s) => ({ id: s.id, opId: s.opId, params: s.params, skip: false }));
  const ran = await sendAsync({ type: 'run', steps: steps });
  assert.ok(ran.type === 'ran', 'the browser side could not run the steps: ' + JSON.stringify(ran).slice(0, 200));
  const last = ran.results[ran.results.length - 1];
  ran.results.forEach(function (r, i) {
    assert.ok(r.status === 'ok' || r.status === 'warning',
      'step ' + (i + 1) + ' (' + WORKFLOW.steps[i].opId + ') came back "' + r.status + '": ' +
      (r.error || JSON.stringify(r.notes)));
  });
  const out = await sendAsync({
    type: 'export',
    stepId: last.stepId,
    options: Object.assign(global.DL.defaultFormatOptions(global.DL.outputFormatById(format)), { format: format })
  });
  assert.ok(out && out.blob, 'the browser side wrote nothing');
  return Buffer.from(await out.blob.arrayBuffer());
}

/* ---------- the terminal side ---------- */

function cliBytes(files, format) {
  const outPath = path.join(tmp, 'cli-out.' + format);
  execFileSync(process.execPath, [path.join(root, 'dist/dl.mjs'), wfPath].concat(files, ['-o', outPath, '--quiet']));
  return fs.readFileSync(outPath);
}

/* ---------- compare ---------- */

let passed = 0, failed = 0;
// The worker holds one source at a time, so each test must finish before the next one starts.
async function test(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack : e)); }
}

(async () => {
  await test('one file: the page and the command line write the same CSV', async () => {
    const fromBrowser = await browserBytes([aPath], 'csv');
    const fromCli = cliBytes([aPath], 'csv');
    assert.ok(fromBrowser.length > 0, 'the output is empty');
    assert.strictEqual(fromCli.toString('utf8'), fromBrowser.toString('utf8'),
      'the two sides wrote different text');
    assert.ok(fromCli.equals(fromBrowser), 'the two sides wrote different bytes');
  });

  await test('many files: the page and the command line stack them the same way', async () => {
    const fromBrowser = await browserBytes([aPath, bPath], 'csv');
    const fromCli = cliBytes([aPath, bPath], 'csv');
    assert.ok(fromBrowser.toString('utf8').split('\n').length > 5, 'the stacked output looks too short');
    if (!fromCli.equals(fromBrowser)) {
      fs.writeFileSync(path.join(root, 'parity-browser.txt'), fromBrowser);
      fs.writeFileSync(path.join(root, 'parity-cli.txt'), fromCli);
    }
    assert.ok(fromCli.equals(fromBrowser), 'the two sides wrote different bytes for a stacked source');
  });

  await test('another format: the two sides agree on TSV as well', async () => {
    const fromBrowser = await browserBytes([aPath], 'tsv');
    const fromCli = cliBytes([aPath], 'tsv');
    assert.ok(fromCli.equals(fromBrowser), 'the two sides wrote different bytes for TSV');
  });

  await test('the values themselves came through, not two empty files', async () => {
    const text = (await browserBytes([aPath], 'csv')).toString('utf8');
    assert.match(text, /Ada/, 'the trim and the case steps did not run');
    assert.match(text, /1,234\.50/, 'the number step did not run');
    assert.match(text, /15 Jan 2024/, 'the date step did not run');
    assert.match(text, /Zoë/, 'a value outside ASCII did not survive');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
