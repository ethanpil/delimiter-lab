# CONTEXT.md

This document is for the developers who maintain and extend Delimiter Lab. It tells you how the application is built, why it is built this way, how to change it safely, and which mistakes cost time before. Read it before the code.

## 1. What the application is

Delimiter Lab is a static web application. It reads a CSV, TSV, text or Excel file in the browser, applies a chain of steps (operations) to the data, shows a preview of each step and downloads the result. No data leaves the computer. There is no server, no build step and no package manager. The application is plain ES5 JavaScript with Bootstrap 5.3 for the user interface.

The version in `js/manifest.js` is 1.4.0. The changelog (`CHANGELOG.md`) lists the changes with the commit hashes.

## 2. How to run, test and release

| Task | Command |
| --- | --- |
| Run the application | `python -m http.server 8765` in the project folder, then open `http://localhost:8765`. The Web Worker does not start from a `file://` address. |
| Run the engine tests | `node test/engine.test.js` (73 tests) |
| Run the worker tests | `node test/worker.test.js` (15 tests; loads the real worker in Node with a fake File) |
| Make test data | `node test/make-data.js 300000` |
| Run the benchmark | `node test/bench.js 1200000` |
| Check the text keys | A script that compares every `DL.t('key')` and `data-i18n*` attribute with `js/i18n/en.js` exists in the session scratch folder; write one if it is gone. Zero missing and zero unused keys is the rule. |
| Release | Set `DL.VERSION` in `js/manifest.js` and the two `?v=` values in `index.html`. Close the changelog section. Commit "Release x.y.z". |

Run both test files before every commit. There is no test runner; each file counts its own results and sets the exit code.

## 3. Structure

```
index.html            Page shell, theme script, loader (reads the manifest, loads the files in order)
js/manifest.js        DL.VERSION, DL.LOCALES, DL.FILES (the ordered file lists)
js/engine/core.js     Pure engine: table model, parsing, formatting, param types, registries, TableBuilder
js/engine/worker.js   Web Worker: readers, chain runner with cache, slices, diff, profile, search, writers, batch, zip
js/ops/*.js           Operations by group: text, rows, columns, dates, reshape, verify
js/app/i18n.js        DL.t, DL.registerLocale, DL.setLocale, DL.applyI18n
js/i18n/en.js         Every user interface text (the only locale today)
js/app/util.js        DOM helpers, modal, toast, tooltips, debounce, file helpers
js/app/store.js       Application state, undo/redo, session persistence, events
js/app/engineClient.js  Promise wrapper around the worker messages
js/app/workflows.js   Saved workflows in localStorage, workflow file format
js/ui/*.js            Views: fields (param renderers), chain, source, config, grid, dialogs, perf
js/main.js            Controller: wires the store, the engine and the views
css/app.css           Styles with theme tokens
vendor/               Bootstrap, Bootstrap Icons, PapaParse, SheetJS (pinned copies)
test/                 Tests, benchmark, test data (big*.csv is ignored by git)
docs/embedding.md     Plan for a library and a command line tool
```

The loader in `index.html` and the worker both read `DL.FILES`. A new file must go into the manifest, or neither the page nor the worker loads it. The worker loads only `engine` and `ops`. Never call `DL.t`, the DOM or `U.*` from engine or operation code.

## 4. The data model

A table is `{ columns: string[], cols: Column[], length: number }`. Every cell is a string; an empty cell is `''`. A `Column` is a plain array of strings, or a lazy column `{ src: string[], idx: Uint32Array }` that refers to rows of another array.

- `DL.selectRows(table, indexes)` gives lazy columns and sets `table.rowMap` (output row to input row). Filter, sort, dedupe and verify use it. The Changes view reads `rowMap` to follow moved rows.
- `DL.col(table, c)` materializes a lazy column and writes the plain array back into the table. This mutation is safe for values but it changes object identity. The worker's `sameColumn` fast path and the profile memo are keyed on column objects, so they miss after a materialization. That is a cost, not a bug.
- `DL.cellGetter(table, c)` gives a function `(row) -> value` for hot loops.
- `DL.mapValues(src, n, fn, stats)` and `DL.mapColumns(...)` memoize `fn` per distinct value (limit 50,000 distinct values, then no memo). Use them for every per-cell transformation and for parsing. `fn` must depend on the value only.
- `DL.groupRows(getters, n)` is an open-addressing FNV-1a hash table in typed arrays. It gives `first[i]` (the first row of the group of row `i`), `count[first]` and `groups`. Dedupe, unique, verify unique, pivot, the text sort ranks and the profile use it.

