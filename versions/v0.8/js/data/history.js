(function () {
  'use strict';

  var dailyCache = {};
  var barsCache = {};
  var negativeCounts = {};
  var cacheKey = '';
  // v0.8 页面内续读：SnapshotExtend.applyExtension 写入的增量 K 线
  //（[date, open, close, high, low, volume] 行，日期全部晚于快照末日）。
  var extension = {};
  var extensionStamp = '';

  function snapshotEntry(symbol) {
    var snap = window.SNAPSHOT || {};
    return (snap.stocks && snap.stocks[symbol]) || (snap.indices && snap.indices[symbol]) || null;
  }

  function todayChina() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function weekStart(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    var day = d.getUTCDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function periodEnd(dateStr, period) {
    if (period === 'week') return addDays(weekStart(dateStr), 4);
    if (period === 'month') {
      var parts = dateStr.split('-');
      var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0));
      return d.toISOString().slice(0, 10);
    }
    return dateStr;
  }

  function periodKey(dateStr, period) {
    if (period === 'week') return weekStart(dateStr);
    if (period === 'month') return dateStr.slice(0, 7);
    return dateStr;
  }

  function toBar(row) {
    return {
      date: String(row[0]),
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
      volume: Number(row[5])
    };
  }

  function dailyBars(symbol) {
    if (dailyCache[symbol]) return dailyCache[symbol];
    var entry = snapshotEntry(symbol);
    if (!entry || !Array.isArray(entry.bars)) return [];
    // v0.8：快照行 + 续读行（applyExtension 已保证日期递增且晚于快照末日）
    var extRows = extension[symbol] || [];
    var raw = entry.bars.concat(extRows).map(toBar).filter(function (bar) {
      return bar.date && Number.isFinite(bar.open) && Number.isFinite(bar.close) &&
        Number.isFinite(bar.high) && Number.isFinite(bar.low);
    });
    // 前复权价格在早期可能因累计分红变成负数（腾讯接口的实际行为）。
    // 负价格不能进入对数坐标和均线/收益率计算，这里剔除并在界面提示数量。
    var bars = raw.filter(function (bar) {
      return bar.open > 0 && bar.close > 0 && bar.high > 0 && bar.low > 0;
    });
    negativeCounts[symbol] = raw.length - bars.length;
    dailyCache[symbol] = bars;
    return bars;
  }

  /**
   * 把日线聚合成周线/月线。
   * 开=第一根开盘，收=最后一根收盘，高=最大，低=最小，量=求和。
   * 只有“当前周/月且还没走完”的最后一段标记 partial。
   */
  function aggregate(daily, period) {
    if (period === 'day') return daily.slice();
    if (period !== 'week' && period !== 'month') return [];
    if (!Array.isArray(daily) || daily.length === 0) return [];

    var groups = [];
    var byKey = {};
    daily.forEach(function (bar) {
      var key = periodKey(bar.date, period);
      var group = byKey[key];
      if (!group) {
        group = {
          key: key,
          startDate: bar.date,
          endDate: bar.date,
          open: bar.open,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          volume: 0,
          bars: 0
        };
        byKey[key] = group;
        groups.push(group);
      }
      group.endDate = bar.date;
      group.close = bar.close;
      group.high = Math.max(group.high, bar.high);
      group.low = Math.min(group.low, bar.low);
      group.volume += bar.volume;
      group.bars += 1;
    });

    var today = todayChina();
    return groups.map(function (group, index) {
      var end = periodEnd(group.endDate, period);
      var isLast = index === groups.length - 1;
      return {
        date: group.endDate,
        startDate: group.startDate,
        endDate: group.endDate,
        open: group.open,
        close: group.close,
        high: group.high,
        low: group.low,
        volume: group.volume,
        bars: group.bars,
        partial: isLast && group.endDate < end && end >= today
      };
    });
  }

  function barsFor(symbol, period) {
    var p = period || 'day';
    var stamp = ((window.SNAPSHOT && window.SNAPSHOT.meta && window.SNAPSHOT.meta.fetchedAt) || '') +
      '#' + extensionStamp; // 续读应用后一并失效缓存
    if (cacheKey !== stamp) {
      dailyCache = {};
      barsCache = {};
      cacheKey = stamp;
    }
    if (p === 'day') return dailyBars(symbol);
    var key = symbol + '|' + p;
    if (!barsCache[key]) barsCache[key] = aggregate(dailyBars(symbol), p);
    return barsCache[key];
  }

  function meta(symbol) {
    var entry = snapshotEntry(symbol);
    return entry
      ? { symbol: entry.symbol, name: entry.name, tx: entry.tx, sector: entry.sector || '' }
      : null;
  }

  function lastDate(symbol) {
    var bars = dailyBars(symbol);
    return bars.length ? bars[bars.length - 1].date : null;
  }

  function has(symbol) {
    return !!snapshotEntry(symbol);
  }

  function clearCache() {
    dailyCache = {};
    barsCache = {};
    negativeCounts = {};
    cacheKey = '';
    extension = {};
    extensionStamp = '';
  }

  /* v0.8：SnapshotExtend 校验通过后调用。ext: { symbol: [[date,o,c,h,l,v],...] }，
     传入前必须已按日期升序、去重、且日期晚于该标的快照末日。 */
  function applyExtension(ext) {
    extension = {};
    var lastDates = {};
    Object.keys(window.SNAPSHOT && window.SNAPSHOT.stocks || {}).forEach(function (symbol) {
      var bars = window.SNAPSHOT.stocks[symbol] && window.SNAPSHOT.stocks[symbol].bars;
      if (bars && bars.length) lastDates[symbol] = String(bars[bars.length - 1][0]);
    });
    Object.keys(window.SNAPSHOT && window.SNAPSHOT.indices || {}).forEach(function (symbol) {
      var bars = window.SNAPSHOT.indices[symbol] && window.SNAPSHOT.indices[symbol].bars;
      if (bars && bars.length) lastDates[symbol] = String(bars[bars.length - 1][0]);
    });
    Object.keys(ext || {}).forEach(function (symbol) {
      var rows = (ext[symbol] || []).filter(function (row) {
        return Array.isArray(row) && row.length >= 6 &&
          /^\d{4}-\d{2}-\d{2}$/.test(String(row[0])) &&
          String(row[0]) > (lastDates[symbol] || '');
      });
      if (rows.length) extension[symbol] = rows;
    });
    extensionStamp = String(Date.now());
    dailyCache = {};
    barsCache = {};
  }

  function negativeCount(symbol) {
    dailyBars(symbol);
    return negativeCounts[symbol] || 0;
  }

  window.PriceHistory = {
    dailyBars: dailyBars,
    barsFor: barsFor,
    aggregate: aggregate,
    meta: meta,
    lastDate: lastDate,
    has: has,
    negativeCount: negativeCount,
    periodEnd: periodEnd,
    periodKey: periodKey,
    clearCache: clearCache,
    applyExtension: applyExtension
  };
})();
