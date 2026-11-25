(function () {
  'use strict';

  var BENCHMARK = 'SH000300';
  var RS_DAYS = 20;
  var MIN_BARS = RS_DAYS + 1;
  var cache = { key: '', html: '', note: '' };

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function pct(value, digits) {
    if (!finite(value)) return '--';
    var n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits) + '%';
  }

  function tone(value) {
    if (!finite(value)) return 'flat';
    return Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : 'flat';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function benchmark() {
    var bars = window.PriceHistory.dailyBars(BENCHMARK);
    var map = {};
    bars.forEach(function (bar) { map[bar.date] = Number(bar.close); });
    return { bars: bars, map: map };
  }

  /**
   * 近 20 日相对强度：个股 20 日涨幅 − 沪深 300 同期涨幅。
   * 用个股最后 21 根日线的首尾日期去基准里取同日收盘，取不到就返回 null。
   */
  function relativeStrength(bars, bench) {
    if (bars.length < MIN_BARS || !bench.bars.length) return null;
    var last = bars.length - 1;
    var startDate = bars[last - RS_DAYS].date;
    var endDate = bars[last].date;
    var start = bench.map[startDate];
    var end = bench.map[endDate];
    if (!finite(start) || !finite(end) || Number(start) === 0) return null;
    var stockReturn = Number(bars[last].close) / Number(bars[last - RS_DAYS].close) - 1;
    var benchReturn = Number(end) / Number(start) - 1;
    return (stockReturn - benchReturn) * 100;
  }

  function brief(s) {
    var parts = [s.trend, 'MACD ' + s.macdState];
    if (s.momentum20 != null) parts.push('20日 ' + pct(s.momentum20, 1));
    return parts.join(' · ');
  }

  function compute() {
    var bench = benchmark();
    var rows = [];
    window.UNIVERSE.forEach(function (stock) {
      var bars = window.PriceHistory.dailyBars(stock.symbol);
      if (!bars.length) return;
      var last = bars[bars.length - 1];
      var prev = bars.length > 1 ? bars[bars.length - 2] : null;
      var close = Number(last.close);
      var pctDay = prev && Number(prev.close) ? (close / Number(prev.close) - 1) * 100 : null;
      var s = bars.length >= MIN_BARS
        ? window.SignalEngine.compute(bars, 'day')
        : { trend: '样本不足', macdState: '数据不足', ma20: null, momentum20: null, distanceHigh20: null };
      rows.push({
        symbol: stock.symbol,
        name: stock.name,
        sector: stock.sector || '',
        type: stock.type || 'stock',
        close: close,
        pctDay: pctDay,
        pct20: s.momentum20,
        rs20: relativeStrength(bars, bench),
        trend: s.trend,
        macdState: s.macdState,
        aboveMa20: s.ma20 != null && close > s.ma20,
        ma20: s.ma20,
        distanceHigh20: s.distanceHigh20,
        brief: brief(s)
      });
    });

    // 按当日涨跌降序：同一天逆势走强的集群会排在一起，便于一眼扫出。
    rows.sort(function (a, b) {
      var av = a.pctDay == null ? -Infinity : a.pctDay;
      var bv = b.pctDay == null ? -Infinity : b.pctDay;
      return bv - av;
    });
    return rows;
  }

  function renderRows(rows) {
    return rows.map(function (row) {
      var golden = row.macdState === '金叉';
      return '<tr data-symbol="' + row.symbol + '"' + (golden ? ' class="is-golden"' : '') + '>' +
        '<td><div class="stock-name">' + esc(row.name) + '</div>' +
          '<div class="stock-code">' + esc(row.symbol) + ' · ' + esc(row.sector) +
          (row.type === 'etf' ? ' · ETF' : '') + '</div></td>' +
        '<td class="num">' + (finite(row.close) ? row.close.toFixed(2) : '--') + '</td>' +
        '<td class="num ' + tone(row.pctDay) + '">' + pct(row.pctDay) + '</td>' +
        '<td class="num ' + tone(row.pct20) + '">' + pct(row.pct20) + '</td>' +
        '<td class="num ' + tone(row.rs20) + '">' + pct(row.rs20) + '</td>' +
        '<td>' + row.trend + '</td>' +
        '<td class="' + (row.macdState === '金叉' ? 'up' : row.macdState === '死叉' ? 'down' : '') + '">' +
          row.macdState + '</td>' +
        '<td>' + (row.ma20 == null ? '--' : row.aboveMa20 ? '站上' : '跌破') + '</td>' +
        '<td class="num">' + pct(row.distanceHigh20) + '</td>' +
        '<td class="overview-brief">' + esc(row.brief) + '</td>' +
      '</tr>';
    }).join('');
  }

  function render(options) {
    var body = options && options.body;
    if (!body) return;
    var snap = window.SNAPSHOT || {};
    var key = [
      (snap.meta && snap.meta.fetchedAt) || '',
      window.ACTIVE_POOL_GROUP || ''
    ].join('|');

    if (cache.key !== key) {
      var rows = compute();
      var golden = rows.filter(function (row) { return row.macdState === '金叉'; }).length;
      cache = {
        key: key,
        html: renderRows(rows),
        note: '按当日涨跌幅降序，逆势走强的集群会排在一起；相对强度 = 个股 20 日涨幅 − 沪深 300 同期涨幅。' +
          '金叉行高亮，共 ' + golden + ' 行。数据基于日线收盘，不随盘中行情跳动。'
      };
    }

    body.innerHTML = cache.html || '<tr><td colspan="10" class="analysis-empty">暂无可用日线</td></tr>';
    if (options.note) options.note.textContent = cache.note;
  }

  window.PoolOverview = {
    BENCHMARK: BENCHMARK,
    RS_DAYS: RS_DAYS,
    compute: compute,
    relativeStrength: relativeStrength,
    render: render
  };
})();
