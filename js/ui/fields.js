/* Form field renderers for operation and format settings.
 * DL.fields.render(param, value, ctx) -> element.
 * ctx = { columns: string[] | null, onChange(value, opts), compact }
 * columns === null means that the input columns are not known yet.
 * onChange opts: { merge: true } groups quick edits (typing) into one undo entry.
 */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;
  var F = DL.fields = {};
  var hasOwn = Object.prototype.hasOwnProperty;

  function labelFor(param, forId) {
    var lab = U.el('label', { class: 'field-label', for: forId }, [param.label]);
    if (param.help) lab.appendChild(U.helpIcon(param.help));
    return lab;
  }

  function wrap(param, control, wide) {
    var id = U.domId('f');
    if (control.tagName === 'INPUT' || control.tagName === 'SELECT' || control.tagName === 'TEXTAREA') control.id = id;
    return U.el('div', { class: 'field' + (wide ? ' field-wide' : ''), dataset: { key: param.key } }, [labelFor(param, id), control]);
  }

  function noColumnsMessage(columns) {
    return DL.t(columns === null ? 'fields.columnsLater' : 'fields.noColumns');
  }

  function colSelect(columns, value, allowEmpty, emptyLabel) {
    var known = columns || [];
    var options = [];
    if (allowEmpty || !value || known.indexOf(value) < 0) options.push({ value: '', label: emptyLabel || (known.length ? DL.t('fields.chooseColumn') : noColumnsMessage(columns)) });
    known.forEach(function (c) { options.push({ value: c, label: c }); });
    if (value && known.indexOf(value) < 0) options.push({ value: value, label: columns ? DL.t('fields.missing', { name: value }) : value });
    return U.select(options, value || '');
  }

  // HTML5 drag and drop for a list. onMove(fromIndex, toIndex) where toIndex is the insertion index.
  F.sortable = function (list, itemSelector, onMove) {
    var dragging = null;
    function clearMarks() {
      list.querySelectorAll('.drop-before, .drop-after').forEach(function (x) { x.classList.remove('drop-before', 'drop-after'); });
    }
    list.addEventListener('dragstart', function (e) {
      var li = e.target.closest(itemSelector);
      if (!li) return;
      dragging = li;
      li.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    list.addEventListener('dragover', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var li = e.target.closest(itemSelector);
      clearMarks();
      if (!li || li === dragging) return;
      var r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
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
      clearMarks();
    });
    list.addEventListener('dragend', function () {
      if (dragging) dragging.classList.remove('is-dragging');
      dragging = null;
      clearMarks();
    });
  };

  function moveItem(arr, from, to) {
    var out = arr.slice();
    var item = out.splice(from, 1)[0];
    if (to > from) to--;
    out.splice(to, 0, item);
    return out;
  }

  // An ordered list with drag handles and up / down buttons.
  function orderedList(items, onChange, opts) {
    var ul = U.el('ul', { class: 'sortable-list' });
    var rebuild = function () {
      U.empty(ul);
      if (!items.length) ul.appendChild(U.el('li', { class: 'text-secondary', text: opts && opts.emptyText || DL.t('fields.nothingChosen') }));
      items.forEach(function (name, i) {
        ul.appendChild(U.el('li', { draggable: 'true' }, [
          U.el('i', { class: 'bi bi-grip-vertical grip' }),
          U.el('span', { class: 'item-label', text: name, title: name }),
          U.el('button', { type: 'button', class: 'btn btn-link btn-sm', title: DL.t('fields.moveUp'), disabled: i === 0, onclick: function () { items = moveItem(items, i, i - 1); onChange(items); rebuild(); } }, [U.el('i', { class: 'bi bi-chevron-up' })]),
          U.el('button', { type: 'button', class: 'btn btn-link btn-sm', title: DL.t('fields.moveDown'), disabled: i === items.length - 1, onclick: function () { items = moveItem(items, i, i + 2); onChange(items); rebuild(); } }, [U.el('i', { class: 'bi bi-chevron-down' })])
        ]));
      });
    };
    F.sortable(ul, 'li[draggable]', function (from, to) { items = moveItem(items, from, to); onChange(items); rebuild(); });
    rebuild();
    ul.setItems = function (next) { items = next.slice(); rebuild(); };
    return ul;
  }

  // A list of rows with an "Add" button. opts = { renderRow(row, api, index) -> element, addLabel, focusSelector }
  // The empty row comes from the field type. api = { emit(merge), remove(), edit(fn) };
  // edit(fn) calls fn(rows, index), then builds the list again. Rows are copied before they go to the store.
  function listEditor(param, value, ctx, opts) {
    var blank = DL.paramTypes[param.type].blank;
    opts.blank = blank;
    var rows = (value && value.length ? value : [blank()]).map(function (r) { return Object.assign(blank(), r); });
    var box = U.el('div', { class: 'rows-editor' });
    function emit(merge) { ctx.onChange(rows.map(function (r) { return Object.assign({}, r); }), { merge: !!merge }); }
    function rebuild() {
      U.empty(box);
      rows.forEach(function (r, i) {
        box.appendChild(opts.renderRow(r, {
          emit: emit,
          remove: function () { rows.splice(i, 1); if (!rows.length) rows.push(opts.blank()); rebuild(); emit(); },
          edit: function (fn) { fn(rows, i); if (!rows.length) rows.push(opts.blank()); rebuild(); emit(); }
        }, i));
      });
    }
    rebuild();
    var add = U.el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm mt-1', onclick: function () {
      rows.push(opts.blank());
      rebuild();
      emit();
      var last = box.lastChild && box.lastChild.querySelector(opts.focusSelector || 'select, input');
      if (last) last.focus();
    } }, [U.el('i', { class: 'bi bi-plus-lg' }), ' ' + opts.addLabel]);
    return { box: box, add: add };
  }

  function removeButton(title, onclick) {
    return U.el('button', { type: 'button', class: 'btn btn-link btn-sm text-danger btn-remove', title: title, onclick: onclick }, [U.el('i', { class: 'bi bi-x-lg' })]);
  }

  var renderers = {};

  renderers.text = function (param, value, ctx) {
    var input = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: value == null ? '' : value, spellcheck: 'false' });
    input.addEventListener('input', function () { ctx.onChange(input.value, { merge: true }); });
    return wrap(param, input);
  };

  renderers.number = function (param, value, ctx) {
    var input = U.el('input', { type: 'number', class: 'form-control form-control-sm', value: value == null ? '' : value, step: 'any' });
    if (param.min != null) input.min = param.min;
    if (param.max != null) input.max = param.max;
    input.addEventListener('input', function () { ctx.onChange(input.value, { merge: true }); });
    return wrap(param, input);
  };

  renderers.code = function (param, value, ctx) {
    var ta = U.el('textarea', { class: 'form-control form-control-sm code-editor', rows: '7', spellcheck: 'false' });
    ta.value = value == null ? '' : value;
    ta.addEventListener('input', function () { ctx.onChange(ta.value, { merge: true }); });
    // Tab writes two spaces. Shift+Tab and Escape leave the editor, so the keyboard is not trapped.
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { ta.blur(); return; }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        ta.setRangeText('  ', s, en, 'end'); // keeps the undo history of the browser
        ctx.onChange(ta.value, { merge: true });
      }
    });
    var w = wrap(param, ta, true);
    if (ctx.columns && ctx.columns.length) {
      var hint = U.el('div', { class: 'form-text' }, [DL.t('fields.columnsHint')]);
      ctx.columns.slice(0, 30).forEach(function (c) {
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
    var check = U.check(param.label, value, function (on) { ctx.onChange(on); }, { switch: true, help: param.help, class: ctx.compact ? '' : 'mt-4' });
    return U.el('div', { class: 'field', dataset: { key: param.key } }, [check.el]);
  };

  renderers.select = function (param, value, ctx) {
    return wrap(param, U.select(param.options, value, function (v) { ctx.onChange(v); }));
  };

  renderers.checkboxes = function (param, value, ctx) {
    var chosen = (value || []).slice();
    var box = U.el('div', { class: 'column-list' });
    param.options.forEach(function (o) {
      var check = U.check(o.label, chosen.indexOf(o.value) >= 0, function (on) {
        chosen = param.options.map(function (x) { return x.value; }).filter(function (v) {
          return v === o.value ? on : chosen.indexOf(v) >= 0;
        });
        ctx.onChange(chosen.slice());
      });
      box.appendChild(check.el);
    });
    return wrap(param, box);
  };

  renderers.column = function (param, value, ctx) {
    var sel = colSelect(ctx.columns, value, param.required === false, param.required === false ? DL.t('fields.noneOption') : null);
    sel.addEventListener('change', function () { ctx.onChange(sel.value); });
    return wrap(param, sel);
  };

  renderers.columns = function (param, value, ctx) {
    var chosen = (value || []).slice();
    var columns = ctx.columns || [];
    var known = !!ctx.columns;
    var box = U.el('div', { class: 'column-list' });
    var filter = U.el('input', { type: 'search', class: 'form-control form-control-sm', placeholder: DL.t('fields.filterColumns') });
    var countEl = U.el('span', { class: 'text-secondary ms-auto' });
    var tools = U.el('div', { class: 'column-list-tools' }, [
      U.el('a', { href: '#', text: DL.t('fields.all'), onclick: function (e) { e.preventDefault(); setChosen(columns.slice()); } }),
      U.el('a', { href: '#', text: DL.t('fields.none'), onclick: function (e) { e.preventDefault(); setChosen([]); } }),
      countEl
    ]);
    var ordered = null;
    var checks = new Map();
    function setChosen(next) {
      chosen = next;
      checks.forEach(function (input, c) { input.checked = chosen.indexOf(c) >= 0; });
      if (ordered) ordered.setItems(chosen);
      updateCount();
      ctx.onChange(chosen.slice());
    }
    function updateCount() {
      countEl.textContent = chosen.length && columns.length ? DL.t('fields.chosenCount', { n: chosen.length, total: columns.length }) : '';
    }
    if (!columns.length) box.appendChild(U.el('div', { class: 'text-secondary small', text: noColumnsMessage(ctx.columns) }));
    columns.forEach(function (c) {
      var check = U.check(c, chosen.indexOf(c) >= 0, function (on) {
        var next = chosen.filter(function (x) { return x !== c; });
        if (on) {
          if (param.ordered) next.push(c);
          else next = columns.filter(function (x) { return x === c || chosen.indexOf(x) >= 0; });
        }
        setChosen(next);
      });
      check.el.dataset.name = c.toLowerCase();
      checks.set(c, check.input);
      box.appendChild(check.el);
    });
    chosen.filter(function (c) { return columns.indexOf(c) < 0; }).forEach(function (c) {
      var check = U.check(known ? DL.t('fields.missing', { name: c }) : c, true, function (on) {
        setChosen(on ? chosen.concat(chosen.indexOf(c) < 0 ? [c] : []) : chosen.filter(function (x) { return x !== c; }));
      });
      if (known) check.el.classList.add('text-danger');
      check.el.dataset.name = c.toLowerCase();
      checks.set(c, check.input);
      box.appendChild(check.el);
    });
    filter.addEventListener('input', function () {
      var q = filter.value.toLowerCase();
      box.querySelectorAll('.form-check[data-name]').forEach(function (row) { row.hidden = q && row.dataset.name.indexOf(q) < 0; });
    });
    var parts = [columns.length > 8 ? filter : null, tools, box];
    if (param.ordered) {
      ordered = orderedList(chosen, function (next) { chosen = next; ctx.onChange(chosen.slice()); }, { emptyText: DL.t('fields.tickColumns') });
      parts.push(U.el('div', { class: 'form-text mt-2', text: DL.t('fields.orderHint') }));
      parts.push(ordered);
    }
    updateCount();
    return wrap(param, U.el('div', {}, parts));
  };

  renderers.columnOrder = function (param, value, ctx) {
    var columns = ctx.columns || [];
    if (!columns.length) return wrap(param, U.el('div', { class: 'text-secondary small', text: noColumnsMessage(ctx.columns) }), true);
    var order = (value || []).filter(function (c) { return columns.indexOf(c) >= 0; });
    columns.forEach(function (c) { if (order.indexOf(c) < 0) order.push(c); });
    var list = orderedList(order, function (next) { order = next; ctx.onChange(next.slice()); });
    var set = function (next) { order = next; list.setItems(next); ctx.onChange(next.slice()); };
    var tools = U.el('div', { class: 'd-flex gap-2 mb-1' }, [
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: DL.t('fields.sortAZ'), onclick: function () { set(order.slice().sort(DL.compareText)); } }),
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: DL.t('fields.reverse'), onclick: function () { set(order.slice().reverse()); } }),
      U.el('button', { type: 'button', class: 'btn btn-link btn-sm p-0', text: DL.t('fields.originalOrder'), onclick: function () { set(columns.slice()); } })
    ]);
    return wrap(param, U.el('div', {}, [tools, list]), true);
  };

  renderers.renameMap = function (param, value, ctx) {
    var map = Object.assign(Object.create(null), value || {});
    var columns = ctx.columns || [];
    if (!columns.length) return wrap(param, U.el('div', { class: 'text-secondary small', text: noColumnsMessage(ctx.columns) }), true);
    // A name of a column that is no longer in the input has no box; the map drops it.
    var stale = Object.keys(map).filter(function (c) { return columns.indexOf(c) < 0; });
    if (stale.length) { stale.forEach(function (c) { delete map[c]; }); ctx.onChange(Object.assign(Object.create(null), map), { merge: true }); }
    var tbody = U.el('tbody');
    var inputs = new Map();
    columns.forEach(function (c) {
      var input = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: hasOwn.call(map, c) ? map[c] : '', placeholder: c, spellcheck: 'false' });
      input.addEventListener('input', function () {
        if (input.value.trim()) map[c] = input.value; else delete map[c];
        ctx.onChange(Object.assign(Object.create(null), map), { merge: true });
      });
      inputs.set(c, input);
      tbody.appendChild(U.el('tr', {}, [U.el('td', { class: 'align-middle', text: c }), U.el('td', {}, [input])]));
    });
    var table = U.el('table', { class: 'table table-sm mb-0 mapping-table' }, [
      U.el('thead', {}, [U.el('tr', {}, [U.el('th', { text: DL.t('fields.currentName') }), U.el('th', { text: DL.t('fields.newName') })])]),
      tbody
    ]);
    function quickLink(label, fn) {
      return U.el('a', { href: '#', text: label, onclick: function (e) {
        e.preventDefault();
        map = Object.create(null);
        columns.forEach(function (c) { var n = fn(c); if (n && n !== c) map[c] = n; inputs.get(c).value = map[c] || ''; });
        ctx.onChange(Object.assign(Object.create(null), map));
      } });
    }
    var tools = U.el('div', { class: 'd-flex gap-3 mb-1 small' }, [
      quickLink(DL.t('fields.titleCase'), function (c) { return DL.titleCase(c.replace(/[_\-]+/g, ' ')); }),
      quickLink(DL.t('fields.snakeCase'), function (c) { return c.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }),
      quickLink(DL.t('fields.removeSpaces'), function (c) { return c.replace(/\s+/g, ''); }),
      quickLink(DL.t('fields.clear'), function () { return ''; })
    ]);
    return wrap(param, U.el('div', {}, [tools, U.el('div', { class: 'column-list', style: 'max-height:260px' }, [table])]), true);
  };

  renderers.mapping = function (param, value, ctx) {
    var blank = DL.paramTypes.mapping.blank;
    var editor = listEditor(param, value, ctx, {
      addLabel: DL.t('fields.addValue'),
      focusSelector: 'input',
      renderRow: function (r, api) {
        var from = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.from, spellcheck: 'false', placeholder: DL.t('fields.findValue') });
        var to = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.to, spellcheck: 'false', placeholder: DL.t('fields.replaceWith') });
        from.addEventListener('input', function () { r.from = from.value; api.emit(true); });
        to.addEventListener('input', function () { r.to = to.value; api.emit(true); });
        // A pasted block of two tab separated columns fills many rows at once.
        // One pasted column fills the box it was pasted into, and the boxes below it.
        var paste = function (e, isTo) {
          var text = (e.clipboardData || window.clipboardData).getData('text');
          if (!text || (text.indexOf('\n') < 0 && text.indexOf('\t') < 0)) return;
          var lines = text.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
          if (!lines.length) return;
          e.preventDefault();
          var parsed = lines.map(function (l) {
            var parts = l.split('\t');
            if (parts.length < 2 && l.split(',').length === 2) parts = l.split(',');
            return { from: (parts[0] || '').trim(), to: (parts[1] || '').trim() };
          });
          var oneColumn = parsed.every(function (p) { return p.to === ''; });
          api.edit(function (rows, i) {
            if (oneColumn) {
              parsed.forEach(function (p, k) {
                if (!rows[i + k]) rows.push(blank());
                rows[i + k][isTo ? 'to' : 'from'] = p.from;
              });
            } else {
              rows.splice.apply(rows, [i, 1].concat(parsed));
            }
          });
        };
        from.addEventListener('paste', function (e) { paste(e, false); });
        to.addEventListener('paste', function (e) { paste(e, true); });
        return U.el('div', { class: 'rule-row' }, [from, U.el('i', { class: 'bi bi-arrow-right text-secondary', style: 'flex:0 0 auto' }), to, removeButton(DL.t('fields.remove'), api.remove)]);
      }
    });
    var hint = U.el('div', { class: 'form-text', text: DL.t('fields.pasteTip') });
    return wrap(param, U.el('div', {}, [editor.box, editor.add, hint]), true);
  };

  // Shared renderer for lists of rules (filter conditions and verify rules).
  function ruleRows(param, value, ctx, operators, allowEmpty) {
    var editor = listEditor(param, value, ctx, {
      addLabel: DL.t('fields.addRule'),
      renderRow: function (r, api) {
        var col = colSelect(ctx.columns, r.column);
        col.addEventListener('change', function () { r.column = col.value; api.emit(); });
        var val = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.value == null ? '' : r.value, spellcheck: 'false' });
        var val2 = U.el('input', { type: 'text', class: 'form-control form-control-sm', value: r.value2 == null ? '' : r.value2, placeholder: DL.t('fields.and') });
        var syncInputs = function () {
          var def = DL.findOption(operators, r.op) || { needs: 'text' };
          val.hidden = def.needs === 'none';
          val2.hidden = def.needs !== 'range';
          val.placeholder = DL.t(def.needs === 'number' ? 'fields.phNumber' : def.needs === 'date' ? 'fields.phDate' : def.needs === 'range' ? 'fields.phFrom' : 'fields.phValue');
        };
        var op = U.select(operators, r.op || operators[0].value, function (v) { r.op = v; syncInputs(); api.emit(); });
        val.addEventListener('input', function () { r.value = val.value; api.emit(true); });
        val2.addEventListener('input', function () { r.value2 = val2.value; api.emit(true); });
        syncInputs();
        var row = U.el('div', { class: 'rule-row' }, [col, op, val, val2]);
        if (allowEmpty) {
          var check = U.check(DL.t('fields.skipEmpty'), r.allowEmpty !== false, function (on) { r.allowEmpty = on; api.emit(); });
          check.el.title = DL.t('fields.skipEmptyHelp');
          row.appendChild(check.el);
        }
        row.appendChild(removeButton(DL.t('fields.removeRule'), api.remove));
        return row;
      }
    });
    return wrap(param, U.el('div', {}, [editor.box, editor.add]), true);
  }

  renderers.conditions = function (param, value, ctx) {
    return ruleRows(param, value, ctx, DL.FILTER_OPERATORS, false);
  };

  renderers.rules = function (param, value, ctx) {
    return ruleRows(param, value, ctx, DL.VERIFY_RULES, true);
  };

  renderers.sortKeys = function (param, value, ctx) {
    var editor = listEditor(param, value, ctx, {
      addLabel: DL.t('fields.addColumn'),
      renderRow: function (k, api, index) {
        var col = colSelect(ctx.columns, k.column);
        col.addEventListener('change', function () { k.column = col.value; api.emit(); });
        var row = U.el('div', { class: 'rule-row' }, [
          U.el('span', { class: 'text-secondary small', style: 'flex:0 0 auto', text: DL.t(index === 0 ? 'fields.sortBy' : 'fields.thenBy') }),
          col,
          U.select(DL.SORT_TYPES, k.type, function (v) { k.type = v; api.emit(); }),
          U.select(DL.SORT_DIRS, k.dir, function (v) { k.dir = v; api.emit(); }),
          removeButton(DL.t('fields.remove'), api.remove)
        ]);
        return row;
      }
    });
    return wrap(param, U.el('div', {}, [editor.box, editor.add]), true);
  };

  F.render = function (param, value, ctx) {
    var r = renderers[param.type];
    if (!r) return wrap(param, U.el('div', { class: 'text-danger', text: DL.t('fields.unknownType', { type: param.type }) }));
    return r(param, value, ctx);
  };

  // Renders a list of field definitions into a grid. onChange(key, value, opts).
  F.renderAll = function (params, values, ctx, onChange) {
    var grid = U.el('div', { class: 'field-grid' });
    var els = {};
    params.forEach(function (p) {
      var el = F.render(p, values[p.key], {
        columns: ctx.columns,
        compact: ctx.compact,
        onChange: function (value, opts) { onChange(p.key, value, opts); }
      });
      els[p.key] = el;
      grid.appendChild(el);
    });
    return { grid: grid, els: els };
  };

  // Shows or hides fields based on their showIf rules.
  F.updateVisibility = function (params, values, els) {
    params.forEach(function (p) {
      if (els[p.key]) els[p.key].hidden = !!(p.showIf && !p.showIf(values));
    });
  };
})(typeof self !== 'undefined' ? self : this);
