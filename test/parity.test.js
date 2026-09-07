/* Parity: the page and the command line must give the same bytes. Run: node test/parity.test.js
 *
 * Both sides run the same workflow file over the same data files. The browser side loads the engine
 * exactly as the page does, through js/manifest.js and dist/engine.global.js, and drives it through
 * the worker's own message protocol. The terminal side runs the real dl command as a separate
 * process. The two outputs are then compared byte for byte.
 *
 * Both sides read the workflow from disk through DL.parseWorkflow and shape the steps with
 * DL.workerSteps, which is what the page and the command both do, so the comparison covers the
 * reading of a workflow and not only the running of it.
 *
 * Both sides read dist/, so this holds the two builds to one answer. It does not say that the
 * answer is right: test/engine.test.js says that.
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

const STEPS = [
  { id: 's1', opId: 'padTrim', params: { columns: ['name'], trim: 'both' }, enabled: true },
  { id: 's2', opId: 'case', params: { columns: ['name'], mode: 'title' }, enabled: true },
  { id: 's3', opId: 'numFormat', params: { columns: ['amount'], decimals: 2, thousands: ',' }, enabled: true },
  { id: 's4', opId: 'dateFormat', params: { columns: ['when'], format: 'D MMM YYYY', pattern: 'D MMM YYYY' }, enabled: true },
  { id: 's5', opId: 'sort', params: { keys: [{ column: 'name', type: 'auto', dir: 'asc' }] }, enabled: true }
];

const aPath = path.join(tmp, 'a.csv');
const bPath = path.join(tmp, 'b.csv');
fs.writeFileSync(aPath, INPUT_A);
fs.writeFileSync(bPath, INPUT_B);

let wfCount = 0;
// Writes a workflow file, which is what a person exports from the page and gives to the command.
function workflow(steps, sourceOptions) {
  const file = path.join(tmp, 'wf-' + (++wfCount) + '.json');
  fs.writeFileSync(file, JSON.stringify({
    format: 'delimiter-lab-workflow',
    version: 1,
    name: 'Parity ' + wfCount,
    columns: ['name', 'city', 'amount', 'when'],
    sourceOptions: sourceOptions || null,
    steps: steps
  }, null, 2));
  return file;
}

const PLAIN = workflow(STEPS);
// A stacked source with the name of the file as a column. The name of a file is where the two
// sides once differed: the command kept the whole path.
const STACKED = workflow(STEPS, { multiFile: 'stack', fileNameColumn: true });
const WITH_OFF_STEP = workflow(STEPS.map((s, i) => (i === 1 ? Object.assign({}, s, { enabled: false }) : s)));
const CANNOT_RUN = workflow([
  { id: 's1', opId: 'case', params: { columns: ['no such column'], mode: 'upper' }, enabled: true }
]);

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

// Reads the files and runs the steps, the way the page does. Gives the reply of the run.
async function browserRun(files, wfPath) {
  // A limit of memory belongs to the machine, not to the engine. Both sides are far above what
  // these files need, so it cannot change the answer.
  send({ type: 'config', maxCells: 8e6 });
  const wf = global.DL.parseWorkflow(fs.readFileSync(wfPath, 'utf8'));
  const loaded = send({
    type: 'load',
    files: files.map((f) => new BrowserFile(fs.readFileSync(f), path.basename(f))),
    options: global.DL.cleanSourceOptions(wf.sourceOptions || {})
  });
  assert.strictEqual(loaded.type, 'loaded', 'the browser side could not read the files');
  return await sendAsync({ type: 'run', steps: global.DL.workerSteps(wf.steps) });
}

async function browserBytes(files, format, wfPath) {
  const ran = await browserRun(files, wfPath);
  assert.ok(ran.type === 'ran', 'the browser side could not run the steps: ' + JSON.stringify(ran).slice(0, 200));
  ran.results.forEach(function (r, i) {
    assert.ok(r.status === 'ok' || r.status === 'warning' || r.status === 'skipped',
      'step ' + (i + 1) + ' came back "' + r.status + '": ' + (r.error || JSON.stringify(r.notes)));
  });
  const last = ran.results[ran.results.length - 1];
  const out = await sendAsync({
    type: 'export',
    stepId: last.stepId,
    options: Object.assign(global.DL.defaultFormatOptions(global.DL.outputFormatById(format)), { format: format })
  });
  assert.ok(out && out.blob, 'the browser side wrote nothing');
  return Buffer.from(await out.blob.arrayBuffer());
}

/* ---------- the terminal side ---------- */

function cliBytes(files, format, wfPath) {
  const outPath = path.join(tmp, 'cli-out-' + (nextId++) + '.' + format);
  execFileSync(process.execPath, [path.join(root, 'dist/dl.mjs'), wfPath].concat(files, ['-o', outPath, '--quiet']));
  return fs.readFileSync(outPath);
}

