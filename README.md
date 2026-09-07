# Delimiter Lab

Delimiter Lab changes delimited data files step by step, without code. It runs fully in the browser. No data leaves the computer.

Use it here: **https://ethanpil.github.io/delimiter-lab/**

## Features

- Reads CSV, TSV, text files with any separator, and Excel workbooks (with sheet selection).
- Detects the encoding and the column separator automatically. You can change both.
- Reads the numbers of a file by the separator that file uses. A file that writes 1.234,56 gives 1000 for 1.000, and a file that writes 1,234.56 gives 1. The reader says when it finds a comma file.
- Builds a chain of steps. Each step reads the output of the step before it.
- Shows a preview of each step. You can download the result of any step.
- Shows a profile of a column (type, empty cells, different values, smallest and largest, most common values) when you click its name.
- Marks the cells that a step changed (the "Changes" button). The marks follow moved rows and renamed columns.
- Shows the rows that failed a Verify rule when you click the rule in the result.
- Saves workflows in the browser and as files, so you can apply them again to new files. Autosave writes each change of the steps to the open workflow.
- Runs a saved workflow on a file from the workflow list, and downloads the result. You do not need to build the steps again.
- Reads many files as one Data Source. Put "Many files" at stack, then add files at any time. The columns go by name, and a column that a file does not have is empty for the rows of that file.
- Keeps the workspace in the browser. After a reload, or after the power goes off, the steps are there again, and the file too when it is smaller than 100 MB.
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

The page runs with no build. A change to the engine needs one, because the page and the worker load
`dist/engine.global.js`, which the build makes from `packages/engine/src`. See "Build and test".

## The dl command

The same engine runs on a terminal. `dl` takes a workflow file and one or more data files, runs the
steps, and writes the result.

```
dl workflow.json input.csv -o out.csv        # write a file
dl workflow.json input.csv                   # write to standard output
dl workflow.json jan.csv feb.csv -o q1.csv   # many files, one source
dl workflow.json input.csv --dry-run         # run every step, write nothing
dl workflow.json input.csv --validate        # check the workflow against the files
```

| Option | What it does |
| --- | --- |
| `-o`, `--output <file>` | Write here. Without it the result goes to standard output. |
| `--format <id>` | `csv`, `tsv`, `delimited`, `xlsx` or `json`. Without it the format comes from the name of the output file, or `csv`. |
| `--dry-run` | Run every step and write nothing. Says what the result would hold. |
| `--validate` | Check the settings of each step against the columns that the files really have, then stop. |
| `--allow-code` | Let a Custom JavaScript step run. Such a step is code from the workflow file, and it runs with the rights of this command. Without this the command refuses such a workflow. |
| `-q`, `--quiet` | Say nothing except errors. |
| `-h`, `--help` | Show the options. |
| `-v`, `--version` | Show the version. |
| `--` | Everything after this is a file name, even when it starts with `-`. |

`--output=<file>` and `--format=<id>` say the same as `-o <file>` and `--format <id>`.

Everything that `dl` says about its work goes to standard error, so a pipe carries only data. It
answers 0 when the work is done and 1 when it is not.

The command writes with the default settings of the format: a byte order mark, CRLF line endings,
and a semicolon for `delimited`. A workflow file does not hold the settings of the Download dialog,
so the page and the command give the same bytes at those defaults and not at others.

More than one input file is read as one Data Source, one file after the other, with the settings
that the workflow holds. Columns go by name.

A workflow file comes from the page: open Workflows and use Export.

