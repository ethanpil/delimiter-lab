/* Talks to the processing worker with promises. */
(function (root) {
  'use strict';
  var DL = root.DL;

  function EngineClient(onProgress) {
    this.pending = new Map();
    this.nextId = 1;
    this.onProgress = onProgress || function () {};
    this.maxCells = 0;
    this.dead = null; // the error that stopped the worker, when it stopped
    this.start();
  }

  EngineClient.prototype.start = function () {
    var self = this;
    this.dead = null;
    try {
      this.worker = new Worker('js/engine/worker.js?v=' + DL.VERSION);
    } catch (e) {
      // A browser refuses a worker from a file:// address or under a strict content security policy.
      this.worker = { postMessage: function () {}, terminate: function () {} };
      this.fail(new Error('The processing engine could not start: ' + (e.message || e) + '. Open the page from a web server.'));
      return;
    }
    this.worker.onmessage = function (e) {
      var msg = e.data;
      if (msg.type === 'progress') { self.onProgress(msg); return; }
      var p = self.pending.get(msg.requestId);
      if (!p) return;
      self.pending.delete(msg.requestId);
      if (msg.type === 'error') {
        var err = new Error(msg.message);
        err.tooLarge = !!msg.tooLarge;
        p.reject(err);
      } else p.resolve(msg);
    };
    this.worker.onerror = function (e) {
      self.fail(new Error('The processing engine stopped: ' + (e.message || 'unknown error') + '. Reload the page.'));
    };
    if (this.maxCells) this.send({ type: 'config', maxCells: this.maxCells });
  };

  // Rejects every request, now and later, with the given error.
  EngineClient.prototype.fail = function (err) {
    this.dead = err;
    this.pending.forEach(function (p) { p.reject(err); });
    this.pending.clear();
  };

  // Stops the worker at once (for example when a step does not finish) and starts a new one.
  // The new worker holds no data: the source file must be loaded again.
  EngineClient.prototype.restart = function () {
    this.worker.terminate();
    this.fail(new Error('The work was stopped.'));
    this.start();
  };

  EngineClient.prototype.send = function (msg) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (self.dead) { reject(self.dead); return; }
      var id = self.nextId++;
      msg.requestId = id;
      self.pending.set(id, { resolve: resolve, reject: reject });
      self.worker.postMessage(msg);
    });
  };

  EngineClient.prototype.configure = function (maxCells) { this.maxCells = maxCells; return this.send({ type: 'config', maxCells: maxCells }); };
  EngineClient.prototype.listSheets = function (file) { return this.send({ type: 'sheets', file: file }); };
  EngineClient.prototype.load = function (file, options) { return this.send({ type: 'load', file: file, options: options }); };
  EngineClient.prototype.run = function (steps, protect) { return this.send({ type: 'run', steps: steps, protect: protect }); };
  // Asks the worker to stop the active run before its next step. The run replies with the results so far.
  EngineClient.prototype.cancel = function () { return this.send({ type: 'cancel' }); };
  EngineClient.prototype.slice = function (stepId, start, count, diff) { return this.send({ type: 'slice', stepId: stepId, start: start, count: count, diff: !!diff }); };
  EngineClient.prototype.columnInfo = function (stepId) { return this.send({ type: 'columnInfo', stepId: stepId }); };
  EngineClient.prototype.columnStats = function (stepId, col) { return this.send({ type: 'columnStats', stepId: stepId, col: col }); };
  EngineClient.prototype.diffSummary = function (stepId) { return this.send({ type: 'diffSummary', stepId: stepId }); };
  EngineClient.prototype.search = function (stepId, query, limit) { return this.send({ type: 'search', stepId: stepId, query: query, limit: limit }); };
  EngineClient.prototype.memory = function () { return this.send({ type: 'memory' }); };
  EngineClient.prototype.findRows = function (stepId, lookup, limit) { return this.send({ type: 'findRows', stepId: stepId, lookup: lookup, limit: limit }); };
  EngineClient.prototype.batch = function (file, options, steps, output) { return this.send({ type: 'batch', file: file, options: options, steps: steps, output: output }); };
  EngineClient.prototype.zip = function (entries) { return this.send({ type: 'zip', entries: entries }); };
  EngineClient.prototype.exportStep = function (stepId, options) { return this.send({ type: 'export', stepId: stepId, options: options }); };

  DL.EngineClient = EngineClient;
})(typeof self !== 'undefined' ? self : this);