// Runs a workflow that cannot run, and gives what the command said about it.
function cliFailure(files, wfPath) {
  try {
    execFileSync(process.execPath, [path.join(root, 'dist/dl.mjs'), wfPath].concat(files, ['--quiet']),
      { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    return { code: e.status, said: String(e.stderr || '').trim() };
  }
  throw new Error('the command answered with success for a workflow that cannot run');
}

/* ---------- compare ---------- */

let passed = 0, failed = 0;
// The worker holds one source at a time, so each test must finish before the next one starts.
async function test(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error('FAIL ' + name + '\n  ' + (e && e.stack ? e.stack : e)); }
}

function sameBytes(fromBrowser, fromCli, what) {
  if (!fromCli.equals(fromBrowser)) {
    fs.writeFileSync(path.join(root, 'parity-browser.out'), fromBrowser);
    fs.writeFileSync(path.join(root, 'parity-cli.out'), fromCli);
  }
  assert.ok(fromCli.equals(fromBrowser), 'the two sides wrote different bytes for ' + what);
}

(async () => {
  await test('one file: the page and the command line write the same CSV', async () => {
    const fromBrowser = await browserBytes([aPath], 'csv', PLAIN);
    const fromCli = cliBytes([aPath], 'csv', PLAIN);
    assert.ok(fromBrowser.length > 0, 'the output is empty');
    assert.strictEqual(fromCli.toString('utf8'), fromBrowser.toString('utf8'), 'the two sides wrote different text');
    sameBytes(fromBrowser, fromCli, 'one file');
  });

  await test('many files: the page and the command line stack them the same way', async () => {
    const fromBrowser = await browserBytes([aPath, bPath], 'csv', STACKED);
    const fromCli = cliBytes([aPath, bPath], 'csv', STACKED);
    const text = fromBrowser.toString('utf8');
    assert.ok(text.split('\n').length > 5, 'the stacked output looks too short');
    // The name of the file must be the name alone on both sides, never the way to it.
    assert.match(text, /(^|\n)"?a\.csv/, 'the name of the file is missing from the stacked output');
    assert.ok(text.indexOf(tmp) < 0, 'the browser side wrote a whole path');
    assert.ok(fromCli.toString('utf8').indexOf(tmp) < 0, 'the command wrote a whole path');
    sameBytes(fromBrowser, fromCli, 'a stacked source');
  });

  await test('another format: the two sides agree on TSV as well', async () => {
    sameBytes(await browserBytes([aPath], 'tsv', PLAIN), cliBytes([aPath], 'tsv', PLAIN), 'TSV');
  });

  await test('a workbook: the two sides write the same bytes for xlsx', async () => {
    const fromBrowser = await browserBytes([aPath], 'xlsx', PLAIN);
    const fromCli = cliBytes([aPath], 'xlsx', PLAIN);
    assert.strictEqual(fromBrowser.slice(0, 2).toString('latin1'), 'PK', 'the workbook is not a zip');
    sameBytes(fromBrowser, fromCli, 'a workbook');
  });

  await test('a step that is off is left out on both sides', async () => {
    const fromBrowser = await browserBytes([aPath], 'csv', WITH_OFF_STEP);
    const fromCli = cliBytes([aPath], 'csv', WITH_OFF_STEP);
    assert.ok(fromBrowser.toString('utf8').indexOf('Ada') < 0, 'the step that is off still ran');
    sameBytes(fromBrowser, fromCli, 'a workflow with a step that is off');
  });

  await test('a workflow that cannot run fails the same way on both sides', async () => {
    const ran = await browserRun([aPath], CANNOT_RUN);
    // A step stops either because its settings do not fit the columns ("invalid") or because it
    // threw while it ran ("error"). Both mean that the workflow cannot go on.
    const bad = ran.results.filter((r) => r.status === 'error' || r.status === 'invalid')[0];
    assert.ok(bad, 'the browser side did not report a step that cannot run: ' +
      JSON.stringify(ran.results.map((r) => r.status)));
    const browserSaid = bad.error || bad.notes.map((n) => global.DL.noteText(n)).join('; ');
    const cli = cliFailure([aPath], CANNOT_RUN);
    assert.strictEqual(cli.code, 1, 'the command must answer with a failure');
    assert.ok(cli.said.indexOf(browserSaid) >= 0,
      'the two sides said different things:\n  page: ' + browserSaid + '\n  dl:   ' + cli.said);
  });

  await test('the values themselves came through, not two empty files', async () => {
    const text = (await browserBytes([aPath], 'csv', PLAIN)).toString('utf8');
    assert.match(text, /Ada/, 'the trim and the case steps did not run');
    assert.match(text, /1,234\.50/, 'the number step did not run');
    assert.match(text, /15 Jan 2024/, 'the date step did not run');
    assert.match(text, /Zoë/, 'a value outside ASCII did not survive');
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