Why: row objects caused heavy garbage collection on million-row files; `Set` and `Map` were several times slower than the typed-array hash; interning strings at load did not help because V8 charges the first hash of a fresh string anyway.

## 5. Operations

An operation is registered with `DL.registerOp(def)`. The contract is documented above `DL.registerOp` in `core.js`:

- `id`, `name`, `category` (Text, Dates, Rows, Columns, Quality, Advanced, Other), `icon`, `description`, `keywords`, `params`.
- `summary(params)` gives the short text on the step card.
- `validate(params, cols)` gives extra problems. `cols` is `null` when the input columns are not known yet. Do not treat null as an empty list.
- `outputColumns(cols, params)` predicts the columns. Return `null` when the step must run before the columns are known.
- `apply(table, params)` gives `{ table, notes, status }`. Never mutate the input table or the params. Status is `'ok'` or `'warning'`. A note is a text, or `{ text, rows }` for a note that the user can click to see rows; then also give `findRows(inputTable, params, rows, limit)`.
- `hashExtra(params)` gives text that must change the cached result, for example today's date.
- An operation that can make a very large result must compare the cell count with `DL.maxCells` and throw a clear error.

Param types (`DL.registerParamType`) are `text`, `code`, `number`, `boolean`, `select`, `checkboxes`, `column`, `columns`, `columnOrder`, `renameMap`, `mapping`, `conditions`, `rules` and `sortKeys`. Each type has `empty`, `coerce`, `validate`, `columnsUsed`, and some have `init` and `blank`. `DL.cleanParams` runs `coerce` on every field; `DL.validateParams` cleans first and skips fields whose `showIf` is false. The UI renderers live in `js/ui/fields.js`, one per type.

Helpers you should use instead of new code: `DL.newColumnName(columns, wanted, fallback)`, `DL.isBlank`, `DL.charCount` (code points), `DL.startOfDay`, `DL.localDate` (years 0 to 99 without the 1900 shift), `DL.unescapeText` (`\t`, `\n`), `DL.toNumber`, `DL.toDate(v, dayFirst)`, `DL.formatDate(ts, pattern)`, `DL.formatFixed`, `DL.formatNumber`, `DL.pluralize`, `DL.keyGetters` (normalized keys for hashing), `DL.buildRegex`, `DL.regexProblem`.

When you add an operation: add it to a file in `js/ops/`, add the file to the manifest if it is new, add a test in `test/engine.test.js` that runs it on a plain table AND on a filtered (lazy) table, add the `outputColumns` parity case in the "every op has metadata" test, update the operation count in that test, and add it to the README table. If it has a new category, add the category to `CATEGORY_ORDER` in `js/ui/dialogs.js`.

## 6. The worker

`js/engine/worker.js` runs in a Web Worker. `js/app/engineClient.js` sends messages and resolves promises by `requestId`. Message types: `config`, `sheets`, `load`, `run`, `cancel`, `slice`, `export`, `batch`, `zip`, `columnInfo`, `columnStats`, `diffSummary`, `search`, `findRows`, `memory`.

- **Readers.** The delimited reader decodes the file in 8 MB slices with one streaming `TextDecoder` and feeds PapaParse through a fake Node stream (`TextStream`). PapaParse's own file chunking corrupts multi-byte characters at chunk boundaries; do not go back to it. PapaParse guesses the line ending once, so the reader strips a stray `\r` from the last value. `checkSize` samples the file before the full read and throws `tooLarge`. The spreadsheet reader has no pre-check; SheetJS needs the whole workbook in memory.
- **Chain runner.** `runChain` runs the steps in 50 ms slices with `setTimeout(0)` between them, so a `cancel` message can arrive. While a run is active, other messages wait in `queue`. A cancel stops the run at the first step that needs computing; cached steps still pass. `state.cancelledFrom` blocks on-demand recompute of the cancelled steps until the next run.
- **Cache.** `state.cache` maps step id to an entry with a 64-bit content hash (`stepHash` of upstream hash, op id, params, `hashExtra`). `enforceBudget` frees the least recently used tables when the cache exceeds three times `DL.maxCells`; `state.pinned` (sent by the page as `protect`) and `state.recent` (the last two tables read) stay. `tableFor(stepId)` recomputes a freed step from the nearest cached upstream table.
- **Diff and profile.** `diffSummary` pairs columns by name and then by shared data (renamed columns), follows `rowMap`, and keeps its result in a `WeakMap` on the output table. `columnStats` keeps its result in a `WeakMap` keyed by the column data and the column name.
- **Writers.** CSV, TSV and custom delimited files use the own columnar writer with PapaParse's quoting rule (three times faster than `Papa.unparse`). JSON is written as text, so a column named `__proto__` survives. Excel goes through SheetJS in 20,000-row blocks and refuses cells over 32,767 characters, more than 16,384 columns and reserved sheet names.
- **Batch and zip.** `batchFile` reads one file and runs every step through `computeStep` without touching the interactive cache. `makeZip` stores the files without compression and refers to the blobs; CRC-32 runs over 8 MB slices.

