/* Builds the desktop application for the platform of this machine. Run: npm run build
 *
 * js/manifest.js holds the one version of the application. It goes in as extraMetadata, so
 * package.json holds no version. electron-builder.yml names the targets and the files.
 */
import electronBuilder from 'electron-builder';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = readFileSync(path.join(here, '../js/manifest.js'), 'utf8');
const found = manifest.match(/DL\.VERSION = '([^']+)'/);
if (!found) throw new Error('js/manifest.js does not say DL.VERSION.');
const version = found[1];

const files = await electronBuilder.build({ projectDir: here, config: { extraMetadata: { version } } });
console.log('built version ' + version + '\n' + files.join('\n'));
