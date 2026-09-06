# Changelog

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
- Fix: dates in the years 0 to 99 and YYYYMMDD values are read correctly; date math refuses results outside the years 0 to 9999 (7007cb7).
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
