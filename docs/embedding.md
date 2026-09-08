# Delimiter Lab as a library and a standalone tool

This document describes how other applications can use Delimiter Lab workflows to transform files.

## Goal

An application lets a user upload a source file. The application applies a Delimiter Lab workflow file to it and uses the result. A user makes the workflow once in the visual editor and applies it many times: in the browser, on a server, or from a command line.

## What exists today

The engine is already separate from the user interface:

| Layer | Files | Depends on |
| --- | --- | --- |
| Engine | `packages/engine/src/` (TypeScript), built to `dist/engine.global.js` and `dist/engine.mjs` | Nothing (runs in browsers and in Node) |
| Readers and writers | `packages/engine/src/io.ts` | PapaParse (CSV), SheetJS (Excel), the browser `FileReaderSync` |
| User interface | `js/app/*.js`, `js/i18n/*.js`, `js/ui/*.js`, `js/main.js` | Bootstrap, the DOM |

The engine has no DOM code. The tests in `test/engine.test.js` run it in Node. The workflow file format (`delimiter-lab-workflow`, version 1) is JSON with the steps, their settings, the expected input columns and the source options.

## Target shape

```
@delimiterlab/engine   table model, operations, workflow validation, runWorkflow()      (browser, Node, Deno, Bun)
@delimiterlab/io       readers and writers with a byte-source interface                (browser: Blob; Node: fs)
delimiterlab (CLI)     run, validate, describe; packaged as a single binary             (Node single executable)
@delimiterlab/ui       optional embeddable editor and "apply a workflow" widget         (browser)
```

### 1. Engine package

- Done: the engine is TypeScript in `packages/engine/src`, and `scripts/build.mjs` builds it to one IIFE file for the page and one ESM file for Node. The page loads the build, not the source.
- Done: `DL.runWorkflow(table, steps)` runs the steps in order and gives `{ table, results, failedAt }`. `DL.runStep(step, upstream)` runs one. The worker calls `DL.runStep` behind its cache; the `dl` command calls `DL.runWorkflow`.
- Done: `DL.parseWorkflow`, `DL.normalizeStep` and `DL.workflowToJSON` hold the workflow file format, so the page and the command read a workflow the same way.
- Publish a JSON Schema for the workflow file. Keep the format version in the file. Add a migration hook per operation for future setting changes.
- Done: the collator has the fixed name `en`, so a sort gives one order on every machine. `test/parity.test.js` compares the bytes of the page and of the command for the same workflow.
- Done: the day-first answer is one setting, `DL.DAY_FIRST`, on Format Dates, Date Math, Sort and Filter.
- Publish a JSON Schema for the workflow file.

### 2. IO package

- Define a byte source: `{ size, readSlice(offset, length) }`. The browser implements it with `Blob.slice`; Node implements it with `fs.read`.
- Done: the readers and the writers are in `packages/engine/src/io.ts`, not in the worker. `DL.platform` holds the few things that only a browser or only Node can do: `readBuffer`, `papa`, `xlsx`, `progress` and `scope`.
- Done: the writers give chunks with `DL.writeBytes`, so a caller can stream them to a file or to an answer. The worker makes a Blob from the chunks; the command writes them to a file or to standard output.
- Define a byte source that reads in slices on both platforms. Today the command reads the whole file into memory, while the page reads a Blob in slices.

### 3. Command line tool

Built. The command is `dl`, and it takes no subcommand:

```
dl workflow.json input.csv -o out.csv        # write a file
dl workflow.json input.csv                   # write to standard output
dl workflow.json jan.csv feb.csv -o q1.csv   # many files, one source
dl workflow.json input.csv --dry-run         # run every step, write nothing
dl workflow.json input.csv --validate        # check the workflow against the files
```

- The exit code is 0 when the work is done and 1 when it is not. Everything the command says goes to standard error, so a pipe carries only data.
- `bun build --compile` makes one file for Linux, macOS and Windows. `.github/workflows/release.yml` builds them, one file for each Mac chip, and makes a deb, an rpm and an apk. A program in any language calls the command as a subprocess.
- Done: the command refuses a workflow with a Custom JavaScript step, and --allow-code lets one run.
- Still open: a JSON report for the notes and the problems.

### 4. Embeddable interface

- `DelimiterLab.mount(element, { file, workflow, onResult })` shows the editor inside another page.
- `DelimiterLab.apply(element, { workflows, onResult })` shows only "choose a file, choose a workflow, apply" and gives the result table or Blob to the application instead of a download.
- Both use the same engine and worker as the app.

### 5. Server use

- The engine runs in Node behind an HTTP endpoint. Tables stay in memory, so enforce a size limit per request.
- Row-local operations (case, replace, calculate, verify) can stream in blocks. Sort, dedupe, unique and outliers need the full table. A "streaming mode" can run the row-local prefix of a workflow in blocks and only hold the rest in memory.

## Other languages

Two ways exist for applications that do not run JavaScript:

1. Call the binary as a subprocess (available after step 3, no extra work).
2. Port the engine to Rust with a C ABI and bindings for Python, Go and .NET. Use the same workflow JSON and the same golden tests. This doubles the maintenance work. Do it only when an application needs the engine in its process without a JavaScript runtime.

## Tests

Built: `test/parity.test.js` runs one workflow over the same files through the worker of the page and through the `dl` command, and compares the bytes. It covers CSV, TSV, a workbook, a source of many files with the name of the file as a column, a step that is off, and a workflow that cannot run.

## Order of work

1. Engine package with `runWorkflow`. Built. The JSON Schema is still open.
2. Readers and writers out of the worker. Built. The byte source that reads in slices is still open.
3. CLI and binary. Built.
4. Embeddable interface.
5. Server mode and streaming, when needed.
