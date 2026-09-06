# Delimiter Lab

Delimiter Lab changes delimited data files step by step, without code. It runs fully in the browser. No data leaves the computer.

Use it here: **https://ethanpil.github.io/delimiter-lab/**

## Features

- Reads CSV, TSV, text files with any separator, and Excel workbooks (with sheet selection).
- Detects the encoding and the column separator automatically. You can change both.
- Builds a chain of steps. Each step reads the output of the step before it.
- Shows a preview of each step. You can download the result of any step.
- Shows a profile of a column (type, empty cells, different values, smallest and largest, most common values) when you click its name.
- Marks the cells that a step changed (the "Changes" button). The marks follow moved rows and renamed columns.
- Shows the rows that failed a Verify rule when you click the rule in the result.
- Saves workflows in the browser and as files, so you can apply them again to new files. Autosave writes each change of the steps to the open workflow.
- Runs a saved workflow on a file from the workflow list, and downloads the result. You do not need to build the steps again.
- Applies the steps to many files at once. Drop the files and choose the output format. The result is a zip file.
- Undo and redo of every change to the steps.
- Shows a light or a dark theme. The theme follows the system setting until you change it.
- A timing panel shows the time of each step and the memory that the results hold.
- You can translate the user interface (see "Add a language").
- A Cancel button stops a slow run before its next step. The steps that ran keep their results.
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

Delimiter Lab is a static site. The published copy runs at https://ethanpil.github.io/delimiter-lab/. To run your own copy, open `index.html` from a web server. Example:

```bash
python -m http.server 8765
```

Then open `http://localhost:8765` in a modern browser (Chrome, Edge, Firefox or Safari).

Note: The Web Worker needs a web server. Most browsers do not start workers from `file://` addresses.

## Test

Run the engine tests and the worker tests:

```bash
node test/engine.test.js
```

```bash
node test/worker.test.js
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

Read `CONTEXT.md` before you change the code. It explains the design, the conventions, the lessons learned and the pitfalls.

```
index.html          Page shell. Loads the files from the manifest.
js/manifest.js      Version and the list of application files
css/app.css         Styles
js/engine/core.js   Table model, value parsing, field types, operation and format registries
js/engine/worker.js Web Worker: reads files, runs the chain, makes downloads
js/ops/*.js         Operations (text, rows, columns, dates, reshape, verify)
js/app/*.js         State store, worker client, saved workflows, texts, helpers
js/i18n/*.js        Texts of the user interface, one file per language
js/ui/*.js          Views: steps list, source panel, step form, data grid, dialogs, timing panel
js/main.js          Application controller
vendor/             Bootstrap, Bootstrap Icons, PapaParse, SheetJS
test/               Tests, benchmark and test data
```

## Add an operation

1. Make a new file in `js/ops/` or add to an existing file.
2. Call `DL.registerOp` with an `id`, `name`, `category`, `icon`, `description`, `params` and `apply`.
3. Add a new file to the `ops` list in `js/manifest.js`.

The `params` list makes the form. The field types are `text`, `number`, `code`, `boolean`, `select`, `checkboxes`, `column`, `columns`, `columnOrder`, `renameMap`, `mapping`, `conditions`, `rules` and `sortKeys`. Each type checks and repairs its value. To add a type, register it with `DL.registerParamType` in `core.js`. Then add a renderer for it in `js/ui/fields.js`.

`apply(table, params)` gets a table `{ columns, cols, length }` and returns `{ table, notes }`. Use the helpers in `core.js`: `DL.col`, `DL.mapColumns`, `DL.addColumn`, `DL.selectRows`, `DL.pickColumns`, `DL.dropColumns`, `DL.groupRows`. Never change the input table.

Add `outputColumns(columns, params)` when the operation changes the columns. Return `null` when the step must run before the columns are known. The user interface uses this to show the correct column names in the steps that follow.

Set `category` to one of Text, Dates, Rows, Columns, Quality, Advanced or Other. The operation picker lists the groups in this order (`CATEGORY_ORDER` in `js/ui/dialogs.js`). A group that is not in the list goes last.

An operation that makes a large result must compare the cell count with `DL.maxCells`. When the result is too large, throw an error with a clear message. An operation that uses the date of today must give `hashExtra(params)` with the date. The cached result then changes with the day.

A result note can be an object `{ text, rows }` instead of a text. The user can then click the note to see the rows it is about. Add `findRows(inputTable, params, rows, limit)` to the operation. It gives `{ matches: [[row, column], ...], total }` for the output table, or `{ removed: true }` when the rows are not in the output.

## Add an input or output format

`DL.inputFormats` (`core.js`) lists the input formats with their file extensions and options. The worker has a reader for each format id in `readers` (`worker.js`). `DL.outputFormats` lists the output formats with their options. The worker has a writer for each format id in `writers`.

## Add a language

The texts of the user interface are in `js/i18n/en.js`. To add a language:

1. Copy `js/i18n/en.js` to `js/i18n/xx.js`, where `xx` is the two-letter language code.
2. Change `'en'` in `DL.registerLocale('en', ...)` to `'xx'`.
3. Translate the texts. Keep the `{placeholders}`. A key that you leave out shows the English text.
4. Add `'xx'` to `DL.LOCALES` in `js/manifest.js`.

The page uses the language of the browser. Add `?lang=xx` to the address to force a language.

These texts stay in English, because they come from the engine and the data layer, which the worker also loads:

- The names, the settings and the result notes of the operations.
- The status labels of the steps.
- The plural words in counts, for example "3 rows".
- The relative times in the workflow list.
- The notes and the errors of file reading, and the errors of workflow files.

## Release

Change `DL.VERSION` in `js/manifest.js`. Then change the two `?v=` values in `index.html` (the stylesheet link and the manifest tag). Browsers then load the new files.

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
