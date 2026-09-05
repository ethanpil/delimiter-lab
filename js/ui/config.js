/* Step configuration panel. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  function ConfigView(container, store, actions) {
    this.el = container;
    this.store = store;
    this.actions = actions; // { changeOp(stepId), remove(stepId) }
    this.renderedFor = null;
    this.renderedColumnsKey = null;
    this.fieldEls = {};
  }

  // Full render. Rebuilds the form. Called on selection change or when input columns change.
  ConfigView.prototype.render = function () {
    var st = this.store.state;
    var id = st.selectedId;
    var step = this.store.getStep(id);
    if (!step) { this.renderedFor = null; return; }
    var op = DL.getOp(step.opId);
    var columns = this.store.inputColumnsFor(id);
    var self = this;
    this.renderedFor = id;
    this.renderedColumnsKey = columns.join('');
    this.fieldEls = {};

    var el = U.empty(this.el);
    var idx = this.store.stepIndex(id);
    el.appendChild(U.el('div', { class: 'config-head' }, [
      U.el('div', { class: 'flex-grow-1' }, [
        U.el('h5', {}, [
          U.el('span', { class: 'badge text-bg-primary rounded-pill', text: String(idx + 1) }),
          U.el('i', { class: 'bi ' + (op ? op.icon : '') + ' text-secondary' }),
          op ? op.name : step.opId
        ]),
        U.el('p', { class: 'config-desc', text: op ? op.description : '' })
      ]),
      U.el('div', { class: 'btn-group btn-group-sm' }, [
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: 'Change to a different operation, keeping the position in the chain', onclick: function () { self.actions.changeOp(id); } }, [U.el('i', { class: 'bi bi-arrow-repeat' }), ' Change operation']),
        U.el('button', { type: 'button', class: 'btn btn-outline-danger', title: 'Delete this step', onclick: function () { self.actions.remove(id); } }, [U.el('i', { class: 'bi bi-trash' })])
      ])
    ]));

    if (!op) {
      el.appendChild(U.el('div', { class: 'alert alert-danger', text: 'This operation is not available in this version.' }));
      return;
    }

    if (st.source.status !== 'ready') {
      el.appendChild(U.el('div', { class: 'alert alert-info py-2' }, [U.el('i', { class: 'bi bi-info-circle me-1' }), 'Open a source file to see its columns and preview this step.']));
    }

    var grid = U.el('div', { class: 'field-grid' });
    op.params.forEach(function (p) {
      var f = DL.fields.render(p, step.params[p.key], {
        columns: columns,
        onChange: function (value, opts) {
          var patch = {};
          patch[p.key] = value;
          self.store.updateParams(id, patch, opts);
        }
      });
      self.fieldEls[p.key] = f;
      grid.appendChild(f);
    });
    el.appendChild(grid);
    el.appendChild(U.el('div', { class: 'problems', dataset: { role: 'problems' } }));
    el.appendChild(U.el('div', { dataset: { role: 'result' } }));
    this.update();
    U.initTooltips(el);
  };

  // Light update: field visibility, validation messages and results. Keeps focus in inputs.
  ConfigView.prototype.update = function () {
    var st = this.store.state;
    var id = st.selectedId;
    var step = this.store.getStep(id);
    if (!step || this.renderedFor !== id) { this.render(); return; }
    var columns = this.store.inputColumnsFor(id);
    if (columns.join('') !== this.renderedColumnsKey && document.activeElement && !this.el.contains(document.activeElement)) {
      this.render();
      return;
    }
    var op = DL.getOp(step.opId);
    if (!op) return;
    var self = this;
    op.params.forEach(function (p) {
      var f = self.fieldEls[p.key];
      if (!f) return;
      f.hidden = !!(p.showIf && !p.showIf(step.params));
    });
    var problems = this.store.validateStep(id);
    var pbox = this.el.querySelector('[data-role=problems]');
    U.empty(pbox);
    if (problems.length) {
      pbox.appendChild(U.el('div', { class: 'alert alert-warning py-2 mb-0' }, [
        U.el('div', { class: 'fw-semibold' }, [U.el('i', { class: 'bi bi-exclamation-circle me-1' }), 'To run this step:']),
        U.el('ul', { class: 'notes-list' }, problems.map(function (m) { return U.el('li', { text: m }); }))
      ]));
    }
    var rbox = this.el.querySelector('[data-role=result]');
    U.empty(rbox);
    var res = st.results[id];
    if (step.enabled === false) {
      rbox.appendChild(U.el('div', { class: 'alert alert-secondary py-2 mb-0 mt-2', text: 'This step is turned off. Data passes through unchanged.' }));
    } else if (res && !problems.length) {
      if (res.status === 'error') {
        rbox.appendChild(U.el('div', { class: 'alert alert-danger py-2 mb-0 mt-2' }, [U.el('i', { class: 'bi bi-x-circle me-1' }), res.error || 'This step failed.']));
      } else if (res.status === 'blocked') {
        rbox.appendChild(U.el('div', { class: 'alert alert-secondary py-2 mb-0 mt-2', text: (res.notes && res.notes[0]) || 'Waiting for an earlier step.' }));
      } else if (res.notes && res.notes.length) {
        rbox.appendChild(U.el('div', { class: 'alert py-2 mb-0 mt-2 ' + (res.status === 'warning' ? 'alert-warning' : 'alert-success') }, [
          U.el('ul', { class: 'notes-list' }, res.notes.map(function (n) { return U.el('li', { text: n }); }))
        ]));
      }
    }
  };

  DL.ConfigView = ConfigView;
})(typeof self !== 'undefined' ? self : this);
