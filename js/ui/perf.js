/* Timing panel: the time and the memory of each step. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  var BYTES_PER_CELL = 32; // An estimate for short text values in V8.


  function cellsText(cells) {
    return cells >= 1e6 ? (cells / 1e6).toFixed(1) + ' M' : U.fmtInt(cells);
  }

  // Opens the panel. store gives the steps and results; memory is the reply of the worker.
  DL.showTiming = function (store, memory) {
    var st = store.state;
    var head = U.el('tr', {}, [DL.t('timing.step'), DL.t('timing.operation'), DL.t('timing.time'), DL.t('timing.rows'), DL.t('timing.cells'), DL.t('timing.status')]
      .map(function (t, i) { return U.el('th', { class: i >= 2 && i <= 4 ? 'text-end' : '', text: t }); }));
    var rows = [];
    var totalMs = 0;
    if (st.source.info) {
      var info = st.source.info;
      totalMs += info.ms || 0;
      rows.push(U.el('tr', {}, [
        U.el('td', { text: '' }),
        U.el('td', { text: DL.t('timing.source') + ' · ' + info.fileName }),
        U.el('td', { class: 'text-end', text: DL.formatMs(info.ms) }),
        U.el('td', { class: 'text-end', text: U.fmtInt(info.rowCount) }),
        U.el('td', { class: 'text-end', text: cellsText(info.rowCount * info.columns.length) }),
        U.el('td', { text: '' })
      ]));
    }
    st.workflow.steps.forEach(function (step, i) {
      var op = DL.getOp(step.opId);
      var r = st.results[step.id];
      var status = r ? (DL.RESULT_STATUS[r.status] ? DL.RESULT_STATUS[r.status].label : r.status) : '';
      var cells = r && r.hasTable ? r.rowCount * r.columns.length : 0;
      var ran = r && (r.hasTable || r.status === 'error'); // a step that failed also took time
      if (ran) totalMs += r.ms || 0;
      rows.push(U.el('tr', { class: step.enabled === false ? 'text-secondary' : '' }, [
        U.el('td', { text: String(i + 1) }),
        U.el('td', { text: op ? op.name : step.opId }),
        U.el('td', { class: 'text-end', text: ran ? DL.formatMs(r.ms) : '' }),
        U.el('td', { class: 'text-end', text: r && r.hasTable ? U.fmtInt(r.rowCount) : '' }),
        U.el('td', { class: 'text-end', text: r && r.hasTable ? cellsText(cells) : '' }),
        U.el('td', { text: status })
      ]));
    });
    rows.push(U.el('tr', { class: 'fw-semibold' }, [
      U.el('td', {}), U.el('td', { text: DL.t('timing.total') }), U.el('td', { class: 'text-end', text: DL.formatMs(totalMs) }), U.el('td', {}), U.el('td', {}), U.el('td', {})
    ]));
    var memoryText = memory ? DL.t('timing.memory', {
      cells: DL.pluralize(Math.round(memory.cells), 'cell'),
      mb: U.fmtBytes(memory.cells * BYTES_PER_CELL),
      limit: DL.pluralize(memory.maxCells, 'cell')
    }) : '';
    U.modal({
      title: DL.t('timing.title'),
      size: 'lg',
      scrollable: true,
      body: U.el('div', {}, [
        st.source.status === 'ready' ? null : U.el('p', { class: 'text-secondary', text: DL.t('timing.noFile') }),
        U.el('div', { class: 'table-responsive' }, [U.el('table', { class: 'table table-sm timing-table' }, [U.el('thead', {}, [head]), U.el('tbody', {}, rows)])]),
        memoryText ? U.el('p', { class: 'mb-1', text: memoryText }) : null,
        U.el('p', { class: 'small text-secondary mb-0', text: DL.t('timing.note') })
      ]),
      footer: [U.el('button', { type: 'button', class: 'btn btn-primary', 'data-bs-dismiss': 'modal', text: DL.t('common.close') })]
    });
  };
})(typeof self !== 'undefined' ? self : this);
