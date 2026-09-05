/* The steps list in the sidebar. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  function ChainView(container, store, actions) {
    this.el = container;
    this.store = store;
    this.actions = actions;
    var self = this;
    DL.fields.sortable(container, '.step-card[data-step]', function (from, to) {
      var steps = store.state.workflow.steps;
      if (steps[from]) store.moveStep(steps[from].id, to);
    });
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      var card = e.target.closest('.step-card');
      if (!card) return;
      var id = card.dataset.step || 'source';
      if (btn) {
        e.stopPropagation();
        self.actions[btn.dataset.action](id);
        return;
      }
      store.select(id);
    });
    container.addEventListener('keydown', function (e) {
      var card = e.target.closest('.step-card');
      if (!card || e.target.closest('button')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.select(card.dataset.step || 'source'); }
    });
  }

  // scroll: bring the selected card into view (on selection changes, not while typing).
  ChainView.prototype.render = function (scroll) {
    var st = this.store.state;
    var steps = st.workflow.steps;
    var el = U.empty(this.el);
    el.appendChild(this.sourceCard());
    if (!steps.length) {
      el.appendChild(U.el('div', { class: 'chain-connector' }));
      el.appendChild(U.el('div', { class: 'chain-empty' }, [
        U.el('i', { class: 'bi bi-arrow-down me-1' }),
        st.source.status === 'ready' ? 'Add a step to start changing the data.' : 'Open a file first, then add steps.'
      ]));
    }
    var self = this;
    steps.forEach(function (step, i) {
      el.appendChild(U.el('div', { class: 'chain-connector' }));
      el.appendChild(self.stepCard(step, i));
    });
    if (scroll) this.scrollSelectedIntoView();
  };

  ChainView.prototype.scrollSelectedIntoView = function () {
    var sel = this.el.querySelector('.step-card.is-selected');
    if (sel && sel.scrollIntoViewIfNeeded) sel.scrollIntoViewIfNeeded(false);
    else if (sel) sel.scrollIntoView({ block: 'nearest' });
  };

  ChainView.prototype.sourceCard = function () {
    var st = this.store.state;
    var src = st.source;
    var selected = st.selectedId === 'source';
    var meta;
    if (src.status === 'ready' && src.info) {
      meta = U.el('div', { class: 'step-meta' }, [
        U.el('span', { class: 'status-dot status-ok' }),
        DL.rowsAndColumns(src.info.rowCount, src.info.columns.length)
      ]);
    } else if (src.status === 'loading') {
      meta = U.el('div', { class: 'step-meta text-secondary' }, [U.el('span', { class: 'spinner-border spinner-border-sm' }), ' Reading file…']);
    } else if (src.status === 'error') {
      meta = U.el('div', { class: 'step-meta text-danger' }, [U.el('span', { class: 'status-dot status-error' }), 'Could not read the file']);
    } else {
      meta = U.el('div', { class: 'step-meta text-secondary' }, ['No file yet']);
    }
    return U.el('div', { class: 'step-card' + (selected ? ' is-selected' : ''), tabindex: '0', role: 'button' }, [
      U.el('span', { class: 'step-num' }, [U.el('i', { class: 'bi bi-file-earmark-text' })]),
      U.el('div', { class: 'step-body' }, [
        U.el('div', { class: 'step-title', text: 'Source file' }),
        U.el('div', { class: 'step-summary', text: src.file ? src.file.name : 'Click to open a file' }),
        meta
      ])
    ]);
  };

  ChainView.prototype.stepCard = function (step, i) {
    var st = this.store.state;
    var op = DL.getOp(step.opId);
    var res = st.results[step.id];
    var selected = st.selectedId === step.id;
    var disabled = step.enabled === false;
    var status, statusText;
    if (disabled) status = 'skipped';
    else if (res) status = res.status;
    else if (this.store.validateStep(step.id).length) status = 'invalid';
    else status = st.source.status === 'ready' ? 'running' : 'invalid';
    if (res && res.hasTable && !disabled) statusText = DL.rowsAndColumns(res.rowCount, res.columns.length);
    else if (!res && !disabled && status === 'invalid' && st.source.status !== 'ready') statusText = '';
    else statusText = DL.RESULT_STATUS[status].label;
    var summary = '';
    try { summary = op.summary ? op.summary(step.params) : ''; } catch (e) { summary = ''; }
    return U.el('div', { class: 'step-card' + (selected ? ' is-selected' : '') + (disabled ? ' is-disabled' : ''), dataset: { step: step.id }, draggable: 'true', tabindex: '0', role: 'button' }, [
      U.el('span', { class: 'step-num', text: String(i + 1) }),
      U.el('div', { class: 'step-body' }, [
        U.el('div', { class: 'step-title' }, [U.el('i', { class: 'bi ' + (op ? op.icon : 'bi-question') }), op ? op.name : step.opId]),
        U.el('div', { class: 'step-summary', text: summary, title: summary }),
        U.el('div', { class: 'step-meta' }, [U.el('span', { class: 'status-dot status-' + status }), statusText])
      ]),
      U.el('div', { class: 'step-actions btn-group-vertical' }, [
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-secondary no-tip', title: disabled ? 'Turn on' : 'Turn off (skip this step)', dataset: { action: 'toggle' } }, [U.el('i', { class: 'bi ' + (disabled ? 'bi-toggle-off' : 'bi-toggle-on') })]),
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-secondary no-tip', title: 'Duplicate', dataset: { action: 'duplicate' } }, [U.el('i', { class: 'bi bi-copy' })]),
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger no-tip', title: 'Delete', dataset: { action: 'remove' } }, [U.el('i', { class: 'bi bi-trash' })])
      ])
    ]);
  };

  DL.ChainView = ChainView;
})(typeof self !== 'undefined' ? self : this);
