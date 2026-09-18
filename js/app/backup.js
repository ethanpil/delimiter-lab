/* Full backup and full restore of everything that Delimiter Lab keeps in the browser storage.
 *
 * The file holds the text of each storage key of the application, as the storage holds it:
 * { format: 'delimiter-lab-backup', version: 1, appVersion, createdAt, storage: { key: text } }.
 * Each key keeps its text without a change. The readers of the application then read that text as
 * they read their own keys. Each key carries the version of its shape, for example dl.workflows.v1.
 * Each reader repairs or moves an old shape when it reads it. So a newer version of the application
 * takes a backup of an older one. The module reads, writes and removes only the keys that start
 * with "dl.". Other applications on the same web address keep their keys. A backup does not hold
 * the data files of the workspace.
 */
(function (root) {
  'use strict';
  var DL = root.DL;

  var B = DL.backup = {};
  var FORMAT = 'delimiter-lab-backup';
  var VERSION = 1;
  var PREFIX = 'dl.';
  var WORKFLOWS_KEY = 'dl.workflows.v1';
  var SESSION_KEY = 'dl.session.v1';

  // The keys of the application in the storage, and their text.
  function readKeys() {
    var out = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k !== null && k.indexOf(PREFIX) === 0) out[k] = localStorage.getItem(k);
    }
    return out;
  }

  // The saved workflows in a text, or null when the text is not a list. An empty text is an empty
  // store, as DL.workflows reads it.
  function readList(text) {
    if (!text) return [];
    var arr;
    try { arr = JSON.parse(text); } catch (e) { return null; }
    return Array.isArray(arr) ? arr : null;
  }

  // The number of saved workflows, or -1 when the text is not a list.
  function countWorkflows(text) {
    var list = readList(text);
    return list ? list.length : -1;
  }

  // True when a step of the saved workflows or of the session runs code. Such a backup gets the
  // warning that a workflow file with code gets, because a backup can come from another person.
  function runsCode(list, sessionText) {
    var all = (list || []).slice();
    try { all.push((JSON.parse(sessionText || '{}') || {}).workflow); } catch (e) { /* a broken session is not read */ }
    return all.some(function (w) {
      return !!w && Array.isArray(w.steps) && w.steps.some(function (s) { return DL.stepRunsCode(s); });
    });
  }

  // The text of a backup of the storage as it is now. Throws when the browser gives no storage.
  // workflows is -1 when the text of the saved workflows cannot be read: the backup keeps that text,
  // but parse() does not take it back.
  B.make = function () {
    var storage = readKeys();
    return {
      text: JSON.stringify({
        format: FORMAT,
        version: VERSION,
        appVersion: DL.VERSION,
        createdAt: new Date().toISOString(),
        storage: storage
      }, null, 2),
      workflows: countWorkflows(storage[WORKFLOWS_KEY])
    };
  };

  // The number of saved workflows in the storage now, or -1 when that text cannot be read. The
  // question before a restore must say which of the two it is: a damaged list is not an empty one,
  // and the restore removes that text.
  B.currentWorkflows = function () {
    try { return countWorkflows(localStorage.getItem(WORKFLOWS_KEY)); } catch (e) { return 0; }
  };

  // Reads the text of a backup file. Gives { storage, workflows, runsCode, createdAt, appVersion }, or throws
  // an Error with a message for the user. Nothing is written.
  B.parse = function (text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error(DL.t('backup.notBackup')); }
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
      // A workflow file is a different file. Say so, because the two look the same at the start.
      if (data && data.format === DL.WORKFLOW_FORMAT) throw new Error(DL.t('backup.isWorkflow'));
      throw new Error(DL.t('backup.notBackup'));
    }
    var version = Number(data.version);
    if (!(version >= 1)) throw new Error(DL.t('backup.notBackup'));
    if (version > VERSION) throw new Error(DL.t('backup.newer'));
    var src = data.storage;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error(DL.t('backup.notBackup'));
    var storage = {};
    Object.keys(src).forEach(function (k) {
      if (k.indexOf(PREFIX) !== 0) return; // only the keys of this application
      if (typeof src[k] !== 'string') throw new Error(DL.t('backup.damaged'));
      storage[k] = src[k];
    });
    // The saved workflows are the reason for the backup. A list that does not read would stop every
    // later save, so such a file is refused before anything is removed.
    var list = readList(storage[WORKFLOWS_KEY]);
    if (!list) throw new Error(DL.t('backup.damaged'));
    var createdAt = typeof data.createdAt === 'string' && !isNaN(Date.parse(data.createdAt)) ? data.createdAt : '';
    // The version of a file that another person made goes into a question on the screen. Only
    // letters, digits and a few marks pass: characters that change the direction of the text can
    // turn the words of that question around.
    var appVersion = typeof data.appVersion === 'string' ? data.appVersion.slice(0, 20) : '';
    if (!/^[\w.+ -]*$/.test(appVersion)) appVersion = '';
    return {
      storage: storage,
      workflows: list.length,
      runsCode: runsCode(list, storage[SESSION_KEY]),
      createdAt: createdAt,
      appVersion: appVersion
    };
  };

  // Removes every key of the application and writes the keys of the backup. When a write fails, for
  // example because the storage is full, the keys of before come back.
  // Gives { ok: true } when it worked, { ok: false } when nothing changed, and
  // { ok: false, lost: true } when the keys of before could not come back either. The caller must
  // tell the user about that last answer: their work is only in a backup file from now on.
  B.restore = function (parsed) {
    var before;
    try { before = readKeys(); } catch (e) { return { ok: false }; }
    var removeAll = function () { Object.keys(readKeys()).forEach(function (k) { localStorage.removeItem(k); }); };
    var writeAll = function (map) { Object.keys(map).forEach(function (k) { localStorage.setItem(k, map[k]); }); };
    try {
      removeAll();
      writeAll(parsed.storage);
      return { ok: true };
    } catch (e) {
      try {
        removeAll();
        writeAll(before);
        return { ok: false };
      } catch (e2) {
        return { ok: false, lost: true };
      }
    }
  };
})(typeof self !== 'undefined' ? self : this);
