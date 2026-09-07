/* Builds the engine for every platform from one source.
 *
 * dist/engine.global.js  the page and the worker read it as self.DL
 * dist/engine.mjs        Node brings it in
 * dist/dl.mjs            the dl command, with the engine and the two libraries inside it
 */
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';

// js/manifest.js holds the one version of the application. The page reads that file before it
// loads anything else, so the build takes the number from there in place of holding a second one.
const manifest = readFileSync('js/manifest.js', 'utf8');
const found = manifest.match(/DL\.VERSION = '([^']+)'/);
if (!found) throw new Error('js/manifest.js does not say DL.VERSION.');
const version = found[1];

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  target: ['es2020'],
  logLevel: 'info',
  define: { __DL_VERSION__: JSON.stringify(version) }
};

await esbuild.build({
  ...common,
  entryPoints: ['packages/engine/src/browser.ts'],
  outfile: 'dist/engine.global.js',
  format: 'iife',
  platform: 'browser',
  // Every file of the engine was strict before the move. An IIFE is not strict by itself, and the
  // Node build is a module, which always is. Both builds must keep the same rules.
  banner: { js: '"use strict";' }
});

await esbuild.build({
  ...common,
  entryPoints: ['packages/engine/src/index.ts'],
  outfile: 'dist/engine.mjs',
  format: 'esm',
  platform: 'neutral',
  sourcemap: true
});

// The command line carries the engine and the same two libraries that the page uses, so that a
// file read on a terminal is read exactly as the page reads it.
await esbuild.build({
  ...common,
  entryPoints: ['packages/cli/src/cli.ts'],
  outfile: 'dist/dl.mjs',
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  banner: { js: '#!/usr/bin/env node' },
  alias: { '@engine': './packages/engine/src/index.ts' },
  sourcemap: true
});

console.log('engine and command line built, version ' + version);