Binaries for Linux, macOS and Windows, with packages for Debian, Red Hat and Alpine, are on the
[releases page](https://github.com/ethanpil/delimiter-lab/releases). Each release says how to
install them.

## Build and test

The engine is TypeScript in `packages/engine/src`. The page, the worker and the `dl` command all
read what the build makes, so start with:

```bash
npm install
```

```bash
npm run build
```

The build writes `dist/engine.global.js`, which the page and the worker load; `dist/engine.mjs` for
a program that takes the engine as a module; and `dist/dl.mjs`, the `dl` command. Only
`dist/engine.global.js` is in the repository, because GitHub Pages serves the files as they are and
has no build step. A change that leaves it behind stops the check on GitHub.

Run every test:

```bash
npm test
```

That builds first and then runs four sets: the engine tests, the worker tests, the tests of the
build, and the parity tests. The parity tests run one workflow through the worker of the page and
through the `dl` command and compare the bytes, so the page and the command cannot drift apart.

Check the types:

```bash
npm run typecheck
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
index.html                       Page shell. Loads the files from the manifest.
js/manifest.js                   Version and the list of application files
css/app.css                      Styles
packages/engine/src/core.ts      Table model, value parsing, field types, operation and format registries
packages/engine/src/io.ts        Readers, writers and the zip
packages/engine/src/run.ts       One step, and a chain of steps
packages/engine/src/workflow.ts  The workflow file format
packages/engine/src/ops/*.ts     Operations (text, rows, columns, dates, reshape, verify)
packages/cli/src/*.ts            The dl command, and what Node gives the engine
scripts/build.mjs                The build: makes dist/ from packages/
dist/engine.global.js            The build that the page and the worker load as self.DL
js/engine/worker.js              Web Worker: the messages of the page, the cache and the slices. It
                                 calls the engine to read, to run and to write.
js/app/*.js                      State store, worker client, saved workflows, texts, helpers
js/i18n/*.js                     Texts of the user interface, one file per language
js/ui/*.js                       Views: steps list, source panel, step form, data grid, dialogs, timing panel
js/main.js                       Application controller
vendor/                          Bootstrap, Bootstrap Icons, PapaParse, SheetJS
test/                            Tests, benchmark and test data
packaging/                       The description that makes the deb, the rpm and the apk
.github/                         The checks on a push, and the build of a release
docs/                            Notes on the design
CONTEXT.md                       The design, the conventions and the pitfalls
```

## Add an operation

1. Make a new file in `packages/engine/src/ops/` or add to an existing file. A new file goes into the list in `packages/engine/src/index.ts`.
2. Call `DL.registerOp` with an `id`, `name`, `category`, `icon`, `description`, `params` and `apply`.
3. Run `npm run build`. The page, the worker and the `dl` command all read the build.

The `params` list makes the form. The field types are `text`, `number`, `code`, `boolean`, `select`, `checkboxes`, `column`, `columns`, `columnOrder`, `renameMap`, `mapping`, `conditions`, `rules` and `sortKeys`. Each type checks and repairs its value. To add a type, register it with `DL.registerParamType` in `packages/engine/src/core.ts`. Then add a renderer for it in `js/ui/fields.js`.

`apply(table, params)` gets a table `{ columns, cols, length }` and returns `{ table, notes }`. Use the helpers in `core.ts`: `DL.col`, `DL.mapColumns`, `DL.addColumn`, `DL.selectRows`, `DL.pickColumns`, `DL.dropColumns`, `DL.groupRows`. Never change the input table.

Add `outputColumns(columns, params)` when the operation changes the columns. Return `null` when the step must run before the columns are known. The user interface uses this to show the correct column names in the steps that follow.

Set `category` to one of Text, Dates, Rows, Columns, Quality, Advanced or Other. The operation picker lists the groups in this order (`CATEGORY_ORDER` in `js/ui/dialogs.js`). A group that is not in the list goes last.

An operation that makes a large result must compare the cell count with `DL.maxCells`. When the result is too large, throw an error with a clear message. An operation that uses the date of today must give `hashExtra(params)` with the date. The cached result then changes with the day.

A result note can be an object `{ text, rows }` instead of a text. The user can then click the note to see the rows it is about. Add `findRows(inputTable, params, rows, limit)` to the operation. It gives `{ matches: [[row, column], ...], total }` for the output table, or `{ removed: true }` when the rows are not in the output.

## Add an input or output format

`DL.inputFormats` (`core.ts`) lists the input formats with their file extensions and options. `DL.outputFormats` lists the output formats with their options. The engine has a reader and a writer for each format id, in `readers` and `writers` (`packages/engine/src/io.ts`). Both the page and the `dl` command use them, so a format that you add is there on every platform. Run `npm run build` after the change.

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

Change `DL.VERSION` in `js/manifest.js` and run `npm run build`, so that the page and the engine
carry the same number. Close the changelog section with the hashes. Then push a tag with the same
number and a `v` in front:

```bash
git tag v1.0 && git push origin v1.0
```

The tag starts the release build. It stops when the tag and `js/manifest.js` do not agree. It builds
the `dl` command for Linux, macOS and Windows, makes the deb, the rpm and the apk for both chips,
writes the checksums, and puts everything on the releases page with the instructions to install it.

Every file that the manifest lists carries `?v=` with the version, so a browser takes the new one.
`js/manifest.js` and `css/app.css` load before that version exists, so `index.html` asks for them
with the number written by hand. `npm test` fails when that number and `DL.VERSION` disagree, so
change all three together. `index.html` itself carries no version: a browser takes it again when
its copy is old enough, which on GitHub Pages is ten minutes.

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
