/* dl - run a Delimiter Lab workflow on files, from a terminal.
 *
 * The engine here is the same engine that the page runs. This file only reads the arguments,
 * hands the files and the workflow to the engine, and writes what comes back.
 */
import { DL } from '@engine';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openFile, installPlatform, NodeFile } from './platform.js';

const NAME = 'dl';

interface Args {
  workflow: string | null;
  inputs: string[];
  output: string | null;
  format: string | null;
  dryRun: boolean;
  validate: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
}

const USAGE = [
  'Usage: ' + NAME + ' <workflow.json> <input file...> [options]',
  '',
  'Runs the steps of a workflow on one or more files.',
  '',
  'Options:',
  '  -o, --output <file>   Write the result to this file. Without it the result goes to',
  '                        standard output, so it can go into another command.',
  '      --format <id>     Output format: csv, tsv, delimited, xlsx or json. Without it the',
  '                        format comes from the name of the output file, or csv.',
  '      --dry-run         Run every step but write nothing. Says what the result would hold.',
  '      --validate        Check the workflow and the files, then stop. Runs no step.',
  '  -q, --quiet           Say nothing on standard error except errors.',
  '  -h, --help            Show this text.',
  '  -v, --version         Show the version.',
  '      --                Everything after this is a file name, even when it starts with -.',
  '',
  'More than one input file is read as one Data Source, one file after the other, with the',
  'settings that the workflow holds. The columns go by name.',
  '',
  'Examples:',
  '  ' + NAME + ' clean.json sales.csv -o clean.csv',
  '  ' + NAME + ' clean.json sales.csv > clean.csv',
  '  ' + NAME + ' clean.json jan.csv feb.csv mar.csv -o q1.csv',
  '  ' + NAME + ' clean.json sales.csv --dry-run',
  '  ' + NAME + ' clean.json sales.csv --validate'
].join('\n');

// The value that follows an option. It must be there, and it must not be another option: -o
// --quiet would else make a file named "--quiet", and --output= with nothing after it would send
// the answer to the screen and say that the work was done.
function value(given: string | undefined, option: string, what: string): string {
  if (!given || (given.charAt(0) === '-' && given.length > 1)) throw new Error(option + ' needs ' + what + '.');
  return given;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    workflow: null, inputs: [], output: null, format: null,
    dryRun: false, validate: false, quiet: false, help: false, version: false
  };
  let onlyFiles = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (onlyFiles) { if (!a.workflow) a.workflow = arg; else a.inputs.push(arg); continue; }
    if (arg === '--') { onlyFiles = true; continue; }
    if (arg === '-h' || arg === '--help') { a.help = true; continue; }
    if (arg === '-v' || arg === '--version') { a.version = true; continue; }
    if (arg === '-q' || arg === '--quiet') { a.quiet = true; continue; }
    if (arg === '--dry-run') { a.dryRun = true; continue; }
    if (arg === '--validate') { a.validate = true; continue; }
    if (arg === '-o' || arg === '--output') { a.output = value(argv[++i], '--output', 'a file name'); continue; }
    if (arg.indexOf('--output=') === 0) { a.output = value(arg.slice(9), '--output', 'a file name'); continue; }
    if (arg === '--format') { a.format = value(argv[++i], '--format', 'a name'); continue; }
    if (arg.indexOf('--format=') === 0) { a.format = value(arg.slice(9), '--format', 'a name'); continue; }
    if (arg.charAt(0) === '-' && arg.length > 1) throw new Error('Unknown option "' + arg + '". Try ' + NAME + ' --help.');
    if (!a.workflow) a.workflow = arg;
    else a.inputs.push(arg);
  }
  return a;
}

// The output format: what --format says, else what the name of the output file says, else CSV.
function formatFor(a: Args) {
  if (a.format) {
    const found = DL.outputFormatById(a.format);
    if (!found) {
      const names = DL.outputFormats.map(function (f: any) { return f.id; }).join(', ');
      throw new Error('Unknown format "' + a.format + '". The formats are: ' + names + '.');
    }
    return found;
  }
  if (a.output) {
    const ext = path.extname(a.output).toLowerCase();
    const byExt = DL.outputFormats.filter(function (f: any) { return f.extension === ext; })[0];
    if (byExt) return byExt;
  }
  return DL.outputFormatById('csv');
}

function fail(message: string): never {
  process.stderr.write(NAME + ': ' + message + '\n');
  process.exit(1);
}

