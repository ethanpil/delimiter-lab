/* The browser build.
 *
 * The page and the worker read the engine as self.DL. js/manifest.js runs before this file and
 * puts the version and the file list on that name, so this file takes those over and then gives
 * the name to the engine object itself.
 *
 * The name must hold the SAME object that the engine reads. A copy would split the two: the worker
 * writes DL.maxCells when the page says how much memory it can use, and the operations read
 * DL.maxCells. With two objects the operations would keep the value that the engine started with.
 */
import { DL } from './index.js';

var before = (self as any).DL;
if (before) {
  Object.keys(before).forEach(function (key) { if (!(key in DL)) DL[key] = before[key]; });
  // The build writes the version of the manifest into the engine, so the two agree. When they do
  // not, the browser holds an engine from another version, which would give old answers with no
  // sign of it. The manifest is what the page loaded its files with, so it wins, and the reason
  // is said out loud.
  if (before.VERSION && before.VERSION !== DL.VERSION) {
    if (typeof console !== 'undefined') {
      console.error('Delimiter Lab: the page is version ' + before.VERSION + ' but the engine is ' +
        'version ' + DL.VERSION + '. Empty the cache of the browser, or run npm run build.');
    }
    DL.VERSION = before.VERSION;
  }
}
(self as any).DL = DL;
