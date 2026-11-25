(function () {
  'use strict';

  var REFRESH_MS = 3000;
  var STALE_MS = 15000;
  var ALERT_LIMIT = 50;
  var CHART_PREFS_KEY = 'guji.chart.prefs.v1';
  var CHART_PERIODS = ['minute', 'day', 'week', 'month'];
  var MA_OPTIONS = [5, 10, 20, 30, 40, 60, 120, 250];
  // A 股习惯叫法，仅日 K 有效：20 日≈月线，60 日≈季线，120 日≈半年线，250 日≈年线。
  var MA_ALIASES = { 20: '月线', 60: '季线', 120: '半年线', 250: '年线' };
  var SUBPLOT_OPTIONS = ['volume', 'macd', 'kdj', 'rsi'];
  var POOL_GROUP_KEY = 'guji.pool.group';
  var STALE_TRADING_DAYS = 2;

  // 分组记忆要在 state 初始化之前生效：state.chartSymbol 取的是当前分组第一只。
  try {
    var savedGroup = localStorage.getItem(POOL_GROUP_KEY);
    if (savedGroup && window.POOL_GROUPS[savedGroup]) window.setPoolGroup(savedGroup);
  } catch (err) {
    // localStorage 不可用时用 pool.json 的默认分组。
  }

  var DEFAULT_CHART_PREFS = {
    day: { ma: [5, 10, 20, 40], boll: false, subplots: ['volume', 'macd'], log: false },
    week: { ma: [5, 10, 20, 40], boll: false, subplots: ['volume', 'macd'], log: false },
    month: { ma: [5, 10, 20, 40], boll: false, subplots: ['volume', 'macd'], log: true }
  };

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
    poolGroup: window.ACTIVE_POOL_GROUP,
    chartSeries: null,
    chartLoading: false,
    chartError: '',
    minuteCache: {},
    samples: {},
    minuteRequestId: 0,
    minuteAbort: null,
    chartPeriod: 'minute',
    chartRange: 120,
    chartPrefs: null,
    klineBars: [],
    klineSeries: null,
    klinePayload: null,
    klineKey: '',
    klineDirty: true,
    klineHover: null,
    klineRaf: 0,
    indicatorOpen: false,
    analysisTab: 'signals',
    forecast: null,
    forecastLoading: false,
    forecastError: ''
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

  /**
   * 行情请求清单：当前分组 + 持仓里属于其他分组的标的。
   * 这样切换分组后，另一组的持仓仍能拿到现价，不会变成“--”。
   */
  function quoteItems() {
    var items = window.ALL_SYMBOLS.slice();
    var seen = {};
    items.forEach(function (item) { seen[item.symbol] = true; });
    state.holdings.forEach(function (holding) {
      if (seen[holding.symbol]) return;
      var meta = window.ALL_BY_SYMBOL[holding.symbol];
      if (meta) {
        items.push(meta);
        seen[holding.symbol] = true;
      }
    });
    return items;
  }

  function snapshotLastDate() {
    var meta = window.SNAPSHOT && window.SNAPSHOT.meta;
    if (meta && meta.lastDate) return meta.lastDate;
    var last = '';
    quoteItems().forEach(function (item) {
      var date = window.PriceHistory.lastDate(item.symbol);
      if (date && date > last) last = date;
    });
    return last;
  }

  function tradingDaysAfter(dateStr) {
    return window.Freshness ? window.Freshness.tradingDaysAfter(dateStr, Date.now()) : 0;
  }

  function updateDataFreshness() {
    var last = snapshotLastDate();
    setText(els.dataDate, '数据截至 ' + (last || '--'));
    if (els.dataDate) {
      els.dataDate.title = last
        ? '快照最后一个交易日 ' + last + '；每个交易日收盘后运行 build_snapshot.py --update'
        : '快照中没有可用的日线';
    }
    var behind = tradingDaysAfter(last);
    if (last && behind >= STALE_TRADING_DAYS) {
      els.staleBanner.classList.remove('hidden');
      setText(els.staleText, '快照已过期 ' + behind + ' 个交易日（数据截至 ' + last +
        '），图表与信号仍是旧数据；请运行 python tools/build_snapshot.py --update');
    } else {
      els.staleBanner.classList.add('hidden');
      setText(els.staleText, '');
    }
  }

  function populatePoolSelect() {
    if (!els.poolGroup) return;
    els.poolGroup.innerHTML = Object.keys(window.POOL_GROUPS).map(function (key) {
      var group = window.POOL_GROUPS[key];
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(group.label || key) + '</option>';
    }).join('');
    els.poolGroup.value = state.poolGroup;
  }

  function handlePoolGroupChange(name) {
    if (!window.POOL_GROUPS[name] || name === state.poolGroup) return;
    window.setPoolGroup(name);
    state.poolGroup = name;
    try {
      localStorage.setItem(POOL_GROUP_KEY, name);
    } catch (err) {
      // 记不住分组只影响下次打开，不影响本次切换。
    }

    state.chartSymbol = window.UNIVERSE[0].symbol;
    state.chartSeries = null;
    state.klineHover = null;
    state.klineKey = '';
    state.klineDirty = true;
    state.forecast = null;
    state.forecastError = '';

    els.watchlistBody.textContent = '';
    els.indexGrid.textContent = '';
    populateSymbolSelect();
    populateChartSelect();
    els.poolGroup.value = name;
    ensureWatchRows();
    fillSnapshotQuotes();
    renderAll();
    loadQuotes(true);
    if (state.chartPeriod === 'minute') loadMinute(state.chartSymbol);
    else renderKline();
  }

  function applySnapshot(reason) {
    var quotes = {};
    quoteItems().forEach(function (item) {
      var quote = window.QuoteProvider.quoteFromSnapshot(item.symbol);
      if (quote) quotes[item.symbol] = quote;
    });
    if (Object.keys(quotes).length > 0) {
      state.quotes = quotes;
      state.mode = 'snapshot';
      state.lastUpdate = window.QuoteState.latestQuoteTime(quotes, quoteItems());
      if (reason) state.error = reason;
    }
  }

  /** 切换分组时先用快照补上新标的，避免整张表空 3 秒等实时请求。 */
  function fillSnapshotQuotes() {
    window.ALL_SYMBOLS.forEach(function (item) {
      if (state.quotes[item.symbol]) return;
      var quote = window.QuoteProvider.quoteFromSnapshot(item.symbol);
      if (quote) state.quotes[item.symbol] = quote;
    });
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
    var items = quoteItems();

    if (manual && els.refreshBtn) {
      els.refreshBtn.disabled = true;
      els.refreshBtn.textContent = '刷新中…';
    }

    window.QuoteProvider.fetchQuotes(items, 8000, controller.signal)
      .then(function (quotes) {
        if (!window.QuoteState.isLatest(state.quoteRequestId, requestId)) return;

        var missing = window.QuoteState.missingItems(items, quotes);
        var recovered = state.mode === 'snapshot';
        state.quotes = quotes;
        state.mode = 'live';
        state.lastUpdate = window.QuoteState.latestQuoteTime(quotes, items);
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
    // 告警覆盖当前分组 + 全部持仓（含另一分组），但不把指数当成可交易标的告警。
    var items = quoteItems().filter(function (item) { return item.type !== 'index'; });
    var events = window.AlertEngine.evaluateAll(quotes, items, window.SNAPSHOT, now);
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
      ? '实时行情触发 · 同规则 30 分钟冷却 · MACD 交叉一天一次'
      : '快照/离线状态不产生新告警 · 保留历史记录');

    updateDataFreshness();

    document.body.dataset.mode = state.mode;
    document.body.dataset.quoteFailures = String(state.fetchFailures);
    document.body.dataset.storageStatus = state.storageStatus || '';
    document.body.dataset.retryAt = state.nextRetryAt ? String(state.nextRetryAt) : '';
  }

  function ensureIndexCards() {
    var signature = (window.ACTIVE_POOL_GROUP || '') + '|' +
      window.INDICES.map(function (item) { return item.symbol; }).join(',');
    if (els.indexGrid.dataset.signature === signature) return;
    els.indexGrid.dataset.signature = signature;
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
    setText(els.watchlistSubtitle, (window.POOL_GROUP_LABEL || '自选') + ' · ' +
      window.UNIVERSE.length + ' 只标的 · 3 秒刷新');
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
    els.klineCanvas.classList.add('hidden');
    els.klineLegend.classList.add('hidden');
    els.klineTooltip.classList.add('hidden');
    els.chartEmpty.classList.remove('hidden');
    els.chartEmptyText.textContent = message;
  }

  function renderChart() {
    var stock = window.UNIVERSE_BY_SYMBOL[state.chartSymbol];
    var quote = state.quotes[state.chartSymbol];
    var series = state.chartSeries;

    if (state.chartPeriod !== 'minute') {
      updateKlineSummary();
      if (state.klineDirty) renderKline();
      return;
    }

    els.klineCanvas.classList.add('hidden');
    els.intradayCanvas.classList.remove('hidden');
    els.chartWrap.classList.remove('is-kline');
    els.klineLegend.classList.add('hidden');
    els.klineTooltip.classList.add('hidden');

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

  function hasValue(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function periodText(period) {
    return period === 'week' ? '周K' : period === 'month' ? '月K' : period === 'day' ? '日K' : '分时';
  }

  function defaultPrefs() {
    return JSON.parse(JSON.stringify(DEFAULT_CHART_PREFS));
  }

  function sanitizePrefs(raw) {
    var out = defaultPrefs();
    ['day', 'week', 'month'].forEach(function (period) {
      var src = raw && raw[period];
      if (!src) return;
      if (Array.isArray(src.ma)) {
        var seen = {};
        var maxMa = period === 'day' ? 250 : 120;
        out[period].ma = src.ma.map(Number).filter(function (value) {
          if (value > maxMa || MA_OPTIONS.indexOf(value) === -1 || seen[value]) return false;
          seen[value] = true;
          return true;
        }).sort(function (a, b) { return a - b; });
      }
      if (typeof src.boll === 'boolean') out[period].boll = src.boll;
      if (typeof src.log === 'boolean') out[period].log = src.log;
      if (Array.isArray(src.subplots)) {
        var subSeen = {};
        out[period].subplots = src.subplots.filter(function (value) {
          if (SUBPLOT_OPTIONS.indexOf(value) === -1 || subSeen[value]) return false;
          subSeen[value] = true;
          return true;
        }).slice(0, 2);
      }
    });
    return out;
  }

  function loadChartPrefs() {
    try {
      var raw = localStorage.getItem(CHART_PREFS_KEY);
      return raw ? sanitizePrefs(JSON.parse(raw)) : defaultPrefs();
    } catch (err) {
      return defaultPrefs();
    }
  }

  function saveChartPrefs() {
    try {
      localStorage.setItem(CHART_PREFS_KEY, JSON.stringify(state.chartPrefs));
    } catch (err) {
      // localStorage 不可用时只影响记忆，不影响当前页面。
    }
  }

  function currentPrefs() {
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    return state.chartPrefs[period];
  }

  function isKlinePeriod() {
    return state.chartPeriod !== 'minute';
  }

  function syncRangeOptions() {
    if (!isKlinePeriod()) {
      els.chartRange.classList.add('hidden');
      return;
    }
    els.chartRange.classList.remove('hidden');
    var values = state.chartPeriod === 'month' ? [60, 120, 0] : [60, 120, 250];
    if (values.indexOf(Number(state.chartRange)) === -1) state.chartRange = 120;
    els.chartRange.innerHTML = values.map(function (value) {
      return '<option value="' + value + '">' + (value === 0 ? '全部' : value + ' 根') + '</option>';
    }).join('');
    els.chartRange.value = String(state.chartRange);
  }

  function updateChartModeUI() {
    var kline = isKlinePeriod();
    els.chartRange.classList.toggle('hidden', !kline);
    els.indicatorToggle.classList.toggle('hidden', !kline);
    els.indicatorPanel.classList.toggle('hidden', !kline || !state.indicatorOpen);
    Array.prototype.forEach.call(document.querySelectorAll('.chart-tab'), function (tab) {
      var active = tab.getAttribute('data-period') === state.chartPeriod;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (!kline) {
      els.intradayCanvas.classList.remove('hidden');
      els.klineCanvas.classList.add('hidden');
      els.klineLegend.classList.add('hidden');
      els.klineTooltip.classList.add('hidden');
      els.chartWrap.classList.remove('is-kline');
    } else {
      els.intradayCanvas.classList.add('hidden');
      els.klineCanvas.classList.remove('hidden');
      els.klineLegend.classList.remove('hidden');
      els.chartWrap.classList.add('is-kline');
    }
  }

  function handlePeriodChange(period) {
    if (CHART_PERIODS.indexOf(period) === -1) return;
    state.chartPeriod = period;
    state.klineHover = null;
    state.klineDirty = true;
    state.chartError = '';
    updateChartModeUI();
    syncRangeOptions();
    renderIndicatorPanel();
    if (period === 'minute') {
      state.chartSeries = state.minuteCache[state.chartSymbol] || buildSampleSeries(state.chartSymbol);
      renderChart();
      loadMinute(state.chartSymbol);
    } else {
      renderKline();
    }
    renderAnalysis();
  }

  function buildKlineSeries(bars, prefs) {
    var closes = bars.map(function (bar) { return Number(bar.close); });
    var series = { ma: {} };
    (prefs.ma || []).forEach(function (period) {
      series.ma[period] = window.Indicators.sma(closes, period);
    });
    if (prefs.boll) series.boll = window.Indicators.boll(closes, 20, 2);
    var subplots = prefs.subplots || [];
    if (subplots.indexOf('volume') >= 0) {
      var volumes = bars.map(function (bar) { return Number(bar.volume); });
      series.volumeMA = {
        5: window.Indicators.volumeMA(volumes, 5),
        10: window.Indicators.volumeMA(volumes, 10)
      };
    }
    if (subplots.indexOf('macd') >= 0) series.macd = window.Indicators.macd(closes, 12, 26, 9);
    if (subplots.indexOf('kdj') >= 0) series.kdj = window.Indicators.kdj(bars, 9, 3, 3);
    if (subplots.indexOf('rsi') >= 0) {
      series.rsi = {
        6: window.Indicators.rsi(closes, 6),
        12: window.Indicators.rsi(closes, 12),
        24: window.Indicators.rsi(closes, 24)
      };
    }
    return series;
  }

  function ensureKlineData() {
    var prefs = currentPrefs();
    var key = state.chartSymbol + '|' + state.chartPeriod + '|' + JSON.stringify(prefs);
    if (state.klineKey === key && state.klineBars) return;
    var bars = window.PriceHistory.barsFor(state.chartSymbol, state.chartPeriod);
    state.klineBars = bars;
    state.klineSeries = buildKlineSeries(bars, prefs);
    state.klineKey = key;
    state.klinePayload = null;
  }

  function buildKlinePayload() {
    ensureKlineData();
    return {
      bars: state.klineBars,
      series: state.klineSeries,
      config: currentPrefs(),
      period: state.chartPeriod,
      range: state.chartRange,
      hoverIndex: state.klineHover,
      colors: {
        up: cssColor('--up', '#f2555f'),
        down: cssColor('--down', '#2fbf71'),
        text: cssColor('--muted', '#8b9aab'),
        grid: 'rgba(139, 154, 171, 0.14)',
        accent: cssColor('--accent', '#4c8dff')
      }
    };
  }

  function pauseKline(stock, message) {
    setText(els.chartSubtitle, stock.name + ' ' + stock.symbol + ' · ' + periodText(state.chartPeriod));
    setText(els.chartPrice, '--');
    setText(els.chartPct, '--');
    setTone(els.chartPrice, null);
    setTone(els.chartPct, null);
    setText(els.chartNote, message);
    els.chartSource.className = 'badge badge-warn';
    els.chartSource.textContent = '暂无日线';
    els.intradayCanvas.classList.add('hidden');
    els.klineCanvas.classList.add('hidden');
    els.klineLegend.classList.add('hidden');
    els.klineTooltip.classList.add('hidden');
    els.chartWrap.classList.add('is-kline');
    els.chartEmpty.classList.remove('hidden');
    els.chartEmptyText.textContent = message;
  }

  function updateKlineSummary() {
    var stock = window.UNIVERSE_BY_SYMBOL[state.chartSymbol];
    if (!stock) return;
    ensureKlineData();
    var bars = state.klineBars;
    if (!bars.length) {
      pauseKline(stock, '该标的没有可用的日线数据');
      return;
    }
    var last = bars[bars.length - 1];
    var prev = bars.length > 1 ? bars[bars.length - 2] : null;
    var quote = state.quotes[state.chartSymbol];
    var price = quote && quote.price != null ? quote.price : last.close;
    var pct = quote && quote.pct != null
      ? quote.pct
      : prev ? (Number(last.close) / Number(prev.close) - 1) * 100 : null;

    setText(els.chartSubtitle, stock.name + ' ' + stock.symbol + ' · ' +
      periodText(state.chartPeriod) + ' · 前复权');
    setText(els.chartPrice, fmtPrice(price));
    setText(els.chartPct, fmtPct(pct));
    setTone(els.chartPrice, pct);
    setTone(els.chartPct, pct);

    var note = ['快照至 ' + last.date, bars.length + ' 根'];
    if (last.partial) note.push('本期未收盘');
    var dropped = window.PriceHistory.negativeCount(state.chartSymbol);
    if (dropped > 0) note.push('已剔除 ' + dropped + ' 根负值');
    setText(els.chartNote, note.join(' · '));

    els.chartSource.className = 'badge ' + (state.mode === 'snapshot' ? 'badge-warn' : 'badge-muted');
    els.chartSource.textContent = state.mode === 'snapshot' ? '离线日线' : '快照日线';
    els.chartEmpty.classList.add('hidden');
  }

  function renderKlineLegend(payload) {
    if (!els.klineLegend) return;
    var prefs = payload.config;
    var series = payload.series;
    var index = payload.hoverIndex != null ? payload.hoverIndex : payload.bars.length - 1;
    var parts = [];
    (prefs.ma || []).forEach(function (period) {
      var value = series.ma && series.ma[period] ? series.ma[period][index] : null;
      if (hasValue(value)) {
        parts.push({
          color: window.KlineChart.MA_COLORS[period] || cssColor('--accent', '#4c8dff'),
          label: 'MA' + period,
          value: fmtPrice(value)
        });
      }
    });
    if (prefs.boll && series.boll) {
      ['upper', 'mid', 'lower'].forEach(function (key) {
        if (hasValue(series.boll[key][index])) {
          parts.push({
            color: 'rgba(122,167,255,.75)',
            label: 'BOLL' + (key === 'upper' ? '上' : key === 'mid' ? '中' : '下'),
            value: fmtPrice(series.boll[key][index])
          });
        }
      });
    }
    (prefs.subplots || []).forEach(function (kind) {
      if (kind === 'volume' && hasValue(payload.bars[index].volume)) {
        parts.push({ color: '#8b9aab', label: 'VOL', value: window.KlineChart.formatVolume(payload.bars[index].volume) });
      } else if (kind === 'macd' && series.macd) {
        parts.push({ color: '#e7b04b', label: 'DIF', value: fmtSigned(series.macd.dif[index], 3) });
        parts.push({ color: '#4c8dff', label: 'DEA', value: fmtSigned(series.macd.dea[index], 3) });
      } else if (kind === 'kdj' && series.kdj) {
        parts.push({ color: '#e7b04b', label: 'K', value: fmtNum(series.kdj.k[index], 1) });
        parts.push({ color: '#4c8dff', label: 'D', value: fmtNum(series.kdj.d[index], 1) });
      } else if (kind === 'rsi' && series.rsi) {
        parts.push({ color: '#e7b04b', label: 'RSI6', value: fmtNum(series.rsi[6][index], 1) });
      }
    });
    els.klineLegend.innerHTML = parts.map(function (part) {
      return '<span class="legend-item"><i class="legend-dot" style="background:' +
        part.color + '"></i>' + part.label + ' <b>' + part.value + '</b></span>';
    }).join('') || '<span class="muted">无可显示指标</span>';
  }

  function renderKline() {
    var stock = window.UNIVERSE_BY_SYMBOL[state.chartSymbol];
    if (!stock) return;
    ensureKlineData();
    if (!state.klineBars.length) {
      pauseKline(stock, '该标的没有可用的日线数据');
      return;
    }
    state.klineHover = null;
    var payload = buildKlinePayload();
    state.klinePayload = payload;
    els.chartWrap.classList.add('is-kline');
    els.intradayCanvas.classList.add('hidden');
    els.klineCanvas.classList.remove('hidden');
    els.klineLegend.classList.remove('hidden');
    els.chartEmpty.classList.add('hidden');

    var drawn = window.KlineChart.draw(els.klineCanvas, payload);
    if (!drawn) {
      pauseKline(stock, 'K 线画布暂不可用，请调整窗口大小');
      return;
    }
    updateKlineSummary();
    renderKlineLegend(payload);
    els.klineTooltip.classList.add('hidden');
    state.klineDirty = false;
  }

  function sameMa(a, b) {
    return a.length === b.length && a.every(function (value, index) { return value === b[index]; });
  }

  function detectPreset(prefs) {
    if (sameMa(prefs.ma, [20, 40]) && !prefs.boll &&
        prefs.subplots.length === 1 && prefs.subplots[0] === 'volume') return 'simple';
    if (sameMa(prefs.ma, [5, 10, 20, 40]) && !prefs.boll &&
        prefs.subplots.join(',') === 'volume,macd') return 'standard';
    if (prefs.boll && prefs.subplots.join(',') === 'volume,macd' && prefs.ma.length >= 7) return 'full';
    return '';
  }

  function renderIndicatorPanel() {
    if (!els.maChecks) return;
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    var prefs = state.chartPrefs[period];
    var bars = window.PriceHistory.barsFor(state.chartSymbol, period);
    var allowed = period === 'day' ? MA_OPTIONS : MA_OPTIONS.filter(function (value) { return value <= 120; });

    els.maChecks.innerHTML = allowed.map(function (value) {
      var disabled = bars.length < value;
      var checked = prefs.ma.indexOf(value) >= 0 && !disabled;
      var alias = period === 'day' && MA_ALIASES[value] ? ' ' + MA_ALIASES[value] : '';
      var unit = period === 'day' ? '交易日' : period === 'week' ? '周' : '月';
      var hint = disabled ? '样本不足' : 'MA' + value + alias + '：最近 ' + value + ' 个' + unit + '收盘均价';
      return '<label class="indicator-check' + (disabled ? ' is-disabled' : '') +
        '" title="' + hint + '">' +
        '<input type="checkbox" data-ma="' + value + '"' +
        (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '> MA' + value + alias +
        '</label>';
    }).join('');

    els.indicatorBoll.checked = !!prefs.boll;
    els.indicatorLog.checked = !!prefs.log;
    els.subplot1.value = prefs.subplots[0] || '';
    els.subplot2.value = prefs.subplots[1] || '';
    els.indicatorHint.textContent = prefs.subplots.length >= 2 ? '最多两个副图' : '可再选一个副图';
    var preset = detectPreset(prefs);
    Array.prototype.forEach.call(document.querySelectorAll('.indicator-chip'), function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-preset') === preset);
    });
  }

  function applyPreset(name) {
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    var presets = {
      simple: { ma: [20, 40], boll: false, log: period === 'month', subplots: ['volume'] },
      standard: { ma: [5, 10, 20, 40], boll: false, log: period === 'month', subplots: ['volume', 'macd'] },
      full: {
        ma: period === 'day' ? MA_OPTIONS.slice() : MA_OPTIONS.filter(function (value) { return value <= 120; }),
        boll: true,
        log: period === 'month',
        subplots: ['volume', 'macd']
      }
    };
    if (!presets[name]) return;
    state.chartPrefs[period] = JSON.parse(JSON.stringify(presets[name]));
    saveChartPrefs();
    state.klineDirty = true;
    state.klineKey = '';
    state.klineHover = null;
    renderIndicatorPanel();
    renderKline();
    renderAnalysis();
  }

  function handleIndicatorChange() {
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    var ma = [];
    Array.prototype.forEach.call(els.maChecks.querySelectorAll('[data-ma]'), function (input) {
      if (input.checked && !input.disabled) ma.push(Number(input.getAttribute('data-ma')));
    });
    var subplots = [els.subplot1.value, els.subplot2.value].filter(Boolean);
    if (subplots.length === 2 && subplots[0] === subplots[1]) {
      subplots = [subplots[0]];
      els.subplot2.value = '';
      els.indicatorHint.textContent = '两个副图不能相同';
    }
    state.chartPrefs[period] = {
      ma: ma,
      boll: els.indicatorBoll.checked,
      log: els.indicatorLog.checked,
      subplots: subplots.slice(0, 2)
    };
    saveChartPrefs();
    state.klineDirty = true;
    state.klineKey = '';
    state.klineHover = null;
    renderIndicatorPanel();
    renderKline();
    renderAnalysis();
  }

  function toggleIndicatorPanel() {
    state.indicatorOpen = !state.indicatorOpen;
    els.indicatorPanel.classList.toggle('hidden', !state.indicatorOpen);
    els.indicatorToggle.setAttribute('aria-expanded', state.indicatorOpen ? 'true' : 'false');
    if (state.indicatorOpen) renderIndicatorPanel();
  }

  function resetIndicatorPrefs() {
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    state.chartPrefs[period] = JSON.parse(JSON.stringify(DEFAULT_CHART_PREFS[period]));
    saveChartPrefs();
    state.klineDirty = true;
    state.klineKey = '';
    state.klineHover = null;
    renderIndicatorPanel();
    renderKline();
    renderAnalysis();
  }

  function handleChartRangeChange() {
    state.chartRange = Number(els.chartRange.value);
    if (!Number.isFinite(state.chartRange)) state.chartRange = 120;
    state.klineDirty = true;
    state.klineHover = null;
    renderKline();
  }

  function positionKlineTooltip(clientX, clientY) {
    var rect = els.chartWrap.getBoundingClientRect();
    var width = els.klineTooltip.offsetWidth || 210;
    var height = els.klineTooltip.offsetHeight || 120;
    var x = clientX - rect.left + 14;
    var y = clientY - rect.top + 14;
    if (x + width > rect.width - 8) x = clientX - rect.left - width - 14;
    if (y + height > rect.height - 8) y = clientY - rect.top - height - 14;
    els.klineTooltip.style.left = Math.max(8, x) + 'px';
    els.klineTooltip.style.top = Math.max(8, y) + 'px';
  }

  function handleKlineMove(event) {
    if (!isKlinePeriod() || !state.klinePayload) return;
    var clientX = event.clientX;
    var clientY = event.clientY;
    if (state.klineRaf) return;
    state.klineRaf = window.requestAnimationFrame(function () {
      state.klineRaf = 0;
      var payload = state.klinePayload;
      var index = window.KlineChart.hitIndex(els.klineCanvas, payload, clientX);
      if (index == null) {
        handleKlineLeave();
        return;
      }
      if (state.klineHover !== index) {
        state.klineHover = index;
        payload.hoverIndex = index;
        window.KlineChart.draw(els.klineCanvas, payload);
        renderKlineLegend(payload);
      }
      els.klineTooltip.innerHTML = window.KlineChart.tooltipHtml(payload, index);
      els.klineTooltip.classList.remove('hidden');
      positionKlineTooltip(clientX, clientY);
    });
  }

  function handleKlineLeave() {
    state.klineHover = null;
    els.klineTooltip.classList.add('hidden');
    if (state.klinePayload) {
      state.klinePayload.hoverIndex = null;
      window.KlineChart.draw(els.klineCanvas, state.klinePayload);
      renderKlineLegend(state.klinePayload);
    }
  }

  function handleKlineTouch(event) {
    var touch = event.touches && event.touches[0];
    if (!touch) return;
    handleKlineMove({ clientX: touch.clientX, clientY: touch.clientY });
  }

  function selectAnalysisTab(tab) {
    if (['signals', 'overview', 'gates', 'risk', 'forecast'].indexOf(tab) === -1) return;
    state.analysisTab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('.analysis-tab'), function (button) {
      var active = button.getAttribute('data-analysis-tab') === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    els.analysisSignals.classList.toggle('hidden', tab !== 'signals');
    els.analysisOverview.classList.toggle('hidden', tab !== 'overview');
    els.analysisGates.classList.toggle('hidden', tab !== 'gates');
    els.analysisRisk.classList.toggle('hidden', tab !== 'risk');
    els.analysisForecast.classList.toggle('hidden', tab !== 'forecast');
    renderAnalysis();
  }

  function renderAnalysis() {
    if (!els.signalGrid) return;
    var period = state.chartPeriod === 'minute' ? 'day' : state.chartPeriod;
    var stock = window.UNIVERSE_BY_SYMBOL[state.chartSymbol];
    var bars = window.PriceHistory.barsFor(state.chartSymbol, period);
    if (!stock || !bars.length) {
      els.signalGrid.innerHTML = '<div class="analysis-empty">暂无可用日线数据</div>';
      els.analysisSummary.textContent = '';
      els.analysisSubtitle.textContent = '暂无可用数据';
      if (els.poolList) els.poolList.innerHTML = '';
      if (window.ForecastEngine) {
        window.ForecastEngine.render({
          result: null,
          grid: els.forecastGrid,
          status: els.forecastStatus,
          detail: els.forecastDetail
        });
      }
      // 闸门与总览按全池/固定指数计算，不依赖当前图表标的是否有日线。
      if (state.analysisTab === 'gates' && window.GateEngine) {
        window.GateEngine.render({ grid: els.gateGrid, note: els.gateNote });
      }
      if (state.analysisTab === 'overview' && window.PoolOverview) {
        window.PoolOverview.render({ body: els.overviewBody, note: els.overviewNote });
      }
      return;
    }
    if (window.SignalEngine) {
      window.SignalEngine.render({
        bars: bars,
        period: period,
        stock: stock,
        grid: els.signalGrid,
        summary: els.analysisSummary,
        subtitle: els.analysisSubtitle,
        poolList: els.poolList
      });
    }
    if (window.RiskEngine) {
      window.RiskEngine.render({
        holdings: state.holdings,
        quotes: state.quotes,
        grid: els.riskGrid,
        note: els.riskNote
      });
    }
    if (state.analysisTab === 'gates' && window.GateEngine) {
      window.GateEngine.render({
        grid: els.gateGrid,
        note: els.gateNote
      });
    }
    if (state.analysisTab === 'overview' && window.PoolOverview) {
      window.PoolOverview.render({
        body: els.overviewBody,
        note: els.overviewNote
      });
    }
    if (window.ForecastEngine && !state.forecastLoading) {
      window.ForecastEngine.render({
        result: state.forecast,
        grid: els.forecastGrid,
        status: els.forecastStatus,
        detail: els.forecastDetail
      });
    }
  }

  function runForecast() {
    if (!window.ForecastEngine) {
      els.forecastDetail.textContent = '预测模块尚未加载。';
      return;
    }
    if (state.forecastLoading) return;
    var bars = window.PriceHistory.barsFor(state.chartSymbol, 'day');
    if (bars.length < 250) {
      els.forecastDetail.textContent = '样本不足：至少需要 250 根日线。';
      return;
    }
    state.forecast = null;
    state.forecastError = '';
    state.forecastLoading = true;
    els.forecastStatus.textContent = '正在运行 walk-forward 回测…';
    els.forecastGrid.innerHTML = '<div class="analysis-empty">正在计算 Holt 区间与逻辑回归 walk-forward…</div>';
    els.forecastDetail.textContent = '';
    els.forecastRun.disabled = true;
    renderAnalysis();
    window.setTimeout(function () {
      try {
        state.forecast = window.ForecastEngine.run(bars, { horizon: 5, trainWindow: 750, retrainEvery: 60 });
        state.forecastError = '';
      } catch (err) {
        state.forecast = null;
        state.forecastError = err && err.message ? err.message : '回测失败';
        els.forecastDetail.textContent = state.forecastError;
      } finally {
        state.forecastLoading = false;
        els.forecastRun.disabled = false;
        els.forecastStatus.textContent = state.forecast
          ? '基于 ' + bars[bars.length - 1].date + ' 收盘'
          : '回测失败';
        renderAnalysis();
      }
    }, 30);
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
    renderAnalysis();
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
    state.klineBars = [];
    state.klineSeries = null;
    state.klinePayload = null;
    state.klineKey = '';
    state.klineDirty = true;
    state.klineHover = null;
    state.forecast = null;
    state.forecastError = '';
    renderWatchlist();
    if (state.chartPeriod === 'minute') {
      renderChart();
      loadMinute(symbol);
    } else {
      renderKline();
    }
    renderAnalysis();
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

    if (els.poolGroup) {
      els.poolGroup.addEventListener('change', function () {
        handlePoolGroupChange(els.poolGroup.value);
      });
    }

    els.chartTabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-period]');
      if (button) handlePeriodChange(button.getAttribute('data-period'));
    });

    els.chartRange.addEventListener('change', handleChartRangeChange);
    els.indicatorToggle.addEventListener('click', toggleIndicatorPanel);
    els.indicatorPanel.addEventListener('change', handleIndicatorChange);
    els.indicatorPanel.addEventListener('click', function (event) {
      var preset = event.target.closest('[data-preset]');
      if (preset) {
        applyPreset(preset.getAttribute('data-preset'));
        return;
      }
      if (event.target.closest('#indicator-reset')) resetIndicatorPrefs();
    });

    els.klineCanvas.addEventListener('mousemove', handleKlineMove);
    els.klineCanvas.addEventListener('mouseleave', handleKlineLeave);
    els.klineCanvas.addEventListener('touchstart', handleKlineTouch, { passive: true });
    els.klineCanvas.addEventListener('touchmove', handleKlineTouch, { passive: true });

    els.analysisTabs.addEventListener('click', function (event) {
      var button = event.target.closest('[data-analysis-tab]');
      if (button) selectAnalysisTab(button.getAttribute('data-analysis-tab'));
    });
    els.forecastRun.addEventListener('click', runForecast);

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
      resizeTimer = setTimeout(function () {
        if (isKlinePeriod()) {
          state.klineDirty = true;
          renderKline();
        } else {
          renderChart();
        }
      }, 120);
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
    els.staleBanner = $('#stale-banner');
    els.staleText = $('#stale-text');
    els.dataDate = $('#data-date');
    els.indexGrid = $('#index-grid');
    els.quoteCount = $('#quote-count');
    els.poolGroup = $('#pool-group');
    els.watchlistSubtitle = $('#watchlist-subtitle');
    els.watchlistBody = $('#watchlist-table tbody');
    els.chartSymbol = $('#chart-symbol');
    els.chartSubtitle = $('#chart-subtitle');
    els.chartSource = $('#chart-source');
    els.chartPrice = $('#chart-price');
    els.chartPct = $('#chart-pct');
    els.chartNote = $('#chart-note');
    els.chartCanvas = $('#intraday-canvas');
    els.intradayCanvas = $('#intraday-canvas');
    els.chartWrap = $('#chart-wrap');
    els.klineCanvas = $('#kline-canvas');
    els.klineLegend = $('#kline-legend');
    els.klineTooltip = $('#kline-tooltip');
    els.chartRange = $('#chart-range');
    els.indicatorToggle = $('#indicator-toggle');
    els.indicatorPanel = $('#indicator-panel');
    els.maChecks = $('#ma-checks');
    els.indicatorBoll = $('#indicator-boll');
    els.indicatorLog = $('#indicator-log');
    els.subplot1 = $('#subplot-1');
    els.subplot2 = $('#subplot-2');
    els.indicatorHint = $('#indicator-hint');
    els.indicatorReset = $('#indicator-reset');
    els.chartTabs = $('#chart-panel .chart-tabs');
    els.chartEmpty = $('#chart-empty');
    els.chartEmptyText = $('#chart-empty-text');
    els.analysisTabs = $('#analysis-panel .analysis-tabs');
    els.analysisSubtitle = $('#analysis-subtitle');
    els.analysisSignals = $('#analysis-signals');
    els.analysisOverview = $('#analysis-overview');
    els.analysisGates = $('#analysis-gates');
    els.analysisRisk = $('#analysis-risk');
    els.analysisForecast = $('#analysis-forecast');
    els.signalGrid = $('#signal-grid');
    els.analysisSummary = $('#analysis-summary');
    els.poolList = $('#pool-list');
    els.overviewBody = $('#overview-body');
    els.overviewNote = $('#overview-note');
    els.gateGrid = $('#gate-grid');
    els.gateNote = $('#gate-note');
    els.riskGrid = $('#risk-grid');
    els.riskNote = $('#risk-note');
    els.forecastGrid = $('#forecast-grid');
    els.forecastRun = $('#forecast-run');
    els.forecastStatus = $('#forecast-status');
    els.forecastDetail = $('#forecast-detail');
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
    state.chartPrefs = loadChartPrefs();
    cacheElements();
    initializeHoldings();
    populatePoolSelect();
    populateSymbolSelect();
    populateChartSelect();
    bindEvents();
    updateChartModeUI();
    syncRangeOptions();
    renderIndicatorPanel();
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
