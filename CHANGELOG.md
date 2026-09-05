# Changelog

## 1.1.0

- Fix: characters that cross a read boundary in large files stay intact (7fdb2f2).
- Fix: rows with empty values group and deduplicate correctly (7fdb2f2).
- Fix: the "None" text delimiter option reads files without quotes (7fdb2f2).
- Fix: steps recover after an earlier step is fixed, moved or removed (7fdb2f2).
- Fix: impossible dates such as 2024-02-30 are not accepted as dates (7fdb2f2).
- Change: the worker checks step settings against the real input columns (7fdb2f2).
- Change: filtered and sorted results share text with their input, which uses much less memory (7fdb2f2).
- Add: field type, input format and output format registries for extensions (7fdb2f2).

## 1.0.0

- First release: 20 operations, saved workflows, undo and redo, virtual preview grid (882ebc2, 75ed7b7).
