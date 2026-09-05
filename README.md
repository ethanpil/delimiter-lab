# Delimiter Lab

Delimiter Lab changes delimited data files step by step, without code. It runs fully in the browser. No data leaves the computer.

## Features

- Reads CSV, TSV, text files with any separator, and Excel workbooks (with sheet selection).
- Detects the encoding and the column separator automatically. You can change both.
- Builds a chain of steps. Each step reads the output of the step before it.
- Shows a preview of each step. You can download the result of any step.
- Saves workflows in the browser and as files, so you can apply them again to new files.
- Undo and redo.
- Works with large files. The file size limit depends on the memory of the computer.

## Operations

| Group | Operations |
| --- | --- |
| Text | Change Case, Combine Columns, Split Column, Split Name, Find & Replace, Substitute Values, Pad / Trim |
| Rows | Remove Duplicates, Filter Rows, Sort Rows, Find Outliers, Unique Values |
| Columns | Rename Columns, Reorder Columns, Remove Columns, Add Column, Calculate, Format Numbers |
| Quality | Verify Values |
| Advanced | Custom JavaScript |

## Run

Delimiter Lab is a static site. Open `index.html` from a web server. Example:

```bash
python -m http.server 8765
```

Then open `http://localhost:8765` in a modern browser (Chrome, Edge, Firefox or Safari).

Note: The Web Worker needs a web server. Most browsers do not start workers from `file://` addresses.

## Test

Run the engine tests:

```bash
node test/engine.test.js
```

Make the test data files (the last argument is the number of rows in the large file):

```bash
node test/make-data.js 300000
```

Run the benchmark:

```bash
node test/bench.js 1200000
```

## Structure

```
index.html          Page shell
css/app.css         Styles
js/engine/core.js   Table model, value parsing, operation registry
js/engine/worker.js Web Worker: reads files, runs the chain, makes downloads
js/ops/*.js         Operations (one file per group)
js/app/*.js         State store, worker client, saved workflows, helpers
js/ui/*.js          Views: steps list, source panel, step form, data grid, dialogs
js/main.js          Application controller
vendor/             Bootstrap, Bootstrap Icons, PapaParse, SheetJS
test/               Tests, benchmark and test data
```

## Add an operation

1. Make a new file in `js/ops/` or add to an existing file.
2. Call `DL.registerOp` with an `id`, `name`, `category`, `icon`, `description`, `params` and `apply`.
3. Add the file to `index.html` and to the `importScripts` call in `js/engine/worker.js`.

The `params` list makes the form. Field types: `text`, `number`, `textarea`, `code`, `boolean`, `select`, `checkboxes`, `column`, `columns`, `columnOrder`, `renameMap`, `mapping`, `conditions`, `rules`, `sortKeys`.

`apply(table, params)` gets a table `{ columns, cols, length }` and returns `{ table, notes }`. Use the helpers in `core.js`: `DL.col`, `DL.mapColumns`, `DL.addColumn`, `DL.selectRows`, `DL.pickColumns`, `DL.dropColumns`. Never change the input table.

Add `outputColumns(columns, params)` when the operation changes the columns. The user interface uses it to show the correct column names in the steps that follow.

## Workflow files

Saved workflows are JSON files with this shape:

```json
{
  "format": "delimiter-lab-workflow",
  "version": 1,
  "name": "Clean contacts",
  "columns": ["Full Name", "Email"],
  "steps": [
    { "opId": "case", "params": { "columns": ["Email"], "mode": "lower" }, "enabled": true }
  ]
}
```

## License

MIT
