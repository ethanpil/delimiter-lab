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

  function columnsKey(cols) {
    return cols === null ? null : cols.join('\u0000');
  }

  // Full render: builds the form again. Runs on selection change or when the input columns change.
  ConfigView.prototype.render = function () {
    var st = this.store.state;
    var id = st.selectedId;
    var step = this.store.getStep(id);
    if (!step) { this.renderedFor = null; return; }
    var op = DL.getOp(step.opId);
    var columns = this.store.inputColumnsFor(id);
    var self = this;
    this.renderedFor = id;
    this.renderedColumnsKey = columnsKey(columns);

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
        U.el('button', { type: 'button', class: 'btn btn-outline-secondary', title: DL.t('config.changeOpTitle'), onclick: function () { self.actions.changeOp(id); } }, [U.el('i', { class: 'bi bi-arrow-repeat' }), ' ' + DL.t('config.changeOp')]),
        U.el('button', { type: 'button', class: 'btn btn-outline-danger', title: DL.t('config.deleteStep'), onclick: function () { self.actions.remove(id); } }, [U.el('i', { class: 'bi bi-trash' })])
      ])
    ]));

    if (!op) {
      el.appendChild(U.el('div', { class: 'alert alert-danger', text: DL.t('config.opMissing') }));
      return;
    }

    if (st.source.status !== 'ready') {
      el.appendChild(U.el('div', { class: 'alert alert-info py-2' }, [U.el('i', { class: 'bi bi-info-circle me-1' }), DL.t('config.openSource')]));
    }

    var rendered = DL.fields.renderAll(op.params, step.params, { columns: columns }, function (key, value, opts) {
      // key is the key of a field, or an object of keys and values from onPatch.
      var patch = {};
      if (typeof key === 'object') patch = key; else patch[key] = value;
      self.store.updateParams(id, patch, opts);
    });
    this.fieldEls = rendered.els;
    el.appendChild(rendered.grid);
    el.appendChild(U.el('div', { class: 'problems', dataset: { role: 'problems' } }));
    el.appendChild(U.el('div', { dataset: { role: 'result' } }));
    this.update();
  };

  // Light update: field visibility, problems and results. Keeps the focus in inputs.
  ConfigView.prototype.update = function () {
    var st = this.store.state;
    var id = st.selectedId;
    var step = this.store.getStep(id);
    if (!step || this.renderedFor !== id) { this.render(); return; }
    var columns = this.store.inputColumnsFor(id);
    var active = document.activeElement;
    var tag = active ? active.tagName.toLowerCase() : '';
    var typing = active && this.el.contains(active) && (tag === 'input' && active.type !== 'checkbox' || tag === 'textarea');
    if (columnsKey(columns) !== this.renderedColumnsKey && !typing) {
      this.render();
      return;
    }
    var op = DL.getOp(step.opId);
    if (!op) return;
    DL.fields.updateVisibility(op.params, step.params, this.fieldEls);

    var problems = this.store.validateStep(id);
    var res = st.results[id];
    if (!problems.length && res && res.status === 'invalid') problems = res.notes;
    var pbox = this.el.querySelector('[data-role=problems]');
    if (!pbox) return; // the panel is still being built; render() calls update() again at its end
    U.empty(pbox);
    if (problems.length) {
      pbox.appendChild(U.el('div', { class: 'alert alert-warning py-2 mb-0' }, [
        U.el('div', { class: 'fw-semibold' }, [U.el('i', { class: 'bi bi-exclamation-circle me-1' }), DL.t('config.toRun')]),
        U.el('ul', { class: 'notes-list' }, problems.map(function (m) { return U.el('li', { text: m }); }))
      ]));
    }

    var rbox = this.el.querySelector('[data-role=result]');
    U.empty(rbox);
    if (step.enabled === false) {
      rbox.appendChild(U.el('div', { class: 'alert alert-secondary py-2 mb-0 mt-2', text: DL.SKIPPED_NOTE }));
    } else if (res && !problems.length) {
      if (res.status === 'error') {
        rbox.appendChild(U.el('div', { class: 'alert alert-danger py-2 mb-0 mt-2' }, [U.el('i', { class: 'bi bi-x-circle me-1' }), res.error || DL.t('config.failed')]));
      } else if (!res.hasTable) {
        rbox.appendChild(U.el('div', { class: 'alert alert-secondary py-2 mb-0 mt-2', text: res.notes[0] || DL.t('config.waiting') }));
      } else if (res.notes.length) {
        var self = this;
        rbox.appendChild(U.el('div', { class: 'alert py-2 mb-0 mt-2 ' + (res.status === 'warning' ? 'alert-warning' : 'alert-success') }, [
          U.el('ul', { class: 'notes-list' }, res.notes.map(function (n) {
            if (typeof n === 'string' || !n.rows || !self.onShowRows) return U.el('li', { text: DL.noteText(n) });
            // A note with rows is a link: a click shows those rows in the preview.
            var link = U.el('a', { href: '#', class: 'note-link', text: n.text, title: DL.t('config.showRows') });
            link.addEventListener('click', function (e) { e.preventDefault(); self.onShowRows(id, n); });
            return U.el('li', {}, [link]);
          }))
        ]));
      }
    }
  };

  DL.ConfigView = ConfigView;
})(typeof self !== 'undefined' ? self : this);
