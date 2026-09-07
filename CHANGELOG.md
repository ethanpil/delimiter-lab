# Changelog

The version is 1.0 while the work continues. The numbers below 1.0 are the
history of the development before that.

## 1.0 (in development)

- Add: "Many files" in the source settings, with the answers batch and stack (02b9d92, c2736f4, d02e4bc).
- Add: the source panel lists its files, and it can add one or take one out (615ad5a).
- Add: "Skip rows at the bottom" in the source settings (843e481).
- Add: a drag on the right of a column name changes its width (c3c20de).
- Change: the first step is now called Source Data (db6c6cd).
- Fix: the cell limit counts the table that stacking makes, not each file on its own (97b4858).
- Fix: the sheet of a workbook stays when a file goes in or out of the source (076120d).
- Fix: every file of one source must have the same format (076120d).
- Fix: a download of many files gave the error "zipName is not defined" in place of the message (4410533).
- Fix: a workbook opens again at the same sheet. Before, it opened at the first sheet, and the steps ran on the wrong data (b898ff5).
- Fix: a write that fails no longer leaves the file of the last time in the workspace (f6bfc55).
- Fix: a file that does not open goes out of the workspace, so the application does not start with the same error at each reload (7228384).
- Fix: the workspace opens its file again only when the name agrees with the steps. A second tab wrote its own file there (6b4b262).
- Fix: New waits while a batch runs, and it stops the work that waits without a red message (f2db7d4, 0959e1b).
- Fix: New gives no undo, because undo cannot bring the file back (b548994).
- Fix: the questions that New asks name the file that it closes (135f6f6).
- Fix: a message tells you when a file is too large for the workspace to keep (c4c0305).
- Fix: the file store holds one connection and closes it when a transaction fails (397ecd9).
- Fix: the session holds the name of the file as soon as the file changes (f351723).
- Change: the workspace does not write its file again at each reload (78fb383).

## 1.7.0

- Add: the workspace comes back after a reload. The steps stay in localStorage and the file stays in IndexedDB. A manual save is still necessary to keep a workflow.
- Add: a logo, from the "Process Line" icon of Iconpark Duotone Icons.
- Add: the help gives the address of the project and the names that the icon licence asks for.
- Change: the New button closes the file as well as the steps.
- Change: "Run a file" names the output [file]-processed-YYYY-MM-DD-HH-mm. A run of many files names the zip file after the workflow.

## 1.6.0

- Add: a New button in the header removes the steps and starts a new workflow. It asks two times.
- Add: "Run a file" in the saved workflows list sends files through a workflow and downloads the result. The steps on the screen stay as they are.
- Change: the Autosave button is green while autosave is on.

## 1.5.0

- Add: an Autosave button in the header writes every change to the saved workflow (09cca9a). It asks for a name first when the workflow has none.
- Add: a dialog offers to save your steps before it opens a different workflow (09cca9a).
- Change: the saved workflows list shows the number of steps as a label (09cca9a). It also shows the dates, and it no longer lists the steps.
- Change: the Rename button shows its name (09cca9a).
- Change: the help dialog is wider and holds two columns (09cca9a).
- Fix: a save keeps the time of the last use of a workflow (09cca9a).

## 1.4.1

- Fix: the column profile stays open. Bootstrap closed it as soon as the statistics arrived, because setContent() shows the panel again and the second show reads the state that the first show left behind.
- Fix: the hover text of a column name does not cover its profile panel.
- Add: the Escape key closes the column profile.

## 1.4.0

