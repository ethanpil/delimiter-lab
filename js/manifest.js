/* Delimiter Lab - file manifest.
 * The page, the worker and the tests read this list. Add new operation files here.
 */
(function (root) {
  'use strict';
  var DL = root.DL || (root.DL = {});
  DL.VERSION = '1.0';
  // The files carry this number, so that a browser takes the new ones after a change. The version
  // stays at 1.0 while the work continues, so on a computer for development each load gets its own
  // number. Without it the browser would keep the files of the last load.
  var host = (root.location && root.location.hostname) || '';
  DL.BUILD = (host === 'localhost' || host === '127.0.0.1' || host === '') ? DL.VERSION + '.' + Date.now() : DL.VERSION;
  // Languages with a file in js/i18n/. English is always loaded; the page adds the language of the user.
  DL.LOCALES = ['en'];
  DL.FILES = {
    engine: ['js/engine/core.js'],
    ops: ['js/ops/text.js', 'js/ops/rows.js', 'js/ops/columns.js', 'js/ops/dates.js', 'js/ops/reshape.js', 'js/ops/verify.js'],
    app: ['js/app/i18n.js', 'js/i18n/en.js', 'js/app/util.js', 'js/app/store.js', 'js/app/engineClient.js', 'js/app/workflows.js', 'js/app/filestore.js'],
    ui: ['js/ui/fields.js', 'js/ui/chain.js', 'js/ui/source.js', 'js/ui/config.js', 'js/ui/grid.js', 'js/ui/dialogs.js', 'js/ui/perf.js'],
    main: ['js/main.js']
  };
})(typeof self !== 'undefined' ? self : this);
