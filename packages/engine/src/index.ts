/* The engine, for every platform.
 *
 * The order of the imports is the order that the files need: core first, because every operation
 * registers itself with it.
 */
import { DL } from './dl.js';
import './core.js';
import './ops/text.js';
import './ops/rows.js';
import './ops/columns.js';
import './ops/dates.js';
import './ops/reshape.js';
import './ops/verify.js';

export { DL };
export default DL;
