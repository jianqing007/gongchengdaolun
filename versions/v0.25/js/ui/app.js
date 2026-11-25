(function () {
  'use strict';

  var REFRESH_MS = 3000;
  var STALE_MS = 15000;
  var ALERT_LIMIT = 50;

  var state = {
    holdings: [],
    quotes: {},
    formMode: 'create',
    targetSymbol: null,
    mode: 'connecting',
    lastUpdate: null,
    loading: false,
    error: '',
    notice: '',
    storageStatus: '',
    fetchFailures: 0,
    nextRetryAt: 0,
    quoteRequestId: 0,
    quoteAbort: null,
    alerts: [],
    alertLastFired: {},
    chartSymbol: window.UNIVERSE[0].symbol,
    chartSeries: null,
    chartLoading: false,
    chartError: '',
    minuteCache: {},
    samples: {},
    minuteRequestId: 0,
    minuteAbort: null
  };

  var els = {};
  var formFeedbackTimer = null;
  var resizeTimer = null;

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

  function fmtDateKey(dateKey) {
    if (!dateKey || dateKey.length !== 8) return '';
    return dateKey.slice(0, 4) + '-' + dateKey.slice(4, 6) + '-' + dateKey.slice(6, 8);
  }

  function sameLocalDay(a, b) {
    if (!a || !b) return false;
    var da = new Date(a);
    var db = new Date(b);
    return da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate();
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function setTone(element, value) {
    if (!element) return;
    element.classList.remove('up', 'down', 'flat');
    element.classList.add(cls(value));
  }

  function cssColor(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function initializeHoldings() {
    var loaded = window.HoldingStore.read(localStorage, window.HoldingStore.sample);
    state.holdings = loaded.holdings;
    state.storageStatus = loaded.status;
    if (loaded.message) state.notice = loaded.message;

    if (loaded.shouldPersist) {
      var saved = window.HoldingStore.save(localStorage, state.holdings);
      if (!saved.ok) {
        state.storageStatus = 'unavailable';
        state.notice = '持仓保存失败：' + saved.error;
      }
    }
  }

  function saveHoldings() {
    var saved = window.HoldingStore.save(localStorage, state.holdings);
    if (!saved.ok) {
      state.storageStatus = 'unavailable';
      state.notice = '持仓保存失败：' + saved.error;
    }
    return saved;
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
      state.lastUpdate = window.QuoteState.latestQuoteTime(quotes, window.ALL_SYMBOLS);
      if (reason) state.error = reason;
    }
  }

  function loadQuotes(manual) {
    if (!manual && state.loading) return;
    if (!manual && state.nextRetryAt && Date.now() < state.nextRetryAt) return;

    if (manual && state.quoteAbort) state.quoteAbort.abort();

    var requestId = state.quoteRequestId + 1;
    state.quoteRequestId = requestId;
    var controller = new AbortController();
    state.quoteAbort = controller;
    state.loading = true;

    if (manual && els.refreshBtn) {
      els.refreshBtn.disabled = true;
      els.refreshBtn.textContent = '刷新中…';
    }

    window.QuoteProvider.fetchQuotes(window.ALL_SYMBOLS, 8000, controller.signal)
      .then(function (quotes) {
        if (!window.QuoteState.isLatest(state.quoteRequestId, requestId)) return;

        var missing = window.QuoteState.missingItems(window.ALL_SYMBOLS, quotes);
        var recovered = state.mode === 'snapshot';
        state.quotes = quotes;
        state.mode = 'live';
        state.lastUpdate = window.QuoteState.latestQuoteTime(quotes, window.ALL_SYMBOLS);
        state.fetchFailures = 0;
        state.nextRetryAt = 0;
        state.error = missing.length
          ? '部分标的暂无行情，相关行显示“--”：' + missing.map(function (item) { return item.name; }).join('、')
          : '';

        syncSamples(quotes);
        evaluateAlerts(quotes);
        syncChartSeries();
        if (recovered) loadMinute(state.chartSymbol);
      })
      .catch(function (err) {
        if (!window.QuoteState.isLatest(state.quoteRequestId, requestId)) return;

        state.fetchFailures += 1;
        var reason = err && err.name === 'AbortError'
          ? '请求超时'
          : (err && err.message ? err.message : '未知错误');
        var delay = window.QuoteState.backoffDelay(state.fetchFailures);
        state.nextRetryAt = Date.now() + delay;
        var hasSnapshot = state.mode === 'snapshot' && Object.keys(state.quotes).length > 0;

        if (hasSnapshot) {
          state.error = '快照模式：实时行情仍不可用（' + reason + '），继续使用 ' +
            fmtDateTime(state.lastUpdate) + ' 快照；约 ' + Math.round(delay / 1000) + ' 秒后重试';
        } else if (state.fetchFailures >= 3 || Object.keys(state.quotes).length === 0) {
          applySnapshot('实时行情不可用，已切换本地快照：' + reason + '；约 ' + Math.round(delay / 1000) + ' 秒后重试');
        } else {
          state.error = '行情更新失败（' + reason + '），显示上次数据；约 ' + Math.round(delay / 1000) + ' 秒后重试';
        }
      })
      .finally(function () {
        if (!window.QuoteState.isLatest(state.quoteRequestId, requestId)) return;
        state.loading = false;
        if (manual && els.refreshBtn) {
          els.refreshBtn.disabled = false;
          els.refreshBtn.textContent = '刷新';
        }
        renderAll();
      });
  }

  function evaluateAlerts(quotes) {
    if (state.mode !== 'live') return;
    var now = Date.now();
    var events = window.AlertEngine.evaluateAll(quotes, window.UNIVERSE, window.SNAPSHOT, now);
    var cooled = window.AlertEngine.applyCooldown(
      events,
      state.alertLastFired,
      now,
      window.AlertEngine.COOLDOWN_MS
    );
    state.alertLastFired = cooled.lastFired;
    if (cooled.events.length > 0) pushAlerts(cooled.events);
  }

  function quoteHhmm(quote) {
    if (!quote || !Number.isFinite(quote.time)) return null;
    var d = new Date(quote.time + 8 * 3600 * 1000);
    var hhmm = d.getUTCHours() * 100 + d.getUTCMinutes();
    var morning = hhmm >= 930 && hhmm <= 1130;
    var afternoon = hhmm >= 1300 && hhmm <= 1500;
    return morning || afternoon ? hhmm : null;
  }

  function quoteDateKey(quote) {
    if (!quote || !Number.isFinite(quote.time)) return '';
    return new Date(quote.time + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
  }

  function minuteLabel(hhmm) {
    var hh = Math.floor(hhmm / 100);
    var mm = hhmm % 100;
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function addSample(symbol, quote) {
    if (!quote || quote.price == null || quote.source === 'snapshot') return;
    var hhmm = quoteHhmm(quote);
    if (hhmm == null) return;

    var list = state.samples[symbol] || [];
    var last = list[list.length - 1];
    if (last && last.hhmm === hhmm) {
      last.price = quote.price;
    } else {
      list.push({ time: minuteLabel(hhmm), hhmm: hhmm, price: quote.price });
    }
    state.samples[symbol] = list.slice(-600);
  }

  function syncSamples(quotes) {
    window.UNIVERSE.forEach(function (stock) {
      addSample(stock.symbol, quotes[stock.symbol]);
    });
  }

  function appendPointToSeries(series, quote) {
    if (!series || !quote || quote.price == null || quote.source === 'snapshot') return;
    var hhmm = quoteHhmm(quote);
    if (hhmm == null) return;
    var dateKey = quoteDateKey(quote);
    if (series.date && dateKey && series.date !== dateKey) return;

    var points = series.points || [];
    var existing = null;
    points.forEach(function (point) {
      if (point.hhmm === hhmm) existing = point;
    });
    if (existing) {
      existing.price = quote.price;
    } else {
      points.push({ time: minuteLabel(hhmm), hhmm: hhmm, price: quote.price });
      points.sort(function (a, b) { return a.hhmm - b.hhmm; });
    }
    series.points = points.slice(-600);
  }

  function getPrevClose(symbol) {
    var quote = state.quotes[symbol];
    if (quote && quote.prevClose != null) return quote.prevClose;
    var snapshot = window.QuoteProvider.quoteFromSnapshot(symbol);
    return snapshot ? snapshot.prevClose : null;
  }

  function buildSampleSeries(symbol) {
    var points = (state.samples[symbol] || []).slice();
    var quote = state.quotes[symbol];
    return {
      symbol: symbol,
      date: quoteDateKey(quote),
      points: points,
      prevClose: getPrevClose(symbol),
      source: 'sample'
    };
  }

  function syncChartSeries() {
    var symbol = state.chartSymbol;
    var cached = state.minuteCache[symbol];
    if (cached) {
      cached.prevClose = getPrevClose(symbol);
      appendPointToSeries(cached, state.quotes[symbol]);
      state.chartSeries = cached;
    } else if (!state.chartLoading) {
      state.chartSeries = buildSampleSeries(symbol);
    }
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
    setText(els.marketStatus, market.text);
    els.marketStatus.className = 'badge ' + (market.live ? 'badge-live' : 'badge-muted');
    els.marketStatus.title = '按北京时间判断，未处理法定节假日';

    if (!state.lastUpdate) {
      setText(els.lastUpdate, '更新时间 --');
    } else if (state.mode === 'snapshot') {
      setText(els.lastUpdate, '快照截至 ' + fmtDateTime(state.lastUpdate));
    } else {
      var label = sameLocalDay(state.lastUpdate, Date.now())
        ? '更新于 ' + fmtClock(state.lastUpdate)
        : '行情 ' + fmtDateTime(state.lastUpdate);
      var stale = market.live && Date.now() - state.lastUpdate > STALE_MS;
      setText(els.lastUpdate, label + (stale ? ' · 延迟' : ''));
    }

    var message = [state.notice, state.error].filter(Boolean).join(' ');
    if (message) {
      setText(els.bannerText, message);
      els.errorBanner.className = 'banner';
    } else {
      setText(els.bannerText, '');
      els.errorBanner.className = 'banner hidden';
    }

    setText(els.alertSubtitle, state.mode === 'live'
      ? '实时行情触发 · 同一规则 30 分钟冷却'
      : '快照/离线状态不产生新告警 · 保留历史记录');

    document.body.dataset.mode = state.mode;
    document.body.dataset.quoteFailures = String(state.fetchFailures);
    document.body.dataset.storageStatus = state.storageStatus || '';
    document.body.dataset.retryAt = state.nextRetryAt ? String(state.nextRetryAt) : '';
  }

  function ensureIndexCards() {
    if (els.indexGrid.children.length === window.INDICES.length) return;
    els.indexGrid.innerHTML = window.INDICES.map(function (index) {
      return (
        '<div class="index-card" data-index="' + escapeHtml(index.symbol) + '">' +
          '<div class="index-head"><span class="index-name">' + escapeHtml(index.name) + '</span>' +
            '<span class="index-code">' + escapeHtml(index.code) + '</span></div>' +
          '<div class="index-price" data-field="price">--</div>' +
          '<div class="index-meta">' +
            '<span data-field="pct">--</span>' +
            '<span class="muted" data-field="change">--</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderIndices() {
    ensureIndexCards();
    window.INDICES.forEach(function (index) {
      var card = els.indexGrid.querySelector('[data-index="' + index.symbol + '"]');
      if (!card) return;
      var quote = state.quotes[index.symbol];
      var price = card.querySelector('[data-field="price"]');
      var pct = card.querySelector('[data-field="pct"]');
      var change = card.querySelector('[data-field="change"]');
      setText(price, quote ? fmtPrice(quote.price) : '--');
      setText(pct, quote ? fmtPct(quote.pct) : '--');
      setText(change, quote ? fmtSigned(quote.change, 2) : '--');
      setTone(price, quote && quote.pct);
      setTone(pct, quote && quote.pct);
      setTone(change, quote && quote.change);
    });
  }

  function createWatchRow(stock) {
    var row = document.createElement('tr');
    row.dataset.symbol = stock.symbol;
    row.title = '点击查看 ' + stock.name + ' 分时';
    row.innerHTML =
      '<td><div class="stock-name">' + escapeHtml(stock.name) + '</div>' +
        '<div class="stock-code">' + escapeHtml(stock.symbol) + ' · ' + escapeHtml(stock.sector) + '</div></td>' +
      '<td class="num price" data-field="price">--</td>' +
      '<td class="num" data-field="pct">--</td>' +
      '<td class="num" data-field="change">--</td>' +
      '<td class="num" data-field="volumeRatio">--</td>' +
      '<td class="num" data-field="turnover">--</td>' +
      '<td class="num range"><span data-field="high">--</span><span class="muted"> / </span>' +
        '<span data-field="low">--</span></td>' +
      '<td class="actions"><button type="button" class="btn btn-small" data-add="' +
        escapeHtml(stock.symbol) + '">+ 建仓</button></td>';
    return row;
  }

  function ensureWatchRows() {
    var existing = {};
    Array.from(els.watchlistBody.children).forEach(function (row) {
      existing[row.dataset.symbol] = row;
    });
    window.UNIVERSE.forEach(function (stock) {
      if (!existing[stock.symbol]) els.watchlistBody.appendChild(createWatchRow(stock));
    });
  }

  function holdingFor(symbol) {
    return state.holdings.find(function (item) { return item.symbol === symbol; }) || null;
  }

  function renderWatchlist() {
    ensureWatchRows();
    var quoteCount = 0;

    window.UNIVERSE.forEach(function (stock) {
      var row = els.watchlistBody.querySelector('tr[data-symbol="' + stock.symbol + '"]');
      if (!row) return;
      var quote = state.quotes[stock.symbol];
      if (quote && quote.price != null) quoteCount += 1;

      var price = row.querySelector('[data-field="price"]');
      var pct = row.querySelector('[data-field="pct"]');
      var change = row.querySelector('[data-field="change"]');
      var ratio = row.querySelector('[data-field="volumeRatio"]');
      var turnover = row.querySelector('[data-field="turnover"]');
      var high = row.querySelector('[data-field="high"]');
      var low = row.querySelector('[data-field="low"]');
      var button = row.querySelector('[data-add]');
      var holding = holdingFor(stock.symbol);

      setText(price, quote ? fmtPrice(quote.price) : '--');
      setText(pct, quote ? fmtPct(quote.pct) : '--');
      setText(change, quote ? fmtSigned(quote.change, 2) : '--');
      setText(ratio, quote && quote.volumeRatio != null ? fmtNum(quote.volumeRatio, 2) : '--');
      setText(turnover, quote && quote.turnover != null ? fmtNum(quote.turnover, 2) + '%' : '--');
      setText(high, quote ? fmtPrice(quote.high) : '--');
      setText(low, quote ? fmtPrice(quote.low) : '--');

      setTone(price, quote && quote.pct);
      setTone(pct, quote && quote.pct);
      setTone(change, quote && quote.change);

      if (button) {
        setText(button, holding ? '加仓' : '+ 建仓');
        button.className = 'btn btn-small' + (holding ? '' : ' btn-ghost');
      }
      row.classList.toggle('is-selected', stock.symbol === state.chartSymbol);
    });

    setText(els.quoteCount, quoteCount + ' / ' + window.UNIVERSE.length + ' 只');
  }

  function computeState() {
    return window.Portfolio.computePortfolio(state.holdings, state.quotes);
  }

  function ensureSummaryCards() {
    if (els.summaryGrid.children.length === 6) return;
    var keys = ['market', 'cost', 'pnl', 'day', 'count', 'time'];
    els.summaryGrid.innerHTML = keys.map(function (key) {
      return (
        '<div class="summary-card" data-card="' + key + '">' +
          '<div class="summary-label"></div>' +
          '<div class="summary-value"></div>' +
          '<div class="summary-sub"></div>' +
        '</div>'
      );
    }).join('');
  }

  function renderSummary() {
    ensureSummaryCards();
    var result = computeState();
    var positions = result.positions;
    var totals = result.totals;
    var complete = positions.length > 0 && positions.every(function (pos) { return pos.marketValue != null; });

    var cards = {
      market: {
        label: '总市值',
        value: complete ? fmtMoneyAbs(totals.marketValue) : '--',
        sub: positions.length ? positions.length + ' 只持仓' : '暂无持仓',
        tone: null
      },
      cost: {
        label: '总成本',
        value: positions.length ? fmtMoneyAbs(totals.costTotal) : '--',
        sub: '按每股成本计算',
        tone: null
      },
      pnl: {
        label: '浮动盈亏',
        value: complete ? fmtMoneySigned(totals.pnl) : '--',
        sub: complete && totals.pnlPct != null ? fmtPct(totals.pnlPct * 100) : '等待完整行情',
        tone: complete ? totals.pnl : null
      },
      day: {
        label: state.mode === 'snapshot' ? '快照日盈亏' : '今日盈亏',
        value: complete ? fmtMoneySigned(totals.dayPnl) : '--',
        sub: complete ? (state.mode === 'snapshot' ? '按快照日昨收' : '按昨收计算') : '等待完整行情',
        tone: complete ? totals.dayPnl : null
      },
      count: {
        label: '持仓数',
        value: positions.length + ' 只',
        sub: '自选 ' + window.UNIVERSE.length + ' 只',
        tone: null
      },
      time: {
        label: '数据时间',
        value: state.mode === 'snapshot' ? '快照' : fmtClock(state.lastUpdate),
        sub: state.mode === 'snapshot' ? fmtDateTime(state.lastUpdate) : '每 3 秒刷新',
        tone: null
      }
    };

    Object.keys(cards).forEach(function (key) {
      var card = els.summaryGrid.querySelector('[data-card="' + key + '"]');
      if (!card) return;
      var data = cards[key];
      setText(card.querySelector('.summary-label'), data.label);
      setText(card.querySelector('.summary-value'), data.value);
      setText(card.querySelector('.summary-sub'), data.sub);
      var value = card.querySelector('.summary-value');
      value.classList.remove('up', 'down', 'flat');
      if (data.tone != null) value.classList.add(cls(data.tone));
    });

    if (positions.length === 0) {
      setText(els.holdingsSubtitle, '还没有持仓');
    } else if (!complete) {
      setText(els.holdingsSubtitle, positions.length + ' 只 · 部分行情缺失，合计暂不展示');
    } else {
      setText(els.holdingsSubtitle, positions.length + ' 只 · 总市值 ' + fmtMoneyAbs(totals.marketValue) +
        ' · ' + (state.mode === 'snapshot' ? '快照数据' : '实时数据'));
    }
  }

  function createHoldingRow(position) {
    var stock = window.UNIVERSE_BY_SYMBOL[position.symbol];
    var row = document.createElement('tr');
    row.dataset.symbol = position.symbol;
    row.innerHTML =
      '<td><div class="stock-name">' + escapeHtml(stock.name) + '</div>' +
        '<div class="stock-code">' + escapeHtml(position.symbol) + '</div></td>' +
      '<td class="num price" data-field="price">--</td>' +
      '<td class="num" data-field="pct">--</td>' +
      '<td class="num" data-field="shares">--</td>' +
      '<td class="num" data-field="cost">--</td>' +
      '<td class="num" data-field="market">--</td>' +
      '<td class="num" data-field="pnl">--</td>' +
      '<td class="num" data-field="pnlPct">--</td>' +
      '<td class="num" data-field="dayPnl">--</td>' +
      '<td class="num" data-field="weight">--</td>' +
      '<td class="actions">' +
        '<button type="button" class="btn btn-small" data-increase="' + escapeHtml(position.symbol) + '">加仓</button>' +
        '<button type="button" class="btn btn-small btn-ghost" data-reduce="' + escapeHtml(position.symbol) + '">减仓</button>' +
        '<button type="button" class="btn btn-small btn-ghost" data-edit="' + escapeHtml(position.symbol) + '">修正</button>' +
        '<button type="button" class="btn btn-small btn-danger" data-delete="' + escapeHtml(position.symbol) + '">删除</button>' +
      '</td>';
    return row;
  }

  function updateHoldingRow(row, position) {
    var quote = state.quotes[position.symbol];
    var price = row.querySelector('[data-field="price"]');
    var pct = row.querySelector('[data-field="pct"]');
    var pnl = row.querySelector('[data-field="pnl"]');
    var pnlPct = row.querySelector('[data-field="pnlPct"]');
    var dayPnl = row.querySelector('[data-field="dayPnl"]');

    setText(price, quote ? fmtPrice(quote.price) : '--');
    setText(pct, quote ? fmtPct(quote.pct) : '--');
    setText(row.querySelector('[data-field="shares"]'), fmtShares(position.shares));
    setText(row.querySelector('[data-field="cost"]'), fmtPrice(position.costCents / 100));
    setText(row.querySelector('[data-field="market"]'), fmtMoneyAbs(position.marketValue));
    setText(pnl, fmtMoneySigned(position.pnl));
    setText(pnlPct, position.pnlPct != null ? fmtPct(position.pnlPct * 100) : '--');
    setText(dayPnl, fmtMoneySigned(position.dayPnl));
    setText(row.querySelector('[data-field="weight"]'), fmtWeight(position.weight));

    setTone(price, quote && quote.pct);
    setTone(pct, quote && quote.pct);
    setTone(pnl, position.pnl);
    setTone(pnlPct, position.pnl);
    setTone(dayPnl, position.dayPnl);
  }

  function renderHoldings() {
    var result = computeState();
    var positions = result.positions;

    if (positions.length === 0) {
      els.holdingsTable.classList.add('hidden');
      els.holdingsEmpty.classList.remove('hidden');
      if (els.holdingsBody.children.length > 0) els.holdingsBody.textContent = '';
      return;
    }

    els.holdingsTable.classList.remove('hidden');
    els.holdingsEmpty.classList.add('hidden');

    var existing = {};
    Array.from(els.holdingsBody.children).forEach(function (row) {
      existing[row.dataset.symbol] = row;
    });
    positions.forEach(function (position) {
      if (!existing[position.symbol]) {
        var row = createHoldingRow(position);
        existing[position.symbol] = row;
        els.holdingsBody.appendChild(row);
      }
    });

    var desired = positions.map(function (position) { return position.symbol; });
    var current = Array.from(els.holdingsBody.children).map(function (row) { return row.dataset.symbol; });
    if (current.join('|') !== desired.join('|')) {
      positions.forEach(function (position) {
        els.holdingsBody.appendChild(existing[position.symbol]);
      });
    }

    Array.from(els.holdingsBody.children).forEach(function (row) {
      if (desired.indexOf(row.dataset.symbol) === -1) row.remove();
    });

    positions.forEach(function (position) {
      updateHoldingRow(existing[position.symbol], position);
    });
  }

  function pauseChart(stock, message, badgeText) {
    setText(els.chartSubtitle, stock.name + ' ' + stock.symbol + ' · ' +
      (state.mode === 'snapshot' ? '快照模式' : '暂无行情'));
    setText(els.chartPrice, '--');
    setText(els.chartPct, '--');
    setTone(els.chartPrice, null);
    setTone(els.chartPct, null);
    setText(els.chartNote, message);
    els.chartSource.className = 'badge badge-warn';
    els.chartSource.textContent = badgeText;
    els.chartCanvas.classList.add('hidden');
    els.chartEmpty.classList.remove('hidden');
    els.chartEmptyText.textContent = message;
  }

  function renderChart() {
    var stock = window.UNIVERSE_BY_SYMBOL[state.chartSymbol];
    var quote = state.quotes[state.chartSymbol];
    var series = state.chartSeries;

    if (state.mode === 'snapshot') {
      pauseChart(stock, '快照模式：分时图暂停，恢复实时行情后自动加载', '快照模式');
      return;
    }
    if (!quote || quote.price == null) {
      pauseChart(stock, '该标的暂无行情，分时图暂停', '暂无行情');
      return;
    }

    if (!series || series.symbol !== state.chartSymbol) {
      series = state.minuteCache[state.chartSymbol] || buildSampleSeries(state.chartSymbol);
      state.chartSeries = series;
    }

    var prevClose = getPrevClose(state.chartSymbol);
    if (prevClose != null) series.prevClose = prevClose;

    els.chartEmptyText.textContent = '暂无分时数据。选择股票或等待行情刷新。';
    setText(els.chartSubtitle, stock.name + ' ' + stock.symbol +
      (series.date ? ' · ' + fmtDateKey(series.date) : ' · 当日分时'));
    setText(els.chartPrice, fmtPrice(quote.price));
    setText(els.chartPct, fmtPct(quote.pct));
    setTone(els.chartPrice, quote.pct);
    setTone(els.chartPct, quote.pct);

    var note = [];
    if (prevClose != null) note.push('昨收 ' + fmtPrice(prevClose));
    if (series.points.length > 0) {
      note.push((series.source === 'minute' ? '腾讯分时 ' : '本页采样 ') + series.points.length + ' 点');
    }
    if (state.chartError) note.push(state.chartError);
    setText(els.chartNote, note.join(' · '));

    var source = els.chartSource;
    source.className = 'badge';
    if (state.chartLoading) {
      source.classList.add('badge-muted');
      source.textContent = '加载中';
    } else if (series.source === 'minute') {
      source.classList.add('badge-live');
      source.textContent = '腾讯分时';
    } else if (series.source === 'sample' && series.points.length > 0) {
      source.classList.add('badge-warn');
      source.textContent = '本页采样';
    } else {
      source.classList.add('badge-muted');
      source.textContent = '暂无数据';
    }

    var drawn = false;
    if (series.points.length > 0) {
      // 先恢复画布布局，否则上一轮无数据时的 hidden 会让 clientWidth 为 0。
      els.chartCanvas.classList.remove('hidden');
      drawn = window.IntradayChart.draw(els.chartCanvas, series, {
        up: cssColor('--up', '#f2555f'),
        down: cssColor('--down', '#2fbf71'),
        accent: cssColor('--accent', '#4c8dff'),
        text: cssColor('--muted', '#8b9aab'),
        grid: 'rgba(139, 154, 171, 0.14)'
      });
    }

    if (drawn) {
      els.chartCanvas.classList.remove('hidden');
      els.chartEmpty.classList.add('hidden');
    } else {
      els.chartCanvas.classList.add('hidden');
      els.chartEmpty.classList.remove('hidden');
    }
  }

  function createAlertNode(event) {
    var item = document.createElement('div');
    item.className = 'alert-item ' + (event.tone || 'warn');

    var icon = document.createElement('div');
    icon.className = 'alert-icon';
    icon.textContent = event.tone === 'down' ? '↓' : event.tone === 'up' ? '↑' : '!';

    var main = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'alert-title';
    var name = document.createElement('strong');
    name.textContent = event.name + ' ' + event.symbol;
    var rule = document.createElement('span');
    rule.className = 'alert-rule';
    rule.textContent = event.ruleLabel + ' · ' + event.title;
    title.appendChild(name);
    title.appendChild(rule);

    var detail = document.createElement('div');
    detail.className = 'alert-detail';
    detail.textContent = event.detail;

    var time = document.createElement('time');
    time.className = 'alert-time';
    time.textContent = fmtClock(event.time);

    main.appendChild(title);
    main.appendChild(detail);
    item.appendChild(icon);
    item.appendChild(main);
    item.appendChild(time);
    return item;
  }

  function renderAlertMeta() {
    setText(els.alertCount, state.alerts.length + ' 条');
    if (state.alerts.length > 0) {
      els.alertEmpty.classList.add('hidden');
    } else {
      els.alertEmpty.classList.remove('hidden');
    }
  }

  function pushAlerts(events) {
    events.slice().reverse().forEach(function (event) {
      state.alerts.unshift(event);
      els.alertList.insertBefore(createAlertNode(event), els.alertList.firstChild);
    });
    while (state.alerts.length > ALERT_LIMIT) {
      state.alerts.pop();
      if (els.alertList.lastChild) els.alertList.removeChild(els.alertList.lastChild);
    }
    renderAlertMeta();
  }

  function clearAlerts() {
    state.alerts = [];
    els.alertList.textContent = '';
    renderAlertMeta();
  }

  function firstAvailableSymbol() {
    var free = window.UNIVERSE.find(function (stock) {
      return !holdingFor(stock.symbol);
    });
    return free ? free.symbol : window.UNIVERSE[0].symbol;
  }

  function quotePriceFor(symbol) {
    var quote = state.quotes[symbol];
    if (quote && quote.price != null) return Number(quote.price).toFixed(2);
    var snapshot = window.QuoteProvider.quoteFromSnapshot(symbol);
    return snapshot && snapshot.price != null ? Number(snapshot.price).toFixed(2) : '';
  }

  function scrollToForm() {
    document.querySelector('.form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderFormState() {
    var mode = state.formMode;
    var target = state.targetSymbol ? holdingFor(state.targetSymbol) : null;
    var stock = target ? window.UNIVERSE_BY_SYMBOL[target.symbol] : null;

    if (mode !== 'create' && !target) {
      mode = 'create';
      state.formMode = 'create';
      state.targetSymbol = null;
    }

    els.formCancel.classList.toggle('hidden', mode === 'create');
    els.formSymbol.disabled = mode !== 'create';
    els.costField.classList.remove('hidden');
    els.labelShares.textContent = '股数';
    els.labelCost.textContent = '成本价（元/股）';
    els.formShares.placeholder = '例如 100';
    els.formCost.placeholder = '例如 1500.00';

    if (mode === 'create') {
      els.formTitle.textContent = '建仓';
      els.formSubtitle.textContent = '新建一只股票的持仓';
      els.formSubmit.textContent = '确认建仓';
      els.formHint.textContent = '建仓只用于尚未持有的股票；已持仓请用“加仓”或“修正”。';
      return;
    }

    els.formSubtitle.textContent = stock.name + ' ' + stock.symbol;

    if (mode === 'increase') {
      els.formTitle.textContent = '加仓';
      els.formSubmit.textContent = '确认加仓';
      els.labelShares.textContent = '新增股数';
      els.labelCost.textContent = '本次成本价（元/股）';
      els.formShares.placeholder = '例如 100';
      els.formHint.textContent = '现有 ' + fmtShares(target.shares) + ' 股 @' +
        fmtPrice(target.cost) + '；确认后按加权平均成本合并。';
    } else if (mode === 'reduce') {
      els.formTitle.textContent = '减仓';
      els.formSubmit.textContent = '确认减仓';
      els.labelShares.textContent = '减持股数';
      els.costField.classList.add('hidden');
      els.formShares.placeholder = '例如 50';
      els.formHint.textContent = '现有 ' + fmtShares(target.shares) + ' 股 @' +
        fmtPrice(target.cost) + '；减仓不改变每股成本，减至 0 将清仓。';
    } else {
      els.formTitle.textContent = '修正持仓';
      els.formSubmit.textContent = '保存修正';
      els.labelShares.textContent = '修正后股数';
      els.labelCost.textContent = '修正后成本价（元/股）';
      els.formHint.textContent = '只用于纠正录入错误，不会按加仓/减仓计算。';
    }
  }

  function renderAll() {
    renderStatus();
    renderIndices();
    renderWatchlist();
    renderSummary();
    renderHoldings();
    renderChart();
    renderFormState();
    renderAlertMeta();
  }

  function populateSymbolSelect() {
    els.formSymbol.innerHTML = window.UNIVERSE.map(function (stock) {
      return '<option value="' + escapeHtml(stock.symbol) + '">' +
        escapeHtml(stock.symbol + '  ' + stock.name) +
        '</option>';
    }).join('');
    els.formSymbol.value = window.UNIVERSE[0].symbol;
  }

  function populateChartSelect() {
    els.chartSymbol.innerHTML = window.UNIVERSE.map(function (stock) {
      return '<option value="' + escapeHtml(stock.symbol) + '">' +
        escapeHtml(stock.symbol + '  ' + stock.name) +
        '</option>';
    }).join('');
    els.chartSymbol.value = state.chartSymbol;
  }

  function clearFieldErrors() {
    [['symbol', els.errorSymbol], ['shares', els.errorShares], ['cost', els.errorCost]].forEach(function (pair) {
      pair[1].textContent = '';
    });
    els.formSymbol.removeAttribute('aria-invalid');
    els.formShares.removeAttribute('aria-invalid');
    els.formCost.removeAttribute('aria-invalid');
  }

  function showFieldErrors(errors) {
    els.errorSymbol.textContent = errors.symbol || '';
    els.errorShares.textContent = errors.shares || '';
    els.errorCost.textContent = errors.cost || '';
    if (errors.symbol) {
      els.formSymbol.setAttribute('aria-invalid', 'true');
      els.formSymbol.focus();
    } else {
      els.formSymbol.removeAttribute('aria-invalid');
    }
    if (errors.shares) {
      els.formShares.setAttribute('aria-invalid', 'true');
      if (!errors.symbol) els.formShares.focus();
    } else {
      els.formShares.removeAttribute('aria-invalid');
    }
    if (errors.cost) {
      els.formCost.setAttribute('aria-invalid', 'true');
      if (!errors.symbol && !errors.shares) els.formCost.focus();
    } else {
      els.formCost.removeAttribute('aria-invalid');
    }
  }

  function clearFormFeedback() {
    if (formFeedbackTimer) {
      clearTimeout(formFeedbackTimer);
      formFeedbackTimer = null;
    }
    els.formFeedback.classList.add('hidden');
    els.formFeedback.textContent = '';
    els.formFeedback.className = 'form-feedback hidden';
  }

  function showFormFeedback(message, type) {
    if (formFeedbackTimer) clearTimeout(formFeedbackTimer);
    els.formFeedback.textContent = message;
    els.formFeedback.className = 'form-feedback ' + type;
    if (type === 'success') {
      formFeedbackTimer = setTimeout(clearFormFeedback, 4000);
    }
  }

  function resetForm() {
    state.formMode = 'create';
    state.targetSymbol = null;
    els.formSymbol.disabled = false;
    els.formSymbol.value = firstAvailableSymbol();
    els.formShares.value = '';
    els.formCost.value = quotePriceFor(els.formSymbol.value);
    clearFieldErrors();
    renderFormState();
  }

  function startCreate(symbol) {
    var holding = holdingFor(symbol);
    if (holding) {
      startIncrease(symbol);
      return;
    }
    state.formMode = 'create';
    state.targetSymbol = null;
    els.formSymbol.disabled = false;
    els.formSymbol.value = symbol || firstAvailableSymbol();
    els.formShares.value = '';
    els.formCost.value = quotePriceFor(els.formSymbol.value);
    clearFieldErrors();
    clearFormFeedback();
    renderFormState();
    els.formShares.focus();
    scrollToForm();
  }

  function startIncrease(symbol) {
    var holding = holdingFor(symbol);
    if (!holding) {
      startCreate(symbol);
      return;
    }
    state.formMode = 'increase';
    state.targetSymbol = symbol;
    els.formSymbol.value = symbol;
    els.formShares.value = '';
    els.formCost.value = quotePriceFor(symbol);
    clearFieldErrors();
    clearFormFeedback();
    renderFormState();
    els.formShares.focus();
    scrollToForm();
  }

  function startReduce(symbol) {
    var holding = holdingFor(symbol);
    if (!holding) return;
    state.formMode = 'reduce';
    state.targetSymbol = symbol;
    els.formSymbol.value = symbol;
    els.formShares.value = '';
    els.formCost.value = '';
    clearFieldErrors();
    clearFormFeedback();
    renderFormState();
    els.formShares.focus();
    scrollToForm();
  }

  function startEdit(symbol) {
    var holding = holdingFor(symbol);
    if (!holding) return;
    state.formMode = 'edit';
    state.targetSymbol = symbol;
    els.formSymbol.value = symbol;
    els.formShares.value = holding.shares;
    els.formCost.value = Number(holding.cost).toFixed(2);
    clearFieldErrors();
    clearFormFeedback();
    renderFormState();
    els.formShares.focus();
    scrollToForm();
  }

  function addFromWatchlist(symbol) {
    if (holdingFor(symbol)) startIncrease(symbol);
    else startCreate(symbol);
  }

  function selectChartSymbol(symbol) {
    if (!window.UNIVERSE_BY_SYMBOL[symbol]) return;
    state.chartSymbol = symbol;
    els.chartSymbol.value = symbol;
    state.chartError = '';
    state.chartSeries = state.minuteCache[symbol] || buildSampleSeries(symbol);
    renderWatchlist();
    renderChart();
    loadMinute(symbol);
  }

  function loadMinute(symbol) {
    var requestId = state.minuteRequestId + 1;
    state.minuteRequestId = requestId;
    if (state.minuteAbort) state.minuteAbort.abort();
    var controller = new AbortController();
    state.minuteAbort = controller;
    state.chartLoading = true;
    if (symbol === state.chartSymbol) renderChart();

    window.QuoteProvider.fetchMinute(symbol, 8000, controller.signal)
      .then(function (series) {
        if (!window.QuoteState.isLatest(state.minuteRequestId, requestId)) return;
        if (symbol !== state.chartSymbol) return;
        series.prevClose = getPrevClose(symbol);
        appendPointToSeries(series, state.quotes[symbol]);
        state.minuteCache[symbol] = series;
        state.chartSeries = series;
        state.chartError = '';
      })
      .catch(function (err) {
        if (!window.QuoteState.isLatest(state.minuteRequestId, requestId)) return;
        if (err && err.name === 'AbortError') return;
        if (symbol !== state.chartSymbol) return;
        state.chartError = '分时接口不可用，使用本页采样';
        if (!state.minuteCache[symbol]) state.chartSeries = buildSampleSeries(symbol);
      })
      .finally(function () {
        if (!window.QuoteState.isLatest(state.minuteRequestId, requestId)) return;
        state.chartLoading = false;
        renderChart();
      });
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearFieldErrors();
    clearFormFeedback();

    var mode = state.formMode;
    var target = state.targetSymbol ? holdingFor(state.targetSymbol) : null;
    var input = {
      symbol: target ? target.symbol : els.formSymbol.value,
      shares: els.formShares.value.trim(),
      cost: els.formCost.value.trim()
    };
    var result;

    if (mode === 'increase') {
      result = window.Portfolio.validateIncrease(input, target);
    } else if (mode === 'reduce') {
      result = window.Portfolio.validateReduce(input, target);
    } else {
      result = window.Portfolio.validateHolding(
        input,
        state.holdings,
        mode === 'edit' && target ? target.symbol : null
      );
    }

    if (!result.ok) {
      showFieldErrors(result.errors);
      var labels = {
        symbol: '股票',
        shares: mode === 'increase' ? '新增股数' : mode === 'reduce' ? '减持股数' : mode === 'edit' ? '修正后股数' : '股数',
        cost: mode === 'increase' ? '本次成本价' : mode === 'edit' ? '修正后成本价' : '成本价'
      };
      var fields = ['symbol', 'shares', 'cost'].filter(function (key) {
        return result.errors[key];
      }).map(function (key) { return labels[key]; });
      showFormFeedback('还有 ' + fields.length + ' 项需要修正：' + fields.join('、'), 'error');
      return;
    }

    var stock = window.UNIVERSE_BY_SYMBOL[input.symbol];
    var message;
    var nextHolding;

    if (mode === 'create') {
      nextHolding = {
        symbol: input.symbol,
        shares: Number(input.shares),
        cost: Number(input.cost)
      };
      state.holdings = state.holdings.concat([nextHolding]);
      message = '已建仓 ' + stock.name + ' ' + fmtShares(nextHolding.shares) +
        ' 股 @' + fmtPrice(nextHolding.cost);
    } else if (mode === 'edit') {
      nextHolding = {
        symbol: target.symbol,
        shares: Number(input.shares),
        cost: Number(input.cost)
      };
      var editIndex = state.holdings.findIndex(function (item) {
        return item.symbol === target.symbol;
      });
      if (editIndex >= 0) state.holdings[editIndex] = nextHolding;
      message = '已修正 ' + stock.name + '：' + fmtShares(nextHolding.shares) +
        ' 股 @' + fmtPrice(nextHolding.cost);
    } else if (mode === 'increase') {
      nextHolding = window.Portfolio.mergeHolding(target, input.shares, input.cost);
      var increaseIndex = state.holdings.findIndex(function (item) {
        return item.symbol === target.symbol;
      });
      if (increaseIndex >= 0) state.holdings[increaseIndex] = nextHolding;
      message = '已加仓 ' + stock.name + ' ' + fmtShares(Number(input.shares)) +
        ' 股，新成本 ' + fmtPrice(nextHolding.cost);
    } else {
      var reduceShares = Number(input.shares);
      if (reduceShares === Number(target.shares) &&
          !window.confirm('减仓 ' + fmtShares(reduceShares) + ' 股将清空 ' + stock.name + '，继续？')) {
        return;
      }
      nextHolding = window.Portfolio.reduceHolding(target, reduceShares);
      var reduceIndex = state.holdings.findIndex(function (item) {
        return item.symbol === target.symbol;
      });
      if (nextHolding) {
        if (reduceIndex >= 0) state.holdings[reduceIndex] = nextHolding;
        message = '已减仓 ' + stock.name + ' ' + fmtShares(reduceShares) +
          ' 股，剩余 ' + fmtShares(nextHolding.shares) + ' 股';
      } else {
        state.holdings = state.holdings.filter(function (item) {
          return item.symbol !== target.symbol;
        });
        message = '已清仓 ' + stock.name;
      }
    }

    var saved = saveHoldings();
    resetForm();
    renderAll();
    showFormFeedback(
      saved.ok ? message : '页面已更新，但本地保存失败：' + saved.error,
      saved.ok ? 'success' : 'error'
    );
  }

  function handleDelete(symbol) {
    var stock = window.UNIVERSE_BY_SYMBOL[symbol];
    if (!stock) return;
    if (!window.confirm('删除 ' + stock.name + ' 的持仓？')) return;
    state.holdings = state.holdings.filter(function (item) { return item.symbol !== symbol; });
    if (state.targetSymbol === symbol) resetForm();
    var saved = saveHoldings();
    renderAll();
    showFormFeedback(
      saved.ok ? '已删除 ' + stock.name + ' 的持仓' : '已从页面删除，但本地保存失败：' + saved.error,
      saved.ok ? 'success' : 'error'
    );
  }

  function handleClear() {
    if (state.holdings.length === 0) return;
    if (!window.confirm('清空全部持仓？此操作不可撤销。')) return;
    state.holdings = [];
    resetForm();
    var saved = saveHoldings();
    renderAll();
    showFormFeedback(
      saved.ok ? '已清空全部持仓' : '页面已清空，但本地保存失败：' + saved.error,
      saved.ok ? 'success' : 'error'
    );
  }

  function handleSample() {
    if (state.holdings.length > 0 && !window.confirm('载入示例会替换当前持仓，继续？')) return;
    state.holdings = window.HoldingStore.sample();
    resetForm();
    var saved = saveHoldings();
    renderAll();
    showFormFeedback(
      saved.ok ? '已载入示例持仓' : '页面已载入示例，但本地保存失败：' + saved.error,
      saved.ok ? 'success' : 'error'
    );
  }

  function bindEvents() {
    els.holdingForm.addEventListener('submit', handleSubmit);

    [els.formSymbol, els.formShares, els.formCost].forEach(function (input) {
      input.addEventListener('input', function () {
        clearFieldErrors();
        clearFormFeedback();
      });
      input.addEventListener('change', function () {
        clearFieldErrors();
        clearFormFeedback();
      });
    });

    els.formSymbol.addEventListener('change', function () {
      if (state.formMode !== 'create') return;
      var quote = state.quotes[els.formSymbol.value];
      if (quote && quote.price != null) {
        els.formCost.value = quote.price.toFixed(2);
      }
    });

    els.formCancel.addEventListener('click', function () {
      clearFormFeedback();
      resetForm();
      renderAll();
    });

    els.refreshBtn.addEventListener('click', function () {
      loadQuotes(true);
    });

    els.bannerClose.addEventListener('click', function () {
      state.notice = '';
      state.error = '';
      renderStatus();
    });

    els.chartSymbol.addEventListener('change', function () {
      selectChartSymbol(els.chartSymbol.value);
    });

    els.watchlistBody.addEventListener('click', function (event) {
      var button = event.target.closest('[data-add]');
      if (button) {
        addFromWatchlist(button.getAttribute('data-add'));
        return;
      }
      var row = event.target.closest('tr[data-symbol]');
      if (row) selectChartSymbol(row.dataset.symbol);
    });

    els.holdingsBody.addEventListener('click', function (event) {
      var increaseButton = event.target.closest('[data-increase]');
      if (increaseButton) {
        startIncrease(increaseButton.getAttribute('data-increase'));
        return;
      }
      var reduceButton = event.target.closest('[data-reduce]');
      if (reduceButton) {
        startReduce(reduceButton.getAttribute('data-reduce'));
        return;
      }
      var editButton = event.target.closest('[data-edit]');
      if (editButton) {
        startEdit(editButton.getAttribute('data-edit'));
        return;
      }
      var deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        handleDelete(deleteButton.getAttribute('data-delete'));
        return;
      }
      var row = event.target.closest('tr[data-symbol]');
      if (row) selectChartSymbol(row.dataset.symbol);
    });

    els.clearBtn.addEventListener('click', handleClear);
    els.sampleBtn.addEventListener('click', handleSample);
    els.alertClear.addEventListener('click', clearAlerts);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        loadQuotes(false);
        renderChart();
      }
    });

    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderChart, 120);
    });

    window.addEventListener('online', function () {
      loadQuotes(true);
    });
  }

  function cacheElements() {
    els.modeBadge = $('#mode-badge');
    els.marketStatus = $('#market-status');
    els.lastUpdate = $('#last-update');
    els.refreshBtn = $('#refresh-btn');
    els.errorBanner = $('#error-banner');
    els.bannerText = $('#banner-text');
    els.bannerClose = $('#banner-close');
    els.indexGrid = $('#index-grid');
    els.quoteCount = $('#quote-count');
    els.watchlistBody = $('#watchlist-table tbody');
    els.chartSymbol = $('#chart-symbol');
    els.chartSubtitle = $('#chart-subtitle');
    els.chartSource = $('#chart-source');
    els.chartPrice = $('#chart-price');
    els.chartPct = $('#chart-pct');
    els.chartNote = $('#chart-note');
    els.chartCanvas = $('#intraday-canvas');
    els.chartEmpty = $('#chart-empty');
    els.chartEmptyText = $('#chart-empty-text');
    els.formTitle = $('#form-title');
    els.formSubtitle = $('#form-subtitle');
    els.formSymbol = $('#form-symbol');
    els.formShares = $('#form-shares');
    els.formCost = $('#form-cost');
    els.costField = $('#cost-field');
    els.labelShares = $('#label-shares');
    els.labelCost = $('#label-cost');
    els.errorSymbol = $('#error-symbol');
    els.errorShares = $('#error-shares');
    els.errorCost = $('#error-cost');
    els.formSubmit = $('#form-submit');
    els.formCancel = $('#form-cancel');
    els.formHint = $('#form-hint');
    els.formFeedback = $('#form-feedback');
    els.holdingForm = $('#holding-form');
    els.holdingsSubtitle = $('#holdings-subtitle');
    els.summaryGrid = $('#summary-grid');
    els.holdingsTable = $('#holdings-table');
    els.holdingsBody = $('#holdings-table tbody');
    els.holdingsEmpty = $('#holdings-empty');
    els.sampleBtn = $('#sample-btn');
    els.clearBtn = $('#clear-btn');
    els.alertList = $('#alert-list');
    els.alertEmpty = $('#alert-empty');
    els.alertCount = $('#alert-count');
    els.alertClear = $('#alert-clear');
    els.alertSubtitle = $('#alert-subtitle');
  }

  function init() {
    cacheElements();
    initializeHoldings();
    populateSymbolSelect();
    populateChartSelect();
    bindEvents();
    applySnapshot('');
    resetForm();
    renderAll();
    loadQuotes(false);
    loadMinute(state.chartSymbol);

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
