/* Delimiter Lab - file manifest.
 * The page, the worker and the tests read this list. The operations are in the build of the
 * engine, so a new operation goes into packages/engine/src/index.ts, not here.
 */
(function (root) {
  'use strict';
  var DL = root.DL || (root.DL = {});
  DL.VERSION = '1.0';
  // The files carry DL.BUILD, so that a browser takes the new ones after a change. index.html sets
  // DL.STAMP: the time of the deploy on a web server, and a new number at each load on a computer for
  // development. The desktop application and the worker have no stamp; the worker takes the number
  // of the page from its own address.
  DL.BUILD = DL.STAMP ? DL.VERSION + '.' + DL.STAMP : DL.VERSION;
  // Languages with a file in js/i18n/. English is always loaded; the page adds the language of the user.
  DL.LOCALES = ['en'];
  DL.FILES = {
    // The engine is built from packages/engine/src by scripts/build.mjs. The page, the worker and
    // the command line all read that one build, so no platform has its own copy of the engine.
    engine: ['dist/engine.global.js'],
    ops: [],
    app: ['js/app/i18n.js', 'js/i18n/en.js', 'js/app/util.js', 'js/app/store.js', 'js/app/engineClient.js', 'js/app/workflows.js', 'js/app/backup.js', 'js/app/filestore.js'],
    ui: ['js/ui/fields.js', 'js/ui/chain.js', 'js/ui/source.js', 'js/ui/config.js', 'js/ui/grid.js', 'js/ui/dialogs.js', 'js/ui/perf.js'],
    main: ['js/main.js']
  };
})(typeof self !== 'undefined' ? self : this);