- Add: the application is published at https://ethanpil.github.io/delimiter-lab/.
- Add: CONTEXT.md with the design, the conventions, the lessons learned and the pitfalls for developers (159eb16).
- Fix: Clean Text keeps prose with "<"; the unique rule label names its comparison (f1f0b1d).
- Fix: number parsing refuses infinite values, malformed digit groups and "(-5)"; number formatting stays sane for huge values (c0e1d74).
- Fix: date parsing refuses versions, identifiers, year-less month text and "13:04 PM"; years 0 to 999 keep four digits (c0e1d74).
- Fix: Split Name keeps a multi-word last name before a comma; title case keeps contractions (c0e1d74).
- Fix: an evicted step is computed again on demand; the diff summary no longer holds freed tables (8207c5a).
- Fix: mixed line endings, blank lines, big-endian UTF-16 and time-only spreadsheet cells are read correctly (8207c5a).
- Fix: Excel exports refuse cells, columns and sheet names that Excel cannot hold (8207c5a).
- Fix: a session restores its selection and saved state; a workflow import asks before it replaces steps or runs custom code (b0a492e).
- Fix: dialogs own the keyboard; Compare shows the input of the shown step; a batch runs with a copy of the settings (b0a492e).
- Fix: source options keep the focus while the file reloads; one dialog at a time; download names keep their extension (ac95bda).
- Change: CSV and JSON writers are three times faster and keep every column name (8207c5a).
- Change: text sort, the Verify date rule and date filters are several times faster (ab830cf).
- Add: test/worker.test.js runs the worker in Node (8207c5a).

## 1.3.1

- Change: the Export and Import buttons of the saved workflows dialog show a text label (a0529df).

## 1.3.0

- Add: Format Dates, Date Math, Extract Text, Clean Text and Fill Empty Values operations (5a32941).
- Add: Pivot and Unpivot operations (b4d0f1b).
- Add: column profile on a click on a column name (61287f4).
- Add: "Changes" view that marks the cells a step changed (61287f4).
- Add: a click on a Verify result shows the rows that failed the rule (dcc533d).
- Add: apply the steps to many files at once and download a zip file (7db3961).
- Add: Cancel button that stops a run or a batch before the next step or file (31d3558).
- Add: dark theme with a switch in the header (0cf8166).
- Add: timing panel with the time and the memory of each step (c2564ac).
- Add: texts of the user interface in a table, so you can add other languages (b2711c7).
- Fix: the parser reads dates in the years 0 to 99 and YYYYMMDD values; date math refuses results outside the years 0 to 9999 (7007cb7).
- Fix: Pivot keeps its total column for an empty input, has a cell limit and stable names for blank keys (7007cb7).
- Fix: Clean Text keeps letters of other scripts and decodes entities safely (7007cb7).
- Fix: a cancelled run keeps the results in the cache; the Changes view follows moved rows and renamed columns (600f28f).
- Fix: the zip of a batch refers to the files instead of copies; a missing sheet gives a note (600f28f).
- Fix: progress, Cancel and Stop stay correct when a run, a batch, a download or a file load overlap (7597800).
- Fix: a workflow file dropped on the drop zone imports; search hits stay visible in the Changes view (7597800).

## 1.2.0

- Fix: text such as "Room 12" is not read as a date; time zones are read (c55740a).
- Fix: fields that need whole numbers reject decimals (c55740a).
- Fix: sort treats values that differ only in case as equal, so the next sort key applies (c55740a).
- Fix: the file drop overlay disappears after a drop on the drop zone; tooltips hide (c6c0cce).
- Fix: undo history stays correct after undo, redo, rename and save (c6c0cce).
- Add: Stop button for a step that does not finish (c6c0cce).
- Change: the preview shows only the visible columns of wide tables, so scrolling stays quick (c6c0cce).
- Change: the worker keeps the steps on screen in memory and trims the cache while the chain runs (a7ad29d).

## 1.1.0

- Fix: characters that cross a read boundary in large files stay intact (7fdb2f2).
- Fix: rows with empty values group and deduplicate correctly (7fdb2f2).
- Fix: the "None" text delimiter option reads files without quotes (7fdb2f2).
- Fix: steps recover after an earlier step is fixed, moved or removed (7fdb2f2).
- Fix: impossible dates such as 2024-02-30 are not accepted as dates (7fdb2f2).
- Change: the worker checks step settings against the real input columns (7fdb2f2).
- Change: filtered and sorted results share text with their input, which uses much less memory (7fdb2f2).
- Add: field type, input format and output format registries for extensions (7fdb2f2).
- Fix: separator detection in small files, header cells with dates, sort key labels, one-column paste in the lookup list (35fce00).

## 1.0.0

- First release: 20 operations, saved workflows, undo and redo, virtual preview grid (882ebc2, 75ed7b7).
