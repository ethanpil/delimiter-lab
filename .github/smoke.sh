#!/usr/bin/env bash
# Checks that a built dl binary reads a file, runs the steps and writes the right answer.
# Usage: bash .github/smoke.sh ./out/dl-linux-x64
#        bash .github/smoke.sh node dist/dl.mjs
set -euo pipefail

dl=("$@")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

printf 'name,city,amount\n ada ,London,1234.5\nGRACE,Paris,20\n' > "$work/in.csv"
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

# Without -o the answer goes to standard output, and nothing else may go there.
"${dl[@]}" "$work/wf.json" "$work/in.csv" --quiet > "$work/piped.csv"
cmp "$work/out.csv" "$work/piped.csv" || {
  echo "::error::the file and the piped output are not the same"; exit 1; }

# A workbook goes through the other library.
"${dl[@]}" "$work/wf.json" "$work/in.csv" -o "$work/out.xlsx" --quiet
test -s "$work/out.xlsx" || { echo "::error::the workbook is empty"; exit 1; }

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

echo "the binary reads, runs and writes"
