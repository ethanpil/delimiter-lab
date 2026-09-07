/* Keeps the open data file in the browser, so that a reload gives the workspace back.
 * localStorage holds text only, and a data file is too large for it. IndexedDB holds the file itself.
 * The store holds one file: the file that is open now.
 */
(function (root) {
  'use strict';
  var DL = root.DL;
  var NAME = 'dl.workspace.v1';
  var STORE = 'file';
  var KEY = 'current';
  // A larger file makes the reload slow, and some browsers copy the bytes. Such a file is not kept.
  var MAX_BYTES = 100 * 1024 * 1024;

  var F = DL.fileStore = {};

  function open() {
    return new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('no IndexedDB')); return; }
      var req = root.indexedDB.open(NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB is not available')); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked')); };
    });
  }

  function run(mode, action) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var out = action(tx.objectStore(STORE));
        tx.oncomplete = function () { db.close(); resolve(out && out.result); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  // Keeps the file. A file that is too large, or a browser without IndexedDB, gives a quiet no.
  F.put = function (file) {
    if (!file || file.size > MAX_BYTES) return F.clear();
    return run('readwrite', function (s) { return s.put({ file: file, name: file.name, at: Date.now() }, KEY); })
      // A write that fails leaves the file of the last time. That file does not belong to the steps
      // on the screen, so it must go.
      .catch(function () { return F.clear(); });
  };

  // Gives the file back, or null.
  F.get = function () {
    return run('readonly', function (s) { return s.get(KEY); })
      .then(function (rec) { return rec && rec.file ? rec.file : null; })
      .catch(function () { return null; });
  };

  F.clear = function () {
    return run('readwrite', function (s) { return s.delete(KEY); }).catch(function () { /* nothing to remove */ });
  };
})(typeof self !== 'undefined' ? self : this);
