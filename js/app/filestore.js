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

  // True when the database itself is wrong, not the work asked of it: a store that is not there
  // after an upgrade that stopped half way, or a database that a later build made. Neither heals
  // on its own, and without a way back every file the person opens says that it cannot be kept.
  function brokenDb(err) {
    var name = err && err.name;
    return name === 'NotFoundError' || name === 'VersionError' || name === 'InvalidStateError';
  }

  var repaired = false;

  // Removes the database so that the next open makes it again. Once only: a second failure is
  // not the database.
  function repair() {
    if (repaired || !root.indexedDB) return Promise.resolve(false);
    repaired = true;
    dbp = null;
    return new Promise(function (resolve) {
      var req = root.indexedDB.deleteDatabase(NAME);
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { resolve(false); };
      req.onblocked = function () { resolve(false); };
    });
  }

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('This browser has no IndexedDB.')); return; }
      var req = root.indexedDB.open(NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () {
        var db = req.result;
        // Another tab, or the user, can ask to change or remove the database. A connection that stays
        // open blocks that, so it closes and the next call opens a new one.
        db.onversionchange = function () { db.close(); dbp = null; };
        db.onclose = function () { dbp = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error || new Error('IndexedDB is not available.')); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked.')); };
    });
    dbp.catch(function () { dbp = null; }); // a connection that failed must not stay
    return dbp;
  }

  function run(mode, action) {
    return once(mode, action).catch(function (err) {
      if (!brokenDb(err) || repaired) throw err;
      return repair().then(function (done) { if (!done) throw err; return once(mode, action); });
    });
  }

  function once(mode, action) {
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
          // The connection closes, or the store is not there. No handler of the transaction can
          // release it now, so this code does. A transaction that another call started keeps the
          // connection alive until it ends.
          dbp = null;
          try { db.close(); } catch (e2) { /* it is closed already */ }
          reject(e);
        }
      });
    });
  }

  var writes = 0; // counts the writes, so that a write that fails knows if it is still the last one

  // Keeps the files. Gives true when they are in the store, and false when they are not.
  F.put = function (files) {
    var mine = ++writes;
    var list = files ? [].concat(files) : [];
    var bytes = 0;
    for (var i = 0; i < list.length; i++) bytes += list[i].size;
    if (!list.length || bytes > F.MAX_BYTES) return F.clear().then(function () { return false; });
    return run('readwrite', function (s) { return s.put(list, KEY); })
      .then(function () { return true; })
      .catch(function () {
        // A write that fails leaves the file of the last time, and that file does not belong to the
        // steps on the screen. But a later write can be there already, and that file must stay.
        if (mine !== writes) return false;
        return F.clear().then(function () { return false; });
      });
  };

  // Gives the files back. An empty list means that the store holds nothing for this browser.
  F.get = function () {
    return run('readonly', function (s) { return s.get(KEY); })
      .then(function (rec) {
        if (Array.isArray(rec) && rec.length && rec[0] instanceof Blob) return rec;
        if (rec instanceof Blob) return [rec]; // one file, from a version before the list
        if (rec) F.clear(); // a record of an older shape has no use, and it holds space
        return [];
      })
      .catch(function () { return []; });
  };

  F.clear = function () {
    return run('readwrite', function (s) { return s.delete(KEY); }).catch(function () { /* nothing to remove */ });
  };
})(typeof self !== 'undefined' ? self : this);
