/* The steps list in the sidebar. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var SLOW_MS = 400; // a step that takes this long is worth a word on its card

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
    // The keyboard focus survives the rebuild: the card with the same step id gets it back.
    var focused = document.activeElement && this.el.contains(document.activeElement) ? document.activeElement.closest('[data-step]') : null;
    var focusId = focused ? focused.getAttribute('data-step') : null;
    var el = U.empty(this.el);
    el.appendChild(this.sourceCard());
    if (!steps.length) {
      el.appendChild(U.el('div', { class: 'chain-connector' }));
      el.appendChild(U.el('div', { class: 'chain-empty' }, [
        U.el('i', { class: 'bi bi-arrow-down me-1' }),
        DL.t(st.source.status === 'ready' ? 'chain.addStep' : 'chain.openFirst')
      ]));
    }
    var self = this;
    steps.forEach(function (step, i) {
      el.appendChild(U.el('div', { class: 'chain-connector' }));
      el.appendChild(self.stepCard(step, i));
    });
    if (scroll) this.scrollSelectedIntoView();
    if (focusId) { var again = el.querySelector('[data-step="' + focusId + '"]'); if (again) again.focus(); }
    U.hideOrphanTooltips();
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
      meta = U.el('div', { class: 'step-meta text-secondary' }, [U.el('span', { class: 'spinner-border spinner-border-sm' }), ' ' + DL.t('chain.readingFile')]);
    } else if (src.status === 'error') {
      meta = U.el('div', { class: 'step-meta text-danger' }, [U.el('span', { class: 'status-dot status-error' }), DL.t('chain.readError')]);
    } else {
      meta = U.el('div', { class: 'step-meta text-secondary' }, [DL.t('chain.noFile')]);
    }
    return U.el('div', { class: 'step-card' + (selected ? ' is-selected' : ''), dataset: { step: 'source' }, tabindex: '0', role: 'button' }, [
      U.el('span', { class: 'step-num' }, [U.el('i', { class: 'bi bi-file-earmark-text' })]),
      U.el('div', { class: 'step-body' }, [
        U.el('div', { class: 'step-title', text: DL.t('preview.sourceFile') }),
        U.el('div', { class: 'step-summary', text: src.file ? src.file.name : DL.t('chain.clickToOpen') }),
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
        U.el('div', { class: 'step-meta' }, [
          U.el('span', { class: 'status-dot status-' + status }),
          statusText,
          // Only a step that takes time says how long. The others are noise.
          (res && res.ms >= SLOW_MS)
            ? U.el('span', { class: 'step-time', title: DL.t('chain.tookTime'), text: U.formatMs(res.ms) })
            : null
        ])
      ]),
      U.el('div', { class: 'step-actions btn-group-vertical' }, [
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-secondary no-tip', title: DL.t(disabled ? 'chain.turnOn' : 'chain.turnOff'), dataset: { action: 'toggle' } }, [U.el('i', { class: 'bi ' + (disabled ? 'bi-toggle-off' : 'bi-toggle-on') })]),
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-secondary no-tip', title: DL.t('chain.duplicate'), dataset: { action: 'duplicate' } }, [U.el('i', { class: 'bi bi-copy' })]),
        U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger no-tip', title: DL.t('common.delete'), dataset: { action: 'remove' } }, [U.el('i', { class: 'bi bi-trash' })])
      ])
    ]);
  };

  DL.ChainView = ChainView;
})(typeof self !== 'undefined' ? self : this);
