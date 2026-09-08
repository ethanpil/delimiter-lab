# Changelog

The version is 1.0 while the work continues. The numbers below 1.0 are the
history of the development before that.

## 1.0 (in development)

- Add: a desktop application for macOS and Windows. It is the page in a window of its own, with no browser and no server (3509b4b, 3429880, 1d00ec7).
- Add: a release carries the page as a zip, for a copy on your own web server (8f02163, 05a9f97, b66c5a1).
- Add: the release and the check on a push start the desktop application once. A run of the release by hand with publish off writes nothing to the releases page (b66c5a1, 1e8e6f8).
- Fix: the page said "Another tab has this workspace open" at every new start that came after a saved session (60bb775).
- Fix: a second desktop application on the same workspace lost its work. One runs at a time (3429880).
- Change: Pad / Trim leaves an empty value empty. It made a value the file does not hold, such as 00000 for a missing postcode (d0f3d68).
- Change: the numbers of a file are read by the separator that file uses. A file that writes 1.234,56 gives 1000 for 1.000 (e2a915e).
- Change: an Excel file holds a number as a number, so SUM works. A value such as 007 stays text (e2a915e).
- Change: an output separator of more than one character is refused. Such a file read back with more columns than it was written with (e2a915e).
- Change: the dl command refuses a workflow with a Custom JavaScript step. --allow-code lets one run (8a1a026).
- Add: Sort and Filter have the day-first setting that Format Dates has (d0f3d68).
- Add: the page works on a narrow screen. Below 760 pixels the header takes two lines (8a1a026).
- Fix: a damaged store of saved workflows no longer loses every workflow at the next save (96713f9).
- Fix: a preview, a profile and a download no longer show data that the settings of today do not make (8b7052a).
- Fix: a batch keeps the column with the name of the file, as the dl command does (8b7052a).
- Fix: an empty header row no longer takes the first row of data as the header (e2a915e).
- Fix: a second batch no longer takes away the one that runs (cd25a04).
- Fix: a tick on one column no longer takes away a column that the file does not have (cd25a04).
- Fix: the workspace database is made again when it is broken (96713f9).
- Fix: an undo of a step no longer takes away the source settings (96713f9).
- Add: the dl command runs a workflow on files from a terminal (d89b7c9).
- Add: a release gives the dl command for Linux, macOS and Windows, with deb, rpm and apk packages (5660420, d8ded69, 9df4a20).
- Change: the engine is TypeScript in packages/engine. One build serves the page, the worker and the command, so no platform has its own copy (b6b97c1, ed36ff6, 69a9bbe).
- Change: sort takes the English order on every machine. Before, the order came from the machine (b551c3b).
- Fix: a batch of large files makes a zip again. The zip held every file in memory at one time (b551c3b).
- Fix: the dl command took the memory limit of a browser, and refused files that the page reads (d7302f5).
- Fix: on Windows the dl command wrote the whole path in the Source file column in place of the name (d7302f5).
- Fix: dl --validate said "ok" for a step whose columns it never saw (d7302f5).
- Fix: dl stops quietly when a reader such as head closes the pipe (d7302f5).
- Fix: the list of checksums of a release held a line for itself, so the check of a download always failed (9df4a20).
- Add: "Many files" in the source settings, with the answers batch and stack (02b9d92, c2736f4, d02e4bc).
- Add: a drag on a file in the source list changes the order of the files (4fc2762).
- Add: a step card gives the time that the step took, when that time is 400 ms or more (90c1ce1).
- Add: a column with the name of the file that gave each row, for a source that stacks (061a575).
- Change: files that write one column name in different ways make one column (061a575).
- Change: the progress bar names the file that it reads, and it goes forward through the list (e20678d).
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
