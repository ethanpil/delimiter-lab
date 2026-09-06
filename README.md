# Delimiter Lab

Delimiter Lab changes delimited data files step by step, without code. It runs fully in the browser. No data leaves the computer.

## Features

- Reads CSV, TSV, text files with any separator, and Excel workbooks (with sheet selection).
- Detects the encoding and the column separator automatically. You can change both.
- Builds a chain of steps. Each step reads the output of the step before it.
- Shows a preview of each step. You can download the result of any step.
- Shows a profile of a column (type, empty cells, different values, smallest and largest, most common values) when you click its name.
- Marks the cells that a step changed (the "Changes" button).
- Saves workflows in the browser and as files, so you can apply them again to new files.
- Undo and redo.
- Works with large files. The file size limit depends on the memory of the computer.

## Operations

| Group | Operations |
| --- | --- |
| Text | Change Case, Combine Columns, Split Column, Split Name, Find & Replace, Substitute Values, Pad / Trim, Extract Text, Clean Text |
| Dates | Format Dates, Date Math |
| Rows | Remove Duplicates, Filter Rows, Sort Rows, Find Outliers, Unique Values, Pivot, Unpivot |
| Columns | Rename Columns, Reorder Columns, Remove Columns, Add Column, Fill Empty Values, Calculate, Format Numbers |
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
index.html          Page shell. Loads the files from the manifest.
js/manifest.js      Version and the list of application files
css/app.css         Styles
js/engine/core.js   Table model, value parsing, field types, operation and format registries
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
3. Add a new file to the `ops` list in `js/manifest.js`.

The `params` list makes the form. Field types: `text`, `number`, `code`, `boolean`, `select`, `checkboxes`, `column`, `columns`, `columnOrder`, `renameMap`, `mapping`, `conditions`, `rules`, `sortKeys`. Each type knows how to check and repair its value. Add a type with `DL.registerParamType` in `core.js` and a renderer in `js/ui/fields.js`.

`apply(table, params)` gets a table `{ columns, cols, length }` and returns `{ table, notes }`. Use the helpers in `core.js`: `DL.col`, `DL.mapColumns`, `DL.addColumn`, `DL.selectRows`, `DL.pickColumns`, `DL.dropColumns`, `DL.groupRows`. Never change the input table.

Add `outputColumns(columns, params)` when the operation changes the columns. Return `null` when the columns are only known after the step runs. The user interface uses this to show the correct column names in the steps that follow.

## Add an input or output format

Input formats are listed in `DL.inputFormats` (`core.js`) with their file extensions and options. The worker has a reader for each format id in `readers` (`worker.js`). Output formats are listed in `DL.outputFormats` with their options. The worker has a writer for each format id in `writers`.

## Release

Change `DL.VERSION` in `js/manifest.js`, and the two `?v=` values in `index.html` (the stylesheet link and the manifest tag). Browsers then load the new files.

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
