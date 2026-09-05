/* Talks to the processing worker with promises. */
(function (root) {
  'use strict';
  var DL = root.DL;

  function EngineClient(onProgress) {
    this.worker = new Worker('js/engine/worker.js?v=' + DL.VERSION);
    this.pending = new Map();
    this.nextId = 1;
    this.onProgress = onProgress || function () {};
    this.busy = 0;
    var self = this;
    this.worker.onmessage = function (e) {
      var msg = e.data;
      if (msg.type === 'progress') { self.onProgress(msg); return; }
      var p = self.pending.get(msg.requestId);
      if (!p) return;
      self.pending.delete(msg.requestId);
      self.busy--;
      if (msg.type === 'error') {
        var err = new Error(msg.message);
        err.tooLarge = !!msg.tooLarge;
        p.reject(err);
      } else p.resolve(msg);
    };
    this.worker.onerror = function (e) {
      var err = new Error('The processing engine stopped: ' + (e.message || 'unknown error'));
      self.pending.forEach(function (p) { p.reject(err); });
      self.pending.clear();
      self.busy = 0;
    };
  }

  EngineClient.prototype.send = function (msg) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var id = self.nextId++;
      msg.requestId = id;
      self.pending.set(id, { resolve: resolve, reject: reject });
      self.busy++;
      self.worker.postMessage(msg);
    });
  };

  EngineClient.prototype.configure = function (maxCells) { return this.send({ type: 'config', maxCells: maxCells }); };
  EngineClient.prototype.listSheets = function (file) { return this.send({ type: 'sheets', file: file }); };
  EngineClient.prototype.load = function (file, options) { return this.send({ type: 'load', file: file, options: options }); };
  EngineClient.prototype.clear = function () { return this.send({ type: 'clear' }); };
  EngineClient.prototype.run = function (steps, selectedStepId) { return this.send({ type: 'run', steps: steps, selectedStepId: selectedStepId }); };
  EngineClient.prototype.slice = function (stepId, start, count) { return this.send({ type: 'slice', stepId: stepId, start: start, count: count }); };
  EngineClient.prototype.columnInfo = function (stepId) { return this.send({ type: 'columnInfo', stepId: stepId }); };
  EngineClient.prototype.search = function (stepId, query, limit) { return this.send({ type: 'search', stepId: stepId, query: query, limit: limit }); };
  EngineClient.prototype.exportStep = function (stepId, options) { return this.send({ type: 'export', stepId: stepId, options: options }); };

  DL.EngineClient = EngineClient;
})(typeof self !== 'undefined' ? self : this);
