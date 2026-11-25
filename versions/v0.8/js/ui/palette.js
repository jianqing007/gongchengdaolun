/* ===== v0.6 B1 命令面板：Ctrl+K 快速跳转标的/周期/页签/分组/动作 =====
   零依赖；拼音首字母检索只对 pool.json 里的固定标的内置映射，未映射的按名称/代码子串匹配。 */
(function () {
  'use strict';

  var PINYIN = {
    '600519': 'gzmt', '000858': 'wly', '300750': 'ndsd', '002594': 'byd',
    '600036': 'zsyh', '601318': 'zgpa', '000333': 'mdjt', '600900': 'cjdl',
    '601888': 'zgem', '600887': 'ylgf',
    '000513': 'lzjt', '300759': 'klhc', '000963': 'hdyy', '000028': 'gyyz',
    '000596': 'gjgj', '003006': 'bygf', '000039': 'zjjt', '000977': 'lcxx',
    '605117': 'dygf', '688825': 'cxkj', '159915': 'cybetf', '588000': 'kc50etf',
    'SZ399006': 'cybz', 'SH000688': 'kc50'
  };

  var actions = null;
  var overlay = null;
  var input = null;
  var list = null;
  var visible = [];
  var active = 0;
  var isOpen = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function haystack(item) {
    return (item.label + ' ' + (PINYIN[item.key] || '') + ' ' + item.key +
      ' ' + (item.hint || '')).toLowerCase();
  }

  function buildItems() {
    var items = [];
    (window.UNIVERSE || []).forEach(function (stock) {
      items.push({
        group: '标的',
        label: stock.name,
        hint: stock.symbol + (stock.sector ? ' · ' + stock.sector : ''),
        key: stock.symbol,
        run: function () { actions.selectSymbol(stock.symbol); }
      });
    });
    [
      ['minute', '切换到分时'], ['day', '切换到日K'],
      ['week', '切换到周K'], ['month', '切换到月K']
    ].forEach(function (pair) {
      items.push({
        group: '图表', label: pair[1], hint: '周期', key: pair[0],
        run: function () { actions.setPeriod(pair[0]); }
      });
    });
    [
      ['signals', '打开追踪信号'], ['overview', '打开池子总览'],
      ['gates', '打开指数闸门'], ['risk', '打开组合风险'],
      ['forecast', '打开预测与回测']
    ].forEach(function (pair) {
      items.push({
        group: '工作台', label: pair[1], hint: '分析页签', key: pair[0],
        run: function () { actions.setTab(pair[0]); }
      });
    });
    Object.keys(window.POOL_GROUPS || {}).forEach(function (name) {
      items.push({
        group: '分组', label: '切换到' + (window.POOL_GROUPS[name].label || name),
        hint: '自选分组', key: name,
        run: function () { actions.setGroup(name); }
      });
    });
    [
      ['开始日K回放', '回放', function () { actions.replay(); }],
      ['信号卡存图', '存图', function () { actions.share(); }],
      ['打开自检页 tests.html', '自检', function () { actions.openTests(); }],
      ['撤销上一步持仓操作', '撤销', function () { actions.undo(); }],
      ['立即刷新行情', '刷新', function () { actions.refresh(); }],
      ['展开/收起指标面板', '指标', function () { actions.toggleIndicators(); }]
    ].forEach(function (triple) {
      items.push({
        group: '动作', label: triple[0], hint: triple[1], key: triple[1],
        run: triple[2]
      });
    });
    return items;
  }

  function filterItems(query) {
    var q = query.trim().toLowerCase();
    if (!q) return buildItems();
    var tokens = q.split(/\s+/);
    return buildItems().filter(function (item) {
      var hay = haystack(item);
      return tokens.every(function (token) { return hay.indexOf(token) >= 0; });
    });
  }

  function render() {
    if (!visible.length) {
      list.innerHTML = '<li class="palette-empty">没有匹配的标的或命令</li>';
      return;
    }
    list.innerHTML = visible.map(function (item, index) {
      return '<li class="palette-item' + (index === active ? ' is-active' : '') +
        '" data-index="' + index + '" role="option" aria-selected="' + (index === active) + '">' +
        '<span class="palette-chip">' + escapeHtml(item.group) + '</span>' +
        '<span class="palette-label">' + escapeHtml(item.label) + '</span>' +
        '<span class="palette-hint">' + escapeHtml(item.hint || '') + '</span>' +
        '</li>';
    }).join('');
    var activeNode = list.querySelector('.is-active');
    if (activeNode) activeNode.scrollIntoView({ block: 'nearest' });
  }

  function refresh(query) {
    visible = filterItems(query);
    if (active >= visible.length) active = 0;
    render();
  }

  function open() {
    if (!actions || isOpen) return;
    isOpen = true;
    overlay.classList.remove('hidden');
    input.value = '';
    active = 0;
    refresh('');
    input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.add('hidden');
    visible = [];
  }

  function run(item) {
    close();
    if (item && item.run) item.run();
  }

  function move(delta) {
    if (!visible.length) return;
    active = (active + delta + visible.length) % visible.length;
    render();
  }

  function init(deps) {
    actions = deps;
    overlay = document.getElementById('palette-overlay');
    input = document.getElementById('palette-input');
    list = document.getElementById('palette-list');
    if (!overlay || !input || !list) return;

    input.addEventListener('input', function () {
      active = 0;
      refresh(input.value);
    });

    list.addEventListener('click', function (event) {
      var node = event.target.closest('[data-index]');
      if (node) run(visible[Number(node.getAttribute('data-index'))]);
    });
    list.addEventListener('mousemove', function (event) {
      var node = event.target.closest('[data-index]');
      if (!node) return;
      var index = Number(node.getAttribute('data-index'));
      if (index !== active) {
        active = index;
        render();
      }
    });

    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) close();
    });

    document.addEventListener('keydown', function (event) {
      var key = event.key || '';
      if ((event.ctrlKey || event.metaKey) && (key === 'k' || key === 'K')) {
        event.preventDefault();
        if (isOpen) close();
        else open();
        return;
      }
      if (!isOpen) return;
      if (key === 'Escape') {
        event.preventDefault();
        close();
      } else if (key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (key === 'Enter') {
        event.preventDefault();
        run(visible[active]);
      }
    });

    var openBtn = document.getElementById('palette-open');
    if (openBtn) openBtn.addEventListener('click', open);
  }

  window.CommandPalette = { init: init, open: open, close: close };
})();
