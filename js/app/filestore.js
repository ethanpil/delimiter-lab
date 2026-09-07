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
  var F = DL.fileStore = {};
  // A larger file makes the reload slow, and some browsers write the bytes again. Such a file stays out.
  F.MAX_BYTES = 100 * 1024 * 1024;

  // One connection for the page. Two transactions on one connection keep their order; two
  // connections do not, and the file of the last write could be the older one.
  var dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('This browser has no IndexedDB.')); return; }
      var req = root.indexedDB.open(NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB is not available.')); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked.')); };
    });
    dbp.catch(function () { dbp = null; }); // a connection that failed must not stay
    return dbp;
  }

  function run(mode, action) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var out;
        try {
          var tx = db.transaction(STORE, mode);
          out = action(tx.objectStore(STORE));
          tx.oncomplete = function () { resolve(out && out.result); };
          tx.onerror = function () { reject(tx.error); };
          tx.onabort = function () { reject(tx.error); };
        } catch (e) {
          // The connection closes, or the store is not there. Give the connection up and close it,
          // because no handler of the transaction can do it now.
          dbp = null;
          try { db.close(); } catch (e2) { /* it is closed already */ }
          reject(e);
        }
      });
    });
  }

  // Keeps the file. Gives true when the file is in the store, and false when it is not.
  F.put = function (file) {
    if (!file || file.size > F.MAX_BYTES) return F.clear().then(function () { return false; });
    return run('readwrite', function (s) { return s.put(file, KEY); })
      .then(function () { return true; })
      // A write that fails leaves the file of the last time. That file does not belong to the steps
      // on the screen, so it must go.
      .catch(function () { return F.clear().then(function () { return false; }); });
  };

  // Gives the file back, or null.
  F.get = function () {
    return run('readonly', function (s) { return s.get(KEY); })
      .then(function (rec) { return rec instanceof Blob ? rec : null; }) // a record of an older shape gives null
      .catch(function () { return null; });
  };

  F.clear = function () {
    return run('readwrite', function (s) { return s.delete(KEY); }).catch(function () { /* nothing to remove */ });
  };
})(typeof self !== 'undefined' ? self : this);
