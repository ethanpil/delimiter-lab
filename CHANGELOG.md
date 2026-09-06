# Changelog

## Unreleased

- Add: Format Dates, Date Math, Extract Text, Clean Text and Fill Empty Values operations (5a32941).

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
