(function () {
  'use strict';

  var COOLDOWN_MS = 30 * 60 * 1000;
  var PCT_THRESHOLD = 3;
  var VOLUME_RATIO_THRESHOLD = 2;
  var RANGE_DAYS = 20;
  // EMA26 + DEA9 至少要 34 根才出 DEA，留到 60 根作为最低样本门槛。
  var MACD_MIN_BARS = 60;
  // 判交叉要用足够长的窗口：只喂 60 根时 EMA 还没收敛，DIF/DEA 会整体偏移，
  // 足以把临界状态判成金叉、也会把交叉日期挪后一天。250 根与全量结果已对齐。
  var MACD_LOOKBACK = 250;
  // |DIF−DEA| / 收盘价低于 0.02% 视为临界：复权口径或数据源不同就可能翻转。
  var MACD_EDGE_PCT = 0.02;
  // 日 K 级别的状态变化一天最多报一次，不能用 30 分钟冷却反复刷。
  var MACD_COOLDOWN_MS = 20 * 60 * 60 * 1000;

  function priceText(value) {
    return value == null || !Number.isFinite(Number(value))
      ? '--'
      : Number(value).toFixed(2);
  }

  function pctText(value) {
    if (value == null || !Number.isFinite(Number(value))) return '--';
    var n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function quoteDateKey(timestamp) {
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
  }

  function barDateKey(bar) {
    return bar && bar[0] ? String(bar[0]).replace(/-/g, '') : '';
  }

  /**
   * 取当前交易日之前的最近 20 根日线；避免把当天 K 线重复算进 MA20。
   */
  function historyFor(snapshot, symbol, quoteTime, days) {
    var source = snapshot && (
      (snapshot.stocks && snapshot.stocks[symbol]) ||
      (snapshot.indices && snapshot.indices[symbol])
    );
    if (!source || !Array.isArray(source.bars)) return [];

    var dateKey = quoteDateKey(quoteTime);
    var bars = source.bars.filter(function (bar) {
      return !dateKey || barDateKey(bar) < dateKey;
    });
    return bars.slice(-(days || RANGE_DAYS));
  }

  /**
   * 取截至报价日（含当日）的日线。收盘后快照的最后一根就是完成的日 K；
   * 盘中实时时快照最后一根是昨天，当日还没写入，也不会把未完成的 bar 算进来。
   */
  function barsThrough(snapshot, symbol, quoteTime, days) {
    var source = snapshot && (
      (snapshot.stocks && snapshot.stocks[symbol]) ||
      (snapshot.indices && snapshot.indices[symbol])
    );
    if (!source || !Array.isArray(source.bars)) return [];

    var dateKey = quoteDateKey(quoteTime);
    var bars = source.bars.filter(function (bar) {
      return !dateKey || barDateKey(bar) <= dateKey;
    });
    // 默认也按 MACD 的 250 根窗口截取；60 根只作为 macdEvents 的最低门槛。
    return bars.slice(-(days || MACD_LOOKBACK));
  }

  /**
   * 临界提示：|DIF−DEA| 不到收盘价 0.02% 时，换个复权口径或数据源就可能翻面。
   */
  function macdEdgeNote(dif, dea, close) {
    if (![dif, dea, close].every(function (value) {
      return value != null && Number.isFinite(Number(value));
    }) || Number(close) <= 0) return '';
    var gapPct = Math.abs(Number(dif) - Number(dea)) / Number(close) * 100;
    return gapPct < MACD_EDGE_PCT
      ? '（DIF−DEA≈0，临界，多空状态在复权口径间会翻转，以收盘多源复核为准）'
      : '';
  }

  function macdEvents(stock, bars, now) {
    if (!Array.isArray(bars) || bars.length < MACD_MIN_BARS) return [];

    var closes = bars.map(function (bar) { return Number(bar[2]); });
    var macd = window.Indicators.macd(closes, 12, 26, 9);
    var i = closes.length - 1;
    var dif = macd.dif[i];
    var dea = macd.dea[i];
    var prevDif = macd.dif[i - 1];
    var prevDea = macd.dea[i - 1];
    if (![dif, dea, prevDif, prevDea].every(function (value) {
      return value != null && Number.isFinite(Number(value));
    })) return [];

    var golden = prevDif <= prevDea && dif > dea;
    var death = prevDif >= prevDea && dif < dea;
    if (!golden && !death) return [];

    var date = String(bars[bars.length - 1][0]);
    var close = Number(bars[bars.length - 1][2]);
    var gapPct = Number.isFinite(close) && close > 0
      ? Math.abs(Number(dif) - Number(dea)) / close * 100
      : null;
    var edge = gapPct != null && gapPct < MACD_EDGE_PCT;
    var detail = 'DIF ' + Number(dif).toFixed(3) + (golden ? ' 上穿 ' : ' 下穿 ') +
      'DEA ' + Number(dea).toFixed(3) + '（' + date + ' 收盘）' +
      macdEdgeNote(dif, dea, close);

    return [{
      id: stock.symbol + (golden ? ':macd-golden' : ':macd-death'),
      symbol: stock.symbol,
      name: stock.name,
      rule: 'macd',
      ruleLabel: 'MACD',
      title: golden ? 'MACD 金叉' : 'MACD 死叉',
      detail: detail,
      value: Number(dif).toFixed(3),
      tone: golden ? 'up' : 'down',
      time: now,
      crossDate: date,
      gapPct: gapPct,
      edge: edge,
      cooldownMs: MACD_COOLDOWN_MS
    }];
  }

  function rangeEvents(stock, quote, history, now) {
    var events = [];
    if (history.length < RANGE_DAYS) return events;

    var closes = history.map(function (bar) { return Number(bar[2]); });
    var highs = history.map(function (bar) { return Number(bar[3]); });
    var lows = history.map(function (bar) { return Number(bar[4]); });
    var ma20 = closes.reduce(function (sum, value) { return sum + value; }, 0) / closes.length;
    var high20 = Math.max.apply(null, highs);
    var low20 = Math.min.apply(null, lows);
    var price = Number(quote.price);
    var prev = quote.prevClose == null ? null : Number(quote.prevClose);

    if (Number.isFinite(prev) && Number.isFinite(ma20)) {
      if (prev <= ma20 && price > ma20) {
        events.push({
          id: stock.symbol + ':ma-up',
          symbol: stock.symbol,
          name: stock.name,
          rule: 'range',
          ruleLabel: '价格位置',
          title: '上穿 20 日均线',
          detail: '现价 ' + priceText(price) + '，MA20 ' + priceText(ma20) + '，昨收 ' + priceText(prev),
          value: priceText(ma20),
          tone: 'up',
          time: now
        });
      } else if (prev >= ma20 && price < ma20) {
        events.push({
          id: stock.symbol + ':ma-down',
          symbol: stock.symbol,
          name: stock.name,
          rule: 'range',
          ruleLabel: '价格位置',
          title: '下破 20 日均线',
          detail: '现价 ' + priceText(price) + '，MA20 ' + priceText(ma20) + '，昨收 ' + priceText(prev),
          value: priceText(ma20),
          tone: 'down',
          time: now
        });
      }
    }

    if (price > high20) {
      events.push({
        id: stock.symbol + ':high',
        symbol: stock.symbol,
        name: stock.name,
        rule: 'range',
        ruleLabel: '价格位置',
        title: '创 20 日新高',
        detail: '现价 ' + priceText(price) + '，20 日高点 ' + priceText(high20),
        value: priceText(high20),
        tone: 'up',
        time: now
      });
    } else if (price < low20) {
      events.push({
        id: stock.symbol + ':low',
        symbol: stock.symbol,
        name: stock.name,
        rule: 'range',
        ruleLabel: '价格位置',
        title: '创 20 日新低',
        detail: '现价 ' + priceText(price) + '，20 日低点 ' + priceText(low20),
        value: priceText(low20),
        tone: 'down',
        time: now
      });
    }

    return events;
  }

  function evaluateStock(stock, quote, snapshot, now) {
    var events = [];
    if (!quote || quote.price == null) return events;

    var price = Number(quote.price);
    var pct = quote.pct == null ? null : Number(quote.pct);
    var ratio = quote.volumeRatio == null ? null : Number(quote.volumeRatio);

    if (Number.isFinite(pct) && Math.abs(pct) >= PCT_THRESHOLD) {
      events.push({
        id: stock.symbol + (pct > 0 ? ':pct-up' : ':pct-down'),
        symbol: stock.symbol,
        name: stock.name,
        rule: 'pct',
        ruleLabel: '涨跌幅',
        title: pct > 0 ? '涨幅达到 3%' : '跌幅达到 3%',
        detail: '现价 ' + priceText(price) + '，涨跌幅 ' + pctText(pct) + '，阈值 ±3%',
        value: pctText(pct),
        tone: pct > 0 ? 'up' : 'down',
        time: now
      });
    }

    if (Number.isFinite(ratio) && ratio >= VOLUME_RATIO_THRESHOLD) {
      events.push({
        id: stock.symbol + ':volume',
        symbol: stock.symbol,
        name: stock.name,
        rule: 'volume',
        ruleLabel: '量比',
        title: '量比显著放大',
        detail: '量比 ' + priceText(ratio) + '，达到 2.0 阈值',
        value: priceText(ratio),
        tone: 'warn',
        time: now
      });
    }

    var history = historyFor(snapshot, stock.symbol, quote.time);
    events = events.concat(rangeEvents(stock, quote, history, now));
    var macdBars = barsThrough(snapshot, stock.symbol, quote.time, MACD_LOOKBACK);
    return events.concat(macdEvents(stock, macdBars, now));
  }

  function evaluateAll(quotes, stocks, snapshot, now) {
    var timestamp = now == null ? Date.now() : now;
    var list = stocks || window.UNIVERSE || [];
    var out = [];
    list.forEach(function (stock) {
      var events = evaluateStock(stock, quotes && quotes[stock.symbol], snapshot || window.SNAPSHOT, timestamp);
      out = out.concat(events);
    });
    return out;
  }

  /**
   * 同一 event.id 在冷却窗口内只放行一次。返回新对象，不修改调用方状态。
   */
  function applyCooldown(events, lastFired, now, cooldownMs) {
    var windowMs = cooldownMs == null ? COOLDOWN_MS : cooldownMs;
    var next = Object.assign({}, lastFired || {});
    var allowed = [];

    (events || []).forEach(function (event) {
      var last = next[event.id];
      var eventWindow = event.cooldownMs == null ? windowMs : event.cooldownMs;
      if (last == null || now - last >= eventWindow) {
        allowed.push(event);
        next[event.id] = now;
      }
    });

    return { events: allowed, lastFired: next };
  }

  window.AlertEngine = {
    COOLDOWN_MS: COOLDOWN_MS,
    PCT_THRESHOLD: PCT_THRESHOLD,
    VOLUME_RATIO_THRESHOLD: VOLUME_RATIO_THRESHOLD,
    RANGE_DAYS: RANGE_DAYS,
    MACD_MIN_BARS: MACD_MIN_BARS,
    MACD_LOOKBACK: MACD_LOOKBACK,
    MACD_EDGE_PCT: MACD_EDGE_PCT,
    MACD_COOLDOWN_MS: MACD_COOLDOWN_MS,
    historyFor: historyFor,
    barsThrough: barsThrough,
    macdEdgeNote: macdEdgeNote,
    macdEvents: macdEvents,
    evaluateStock: evaluateStock,
    evaluateAll: evaluateAll,
    applyCooldown: applyCooldown
  };
})();
