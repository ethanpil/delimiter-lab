/* Puts the page and its files in one tree, dist/web: what a web server serves, and nothing else.
 * Run: node scripts/stage-web.mjs
 *
 * The script stops with an error when a file that js/manifest.js lists, or the worker, is not in
 * the tree. A page with a missing file opens, says nothing, and does not work.
 */
import { cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/web');

// js/manifest.js is a browser file. It runs here in a context of its own, with only self in it.
// The list of files then comes from the file itself, not from a copy of the list.
const context = { self: {} };
vm.runInNewContext(readFileSync(path.join(root, 'js/manifest.js'), 'utf8'), context, { filename: 'js/manifest.js' });
const DL = context.self.DL;

// These parts of the repository make the page. The tests, the sources of the engine and the
// command line stay out. The manifest names the build of the engine, so its path comes from there.
const PARTS = ['index.html', 'css', 'img', 'js', 'vendor'].concat(DL.FILES.engine, DL.FILES.ops);

rmSync(out, { recursive: true, force: true });
for (const part of PARTS) cpSync(path.join(root, part), path.join(out, part), { recursive: true });

// Every file that the page loads must be in the tree, with the same letters. Windows and macOS
// find a file whose case differs. A Linux server does not.
const staged = new Set(readdirSync(out, { recursive: true }).map((f) => f.split(path.sep).join('/')));
const needed = [...new Set(['index.html', 'js/engine/worker.js']
  .concat(...Object.values(DL.FILES))
  .concat(DL.LOCALES.map((l) => 'js/i18n/' + l + '.js')))];
const missing = needed.filter((f) => !staged.has(f));
if (missing.length) throw new Error('These files are not in the staged page:\n  ' + missing.join('\n  '));
console.log('page staged in dist/web, version ' + DL.VERSION + ', ' + needed.length + ' files checked');
