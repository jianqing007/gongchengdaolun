(function () {
  'use strict';

  var QUOTE_BASE = 'https://qt.gtimg.cn/q=';
  var MINUTE_BASE = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';

  function buildQuoteUrl(items) {
    return QUOTE_BASE + items.map(function (item) { return item.tx; }).join(',');
  }

  function buildMinuteUrl(symbol) {
    var meta = window.ALL_BY_SYMBOL[symbol];
    return MINUTE_BASE + (meta ? meta.tx : '');
  }

  function num(value) {
    if (value === '-' || value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseTxTime(value) {
    if (!value || value.length < 14) return Date.now();
    var y = Number(value.slice(0, 4));
    var m = Number(value.slice(4, 6)) - 1;
    var d = Number(value.slice(6, 8));
    var hh = Number(value.slice(8, 10));
    var mm = Number(value.slice(10, 12));
    var ss = Number(value.slice(12, 14));
    var t = Date.UTC(y, m, d, hh, mm, ss) - 8 * 3600 * 1000;
    return Number.isFinite(t) ? t : Date.now();
  }

  /**
   * 腾讯行情返回的是 v_sh600519="字段~字段~..." 形式的 GBK 文本。
   * 这里只解析需要的字段，字段位置按 2026-10 的接口验证过。
   */
  function parseQuoteText(text) {
    var out = {};
    var re = /v_([a-z]{2}\d{6})="([^"]*)"/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      var tx = match[1];
      var symbol = window.TX_TO_SYMBOL[tx];
      if (!symbol) continue;
      var f = match[2].split('~');
      var meta = window.ALL_BY_SYMBOL[symbol] || {};
      var price = num(f[3]);
      if (price != null && price <= 0) price = null;

      out[symbol] = {
        symbol: symbol,
        code: f[2] || meta.symbol,
        name: meta.name || f[1] || f[2],
        price: price,
        pct: num(f[32]),
        change: num(f[31]),
        volume: num(f[6]),
        amountWan: num(f[37]),
        turnover: num(f[38]),
        volumeRatio: num(f[49]),
        high: num(f[33]),
        low: num(f[34]),
        open: num(f[5]),
        prevClose: num(f[4]),
        time: parseTxTime(f[30]),
        source: 'live'
      };
    }
    return out;
  }

  function decodeGbk(buffer) {
    try {
      return new TextDecoder('gbk').decode(buffer);
    } catch (err) {
      return new TextDecoder('utf-8').decode(buffer);
    }
  }

  function fetchQuotes(items, timeoutMs, signal) {
    var timeout = timeoutMs || 8000;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    var onAbort = function () { controller.abort(); };

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort);
    }

    return fetch(buildQuoteUrl(items), {
      signal: controller.signal,
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    }).then(function (buffer) {
      var text = decodeGbk(buffer);
      var quotes = parseQuoteText(text);
      if (Object.keys(quotes).length === 0) throw new Error('未解析到行情数据');
      return quotes;
    }).finally(function () {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    });
  }

  /**
   * 分时接口返回：
   * data.{tx}.data.data = ["0930 1363.00 1534 209084200.00", ...]
   * 仅保留 09:30—11:30 与 13:00—15:00，过滤掉竞价后/盘后数据。
   */
  function parseMinutePayload(payload, symbol) {
    var meta = window.ALL_BY_SYMBOL[symbol];
    var tx = meta && meta.tx;
    var node = payload && payload.data && payload.data[tx] && payload.data[tx].data;
    var lines = node && node.data;

    if (!Array.isArray(lines)) throw new Error('分时接口没有返回数据');

    var points = [];
    lines.forEach(function (line) {
      var parts = String(line).trim().split(/\s+/);
      var time = parts[0];
      if (!/^\d{4}$/.test(time)) return;
      var hhmm = Number(time);
      var inMorning = hhmm >= 930 && hhmm <= 1130;
      var inAfternoon = hhmm >= 1300 && hhmm <= 1500;
      if (!inMorning && !inAfternoon) return;

      var price = num(parts[1]);
      if (price == null || price <= 0) return;

      points.push({
        time: time.slice(0, 2) + ':' + time.slice(2),
        hhmm: hhmm,
        price: price
      });
    });

    if (points.length === 0) throw new Error('分时数据为空');

    return {
      symbol: symbol,
      date: node.date ? String(node.date) : '',
      points: points,
      source: 'minute'
    };
  }

  function fetchMinute(symbol, timeoutMs, signal) {
    var meta = window.ALL_BY_SYMBOL[symbol];
    if (!meta) return Promise.reject(new Error('未知股票'));
    var timeout = timeoutMs || 8000;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    var onAbort = function () { controller.abort(); };

    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort);
    }

    return fetch(buildMinuteUrl(symbol), {
      signal: controller.signal,
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      return parseMinutePayload(JSON.parse(text), symbol);
    }).finally(function () {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    });
  }

  function quoteFromSnapshot(symbol) {
    var snap = window.SNAPSHOT;
    if (!snap) return null;
    var src = (snap.stocks && snap.stocks[symbol]) || (snap.indices && snap.indices[symbol]);
    if (!src || !src.bars || src.bars.length === 0) return null;

    var bars = src.bars;
    var last = bars[bars.length - 1];
    var prev = bars.length > 1 ? bars[bars.length - 2] : last;
    var price = last[2];
    var prevClose = prev[2];

    return {
      symbol: symbol,
      code: src.code || symbol,
      name: src.name,
      price: price,
      pct: prevClose ? (price / prevClose - 1) * 100 : null,
      change: price - prevClose,
      volume: last[5],
      amountWan: null,
      turnover: null,
      volumeRatio: null,
      high: last[3],
      low: last[4],
      open: last[1],
      prevClose: prevClose,
      time: Date.parse(last[0] + 'T15:00:00+08:00'),
      source: 'snapshot'
    };
  }

  window.QuoteProvider = {
    buildQuoteUrl: buildQuoteUrl,
    buildMinuteUrl: buildMinuteUrl,
    parseQuoteText: parseQuoteText,
    parseMinutePayload: parseMinutePayload,
    fetchQuotes: fetchQuotes,
    fetchMinute: fetchMinute,
    quoteFromSnapshot: quoteFromSnapshot
  };
})();
