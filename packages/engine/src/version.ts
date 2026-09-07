/* The version of the engine.
 *
 * js/manifest.js holds the one version of the application, because the page reads it before it
 * loads anything else. The build reads that file and puts the same value here, so the command line
 * and the page always say the same number.
 */
import { DL } from './dl.js';

declare const __DL_VERSION__: string;

DL.VERSION = __DL_VERSION__;
