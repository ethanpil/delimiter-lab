/* Form field renderers for operation parameters.
 * DL.fields.render(param, value, ctx) -> element. ctx = { columns: string[], onChange(value, opts) }
 * onChange opts: { merge: true } groups quick edits (typing) into one undo entry.
 */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var F = DL.fields = {};

  function labelFor(param, forId) {
    var lab = U.el('label', { class: 'field-label', for: forId }, [param.label]);
    if (param.help) lab.appendChild(U.el('i', { class: 'bi bi-info-circle help-icon', 'data-bs-toggle': 'tooltip', title: param.help, tabindex: '0' }));
    return lab;
  }

  function wrap(param, control, wide) {
    var id = 'f_' + param.key + '_' + Math.random().toString(36).slice(2, 6);
    if (control.tagName === 'INPUT' || control.tagName === 'SELECT' || control.tagName === 'TEXTAREA') control.id = id;
    var w = U.el('div', { class: 'field' + (wide ? ' field-wide' : ''), dataset: { key: param.key } }, [labelFor(param, id), control]);
    return w;
  }

  function colSelect(columns, value, allowEmpty, emptyLabel) {
    var sel = U.el('select', { class: 'form-select form-select-sm' });
    if (allowEmpty || !value || columns.indexOf(value) < 0) sel.appendChild(U.el('option', { value: '', text: emptyLabel || (columns.length ? 'Choose a column…' : 'Load a file to see columns') }));
    columns.forEach(function (c) { sel.appendChild(U.el('option', { value: c, text: c })); });
    if (value && columns.indexOf(value) < 0) sel.appendChild(U.el('option', { value: value, text: value + ' (missing)' }));
    sel.value = value || '';
    return sel;
  }

  // HTML5 drag and drop for a list. onMove(fromIndex, toIndex) where toIndex is the insertion index.
  F.sortable = function (list, itemSelector, onMove) {
    var dragging = null;
    list.addEventListener('dragstart', function (e) {
      var li = e.target.closest(itemSelector);
      if (!li) return;
      dragging = li;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', ''); } catch (err) { /* IE */ }
    });
    list.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var li = e.target.closest(itemSelector);
      list.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
      if (!li || li === dragging) return;
      var r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('dragleave', function (e) {
      var li = e.target.closest && e.target.closest(itemSelector);
      if (li) li.classList.remove('drop-before', 'drop-after');
    });
    list.addEventListener('drop', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var li = e.target.closest(itemSelector);
      var items = Array.prototype.slice.call(list.querySelectorAll(itemSelector));
      var from = items.indexOf(dragging);
      if (li && li !== dragging) {
        var to = items.indexOf(li);
        if (li.classList.contains('drop-after')) to++;
        onMove(from, to);
      }
      list.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
    });
    list.addEventListener('dragend', function () {
      if (dragging) dragging.classList.remove('is-dragging');
      dragging = null;
      list.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
    });
  };

  function moveItem(arr, from, to) {
    var out = arr.slice();
    var item = out.splice(from, 1)[0];
    if (to > from) to--;
    out.splice(to, 0, item);
    return out;
  }

  // Renders an ordered list with drag handles and up / down buttons.
  function orderedList(items, onChange, opts) {
    var ul = U.el('ul', { class: 'sortable-list' });
    var rebuild = function () {
      U.empty(ul);
      if (!items.length) ul.appendChild(U.el('li', { class: 'text-secondary', text: opts && opts.emptyText || 'Nothing chosen yet.' }));
      items.forEach(function (name, i) {
        var li = U.el('li', { draggable: 'true', dataset: { index: i } }, [
          U.el('i', { class: 'bi bi-grip-vertical grip' }),
          U.el('span', { class: 'item-label', text: name, title: name }),
          U.el('button', { type: 'button', class: 'btn btn-link btn-sm', title: 'Move up', disabled: i === 0, onclick: function () { items = moveItem(items, i, i - 1); onChange(items); rebuild(); } }, [U.el('i', { class: 'bi bi-chevron-up' })]),
          U.el('button', { type: 'button', class: 'btn btn-link btn-sm', title: 'Move down', disabled: i === items.length - 1, onclick: function () { items = moveItem(items, i, i + 2); onChange(items); rebuild(); } }, [U.el('i', { class: 'bi bi-chevron-down' })]),
          opts && opts.removable ? U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger', title: 'Remove', onclick: function () { items = items.filter(function (x, j) { return j !== i; }); onChange(items); rebuild(); } }, [U.el('i', { class: 'bi bi-x-lg' })]) : null
        ]);
        ul.appendChild(li);
      });
    };
    F.sortable(ul, 'li[draggable]', function (from, to) { items = moveItem(items, from, to); onChange(items); rebuild(); });
    rebuild();
    ul.setItems = function (next) { items = next.slice(); rebuild(); };
    return ul;
  }

  var renderers = {};

  renderers.text = function (param, value, ctx) {
    var input = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: value == null ? '' : value, placeholder: param.placeholder || '', spellcheck: 'false' });
    input.addEventListener('input', function () { ctx.onChange(input.value, { merge: true }); });
    return wrap(param, input);
  };

  renderers.number = function (param, value, ctx) {
    var input = U.el('input', { type: 'number', class: 'form-control form-control-sm', value: value == null ? '' : value, step: param.step || 'any' });
    if (param.min != null) input.min = param.min;
    if (param.max != null) input.max = param.max;
    input.addEventListener('input', function () { ctx.onChange(input.value === '' ? '' : input.value, { merge: true }); });
    return wrap(param, input);
  };

  renderers.textarea = function (param, value, ctx) {
    var ta = U.el('textarea', { class: 'form-control form-control-sm', rows: '3', spellcheck: 'false' });
    ta.value = value == null ? '' : value;
    ta.addEventListener('input', function () { ctx.onChange(ta.value, { merge: true }); });
    return wrap(param, ta, true);
  };

  renderers.code = function (param, value, ctx) {
    var ta = U.el('textarea', { class: 'form-control form-control-sm code-editor', rows: '7', spellcheck: 'false' });
    ta.value = value == null ? '' : value;
    ta.addEventListener('input', function () { ctx.onChange(ta.value, { merge: true }); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ctx.onChange(ta.value, { merge: true });
      }
    });
    var w = wrap(param, ta, true);
    if (ctx.columns && ctx.columns.length) {
      var hint = U.el('div', { class: 'form-text' }, ['Columns: ']);
      ctx.columns.slice(0, 30).forEach(function (c, i) {
        hint.appendChild(U.el('a', { href: '#', class: 'text-mono me-2', text: 'row["' + c + '"]', onclick: function (e) {
          e.preventDefault();
          var s = ta.selectionStart;
          var ins = 'row[' + JSON.stringify(c) + ']';
          ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = s + ins.length;
          ta.focus();
          ctx.onChange(ta.value, { merge: true });
        } }));
      });
      w.appendChild(hint);
    }
    return w;
  };

  renderers.boolean = function (param, value, ctx) {
    var id = 'f_' + param.key + '_' + Math.random().toString(36).slice(2, 6);
    var input = U.el('input', { type: 'checkbox', class: 'form-check-input', role: 'switch', id: id });
    input.checked = !!value;
    input.addEventListener('change', function () { ctx.onChange(input.checked); });
    var lab = U.el('label', { class: 'form-check-label', for: id, text: param.label });
    if (param.help) lab.appendChild(U.el('i', { class: 'bi bi-info-circle help-icon ms-1', 'data-bs-toggle': 'tooltip', title: param.help, tabindex: '0' }));
    return U.el('div', { class: 'field', dataset: { key: param.key } }, [U.el('div', { class: 'form-check form-switch mt-4' }, [input, lab])]);
  };

  renderers.select = function (param, value, ctx) {
    var sel = U.el('select', { class: 'form-select form-select-sm' });
    (param.options || []).forEach(function (o) { sel.appendChild(U.el('option', { value: o.value, text: o.label })); });
    sel.value = value == null ? '' : value;
    sel.addEventListener('change', function () { ctx.onChange(sel.value); });
    return wrap(param, sel);
  };

  renderers.checkboxes = function (param, value, ctx) {
    var chosen = (value || []).slice();
    var box = U.el('div', { class: 'column-list' });
    (param.options || []).forEach(function (o) {
      var id = 'f_' + param.key + '_' + o.value + '_' + Math.random().toString(36).slice(2, 5);
      var input = U.el('input', { type: 'checkbox', class: 'form-check-input', id: id, value: o.value });
      input.checked = chosen.indexOf(o.value) >= 0;
      input.addEventListener('change', function () {
        chosen = (param.options || []).map(function (x) { return x.value; }).filter(function (v) {
          return v === o.value ? input.checked : chosen.indexOf(v) >= 0;
        });
        ctx.onChange(chosen);
      });
      box.appendChild(U.el('div', { class: 'form-check' }, [input, U.el('label', { class: 'form-check-label', for: id, text: o.label })]));
    });
    return wrap(param, box);
  };

  renderers.column = function (param, value, ctx) {
    var sel = colSelect(ctx.columns, value, param.required === false, param.required === false ? '(none)' : null);
    sel.addEventListener('change', function () { ctx.onChange(sel.value); });
    return wrap(param, sel);
  };

  renderers.columns = function (param, value, ctx) {
    var chosen = (value || []).slice();
    var columns = ctx.columns || [];
    var box = U.el('div', { class: 'column-list' });
    var filter = U.el('input', { type: 'search', class: 'form-control form-control-sm', placeholder: 'Filter columns…' });
    var tools = U.el('div', { class: 'column-list-tools' }, [
      U.el('a', { href: '#', text: 'All', onclick: function (e) { e.preventDefault(); setChosen(columns.slice()); } }),
      U.el('a', { href: '#', text: 'None', onclick: function (e) { e.preventDefault(); setChosen([]); } }),
      U.el('span', { class: 'text-secondary ms-auto', dataset: { role: 'count' } })
    ]);
    var missing = chosen.filter(function (c) { return columns.indexOf(c) < 0; });
    var ordered = null;
    var checks = {};
    function setChosen(next) {
      chosen = next;
      Object.keys(checks).forEach(function (c) { checks[c].checked = chosen.indexOf(c) >= 0; });
      if (ordered) ordered.setItems(chosen);
      updateCount();
      ctx.onChange(chosen.slice());
    }
    function updateCount() {
      tools.querySelector('[data-role=count]').textContent = chosen.length ? chosen.length + ' of ' + columns.length + ' chosen' : '';
    }
    if (!columns.length) box.appendChild(U.el('div', { class: 'text-secondary small', text: 'Load a file to see its columns.' }));
    columns.forEach(function (c) {
      var id = 'f_' + param.key + '_' + Math.random().toString(36).slice(2, 7);
      var input = U.el('input', { type: 'checkbox', class: 'form-check-input', id: id });
      input.checked = chosen.indexOf(c) >= 0;
      checks[c] = input;
      input.addEventListener('change', function () {
        var next = chosen.filter(function (x) { return x !== c; });
        if (input.checked) {
          if (param.ordered) next.push(c);
          else next = columns.filter(function (x) { return x === c || chosen.indexOf(x) >= 0; });
        }
        setChosen(next);
      });
      box.appendChild(U.el('div', { class: 'form-check', dataset: { name: c.toLowerCase() } }, [input, U.el('label', { class: 'form-check-label', for: id, text: c })]));
    });
    missing.forEach(function (c) {
      var noFile = !columns.length;
      box.appendChild(U.el('div', { class: 'form-check' + (noFile ? '' : ' text-danger') }, [
        U.el('input', { type: 'checkbox', class: 'form-check-input', checked: true, onchange: function () { setChosen(chosen.filter(function (x) { return x !== c; })); } }),
        U.el('label', { class: 'form-check-label', text: noFile ? c : c + ' (missing)' })
      ]));
    });
    filter.addEventListener('input', function () {
      var q = filter.value.toLowerCase();
      box.querySelectorAll('.form-check[data-name]').forEach(function (row) { row.hidden = q && row.dataset.name.indexOf(q) < 0; });
    });
    var parts = [columns.length > 8 ? filter : null, tools, box];
    if (param.ordered) {
      ordered = orderedList(chosen, function (next) { chosen = next; ctx.onChange(chosen.slice()); }, { emptyText: 'Tick columns above to add them here.' });
      parts.push(U.el('div', { class: 'form-text mt-2', text: 'Order (drag or use the arrows):' }));
      parts.push(ordered);
    }
    updateCount();
    var w = wrap(param, U.el('div', {}, parts));
    return w;
  };

  renderers.columnOrder = function (param, value, ctx) {
    var columns = ctx.columns || [];
    var order = (value || []).filter(function (c) { return columns.indexOf(c) >= 0; });
    columns.forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); });
    var list = orderedList(order, function (next) { ctx.onChange(next.slice()); });
    var tools = U.el('div', { class: 'd-flex gap-2 mb-1' }, [
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: 'Sort A → Z', onclick: function () { var n = order.slice().sort(DL.compareText); order = n; list.setItems(n); ctx.onChange(n.slice()); } }),
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: 'Reverse', onclick: function () { var n = order.slice().reverse(); order = n; list.setItems(n); ctx.onChange(n.slice()); } }),
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: 'Original order', onclick: function () { order = columns.slice(); list.setItems(order); ctx.onChange(order.slice()); } })
    ]);
    if (!columns.length) return wrap(param, U.el('div', { class: 'text-secondary small', text: 'Load a file to see its columns.' }), true);
    return wrap(param, U.el('div', {}, [tools, list]), true);
  };

  renderers.renameMap = function (param, value, ctx) {
    var map = Object.assign({}, value || {});
    var columns = ctx.columns || [];
    if (!columns.length) return wrap(param, U.el('div', { class: 'text-secondary small', text: 'Load a file to see its columns.' }), true);
    var table = U.el('table', { class: 'table table-sm mb-0 mapping-table' }, [
      U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: 'Current name' }), U.el('th', { text: 'New name' })])])
    ]);
    var tbody = U.el('tbody');
    columns.forEach(function (c) {
      var input = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: map[c] || '', placeholder: c, spellcheck: 'false' });
      input.addEventListener('input', function () {
        if (input.value.trim()) map[c] = input.value; else delete map[c];
        ctx.onChange(Object.assign({}, map), { merge: true });
      });
      tbody.appendChild(U.el('tr', {}, [U.el('td', { class: 'align-middle', text: c }), U.el('td', {}, [input])]));
    });
    table.appendChild(tbody);
    var tools = U.el('div', { class: 'd-flex gap-3 mb-1 small' }, [
      quickLink('Title Case', function (c) { return DL.titleCase(c.replace(/[_\-]+/g, ' ')); }),
      quickLink('lower_snake_case', function (c) { return c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }),
      quickLink('Remove spaces', function (c) { return c.replace(/\s+/g, ''); }),
      U.el('a', { href: '#', text: 'Clear', onclick: function (e) { e.preventDefault(); map = {}; tbody.querySelectorAll('input').forEach(function (i) { i.value = ''; }); ctx.onChange({}); } })
    ]);
    function quickLink(label, fn) {
      return U.el('a', { href: '#', text: label, onclick: function (e) {
        e.preventDefault();
        map = {};
        columns.forEach(function (c, i) { var n = fn(c); if (n && n !== c) map[c] = n; });
        tbody.querySelectorAll('input').forEach(function (inp, i) { inp.value = map[columns[i]] || ''; });
        ctx.onChange(Object.assign({}, map));
      } });
    }
    return wrap(param, U.el('div', {}, [tools, U.el('div', { class: 'column-list', style: 'max-height:260px' }, [table])]), true);
  };

  renderers.mapping = function (param, value, ctx) {
    var rows = (value && value.length ? value : [{ from: '', to: '' }]).map(function (r) { return { from: r.from || '', to: r.to || '' }; });
    var table = U.el('table', { class: 'table table-sm mb-0 mapping-table' }, [
      U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: 'Find this value' }), U.el('th', { text: 'Replace with' }), U.el('th')])])
    ]);
    var tbody = U.el('tbody');
    function emit() { ctx.onChange(rows.map(function (r) { return { from: r.from, to: r.to }; }), { merge: true }); }
    function rebuild() {
      U.empty(tbody);
      rows.forEach(function (r, i) {
        var from = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.from, spellcheck: 'false', placeholder: 'e.g. CA' });
        var to = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.to, spellcheck: 'false', placeholder: 'e.g. California' });
        from.addEventListener('input', function () { r.from = from.value; emit(); });
        to.addEventListener('input', function () { r.to = to.value; emit(); });
        [from, to].forEach(function (inp) { inp.addEventListener('paste', function (e) { handlePaste(e, i, inp === to); }); });
        var del = U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger', title: 'Remove', onclick: function () { rows.splice(i, 1); if (!rows.length) rows.push({ from: '', to: '' }); rebuild(); ctx.onChange(rows.slice()); } }, [U.el('i', { class: 'bi bi-x-lg' })]);
        tbody.appendChild(U.el('tr', {}, [U.el('td', {}, [from]), U.el('td', {}, [to]), U.el('td', {}, [del])]));
      });
    }
    // Pasting two tab separated columns fills many rows at once.
    function handlePaste(e, index, isTo) {
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || text.indexOf('\n') < 0 && text.indexOf('\t') < 0) return;
      e.preventDefault();
      var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
      var parsed = lines.map(function (l) {
        var parts = l.split('\t');
        if (parts.length < 2) parts = l.split(',');
        return { from: (parts[0] || '').trim(), to: (parts.slice(1).join(',') || '').trim() };
      });
      if (isTo && parsed.every(function (p) { return p.to === ''; })) {
        parsed.forEach(function (p, k) { if (rows[index + k]) rows[index + k].to = p.from; else rows.push({ from: '', to: p.from }); });
      } else {
        rows.splice.apply(rows, [index, 1].concat(parsed));
      }
      rebuild();
      ctx.onChange(rows.slice());
    }
    rebuild();
    table.appendChild(tbody);
    var add = U.el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm mt-1', onclick: function () { rows.push({ from: '', to: '' }); rebuild(); tbody.querySelector('tr:last-child input').focus(); } }, [U.el('i', { class: 'bi bi-plus-lg' }), ' Add value']);
    var hint = U.el('div', { class: 'form-text', text: 'Tip: paste two columns from a spreadsheet into the first box to fill the whole list.' });
    return wrap(param, U.el('div', {}, [U.el('div', { class: 'column-list', style: 'max-height:260px' }, [table]), add, hint]), true);
  };

  // Shared renderer for lists of rules (filter conditions and verify rules).
  function ruleRows(param, value, ctx, opts) {
    var rules = (value && value.length ? value : [opts.blank()]).map(function (r) { return Object.assign(opts.blank(), r); });
    var box = U.el('div', { class: 'rows-editor' });
    function emit(merge) { ctx.onChange(rules.map(function (r) { return Object.assign({}, r); }), { merge: !!merge }); }
    function rebuild() {
      U.empty(box);
      rules.forEach(function (r, i) {
        var row = U.el('div', { class: 'rule-row' });
        var col = colSelect(ctx.columns || [], r.column);
        col.addEventListener('change', function () { r.column = col.value; emit(); });
        var op = U.el('select', { class: 'form-select form-select-sm' });
        opts.operators.forEach(function (o) { op.appendChild(U.el('option', { value: o.value, text: o.label })); });
        op.value = r.op || opts.operators[0].value;
        var val = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.value == null ? '' : r.value, spellcheck: 'false' });
        var val2 = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.value2 == null ? '' : r.value2, placeholder: 'and' });
        var syncInputs = function () {
          var def = opts.operators.filter(function (o) { return o.value === op.value; })[0] || { needs: 'text' };
          val.hidden = def.needs === 'none';
          val2.hidden = def.needs !== 'range';
          val.placeholder = def.needs === 'number' ? 'number' : def.needs === 'date' ? 'e.g. 2024-01-31' : def.needs === 'range' ? 'from' : 'value';
          val.type = 'text';
        };
        op.addEventListener('change', function () { r.op = op.value; syncInputs(); emit(); });
        val.addEventListener('input', function () { r.value = val.value; emit(true); });
        val2.addEventListener('input', function () { r.value2 = val2.value; emit(true); });
        syncInputs();
        row.appendChild(col); row.appendChild(op); row.appendChild(val); row.appendChild(val2);
        if (opts.allowEmpty) {
          var id = 'ae_' + Math.random().toString(36).slice(2, 7);
          var ae = U.el('input', { type: 'checkbox', class: 'form-check-input', id: id });
          ae.checked = r.allowEmpty !== false;
          ae.addEventListener('change', function () { r.allowEmpty = ae.checked; emit(); });
          row.appendChild(U.el('div', { class: 'form-check', title: 'Empty values pass this rule' }, [ae, U.el('label', { class: 'form-check-label small', for: id, text: 'Skip empty' })]));
        }
        row.appendChild(U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger btn-remove', title: 'Remove rule', onclick: function () { rules.splice(i, 1); if (!rules.length) rules.push(opts.blank()); rebuild(); emit(); } }, [U.el('i', { class: 'bi bi-x-lg' })]));
        box.appendChild(row);
      });
    }
    rebuild();
    var add = U.el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm mt-1', onclick: function () { rules.push(opts.blank()); rebuild(); emit(); box.querySelector('.rule-row:last-child select').focus(); } }, [U.el('i', { class: 'bi bi-plus-lg' }), ' Add rule']);
    return wrap(param, U.el('div', {}, [box, add]), true);
  }

  renderers.conditions = function (param, value, ctx) {
    return ruleRows(param, value, ctx, { operators: DL.FILTER_OPERATORS, blank: function () { return { column: '', op: 'contains', value: '', value2: '' }; } });
  };

  renderers.rules = function (param, value, ctx) {
    return ruleRows(param, value, ctx, { operators: DL.VERIFY_RULES, allowEmpty: true, blank: function () { return { column: '', op: 'notEmpty', value: '', allowEmpty: true }; } });
  };

  renderers.sortKeys = function (param, value, ctx) {
    var keys = (value && value.length ? value : [{ column: '', type: 'auto', dir: 'asc' }]).map(function (k) { return Object.assign({ column: '', type: 'auto', dir: 'asc' }, k); });
    var box = U.el('div', { class: 'rows-editor' });
    function emit() { ctx.onChange(keys.map(function (k) { return Object.assign({}, k); })); }
    function rebuild() {
      U.empty(box);
      keys.forEach(function (k, i) {
        var col = colSelect(ctx.columns || [], k.column);
        col.addEventListener('change', function () { k.column = col.value; emit(); });
        var type = U.el('select', { class: 'form-select form-select-sm' });
        [['auto', 'Detect type'], ['text', 'As text'], ['number', 'As numbers'], ['date', 'As dates']].forEach(function (o) { type.appendChild(U.el('option', { value: o[0], text: o[1] })); });
        type.value = k.type;
        type.addEventListener('change', function () { k.type = type.value; emit(); });
        var dir = U.el('select', { class: 'form-select form-select-sm' });
        [['asc', 'A → Z / low → high'], ['desc', 'Z → A / high → low']].forEach(function (o) { dir.appendChild(U.el('option', { value: o[0], text: o[1] })); });
        dir.value = k.dir;
        dir.addEventListener('change', function () { k.dir = dir.value; emit(); });
        var row = U.el('div', { class: 'rule-row' }, [
          U.el('span', { class: 'text-secondary small', style: 'flex:0 0 auto', text: i === 0 ? 'Sort by' : 'then by' }),
          col, type, dir,
          U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger btn-remove', title: 'Remove', onclick: function () { keys.splice(i, 1); if (!keys.length) keys.push({ column: '', type: 'auto', dir: 'asc' }); rebuild(); emit(); } }, [U.el('i', { class: 'bi bi-x-lg' })])
        ]);
        box.appendChild(row);
      });
    }
    rebuild();
    var add = U.el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm mt-1', onclick: function () { keys.push({ column: '', type: 'auto', dir: 'asc' }); rebuild(); emit(); } }, [U.el('i', { class: 'bi bi-plus-lg' }), ' Add another column']);
    return wrap(param, U.el('div', {}, [box, add]), true);
  };

  F.render = function (param, value, ctx) {
    var r = renderers[param.type];
    if (!r) return wrap(param, U.el('div', { class: 'text-danger', text: 'Unknown field type "' + param.type + '".' }));
    return r(param, value, ctx);
  };

  F.colSelect = colSelect;
  F.orderedList = orderedList;
})(typeof self !== 'undefined' ? self : this);
