/* Virtual data grid. Only the visible rows exist in the DOM; data comes from the worker in pages. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  var ROW_H = 28;
  var HEADER_H = 34;
  var MAX_VIRTUAL_H = 8000000; // browsers limit element height; above this the scrollbar is scaled
  var BUFFER = 8;
  var COL_BUFFER = 2;
  var PAGE_CELLS = 20000;      // cells per page request; the row count per page follows from the columns
  var CACHE_CELLS = 600000;    // pages kept in memory per grid

  function GridView(container, engine, opts) {
    this.engine = engine;
    this.opts = opts || {};
    this.el = container;
    this.showVersion = 0;
    this.diff = false; // true: the pages carry the cells that the step changed
    this.title = U.el('div', { class: 'grid-side-title' });
    this.title.hidden = !this.opts.title;
    if (this.opts.title) this.title.textContent = this.opts.title;
    this.scroll = U.el('div', { class: 'grid-scroll', tabindex: '0' });
    this.header = U.el('div', { class: 'grid-header' });
    this.rowsEl = U.el('div', { class: 'grid-rows' });
    this.emptyEl = U.el('div', { class: 'grid-empty' });
    this.scroll.appendChild(this.header);
    this.scroll.appendChild(this.rowsEl);
    this.scroll.appendChild(this.emptyEl);
    U.empty(container);
    container.appendChild(this.title);
    container.appendChild(this.scroll);
    this.reset();
    var self = this;
    // Render on each scroll event. About 40 rows are quick to build. requestAnimationFrame
    // stops in hidden tabs, so it is not used here.
    this.scroll.addEventListener('scroll', function () {
      self.renderRows();
      if (self.onScroll) self.onScroll(self.scroll.scrollTop);
    }, { passive: true });
    this.resizeObs = new ResizeObserver(function () { self.renderRows(); });
    this.resizeObs.observe(this.scroll);
    this.scroll.addEventListener('keydown', function (e) {
      if (e.key === 'Home' && e.ctrlKey) { self.scroll.scrollTop = 0; }
      else if (e.key === 'End' && e.ctrlKey) { self.scroll.scrollTop = self.scroll.scrollHeight; }
    });
    // A cell shows its full text as a tooltip only when the mouse is over it.
    this.rowsEl.addEventListener('mouseover', function (e) {
      var cell = e.target.closest('.grid-cell');
      if (cell && !cell.title && cell.scrollWidth > cell.clientWidth) cell.title = cell.textContent;
    });
    // A click on a column name opens the column profile.
    this.header.addEventListener('click', function (e) {
      var cell = e.target.closest('.grid-hcell[data-col]');
      if (cell) self.showProfile(cell, Number(cell.getAttribute('data-col')));
    });
    this.popover = null;
    document.addEventListener('click', this.onDocClick = function (e) {
      if (self.popover && !self.popover.tip.contains(e.target) && !self.header.contains(e.target)) self.closeProfile();
    });
  }

  GridView.prototype.reset = function () {
    this.stepId = null;
    this.total = 0;
    this.renderKey = '';
    this.hitsVersion = 0;
    this.columns = [];
    this.widths = [];
    this.lefts = [0];
    this.totalW = 0;
    this.rowNumW = 44;
    this.headerRange = null;
    this.pages = new Map();
    this.inflight = new Map();
    this.page = 200;
    this.info = null;
    this.hits = null;      // Map rowIndex -> Set(colIndex)
    this.current = null;   // [row, col]
    this.scale = 1;
    this.diffSummary = null; // per-column change counts, when the "Changes" view is on
    this.closeProfile();
  };

  GridView.prototype.setTitle = function (t) { this.title.textContent = t || ''; this.title.hidden = !t; };

  // Shows the result of a step. Resolves when the first page is on screen.
  GridView.prototype.show = function (stepId, message) {
    var self = this;
    this.reset();
    this.stepId = stepId;
    var version = ++this.showVersion;
    this.scroll.scrollTop = 0;
    if (!stepId) {
      this.columns = [];
      this.renderHeader();
      this.rowsEl.style.height = '0px';
      U.empty(this.rowsEl);
      this.showMessage(message || 'Nothing to show yet.');
      return Promise.resolve();
    }
    this.showMessage('');
    return this.engine.slice(stepId, 0, 1).then(function (msg) {
      if (self.showVersion !== version) return;
      self.total = msg.data.total;
      self.columns = msg.data.columns;
      self.page = Math.max(20, Math.min(200, Math.floor(PAGE_CELLS / Math.max(1, self.columns.length))));
      return self.fetchPage(0);
    }).then(function (data) {
      if (self.showVersion !== version || !data) return;
      self.computeWidths(data.rows);
      self.scale = Math.min(1, MAX_VIRTUAL_H / Math.max(1, self.total * ROW_H));
      self.rowsEl.style.height = Math.max(1, Math.round(self.total * ROW_H * self.scale)) + 'px';
      self.renderHeader();
      self.renderRows();
      if (!self.total) self.showMessage(self.columns.length ? 'No rows.' : 'No data.');
      self.engine.columnInfo(stepId).then(function (r) {
        if (self.showVersion !== version) return;
        self.info = r.info;
        self.renderHeader();
        self.renderKey = '';
        self.renderRows();
      }).catch(function () { /* the header keeps plain names */ });
      if (self.diff) {
        self.engine.diffSummary(stepId).then(function (r) {
          if (self.showVersion !== version) return;
          self.diffSummary = r.summary;
          self.renderHeader();
          if (self.onDiffSummary) self.onDiffSummary(r.summary);
        }).catch(function () { /* the header keeps plain names */ });
      }
    }).catch(function (err) {
      if (self.showVersion !== version) return;
      self.showMessage(err.message || String(err));
    });
  };

  GridView.prototype.showMessage = function (msg) {
    this.emptyEl.textContent = msg || '';
    this.emptyEl.hidden = !msg;
  };

  GridView.prototype.fetchPage = function (pageIndex) {
    var self = this;
    if (this.pages.has(pageIndex)) return Promise.resolve(this.pages.get(pageIndex));
    if (this.inflight.has(pageIndex)) return this.inflight.get(pageIndex);
    var stepId = this.stepId;
    var page = this.page;
    var p = this.engine.slice(stepId, pageIndex * page, page, this.diff).then(function (msg) {
      if (self.inflight.get(pageIndex) === p) self.inflight.delete(pageIndex);
      if (self.stepId !== stepId) return msg.data;
      self.pages.set(pageIndex, msg.data);
      if (self.pages.size * page * self.columns.length > CACHE_CELLS) {
        // Keep memory small: drop the pages that are far from the current view.
        var first = self.firstVisibleRow();
        var keys = Array.from(self.pages.keys());
        keys.sort(function (a, b) { return Math.abs(b * page - first) - Math.abs(a * page - first); });
        for (var i = 0; i < Math.ceil(keys.length / 3); i++) self.pages.delete(keys[i]);
      }
      return msg.data;
    }, function (err) {
      if (self.inflight.get(pageIndex) === p) self.inflight.delete(pageIndex);
      throw err;
    });
    this.inflight.set(pageIndex, p);
    return p;
  };

  var canvas = null;
  function textWidth(s, bold) {
    if (!canvas) canvas = document.createElement('canvas').getContext('2d');
    canvas.font = (bold ? '600 ' : '') + '14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    return canvas.measureText(s).width;
  }

  GridView.prototype.computeWidths = function (sampleRows) {
    var cols = this.columns;
    var n = Math.min(sampleRows.length, 100);
    var widths = new Array(cols.length);
    var lefts = new Array(cols.length + 1);
    this.rowNumW = Math.max(44, textWidth(String(this.total)) + 18);
    lefts[0] = this.rowNumW;
    for (var c = 0; c < cols.length; c++) {
      // Measure the longest sample value only: one measurement per column.
      var longest = '';
      for (var i = 0; i < n; i++) { var v = sampleRows[i][c]; if (v.length > longest.length) longest = v; }
      var w = Math.max(70, textWidth(cols[c], true) + 40);
      if (longest) w = Math.max(w, textWidth(longest.length > 60 ? longest.slice(0, 60) : longest) + 18);
      widths[c] = Math.min(320, w);
      lefts[c + 1] = lefts[c] + widths[c];
    }
    this.widths = widths;
    this.lefts = lefts; // left edge of each column; lefts[cols.length] is the total width
    this.totalW = lefts[cols.length];
  };

  // The columns that are inside the view (plus a small buffer): [first, last).
  GridView.prototype.visibleColumns = function () {
    var w = this.columns.length;
    if (!w) return [0, 0];
    var left = this.scroll.scrollLeft;
    var right = left + this.scroll.clientWidth;
    var lefts = this.lefts;
    var lo = 0, hi = w;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (lefts[mid + 1] <= left) lo = mid + 1; else hi = mid; }
    var first = lo;
    var last = first;
    while (last < w && lefts[last] < right) last++;
    return [Math.max(0, first - COL_BUFFER), Math.min(w, last + COL_BUFFER)];
  };

  GridView.prototype.renderHeader = function () {
    var h = this.header;
    var range = this.visibleColumns();
    var html = '<div class="grid-hcell rownum" style="width:' + this.rowNumW + 'px">#</div>';
    if (range[0] > 0) html += '<div class="grid-hcell" style="width:' + (this.lefts[range[0]] - this.rowNumW) + 'px"></div>';
    var info = this.info;
    var diff = this.diffSummary;
    for (var c = range[0]; c < range[1]; c++) {
      var name = this.columns[c];
      var icon = '';
      var title = name;
      var badge = '';
      var cls = 'grid-hcell';
      if (info && info[c]) {
        var t = info[c].type;
        icon = '<i class="type-icon bi ' + (t === 'number' ? 'bi-123' : t === 'date' ? 'bi-calendar3' : 'bi-fonts') + '"></i>';
        title = name + ' · ' + (t === 'number' ? 'numbers' : t === 'date' ? 'dates' : 'text') + (info[c].emptyPct ? ' · ' + info[c].emptyPct + '% empty' : '');
      }
      if (diff && diff.columns[c]) {
        var d = diff.columns[c];
        if (d.isNew) { cls += ' is-new'; badge = '<span class="hbadge">new</span>'; title += ' · new column'; }
        else if (d.changed) { cls += ' is-changed'; badge = '<span class="hbadge">' + d.changed.toLocaleString() + '</span>'; title += ' · ' + DL.pluralize(d.changed, 'changed cell'); }
      }
      title += ' · Click for the column profile';
      html += '<div class="' + cls + '" data-col="' + c + '" style="width:' + this.widths[c] + 'px" title="' + U.esc(title) + '">' + icon + '<span class="hname">' + U.esc(name) + '</span>' + badge + '</div>';
    }
    this.closeProfile();
    h.innerHTML = html;
    h.style.width = this.totalW + 'px';
    this.rowsEl.style.width = this.totalW + 'px';
    this.headerRange = range;
  };

  // The number of rows that fit in the view below the header.
  GridView.prototype.visibleRows = function () {
    return Math.max(1, Math.ceil((this.scroll.clientHeight - HEADER_H) / ROW_H));
  };

  GridView.prototype.firstVisibleRow = function () {
    var top = this.scroll.scrollTop;
    if (this.scale < 1) {
      var maxTop = Math.max(1, this.scroll.scrollHeight - this.scroll.clientHeight);
      var lastFirst = Math.max(0, this.total - this.visibleRows());
      return Math.min(lastFirst, Math.floor((top / maxTop) * lastFirst));
    }
    return Math.min(Math.max(0, this.total - 1), Math.floor(top / ROW_H));
  };

  var ESC_RE = /[&<>"']/;
  function esc(v) { return ESC_RE.test(v) ? U.esc(v) : v; }

  // Asks the worker for the pages that the view needs. Waits a moment so that a fast scroll
  // only requests the pages where it stops.
  GridView.prototype.requestPages = function (missing) {
    var self = this;
    var version = this.showVersion;
    clearTimeout(this.fetchTimer);
    this.fetchTimer = setTimeout(function () {
      if (self.showVersion !== version) return;
      Promise.all(missing.map(function (p) { return self.fetchPage(p); })).then(function () {
        if (self.showVersion === version) self.renderRows();
      }).catch(function (err) {
        if (self.showVersion === version) self.showMessage(err.message || String(err));
      });
    }, 30);
  };

  GridView.prototype.renderRows = function () {
    if (!this.stepId || !this.total) { U.empty(this.rowsEl); this.renderKey = ''; return; }
    var first = Math.max(0, this.firstVisibleRow() - BUFFER);
    var count = this.visibleRows() + BUFFER * 2;
    var last = Math.min(this.total, first + count);
    var pageSize = this.page;
    var firstPage = Math.floor(first / pageSize), lastPage = Math.floor(Math.max(first, last - 1) / pageSize);
    var missing = [];
    var loaded = '';
    for (var p = firstPage; p <= lastPage; p++) {
      if (this.pages.has(p)) loaded += p + ',';
      else missing.push(p);
    }
    if (missing.length) this.requestPages(missing);
    var range = this.visibleColumns();
    if (!this.headerRange || range[0] !== this.headerRange[0] || range[1] !== this.headerRange[1]) this.renderHeader();
    // Nothing changed since the last render: keep the DOM.
    var key = first + ':' + last + ':' + range.join('-') + ':' + loaded + ':' + this.hitsVersion + ':' + (this.current ? this.current.join('/') : '') + ':' + (this.scale < 1 ? this.scroll.scrollTop : 0);
    if (key === this.renderKey) return;
    this.renderKey = key;
    // In scaled mode rows are placed relative to the current scroll position.
    var baseTop = this.scale < 1 ? this.scroll.scrollTop : 0;
    var firstVisible = this.firstVisibleRow();
    var html = '';
    var info = this.info;
    var widths = this.widths;
    var spacer = range[0] > 0 ? '<div class="grid-cell" style="width:' + (this.lefts[range[0]] - this.rowNumW) + 'px"></div>' : '';
    for (var i = first; i < last; i++) {
      var page = this.pages.get(Math.floor(i / pageSize));
      var row = page ? page.rows[i - page.start] : null;
      var top = this.scale < 1 ? baseTop + (i - firstVisible) * ROW_H : i * ROW_H;
      var hitCols = this.hits ? this.hits.get(i) : null;
      var changed = page && page.changes ? page.changes[i - page.start] : null;
      html += '<div class="grid-row' + (hitCols ? ' is-hit' : '') + '" style="top:' + top + 'px;width:' + this.totalW + 'px">';
      html += '<div class="grid-cell rownum" style="width:' + this.rowNumW + 'px">' + (i + 1) + '</div>' + spacer;
      if (row) {
        for (var c = range[0]; c < range[1]; c++) {
          var v = row[c];
          var cls = 'grid-cell';
          if (v === '') cls += ' is-empty';
          else if (info && info[c] && info[c].type === 'number') cls += ' is-num';
          if (changed && changed.indexOf(c) >= 0) cls += ' is-changed';
          if (hitCols && hitCols.has(c)) cls += ' is-hit';
          if (this.current && this.current[0] === i && this.current[1] === c) cls += ' is-current';
          html += '<div class="' + cls + '" style="width:' + widths[c] + 'px">' + esc(v) + '</div>';
        }
      } else {
        html += '<div class="grid-cell text-secondary" style="width:200px">Loading…</div>';
      }
      html += '</div>';
    }
    this.rowsEl.innerHTML = html;
  };

  GridView.prototype.scrollToRow = function (row) {
    var target;
    if (this.scale < 1) {
      var maxTop = this.scroll.scrollHeight - this.scroll.clientHeight;
      target = (row / Math.max(1, this.total - this.visibleRows())) * maxTop;
    } else {
      target = row * ROW_H - this.scroll.clientHeight / 2 + ROW_H;
    }
    this.scroll.scrollTop = Math.max(0, target);
    this.renderRows();
  };

  GridView.prototype.scrollToColumn = function (col) {
    if (!this.lefts || col >= this.columns.length) return;
    var left = this.lefts[col];
    var right = this.lefts[col + 1];
    var s = this.scroll;
    if (left - this.rowNumW < s.scrollLeft) s.scrollLeft = left - this.rowNumW;
    else if (right > s.scrollLeft + s.clientWidth) s.scrollLeft = right - s.clientWidth;
  };

  // Highlights search matches. matches = [[row, col], ...]
  GridView.prototype.setHits = function (matches) {
    this.hitsVersion++;
    if (!matches || !matches.length) { this.hits = null; this.current = null; this.renderRows(); return; }
    var map = new Map();
    matches.forEach(function (m) {
      if (!map.has(m[0])) map.set(m[0], new Set());
      map.get(m[0]).add(m[1]);
    });
    this.hits = map;
    this.renderRows();
  };

  GridView.prototype.setCurrent = function (match) {
    this.current = match;
    if (match) { this.scrollToRow(match[0]); this.scrollToColumn(match[1]); }
    this.renderRows();
  };

  /* ---------- Column profile ---------- */

  function statRow(label, value) {
    return '<tr><th>' + label + '</th><td>' + value + '</td></tr>';
  }

  function number(v) {
    return DL.numberText(Math.round(v * 1e6) / 1e6);
  }

  // The HTML of the column profile.
  function profileHtml(st) {
    var kind = st.type === 'number' ? 'Numbers' : st.type === 'date' ? 'Dates' : 'Text';
    var filled = st.rows - st.empty;
    var pct = function (n) { return st.rows ? ' (' + Math.round(100 * n / st.rows) + '%)' : ''; };
    var rows = statRow('Type', kind) +
      statRow('Rows', st.rows.toLocaleString()) +
      statRow('Empty', st.empty.toLocaleString() + pct(st.empty)) +
      statRow('Different values', st.distinct.toLocaleString() + (st.distinct === filled && filled ? ' (all unique)' : ''));
    if (st.numbers) {
      rows += statRow('Numbers', st.numbers.toLocaleString() + pct(st.numbers)) +
        statRow('Smallest', number(st.min)) + statRow('Largest', number(st.max)) +
        statRow('Sum', number(st.sum)) + statRow('Average', number(st.avg));
    }
    if (st.dates) {
      rows += statRow('Dates', st.dates.toLocaleString() + pct(st.dates)) +
        statRow('Earliest', DL.formatDateISO(st.earliest)) + statRow('Latest', DL.formatDateISO(st.latest));
    }
    if (filled) rows += statRow('Length', st.minLen === st.maxLen ? st.maxLen + ' characters' : st.minLen + ' to ' + st.maxLen + ' characters');
    var top = st.top.map(function (t) {
      return '<tr><td class="pv">' + U.esc(t.value.length > 40 ? t.value.slice(0, 40) + '…' : t.value) + '</td><td class="pc">' + t.count.toLocaleString() + '</td></tr>';
    }).join('');
    return '<table class="profile-table">' + rows + '</table>' +
      (top ? '<div class="profile-sub">Most common values</div><table class="profile-table profile-top">' + top + '</table>' : '');
  }

  GridView.prototype.showProfile = function (cell, col) {
    var self = this;
    var stepId = this.stepId;
    if (this.popover && this.popover.col === col) { this.closeProfile(); return; }
    this.closeProfile();
    var pop = new bootstrap.Popover(cell, {
      html: true, sanitize: false, trigger: 'manual', placement: 'bottom', container: 'body',
      customClass: 'profile-popover', title: U.esc(this.columns[col]), content: '<div class="text-secondary small">Calculating…</div>'
    });
    pop.col = col;
    pop.show();
    this.popover = pop;
    this.engine.columnStats(stepId, col).then(function (r) {
      if (self.popover !== pop || !r.stats) return;
      pop.setContent({ '.popover-body': profileHtml(r.stats) });
    }).catch(function (err) {
      if (self.popover === pop) pop.setContent({ '.popover-body': '<div class="text-danger small">' + U.esc(err.message || String(err)) + '</div>' });
    });
  };

  GridView.prototype.closeProfile = function () {
    if (!this.popover) return;
    this.popover.dispose();
    this.popover = null;
  };

  GridView.prototype.destroy = function () {
    this.resizeObs.disconnect();
    clearTimeout(this.fetchTimer);
    this.closeProfile();
    document.removeEventListener('click', this.onDocClick);
  };

  DL.GridView = GridView;
})(typeof self !== 'undefined' ? self : this);
