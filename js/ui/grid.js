/* Virtual data grid. Only the visible rows exist in the DOM; data comes from the worker in pages. */
(function (root) {
  'use strict';
  var DL = root.DL;
  var U = DL.util;

  var ROW_H = 28;
  var PAGE = 200;
  var MAX_VIRTUAL_H = 8000000; // browsers limit element height; above this we scale the scrollbar
  var BUFFER = 8;

  function GridView(container, engine, opts) {
    this.engine = engine;
    this.opts = opts || {};
    this.el = container;
    this.showVersion = 0;
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
  }

  GridView.prototype.reset = function () {
    this.stepId = null;
    this.total = 0;
    this.renderKey = '';
    this.hitsVersion = 0;
    this.columns = [];
    this.widths = [];
    this.pages = new Map();
    this.inflight = new Map();
    this.info = null;
    this.hits = null;      // Map rowIndex -> Set(colIndex)
    this.current = null;   // [row, col]
    this.scale = 1;
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
    return this.fetchPage(0).then(function (data) {
      if (self.showVersion !== version) return;
      self.total = data.total;
      self.columns = data.columns;
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
    var p = this.engine.slice(stepId, pageIndex * PAGE, PAGE).then(function (msg) {
      if (self.inflight.get(pageIndex) === p) self.inflight.delete(pageIndex);
      if (self.stepId !== stepId) return msg.data;
      self.pages.set(pageIndex, msg.data);
      if (self.pages.size > 60) {
        // Keep memory small: drop pages far from the current view.
        var first = self.firstVisibleRow();
        var keys = Array.from(self.pages.keys());
        keys.sort(function (a, b) { return Math.abs(b * PAGE - first) - Math.abs(a * PAGE - first); });
        for (var i = 0; i < 20; i++) self.pages.delete(keys[i]);
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
    var widths = cols.map(function (c) { return Math.min(320, Math.max(70, textWidth(c, true) + 40)); });
    var n = Math.min(sampleRows.length, 100);
    for (var i = 0; i < n; i++) {
      var r = sampleRows[i];
      for (var c = 0; c < cols.length; c++) {
        var v = r[c];
        if (!v) continue;
        var w = Math.min(320, textWidth(v.length > 60 ? v.slice(0, 60) : v) + 18);
        if (w > widths[c]) widths[c] = w;
      }
    }
    this.widths = widths;
    this.rowNumW = Math.max(44, textWidth(String(this.total)) + 18);
    this.totalW = this.rowNumW + widths.reduce(function (a, b) { return a + b; }, 0);
  };

  GridView.prototype.renderHeader = function () {
    var h = this.header;
    var html = '<div class="grid-hcell rownum" style="width:' + this.rowNumW + 'px">#</div>';
    var info = this.info;
    for (var c = 0; c < this.columns.length; c++) {
      var name = this.columns[c];
      var icon = '';
      var title = name;
      if (info && info[c]) {
        var t = info[c].type;
        icon = '<i class="type-icon bi ' + (t === 'number' ? 'bi-123' : t === 'date' ? 'bi-calendar3' : 'bi-fonts') + '"></i>';
        title = name + ' · ' + (t === 'number' ? 'numbers' : t === 'date' ? 'dates' : 'text') + (info[c].emptyPct ? ' · ' + info[c].emptyPct + '% empty' : '');
      }
      html += '<div class="grid-hcell" style="width:' + this.widths[c] + 'px" title="' + U.esc(title) + '">' + icon + '<span class="hname">' + U.esc(name) + '</span></div>';
    }
    h.innerHTML = html;
    h.style.width = this.totalW + 'px';
    this.rowsEl.style.width = this.totalW + 'px';
  };

  GridView.prototype.firstVisibleRow = function () {
    var top = this.scroll.scrollTop;
    if (this.scale < 1) {
      var maxTop = Math.max(1, this.total * ROW_H * this.scale - this.scroll.clientHeight);
      return Math.floor((top / maxTop) * Math.max(0, this.total - Math.ceil(this.scroll.clientHeight / ROW_H)));
    }
    return Math.floor(top / ROW_H);
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
    var count = Math.ceil(this.scroll.clientHeight / ROW_H) + BUFFER * 2;
    var last = Math.min(this.total, first + count);
    var firstPage = Math.floor(first / PAGE), lastPage = Math.floor(Math.max(first, last - 1) / PAGE);
    var missing = [];
    var loaded = '';
    for (var p = firstPage; p <= lastPage; p++) {
      if (this.pages.has(p)) loaded += p + ',';
      else missing.push(p);
    }
    if (missing.length) this.requestPages(missing);
    // Nothing changed since the last render (for example a horizontal scroll): keep the DOM.
    var key = first + ':' + last + ':' + loaded + ':' + this.hitsVersion + ':' + (this.current ? this.current.join('/') : '') + ':' + (this.scale < 1 ? this.scroll.scrollTop : 0);
    if (key === this.renderKey) return;
    this.renderKey = key;
    // In scaled mode rows are placed relative to the current scroll position.
    var baseTop = this.scale < 1 ? this.scroll.scrollTop : 0;
    var firstVisible = this.firstVisibleRow();
    var html = '';
    var w = this.columns.length;
    var info = this.info;
    var widths = this.widths;
    for (var i = first; i < last; i++) {
      var page = this.pages.get(Math.floor(i / PAGE));
      var row = page ? page.rows[i - page.start] : null;
      var top = this.scale < 1 ? baseTop + (i - firstVisible) * ROW_H : i * ROW_H;
      var hitCols = this.hits ? this.hits.get(i) : null;
      html += '<div class="grid-row' + (hitCols ? ' is-hit' : '') + '" style="top:' + top + 'px;width:' + this.totalW + 'px">';
      html += '<div class="grid-cell rownum" style="width:' + this.rowNumW + 'px">' + (i + 1) + '</div>';
      if (row) {
        for (var c = 0; c < w; c++) {
          var v = row[c];
          var cls = 'grid-cell';
          if (v === '') cls += ' is-empty';
          else if (info && info[c] && info[c].type === 'number') cls += ' is-num';
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
      var maxTop = this.total * ROW_H * this.scale - this.scroll.clientHeight;
      target = (row / Math.max(1, this.total - Math.ceil(this.scroll.clientHeight / ROW_H))) * maxTop;
    } else {
      target = row * ROW_H - this.scroll.clientHeight / 2 + ROW_H;
    }
    this.scroll.scrollTop = Math.max(0, target);
    this.renderRows();
  };

  GridView.prototype.scrollToColumn = function (col) {
    var left = this.rowNumW;
    for (var c = 0; c < col; c++) left += this.widths[c];
    var right = left + this.widths[col];
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

  GridView.prototype.destroy = function () {
    this.resizeObs.disconnect();
    clearTimeout(this.fetchTimer);
  };

  DL.GridView = GridView;
})(typeof self !== 'undefined' ? self : this);
