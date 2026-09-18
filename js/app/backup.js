/* Full backup and full restore of everything that Delimiter Lab keeps in the browser storage.
 *
 * The file holds the text of each storage key of the application, as the storage holds it:
 * { format: 'delimiter-lab-backup', version: 1, appVersion, createdAt, storage: { key: text } }.
 * The text goes back byte for byte, so the readers of the application read it as they read their
 * own keys. Each key carries the version of its shape (for example dl.workflows.v1), and each reader
 * repairs or moves an old shape when it reads it. So a backup of an older version works in a newer
 * one. Only keys that start with "dl." are read, written or removed: other applications on the
 * same web address keep their keys. The data files of the workspace are not in the backup.
 */
(function (root) {
  'use strict';
  var DL = root.DL;

  var B = DL.backup = {};
  B.FORMAT = 'delimiter-lab-backup';
  B.VERSION = 1;
  B.PREFIX = 'dl.';
  var WORKFLOWS_KEY = 'dl.workflows.v1';

  // The keys of the application in the storage, and their text.
  function readKeys() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k !== null && k.indexOf(B.PREFIX) === 0) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  // The number of saved workflows in the text of the workflows key, or -1 when the text is not a list.
  function countWorkflows(text) {
    if (text === undefined || text === null) return 0;
    try {
      var arr = JSON.parse(text);
      return Array.isArray(arr) ? arr.length : -1;
    } catch (e) { return -1; }
  }

  // The text of a backup of the storage as it is now. Throws when the browser gives no storage.
  B.make = function () {
    var storage = readKeys();
    return {
      text: JSON.stringify({
        format: B.FORMAT,
        version: B.VERSION,
        appVersion: DL.VERSION,
        createdAt: new Date().toISOString(),
        storage: storage
      }, null, 2),
      workflows: Math.max(0, countWorkflows(storage[WORKFLOWS_KEY]))
    };
  };

  // The number of saved workflows in the storage now.
  B.currentWorkflows = function () {
    try { return Math.max(0, countWorkflows(localStorage.getItem(WORKFLOWS_KEY))); } catch (e) { return 0; }
  };

  // Reads the text of a backup file. Gives { storage, workflows, createdAt, appVersion }, or throws
  // an Error with a message for the user. Nothing is written.
  B.parse = function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(DL.t('backup.notBackup')); }
    if (!data || typeof data !== 'object' || data.format !== B.FORMAT) {
      // A workflow file is a different file. Say so, because the two are easy to mix up.
      if (data && data.format === DL.WORKFLOW_FORMAT) throw new Error(DL.t('backup.isWorkflow'));
      throw new Error(DL.t('backup.notBackup'));
    }
    var version = Number(data.version);
    if (!(version >= 1)) throw new Error(DL.t('backup.notBackup'));
    if (version > B.VERSION) throw new Error(DL.t('backup.newer'));
    var src = data.storage;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error(DL.t('backup.notBackup'));
    var storage = {};
    Object.keys(src).forEach(function (k) {
      if (k.indexOf(B.PREFIX) !== 0) return; // only the keys of this application
      if (typeof src[k] !== 'string') throw new Error(DL.t('backup.damaged'));
      storage[k] = src[k];
    });
    // The saved workflows are the reason for the backup. A list that does not read would stop every
    // later save, so such a file is refused before anything is removed.
    var workflows = countWorkflows(storage[WORKFLOWS_KEY]);
    if (workflows < 0) throw new Error(DL.t('backup.damaged'));
    var createdAt = typeof data.createdAt === 'string' && !isNaN(Date.parse(data.createdAt)) ? data.createdAt : '';
    return {
      storage: storage,
      workflows: workflows,
      createdAt: createdAt,
      appVersion: typeof data.appVersion === 'string' ? data.appVersion.slice(0, 20) : ''
    };
  };

  // Removes every key of the application and writes the keys of the backup. When a write fails, for
  // example because the storage is full, the keys of before come back. Gives true when it worked.
  B.restore = function (parsed) {
    var before;
    try { before = readKeys(); } catch (e) { return false; }
    var removeAll = function () { Object.keys(readKeys()).forEach(function (k) { localStorage.removeItem(k); }); };
    try {
      removeAll();
      Object.keys(parsed.storage).forEach(function (k) { localStorage.setItem(k, parsed.storage[k]); });
      return true;
    } catch (e) {
      try {
        removeAll();
        Object.keys(before).forEach(function (k) { localStorage.setItem(k, before[k]); });
      } catch (e2) { /* the storage refuses writes: nothing more can be done here */ }
      return false;
    }
  };
})(typeof self !== 'undefined' ? self : this);