The worker has no access to `DL.t`. Its notes are English by design.

## 7. The page

- **Store** (`js/app/store.js`) holds `state.workflow` (id, name, steps), `state.selectedId`, `state.results` (from the worker), `state.source` (file, options, info, status). It emits `steps`, `params`, `selection`, `source`, `sourceOptions`, `results` and `workflow`. Undo snapshots hold the workflow, the selection and the source options. Param edits within 1.5 s merge into one undo entry (`lastEditKey`). The session (steps, selection, source options, file name) is saved in `localStorage` and restored on the next visit; the file itself is not.
- **Controller** (`js/main.js`) listens to the store, runs the chain after each change (debounced 220 ms with a `runToken` so old results are dropped), refreshes the preview, and owns the progress bar. Four flags describe the progress bar: `runInFlight`, `cancelable`, `batchLabel` and `exporting`. A run, a batch, a download and a file load must not hide each other's bar or Stop timer; `runEnded` checks the others first.
- **Views** rebuild their DOM on store events. The config panel updates in place while the user types (`update` versus `render`); the source panel waits for the input to blur before it rebuilds; the chain restores the focus to the same card after a rebuild.
- **Grid** (`js/ui/grid.js`) is a virtual grid: only visible rows and columns are in the DOM, pages of rows come from the worker, and tables above 285,714 rows use a scaled scrollbar. The header click opens the column profile in a Bootstrap popover.
- **Texts.** Every user-visible text goes through `DL.t('key', vars)` with the key in `js/i18n/en.js`, or through a `data-i18n*` attribute in `index.html`. Engine texts (operation names, notes, status labels, plural words) stay English by design; the README lists them.
- **Theme.** `css/app.css` defines color tokens on `:root` and overrides them under `[data-bs-theme="dark"]`. Do not write literal colors in the CSS or in JavaScript; use a token.

## 8. Conventions

- Readme, changelog, documents, comments and commit messages are in ASD-STE100 Simplified Technical English: short sentences, active voice, one instruction per sentence, no fragments, American spelling.
- A changelog entry is one short line with the commit hash. A fix commit adds the hash of the fixed feature if the entry lacks it.
- Group logical work per commit: engine, worker, application layer, views, documents. Do not mix a feature with unrelated fixes.
- No speculative features or abstractions. A helper needs at least two callers.
- Keep the engine free of DOM, texts and browser APIs; the tests and the planned library depend on it.
- After every feature: run `/code-review medium`, fix the findings, and commit the fixes by layer.

## 9. Lessons learned

These came from measured failures. Each one changed the design.

1. **Measure before you optimize the text layer.** The first version copied rows; the columnar model with lazy selection came from a GC profile on 1.2 million rows. A `Set` of keys took 12 s where the typed-array hash takes 0.5 s.
2. **Do not intern strings at load.** V8 charges the first hash of every fresh string. Memoizing per distinct value in the operation is cheaper and more general.
3. **PapaParse chunking corrupts UTF-8.** A multi-byte character that crosses a 4 MB boundary became two replacement characters. The streaming decoder plus the fake stream fixed it. A test with a small slice size (`SLICE_OVERRIDE` in `test/worker.test.js`) guards it.
4. **The worker must validate against the real columns.** The page predicts columns from `outputColumns`; the prediction can be null or wrong. The worker's result is the truth; the page's validation is only for quick feedback.
5. **Cached results must not outlive their inputs.** Content hashes keyed on the upstream hash were needed after stale results showed for fixed steps. Anything that changes the output must be in the hash (`hashExtra` for "today").
6. **Cooperative cancel needs slices.** A synchronous chain cannot be cancelled. The 50 ms slice loop plus the message queue gave a Cancel button without a worker restart. Stop (terminate and reload) is the last resort and it costs a reload.
7. **Every layer that reads a table must follow row moves.** The first Changes view compared rows by position and marked every cell after a sort. `rowMap` on lazy tables solved it; a new row-selecting operation must keep using `DL.selectRows`.
8. **Number and date parsing needs negative tests.** "1e400", "1,234,56", "1.5.3", "5 March" and "13:04 PM" all parsed as valid before the whole-codebase review. Every parser change needs cases that must fail.
9. **Dialog flows need to close before they open.** Bootstrap does not support stacked modals. Use `modal.closeThen(fn)` from `U.modal` to open the next dialog after the first is gone.
10. **A strict-mode `for (i = ...)` without `var` is a runtime crash, not a lint warning.** A refactor removed the declaring loop and broke every recompute of an evicted step; only a test with a small cache budget found it. Keep `test/worker.test.js` running.

