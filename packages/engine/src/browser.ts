/* The browser build.
 *
 * The page and the worker read the engine as self.DL, which is the name they used before the
 * engine became a package. The build gives that name to the same object the CLI brings in.
 */
import { DL } from './index.js';

(self as any).DL = (self as any).DL || {};
Object.keys(DL).forEach(function (key) { (self as any).DL[key] = DL[key]; });
