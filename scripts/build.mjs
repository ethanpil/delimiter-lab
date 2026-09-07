/* Builds the engine for every platform from one source.
 *
 * dist/engine.global.js  the page and the worker read it as self.DL
 * dist/engine.mjs        Node brings it in, for the command line and the tests
 */
import * as esbuild from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

const common = {
  bundle: true,
  target: ['es2020'],
  logLevel: 'info',
  sourcemap: true
};

await esbuild.build({
  ...common,
  entryPoints: ['packages/engine/src/browser.ts'],
  outfile: 'dist/engine.global.js',
  format: 'iife',
  platform: 'browser'
});

await esbuild.build({
  ...common,
  entryPoints: ['packages/engine/src/index.ts'],
  outfile: 'dist/engine.mjs',
  format: 'esm',
  platform: 'neutral'
});

console.log('engine built');