## 10. Pitfalls and footguns

- **Cache busting.** The browser and the worker load files with `?v=DL.VERSION`. After you edit a file, bump the version (a `-devN` suffix is fine during work) or the browser serves the old file. The stylesheet link and the manifest tag in `index.html` have their own `?v=` values.
- **The manifest order matters.** `i18n.js` and `en.js` load before `util.js`; `core.js` loads before the operations; the locale file loads between `app` and `ui`. A module must not call `DL.t` at load time.
- **`DL.col` mutates tables in place.** Never rely on column object identity across a `DL.col` call. Memos keyed on column objects can miss; they must not give wrong data.
- **`DL.maxCells` is a global that the worker overwrites** from the `config` message. Operations read it at run time. The page's own copy of core keeps the default.
- **`validateParams` skips hidden fields.** A field whose `showIf` is false is not checked. If a hidden field is still used by `apply`, clamp it in `apply`.
- **Number params keep bad text.** `coerce` keeps text that is not a number, so validation shows "Enter a number". Do not "repair" it to the default silently; that hid a workflow-import bug.
- **`op.validate` gets `null` columns** when the input is unknown. Guard with `if (!cols) return []`.
- **Notes can be objects.** Use `DL.noteText(note)` where a note is displayed. Only notes with `rows` become links.
- **Result status `'warning'` is not an error.** The step ran; the notes explain. `'invalid'`, `'blocked'` and `'error'` have no table.
- **The step hash includes `JSON.stringify(params)`.** Key order in params must be stable; `cleanParams` gives a stable shape. Do not put functions or Dates in params.
- **Workflow files run code.** A `javascript` step in an imported file runs `new Function` in the worker with access to the worker global. The import asks the user first. There is no sandbox and no time limit; see the open items below.
- **Excel dates.** SheetJS gives Date objects with `cellDates`; time-only cells have the date 30 or 31 December 1899 and `DL.cellText` writes them as a time.
- **Zoned dates.** `2024-01-01T00:00:00Z` is an instant; the formatter writes it in the local time of the computer. The field help says so.
- **The browser pane of the coding assistant** throttles timers when hidden, often times out on screenshots, and never completes Bootstrap hide transitions. Test dialog flows by reading the code or in a real browser. Inject `.fade { transition: none }` when you must drive dialogs there.
- **Bash heredocs in the assistant environment mangle backslashes.** A `\d` in a JavaScript string arrives as `d`. Write patch scripts and tests with the file-writing tool, never through a heredoc.
- **Two-digit years pivot at 70** (`1/2/69` is 2069). Excel pivots at 30. This is a documented choice, not a bug.
- **`Intl.Collator` costs about 1 µs per compare.** The sort key fast path applies only to plain Latin text in English-like locales; other text uses the collator. Do not extend the key to punctuation without a verified order table.
- **Bootstrap tooltips outlive their elements.** Views that replace `innerHTML` call `U.hideOrphanTooltips()`.
- **The `dl.workflows.v1` and session keys in `localStorage`** are the persistence format. A change to the record shape needs a migration in `W.list` and `restoreSession`; both filter bad records.

## 11. Open items

These are known and documented, not fixed:

- A sandbox and a time limit for the Custom JavaScript step (a disposable worker or a sandboxed iframe).
- Cooperative cancel checks inside long row loops, so Stop never needs a worker restart.
- Plural words and status labels stay English in translated interfaces.
- A size pre-check for very large workbooks; SheetJS reads the whole file.
- Filter and Verify have separate rule builders with slightly different semantics for list and equality tests.
- `docs/embedding.md` describes a library and a command line tool that do not exist yet.
