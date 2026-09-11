#!/usr/bin/env bash
# Checks that a built dl binary reads a file, runs the steps and writes the right answer.
# Usage: bash .github/smoke.sh ./out/dl-linux-x64
#        bash .github/smoke.sh node dist/dl.mjs
set -euo pipefail

dl=("$@")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf 'name,city,amount\n ada ,London,1234.5\nGRACE,Paris,20\n' > "$work/in.csv"
printf 'name,city,amount\n bob ,Rome,7\nEVE,Berlin,8\n' > "$work/in2.csv"
cat > "$work/wf.json" <<'JSON'
{
  "format": "delimiter-lab-workflow",
  "version": 1,
  "name": "Smoke",
  "columns": ["name", "city", "amount"],
  "sourceOptions": null,
  "steps": [
    { "id": "s1", "opId": "padTrim", "params": { "columns": ["name"], "trim": "both" }, "enabled": true },
    { "id": "s2", "opId": "case", "params": { "columns": ["name"], "mode": "title" }, "enabled": true },
    { "id": "s3", "opId": "numFormat", "params": { "columns": ["amount"], "decimals": 2, "thousands": "," }, "enabled": true }
  ]
}
JSON

"${dl[@]}" "$work/wf.json" "$work/in.csv" -o "$work/out.csv" --quiet
grep -q 'Ada,London,"1,234.50"' "$work/out.csv" || {
  echo "::error::the binary gave the wrong answer"; cat "$work/out.csv"; exit 1; }

# Without -o the answer goes to standard output. Nothing that the command says about its work
# may go there, so this runs without --quiet and keeps only standard output.
"${dl[@]}" "$work/wf.json" "$work/in.csv" > "$work/piped.csv" 2> "$work/said.txt"
cmp "$work/out.csv" "$work/piped.csv" || {
  echo "::error::the file and the piped output are not the same"; cat "$work/said.txt"; exit 1; }
test -s "$work/said.txt" || { echo "::error::the command said nothing on standard error"; exit 1; }

# Many files make one source, one file after the other. Two files of two rows make four rows.
"${dl[@]}" "$work/wf.json" "$work/in.csv" "$work/in2.csv" -o "$work/both.csv" --quiet
lines=$(grep -c '' < "$work/both.csv")
if [ "$lines" != "5" ]; then
  echo "::error::two files of two rows must make four rows and a heading, not $lines lines"
  cat "$work/both.csv"; exit 1
fi

# A workbook goes through the other library. An xlsx file is a zip, so it starts with PK.
"${dl[@]}" "$work/wf.json" "$work/in.csv" -o "$work/out.xlsx" --quiet
test -s "$work/out.xlsx" || { echo "::error::the workbook is empty"; exit 1; }
if [ "$(head -c 2 "$work/out.xlsx")" != "PK" ]; then
  echo "::error::the workbook is not a zip, so no program can open it"; exit 1
fi

# The checks that write nothing.
"${dl[@]}" "$work/wf.json" "$work/in.csv" --validate --quiet
"${dl[@]}" "$work/wf.json" "$work/in.csv" --dry-run --quiet

# A workflow that cannot run must say so and answer with a failure.
cat > "$work/bad.json" <<'JSON'
{ "format": "delimiter-lab-workflow", "version": 1, "name": "Bad", "columns": [], "sourceOptions": null,
  "steps": [ { "id": "s1", "opId": "case", "params": { "columns": ["nope"], "mode": "upper" }, "enabled": true } ] }
JSON
if "${dl[@]}" "$work/bad.json" "$work/in.csv" --validate --quiet 2>/dev/null; then
  echo "::error::a workflow that names a column that is not there must fail"; exit 1
fi

# A workflow that holds code must not run without the answer that allows it.
cat > "$work/code.json" <<'JSON'
{ "format": "delimiter-lab-workflow", "version": 1, "name": "Code", "columns": ["name"], "sourceOptions": null,
  "steps": [ { "id": "s1", "opId": "javascript", "params": { "code": "return { name: 1 };", "output": "name" }, "enabled": true } ] }
JSON
if "${dl[@]}" "$work/code.json" "$work/in.csv" -o "$work/code.csv" --quiet 2>/dev/null; then
  echo "::error::a workflow with a Custom JavaScript Column step must not run without --allow-code"; exit 1
fi
"${dl[@]}" "$work/code.json" "$work/in.csv" -o "$work/code.csv" --allow-code --quiet
test -s "$work/code.csv" || { echo "::error::--allow-code did not run the workflow"; exit 1; }

# A row edit is code too.
cat > "$work/rowcode.json" <<'JSON'
{ "format": "delimiter-lab-workflow", "version": 1, "name": "Row code", "columns": ["name"], "sourceOptions": null,
  "steps": [ { "id": "s1", "opId": "javascriptRow", "params": { "code": "row.name = 'x';" }, "enabled": true } ] }
JSON
if "${dl[@]}" "$work/rowcode.json" "$work/in.csv" -o "$work/rowcode.csv" --quiet 2>/dev/null; then
  echo "::error::a workflow with a JavaScript Row Edit step must not run without --allow-code"; exit 1
fi
"${dl[@]}" "$work/rowcode.json" "$work/in.csv" -o "$work/rowcode.csv" --allow-code --quiet
test -s "$work/rowcode.csv" || { echo "::error::--allow-code did not run the row edit"; exit 1; }

echo "the binary reads, runs and writes"
