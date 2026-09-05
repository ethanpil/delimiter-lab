# Delimiter Lab as a library and a standalone tool

This document describes how other applications can use Delimiter Lab workflows to transform files.

## Goal

An application lets a user upload a source file. The application applies a Delimiter Lab workflow file to it and uses the result. The workflow is made once in the visual editor and applied many times, in the browser, on a server, or from a command line.

## What exists today

The engine is already separate from the user interface:

| Layer | Files | Depends on |
| --- | --- | --- |
| Engine | `js/engine/core.js`, `js/ops/*.js` | Nothing (pure JavaScript, runs in browsers and in Node) |
| Readers and writers | `js/engine/worker.js` | PapaParse (CSV), SheetJS (Excel), the browser `FileReaderSync` |
| User interface | `js/app/*.js`, `js/ui/*.js`, `js/main.js` | Bootstrap, the DOM |

The engine has no DOM code. The tests in `test/engine.test.js` run it in Node. The workflow file format (`delimiter-lab-workflow`, version 1) is JSON with the steps, their settings, the expected input columns and the source options.

## Target shape

```
@delimiterlab/engine   table model, operations, workflow validation, runWorkflow()      (browser, Node, Deno, Bun)
@delimiterlab/io       readers and writers with a byte-source interface                (browser: Blob; Node: fs)
delimiterlab (CLI)     run, validate, describe; packaged as a single binary             (Node single executable)
@delimiterlab/ui       optional embeddable editor and "apply a workflow" widget         (browser)
```

### 1. Engine package

- Build the engine files into one ESM module and one UMD file with esbuild. The web app keeps loading the source files.
- Add `DL.runWorkflow(table, workflow, options)` to the core. It validates each step against the real input columns, runs the steps in order, and gives `{ table, results }`. The worker uses the same function without its cache.
- Publish a JSON Schema for the workflow file. Keep the format version in the file. Add a migration hook per operation for future setting changes.
- Make behaviour deterministic across environments: a fixed collator locale in the workflow (default `en`), an explicit day-first option for dates, and no dependence on the machine locale in text case changes.

### 2. IO package

- Define a byte source: `{ size, readSlice(offset, length) }`. The browser implements it with `Blob.slice`; Node implements it with `fs.read`.
- Move the delimited reader (streaming decoder, PapaParse stream, table builder) and the Excel reader out of the worker into this package. The worker calls the package with the Blob source.
- Writers give chunks (for streaming to a file or an HTTP response) instead of one Blob.

### 3. Command line tool

```
delimiterlab run workflow.json input.csv --out output.csv --format csv
delimiterlab run workflow.json input.xlsx --sheet Orders --format json
delimiterlab validate workflow.json --columns "Full Name,Email,Amount"
delimiterlab describe workflow.json
```

- Exit code 0 on success, 1 when a step cannot run, 2 for a bad file. Notes and problems go to a JSON report (`--report report.json`) so the calling application can show them.
- Package with the Node single-executable feature (`--experimental-sea-config`) or Bun (`bun build --compile`). This gives one file for Windows, macOS and Linux. Applications in any language call it as a subprocess.
- Custom JavaScript steps run in an isolated context with a time limit. A `--no-js` flag refuses workflows that contain them.

### 4. Embeddable interface

- `DelimiterLab.mount(element, { file, workflow, onResult })` shows the editor inside another page.
- `DelimiterLab.apply(element, { workflows, onResult })` shows only "choose a file, choose a workflow, apply" and hands the result table or Blob to the application instead of a download.
- Both use the same engine and worker as the app.

### 5. Server use

- The engine runs in Node behind an HTTP endpoint. Tables live in memory, so enforce a size limit per request.
- Row-local operations (case, replace, calculate, verify) can stream in blocks. Sort, dedupe, unique and outliers need the full table. A "streaming mode" can run the row-local prefix of a workflow in blocks and only hold the rest in memory.

## Other languages

Two ways exist for applications that do not run JavaScript:

1. Call the binary as a subprocess (available after step 3, no extra work).
2. Port the engine to Rust with a C ABI and bindings for Python, Go and .NET, with the same workflow JSON and the same golden tests. This doubles the maintenance work, so do it only when in-process use without a JavaScript runtime is required.

## Tests

Golden tests: sample input files and workflows with expected outputs. The same tests run in the browser (through the worker) and in the CLI, so both give the same output for the same workflow.

## Order of work

1. Engine package with `runWorkflow` and the JSON Schema.
2. IO package with the byte-source interface; the worker uses it.
3. CLI and binary.
4. Embeddable interface.
5. Server mode and streaming, when needed.
