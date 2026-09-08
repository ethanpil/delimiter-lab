/* Builds the desktop application for the platform of this machine. Run: npm run build
 *
 * js/manifest.js holds the one version of the application. electron-builder needs three numbers,
 * so 1.0 becomes 1.0.0 here and goes in as extraMetadata; package.json holds no version. The
 * names of the files carry the version of the manifest, as the files of the dl command do.
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
const three = version.split('.').length === 2 ? version + '.0' : version;

const platform = { darwin: 'mac', win32: 'win' }[process.platform];
if (!platform) throw new Error('The desktop application is built on macOS or Windows.');

// An empty list means: the targets and the chips that electron-builder.yml names. The names of
// the files are here and not in electron-builder.yml, because ${version} there is 1.0.0.
const files = await electronBuilder.build({
  projectDir: here,
  [platform]: [],
  config: {
    extraMetadata: { version: three },
    mac: { artifactName: 'delimiter-lab-' + version + '-macos-${arch}.${ext}' },
    win: { artifactName: 'delimiter-lab-' + version + '-windows-${arch}.${ext}' },
    nsis: { artifactName: 'delimiter-lab-' + version + '-windows-${arch}-setup.${ext}' }
  }
});
console.log('built version ' + version + '\n' + files.join('\n'));
