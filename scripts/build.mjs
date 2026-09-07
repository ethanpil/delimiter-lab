/* Builds the engine for every platform from one source.
 *
 * dist/engine.global.js  the page and the worker read it as self.DL
 * dist/engine.mjs        Node brings it in, for the command line
 */
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  target: ['es2020'],
  logLevel: 'info'
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

console.log('engine built');
