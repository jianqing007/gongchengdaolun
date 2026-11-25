(function () {
  'use strict';

  var STORAGE_KEY = 'guji.holdings.v1';
  var REFRESH_MS = 3000;
  var STALE_MS = 15000;

  var SAMPLE_HOLDINGS = [
    { symbol: '600519', shares: 100, cost: 1500 },
    { symbol: '300750', shares: 200, cost: 180 }
  ];

  var state = {
    holdings: [],
    quotes: {},
    editingSymbol: null,
    mode: 'connecting',
    lastUpdate: null,
    loading: false,
    error: '',
    fetchFailures: 0
  };

  var els = {};

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(value, digits) {
    var n = Number(value);
    return value == null || !Number.isFinite(n) ? '--' : n.toFixed(digits == null ? 2 : digits);
  }

  function fmtPrice(value) {
    return fmtNum(value, 2);
  }

  function fmtPct(value) {
    var n = Number(value);
    if (value == null || !Number.isFinite(n)) return '--';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtSigned(value, digits) {
    var n = Number(value);
    if (value == null || !Number.isFinite(n)) return '--';
    return (n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits);
  }

  function fmtMoney(cents) {
    var n = Number(cents);
    if (cents == null || !Number.isFinite(n)) return '--';
    return (n / 100).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function fmtMoneyAbs(cents) {
    return cents == null ? '--' : '¥' + fmtMoney(cents);
  }

  function fmtMoneySigned(cents) {
    var n = Number(cents);
    if (cents == null || !Number.isFinite(n)) return '--';
    var sign = n > 0 ? '+' : n < 0 ? '-' : '';
    return sign + '¥' + fmtMoney(Math.abs(n));
  }

  function fmtShares(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '--';
  }

  function fmtWeight(value) {
    var n = Number(value);
    return value == null || !Number.isFinite(n) ? '--' : (n * 100).toFixed(1) + '%';
  }

  function cls(value) {
    var n = Number(value);
    if (value == null || !Number.isFinite(n)) return 'flat';
    return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  }

  function fmtClock(ts) {
    if (!ts) return '--';
    return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
  }

  function fmtDateTime(ts) {
    if (!ts) return '--';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function cloneSample() {
    return SAMPLE_HOLDINGS.map(function (item) {
      return { symbol: item.symbol, shares: item.shares, cost: item.cost };
    });
  }

  function loadHoldings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw == null) return cloneSample();
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (holding) {
        return holding &&
          window.UNIVERSE_BY_SYMBOL[holding.symbol] &&
          Number.isInteger(Number(holding.shares)) &&
          Number(holding.shares) > 0 &&
          Number.isFinite(Number(holding.cost)) &&
          Number(holding.cost) > 0;
      }).map(function (holding) {
        return {
          symbol: holding.symbol,
          shares: Number(holding.shares),
          cost: Number(holding.cost)
        };
      });
    } catch (err) {
      state.error = '本地持仓读取失败，已恢复示例数据';
      return cloneSample();
    }
  }

  function saveHoldings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.holdings));
    } catch (err) {
      state.error = '持仓保存失败：浏览器本地存储不可用';
    }
  }

  function getMarketStatus() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    var day = d.getUTCDay();
    var minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (day === 0 || day === 6) return { text: '休市', live: false };
    if (minutes >= 570 && minutes < 690) return { text: '交易中', live: true };
    if (minutes >= 690 && minutes < 780) return { text: '午间休市', live: false };
    if (minutes >= 780 && minutes < 900) return { text: '交易中', live: true };
    if (minutes < 570) return { text: '未开盘', live: false };
    return { text: '已收盘', live: false };
  }

  function applySnapshot(reason) {
    var quotes = {};
    window.ALL_SYMBOLS.forEach(function (item) {
      var quote = window.QuoteProvider.quoteFromSnapshot(item.symbol);
      if (quote) quotes[item.symbol] = quote;
    });
    if (Object.keys(quotes).length > 0) {
      state.quotes = quotes;
      state.mode = 'snapshot';
      var firstSymbol = Object.keys(quotes)[0];
      state.lastUpdate = firstSymbol
        ? quotes[firstSymbol].time
        : (window.SNAPSHOT && window.SNAPSHOT.meta ? Date.parse(window.SNAPSHOT.meta.fetchedAt) : null);
      if (reason) state.error = reason;
    }
  }

  function loadQuotes(manual) {
    if (state.loading) return;
    state.loading = true;
    if (manual && els.refreshBtn) {
      els.refreshBtn.disabled = true;
      els.refreshBtn.textContent = '刷新中…';
    }

    window.QuoteProvider.fetchQuotes(window.ALL_SYMBOLS).then(function (quotes) {
      var missing = window.ALL_SYMBOLS.filter(function (item) {
        return !quotes[item.symbol];
      });
      state.quotes = Object.assign({}, state.quotes, quotes);
      state.mode = 'live';
      state.lastUpdate = Date.now();
      state.fetchFailures = 0;
      state.error = missing.length
        ? '部分标的暂无行情：' + missing.map(function (item) { return item.name; }).join('、')
        : '';
    }).catch(function (err) {
      state.fetchFailures += 1;
      if (state.fetchFailures >= 3 || Object.keys(state.quotes).length === 0) {
        applySnapshot('实时行情不可用，已切换本地快照：' + err.message);
      } else {
        state.error = '行情更新失败（' + err.message + '），显示上次数据';
      }
    }).finally(function () {
      state.loading = false;
      if (manual && els.refreshBtn) {
        els.refreshBtn.disabled = false;
        els.refreshBtn.textContent = '刷新';
      }
      renderAll();
    });
  }

  function renderStatus() {
    var badge = els.modeBadge;
    badge.className = 'badge';
    if (state.mode === 'live') {
      badge.classList.add('badge-live');
      badge.innerHTML = '<i></i>实时 · 3s';
    } else if (state.mode === 'snapshot') {
      badge.classList.add('badge-warn');
      badge.innerHTML = '<i></i>快照模式';
    } else {
      badge.classList.add('badge-muted');
      badge.innerHTML = '<i></i>连接中';
    }

    var market = getMarketStatus();
    els.marketStatus.textContent = market.text;
    els.marketStatus.className = 'badge ' + (market.live ? 'badge-live' : 'badge-muted');
    els.marketStatus.title = '按北京时间判断，未处理法定节假日';

    if (!state.lastUpdate) {
      els.lastUpdate.textContent = '更新时间 --';
    } else if (state.mode === 'snapshot') {
      els.lastUpdate.textContent = '快照截至 ' + fmtDateTime(state.lastUpdate);
    } else {
      els.lastUpdate.textContent = '更新于 ' + fmtClock(state.lastUpdate);
    }

    var stale = state.mode === 'live' && state.lastUpdate && (Date.now() - state.lastUpdate > STALE_MS);
    if (stale) {
      els.lastUpdate.textContent += ' · 延迟';
    }

    if (state.error) {
      els.errorBanner.textContent = state.error;
      els.errorBanner.className = 'banner warn';
    } else {
      els.errorBanner.textContent = '';
      els.errorBanner.className = 'banner hidden';
    }
  }

  function renderIndices() {
    els.indexGrid.innerHTML = window.INDICES.map(function (index) {
      var quote = state.quotes[index.symbol];
      var price = quote ? fmtPrice(quote.price) : '--';
      var pct = quote ? fmtPct(quote.pct) : '--';
      var change = quote ? fmtSigned(quote.change, 2) : '--';
      return (
        '<div class="index-card">' +
          '<div class="index-head"><span class="index-name">' + escapeHtml(index.name) + '</span>' +
            '<span class="index-code">' + escapeHtml(index.code) + '</span></div>' +
          '<div class="index-price ' + cls(quote && quote.pct) + '">' + price + '</div>' +
          '<div class="index-meta">' +
            '<span class="' + cls(quote && quote.pct) + '">' + pct + '</span>' +
            '<span class="muted">' + change + '</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function holdingFor(symbol) {
    return state.holdings.find(function (item) { return item.symbol === symbol; }) || null;
  }

  function renderWatchlist() {
    var stockCount = window.UNIVERSE.filter(function (stock) {
      return state.quotes[stock.symbol];
    }).length;
    els.quoteCount.textContent = stockCount + ' / ' + window.UNIVERSE.length + ' 只';
    els.watchlistBody.innerHTML = window.UNIVERSE.map(function (stock) {
      var quote = state.quotes[stock.symbol];
      var holding = holdingFor(stock.symbol);
      var actionText = holding ? '调整' : '+ 持仓';
      var actionClass = holding ? 'btn btn-small btn-ghost' : 'btn btn-small';
      return (
        '<tr>' +
          '<td><div class="stock-name">' + escapeHtml(stock.name) + '</div>' +
            '<div class="stock-code">' + escapeHtml(stock.symbol) + ' · ' + escapeHtml(stock.sector) + '</div></td>' +
          '<td class="num price ' + cls(quote && quote.pct) + '">' + (quote ? fmtPrice(quote.price) : '--') + '</td>' +
          '<td class="num ' + cls(quote && quote.pct) + '">' + (quote ? fmtPct(quote.pct) : '--') + '</td>' +
          '<td class="num ' + cls(quote && quote.change) + '">' + (quote ? fmtSigned(quote.change, 2) : '--') + '</td>' +
          '<td class="num">' + (quote && quote.volumeRatio != null ? fmtNum(quote.volumeRatio, 2) : '--') + '</td>' +
          '<td class="num">' + (quote && quote.turnover != null ? fmtNum(quote.turnover, 2) + '%' : '--') + '</td>' +
          '<td class="num range">' +
            '<span>' + (quote ? fmtPrice(quote.high) : '--') + '</span>' +
            '<span class="muted"> / </span>' +
            '<span>' + (quote ? fmtPrice(quote.low) : '--') + '</span>' +
          '</td>' +
          '<td class="actions"><button type="button" class="' + actionClass + '" data-add="' + escapeHtml(stock.symbol) + '">' + actionText + '</button></td>' +
        '</tr>'
      );
    }).join('');
  }

  function computeState() {
    return window.Portfolio.computePortfolio(state.holdings, state.quotes);
  }

  function renderSummary() {
    var result = computeState();
    var positions = result.positions;
    var totals = result.totals;
    var complete = positions.length > 0 && positions.every(function (pos) { return pos.marketValue != null; });

    var cards = [
      {
        label: '总市值',
        value: complete ? fmtMoneyAbs(totals.marketValue) : '--',
        sub: positions.length ? positions.length + ' 只持仓' : '暂无持仓',
        cls: ''
      },
      {
        label: '总成本',
        value: positions.length ? fmtMoneyAbs(totals.costTotal) : '--',
        sub: '按每股成本计算',
        cls: ''
      },
      {
        label: '浮动盈亏',
        value: complete ? fmtMoneySigned(totals.pnl) : '--',
        sub: complete && totals.pnlPct != null ? fmtPct(totals.pnlPct * 100) : '等待完整行情',
        cls: complete ? cls(totals.pnl) : ''
      },
      {
        label: state.mode === 'snapshot' ? '快照日盈亏' : '今日盈亏',
        value: complete ? fmtMoneySigned(totals.dayPnl) : '--',
        sub: complete ? (state.mode === 'snapshot' ? '按快照日昨收' : '按昨收计算') : '等待完整行情',
        cls: complete ? cls(totals.dayPnl) : ''
      },
      {
        label: '持仓数',
        value: positions.length + ' 只',
        sub: '自选 ' + window.UNIVERSE.length + ' 只',
        cls: ''
      },
      {
        label: '数据时间',
        value: state.mode === 'snapshot' ? '快照' : fmtClock(state.lastUpdate),
        sub: state.mode === 'snapshot' ? fmtDateTime(state.lastUpdate) : '每 3 秒刷新',
        cls: ''
      }
    ];

    els.summaryGrid.innerHTML = cards.map(function (card) {
      return (
        '<div class="summary-card">' +
          '<div class="summary-label">' + escapeHtml(card.label) + '</div>' +
          '<div class="summary-value ' + card.cls + '">' + escapeHtml(card.value) + '</div>' +
          '<div class="summary-sub">' + escapeHtml(card.sub) + '</div>' +
        '</div>'
      );
    }).join('');

    if (positions.length === 0) {
      els.holdingsSubtitle.textContent = '还没有持仓';
    } else if (!complete) {
      els.holdingsSubtitle.textContent = positions.length + ' 只 · 部分行情缺失，合计暂不展示';
    } else {
      els.holdingsSubtitle.textContent = positions.length + ' 只 · 总市值 ' + fmtMoneyAbs(totals.marketValue) + ' · ' + (state.mode === 'snapshot' ? '快照数据' : '实时数据');
    }
  }

  function renderHoldings() {
    var result = computeState();
    var positions = result.positions;

    if (positions.length === 0) {
      els.holdingsTable.classList.add('hidden');
      els.holdingsEmpty.classList.remove('hidden');
      els.holdingsBody.innerHTML = '';
      return;
    }

    els.holdingsTable.classList.remove('hidden');
    els.holdingsEmpty.classList.add('hidden');

    els.holdingsBody.innerHTML = positions.map(function (pos) {
      var stock = window.UNIVERSE_BY_SYMBOL[pos.symbol];
      var quote = state.quotes[pos.symbol];
      return (
        '<tr>' +
          '<td><div class="stock-name">' + escapeHtml(stock.name) + '</div>' +
            '<div class="stock-code">' + escapeHtml(pos.symbol) + '</div></td>' +
          '<td class="num price ' + cls(quote && quote.pct) + '">' + (quote ? fmtPrice(quote.price) : '--') + '</td>' +
          '<td class="num ' + cls(quote && quote.pct) + '">' + (quote ? fmtPct(quote.pct) : '--') + '</td>' +
          '<td class="num">' + fmtShares(pos.shares) + '</td>' +
          '<td class="num">' + fmtPrice(pos.costCents / 100) + '</td>' +
          '<td class="num">' + fmtMoneyAbs(pos.marketValue) + '</td>' +
          '<td class="num ' + cls(pos.pnl) + '">' + fmtMoneySigned(pos.pnl) + '</td>' +
          '<td class="num ' + cls(pos.pnl) + '">' + (pos.pnlPct != null ? fmtPct(pos.pnlPct * 100) : '--') + '</td>' +
          '<td class="num ' + cls(pos.dayPnl) + '">' + fmtMoneySigned(pos.dayPnl) + '</td>' +
          '<td class="num">' + fmtWeight(pos.weight) + '</td>' +
          '<td class="actions">' +
            '<button type="button" class="btn btn-small btn-ghost" data-edit="' + escapeHtml(pos.symbol) + '">编辑</button>' +
            '<button type="button" class="btn btn-small btn-danger" data-delete="' + escapeHtml(pos.symbol) + '">删除</button>' +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderFormState() {
    if (state.editingSymbol) {
      var stock = window.UNIVERSE_BY_SYMBOL[state.editingSymbol];
      els.formTitle.textContent = '编辑持仓';
      els.formSubmit.textContent = '保存修改';
      els.formCancel.classList.remove('hidden');
      els.formHint.textContent = '正在编辑 ' + stock.name + '（' + stock.symbol + '）';
    } else {
      els.formTitle.textContent = '添加持仓';
      els.formSubmit.textContent = '添加持仓';
      els.formCancel.classList.add('hidden');
      els.formHint.textContent = '持仓保存在本机浏览器，不会上传。';
    }
  }

  function renderAll() {
    renderStatus();
    renderIndices();
    renderWatchlist();
    renderSummary();
    renderHoldings();
    renderFormState();
  }

  function populateSymbolSelect() {
    els.formSymbol.innerHTML = window.UNIVERSE.map(function (stock) {
      return '<option value="' + escapeHtml(stock.symbol) + '">' +
        escapeHtml(stock.symbol + '  ' + stock.name) +
        '</option>';
    }).join('');
    els.formSymbol.value = window.UNIVERSE[0].symbol;
  }

  function clearFieldErrors() {
    els.errorSymbol.textContent = '';
    els.errorShares.textContent = '';
    els.errorCost.textContent = '';
  }

  function showFieldErrors(errors) {
    els.errorSymbol.textContent = errors.symbol || '';
    els.errorShares.textContent = errors.shares || '';
    els.errorCost.textContent = errors.cost || '';
    if (errors.symbol) els.formSymbol.focus();
    else if (errors.shares) els.formShares.focus();
    else if (errors.cost) els.formCost.focus();
  }

  function resetForm() {
    state.editingSymbol = null;
    els.formShares.value = '';
    var quote = state.quotes[els.formSymbol.value];
    els.formCost.value = quote && quote.price != null ? quote.price.toFixed(2) : '';
    clearFieldErrors();
    renderFormState();
  }

  function startEdit(symbol) {
    var holding = holdingFor(symbol);
    if (!holding) return;
    state.editingSymbol = symbol;
    els.formSymbol.value = symbol;
    els.formShares.value = holding.shares;
    els.formCost.value = Number(holding.cost).toFixed(2);
    clearFieldErrors();
    renderFormState();
    els.formShares.focus();
    document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function addFromWatchlist(symbol) {
    var holding = holdingFor(symbol);
    if (holding) {
      startEdit(symbol);
      return;
    }
    state.editingSymbol = null;
    els.formSymbol.value = symbol;
    els.formShares.value = '';
    var quote = state.quotes[symbol];
    els.formCost.value = quote && quote.price != null ? quote.price.toFixed(2) : '';
    clearFieldErrors();
    renderFormState();
    els.formShares.focus();
    document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearFieldErrors();
    var input = {
      symbol: els.formSymbol.value,
      shares: els.formShares.value.trim(),
      cost: els.formCost.value.trim()
    };
    var result = window.Portfolio.validateHolding(input, state.holdings, state.editingSymbol);
    if (!result.ok) {
      showFieldErrors(result.errors);
      return;
    }

    var holding = {
      symbol: input.symbol,
      shares: Number(input.shares),
      cost: Number(input.cost)
    };

    if (state.editingSymbol) {
      var index = state.holdings.findIndex(function (item) {
        return item.symbol === state.editingSymbol;
      });
      if (index >= 0) state.holdings[index] = holding;
      else state.holdings.push(holding);
    } else {
      state.holdings.push(holding);
    }

    saveHoldings();
    resetForm();
    renderAll();
  }

  function handleDelete(symbol) {
    var stock = window.UNIVERSE_BY_SYMBOL[symbol];
    if (!stock) return;
    if (!window.confirm('删除 ' + stock.name + ' 的持仓？')) return;
    state.holdings = state.holdings.filter(function (item) { return item.symbol !== symbol; });
    if (state.editingSymbol === symbol) resetForm();
    saveHoldings();
    renderAll();
  }

  function handleClear() {
    if (state.holdings.length === 0) return;
    if (!window.confirm('清空全部持仓？此操作不可撤销。')) return;
    state.holdings = [];
    resetForm();
    saveHoldings();
    renderAll();
  }

  function handleSample() {
    if (state.holdings.length > 0 && !window.confirm('载入示例会替换当前持仓，继续？')) return;
    state.holdings = cloneSample();
    resetForm();
    saveHoldings();
    renderAll();
  }

  function bindEvents() {
    els.holdingForm.addEventListener('submit', handleSubmit);

    [els.formSymbol, els.formShares, els.formCost].forEach(function (input) {
      input.addEventListener('input', clearFieldErrors);
      input.addEventListener('change', clearFieldErrors);
    });

    els.formSymbol.addEventListener('change', function () {
      if (state.editingSymbol) return;
      var quote = state.quotes[els.formSymbol.value];
      if (quote && quote.price != null) {
        els.formCost.value = quote.price.toFixed(2);
      }
    });

    els.formCancel.addEventListener('click', function () {
      resetForm();
      renderAll();
    });

    els.refreshBtn.addEventListener('click', function () {
      loadQuotes(true);
    });

    els.watchlistBody.addEventListener('click', function (event) {
      var button = event.target.closest('[data-add]');
      if (!button) return;
      addFromWatchlist(button.getAttribute('data-add'));
    });

    els.holdingsBody.addEventListener('click', function (event) {
      var editButton = event.target.closest('[data-edit]');
      if (editButton) {
        startEdit(editButton.getAttribute('data-edit'));
        return;
      }
      var deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        handleDelete(deleteButton.getAttribute('data-delete'));
      }
    });

    els.clearBtn.addEventListener('click', handleClear);
    els.sampleBtn.addEventListener('click', handleSample);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') loadQuotes(false);
    });
  }

  function cacheElements() {
    els.modeBadge = $('#mode-badge');
    els.marketStatus = $('#market-status');
    els.lastUpdate = $('#last-update');
    els.refreshBtn = $('#refresh-btn');
    els.errorBanner = $('#error-banner');
    els.indexGrid = $('#index-grid');
    els.quoteCount = $('#quote-count');
    els.watchlistBody = $('#watchlist-table tbody');
    els.formTitle = $('#form-title');
    els.formSymbol = $('#form-symbol');
    els.formShares = $('#form-shares');
    els.formCost = $('#form-cost');
    els.errorSymbol = $('#error-symbol');
    els.errorShares = $('#error-shares');
    els.errorCost = $('#error-cost');
    els.formSubmit = $('#form-submit');
    els.formCancel = $('#form-cancel');
    els.formHint = $('#form-hint');
    els.holdingForm = $('#holding-form');
    els.holdingsSubtitle = $('#holdings-subtitle');
    els.summaryGrid = $('#summary-grid');
    els.holdingsTable = $('#holdings-table');
    els.holdingsBody = $('#holdings-table tbody');
    els.holdingsEmpty = $('#holdings-empty');
    els.sampleBtn = $('#sample-btn');
    els.clearBtn = $('#clear-btn');
  }

  function init() {
    cacheElements();
    state.holdings = loadHoldings();
    populateSymbolSelect();
    bindEvents();
    applySnapshot('');
    resetForm();
    renderAll();
    loadQuotes(false);

    window.setInterval(function () {
      if (document.visibilityState === 'visible') loadQuotes(false);
    }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