export async function main(argv: string[]): Promise<void> {
  let a: Args;
  try { a = parseArgs(argv); } catch (e: any) { return fail(e.message); }

  if (a.help) { process.stdout.write(USAGE + '\n'); return; }
  if (a.version) { process.stdout.write(DL.VERSION + '\n'); return; }
  if (!a.workflow) { process.stderr.write(USAGE + '\n'); process.exit(1); }
  if (!a.inputs.length) return fail('Name at least one input file.');

  const say = (text: string) => { if (!a.quiet) process.stderr.write(text + '\n'); };
  installPlatform();

  // ---- the workflow ----
  let workflow: any;
  let text: string;
  try {
    text = fs.readFileSync(a.workflow, 'utf8');
  } catch (e: any) {
    return fail('The workflow file "' + a.workflow + '" could not be read: ' + e.message);
  }
  try {
    // A Windows editor puts a byte order mark at the head of a file. JSON has no place for it.
    workflow = DL.parseWorkflow(text.replace(/^\ufeff/, ''));
  } catch (e: any) {
    return fail('The workflow file "' + a.workflow + '" is not right: ' + e.message);
  }

  // ---- the files ----
  const files: NodeFile[] = [];
  for (const name of a.inputs) {
    if (!fs.existsSync(name)) return fail('The file "' + name + '" is not there.');
    if (fs.statSync(name).isDirectory()) return fail('"' + name + '" is a directory, not a file.');
    try { files.push(openFile(name)); }
    catch (e: any) { return fail('The file "' + name + '" could not be read: ' + e.message); }
  }

  // The settings of the workflow read every file. More than one file is one source, one file
  // after the other, which is what one output asks for.
  const options = DL.cleanSourceOptions(workflow.sourceOptions || {});
  if (files.length > 1) options.multiFile = 'stack';

  let format: any;
  try { format = formatFor(a); } catch (e: any) { return fail(e.message); }

  // ---- read ----
  let source: any;
  try {
    source = DL.readSource(files, options);
  } catch (e: any) {
    return fail(e.message);
  }
  say('Read ' + DL.pluralize(source.info.rowCount, 'row') + ' and ' +
    DL.pluralize(source.info.columns.length, 'column') + ' from ' + DL.pluralize(files.length, 'file') + '.');
  source.info.notes.forEach(function (n: any) { say('  note: ' + DL.noteText(n)); });

  const steps = DL.workerSteps(workflow.steps);

  // ---- validate: check the settings against the real columns, then stop ----
  if (a.validate) {
    if (a.output) say('--output does nothing with --validate: no step runs and nothing is written.');
    let columns = source.table.columns;
    let problems = 0;
    let unknownAfter = -1;   // the step whose columns cannot be known before it runs
    steps.forEach(function (step: any, i: number) {
      if (step.skip) { say('Step ' + (i + 1) + ' (' + step.opId + '): off'); return; }
      // With no columns the engine checks the settings alone, so such a step must not say "ok".
      const found = DL.validateParams(step.opId, step.params, columns);
      if (found.length) {
        problems++;
        process.stderr.write('Step ' + (i + 1) + ' (' + step.opId + '): ' + found.map(DL.noteText).join('; ') + '\n');
        columns = null;
      } else if (!columns) {
        say('Step ' + (i + 1) + ' (' + step.opId + '): the settings are right, but its columns are not known');
      } else {
        say('Step ' + (i + 1) + ' (' + step.opId + '): ok');
        columns = DL.predictColumns(step.opId, step.params, columns);
        if (!columns && unknownAfter < 0) unknownAfter = i + 1;
      }
    });
    if (problems) return fail(DL.pluralize(problems, 'step') + ' cannot run with these files.');
    if (unknownAfter >= 0) {
      say('The settings of every step are right. Step ' + unknownAfter + ' makes columns that are ' +
        'only known when it runs, so the columns of the steps after it were not checked.');
      return;
    }
    say('The workflow can run on these files.');
    return;
  }

  // ---- run ----
  const run = DL.runWorkflow(source.table, steps);
  run.results.forEach(function (r: any, i: number) {
    r.notes.forEach(function (n: any) { say('Step ' + (i + 1) + ' (' + r.opId + '): ' + DL.noteText(n)); });
  });
  if (!run.table) {
    const bad = run.results[run.failedAt];
    return fail('Step ' + (run.failedAt + 1) + ' (' + bad.opId + ') did not run: ' +
      (bad.error || bad.notes.map(DL.noteText).join('; ')));
  }

  const rows = DL.pluralize(run.table.length, 'row');
  const cols = DL.pluralize(run.table.columns.length, 'column');

  // ---- dry run: everything but the writing ----
  if (a.dryRun) {
    if (a.output) say('--output does nothing with --dry-run: nothing is written.');
    say('The result would hold ' + rows + ' and ' + cols + ': ' + run.table.columns.join(', ') + '.');
    say('Nothing was written.');
    return;
  }

  // ---- write ----
  const outOptions = Object.assign(DL.defaultFormatOptions(format), { format: format.id });
  const written = DL.writeBytes(run.table, outOptions);
  const bytes = Buffer.concat(written.chunks.map(function (c: any) { return Buffer.from(c); }));
  if (a.output) {
    try { fs.writeFileSync(a.output, bytes); }
    catch (e: any) { return fail('The result could not be written to "' + a.output + '": ' + e.message); }
    say('Wrote ' + rows + ' and ' + cols + ' to ' + a.output + '.');
  } else {
    process.stdout.write(bytes);
  }
}
