/* Collects the page and its files into one tree: what a web server or the desktop application
 * serves, and nothing else. Run: node scripts/stage-web.mjs [directory]
 *
 * dist/web       the default place; a release zips it as the web edition
 * desktop/app    what the desktop build reads (npm run stage in desktop/)
 *
 * The script stops with an error when a file that js/manifest.js lists, or the worker, is not in
 * the tree. A page with a missing file opens, says nothing, and does not work.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root, 'dist/web'));
if (!out.startsWith(root + path.sep)) throw new Error('The target must be inside the repository: ' + out);

// The parts of the repository that the page is made of. The tests, the sources of the engine and
// the command line stay out. dist/engine.global.js keeps its path, because the manifest names it.
const PARTS = ['index.html', 'css', 'img', 'js', 'vendor', 'dist/engine.global.js'];

rmSync(out, { recursive: true, force: true });
for (const part of PARTS) {
  const from = path.join(root, part);
  if (!existsSync(from)) throw new Error(part + ' is missing. Run: npm run build');
  mkdirSync(path.dirname(path.join(out, part)), { recursive: true });
  cpSync(from, path.join(out, part), { recursive: true });
}

// js/manifest.js is a browser file. It runs here the way test/bundle.test.js runs it, so the list
// of files comes from the file itself and not from a copy of the list.
const context = { self: {} };
vm.runInNewContext(readFileSync(path.join(out, 'js/manifest.js'), 'utf8'), context);
const DL = context.self.DL;
const needed = ['index.html', 'js/engine/worker.js']
  .concat(...Object.values(DL.FILES))
  .concat(DL.LOCALES.map((l) => 'js/i18n/' + l + '.js'));
const missing = needed.filter((f) => !existsSync(path.join(out, f)));
if (missing.length) {
  console.error('The staged page misses these files:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log('page staged in ' + path.relative(root, out) + ', version ' + DL.VERSION + ', ' + needed.length + ' files checked');
