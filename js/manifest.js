/* Delimiter Lab - file manifest.
 * The page, the worker and the tests read this list. Add new operation files here.
 */
(function (root) {
  'use strict';
  var DL = root.DL || (root.DL = {});
  DL.VERSION = '1.1.0';
  DL.FILES = {
    engine: ['js/engine/core.js'],
    ops: ['js/ops/text.js', 'js/ops/rows.js', 'js/ops/columns.js', 'js/ops/verify.js'],
    app: ['js/app/util.js', 'js/app/store.js', 'js/app/engineClient.js', 'js/app/workflows.js'],
    ui: ['js/ui/fields.js', 'js/ui/chain.js', 'js/ui/source.js', 'js/ui/config.js', 'js/ui/grid.js', 'js/ui/dialogs.js'],
    main: ['js/main.js']
  };
})(typeof self !== 'undefined' ? self : this);
