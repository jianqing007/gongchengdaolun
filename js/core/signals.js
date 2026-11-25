(function () {
  'use strict';

  var rankCache = { key: '', list: null };

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function valueAt(series, index) {
    if (!series || index < 0 || index >= series.length) return null;
    return finite(series[index]) ? Number(series[index]) : null;
  }

  function pctChange(current, previous) {
    if (!finite(current) || !finite(previous) || Number(previous) === 0) return null;
    return (Number(current) / Number(previous) - 1) * 100;
  }

  function periodLabel(period) {
    return period === 'week' ? '周线' : period === 'month' ? '月线' : '日线';
  }

  function mean(values) {
    return window.Indicators.mean(values);
  }

  function stdev(values) {
    return window.Indicators.stdev(values, true);
  }

  function zScore(value, avg, sd) {
    if (!finite(value) || !finite(avg) || !finite(sd) || Number(sd) === 0) return 0;
    return (Number(value) - Number(avg)) / Number(sd);
  }

  function compute(bars, period) {
    var n = bars.length;
    var closes = bars.map(function (bar) { return Number(bar.close); });
    var volumes = bars.map(function (bar) { return Number(bar.volume); });
    var index = n - 1;
    var prev = n - 2;

    var ma = {};
    [5, 10, 20, 40, 60, 250].forEach(function (p) {
      ma[p] = window.Indicators.sma(closes, p);
    });
    var macd = window.Indicators.macd(closes, 12, 26, 9);
    var kdj = window.Indicators.kdj(bars, 9, 3, 3);
    var rsi = {
      6: window.Indicators.rsi(closes, 6),
      12: window.Indicators.rsi(closes, 12),
      24: window.Indicators.rsi(closes, 24)
    };
    var boll = window.Indicators.boll(closes, 20, 2);

    var last = bars[index];
    var close = Number(last.close);
    var ma5 = valueAt(ma[5], index);
    var ma10 = valueAt(ma[10], index);
    var ma20 = valueAt(ma[20], index);
    var ma40 = valueAt(ma[40], index);
    var ma60 = valueAt(ma[60], index);
    var ma250 = valueAt(ma[250], index);

    // 多空排列按 MA5/10/20/60；其余情况统一叫“纠缠”，不把交叉缠绕说成震荡趋势。
    var trend = '纠缠';
    if (ma5 != null && ma10 != null && ma20 != null && ma60 != null) {
      if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) trend = '多头排列';
      else if (ma5 < ma10 && ma10 < ma20 && ma20 < ma60) trend = '空头排列';
    }

    var ma40Distance = ma40 ? pctChange(close, ma40) : null;
    var ma250Distance = ma250 ? pctChange(close, ma250) : null;

    var dif = valueAt(macd.dif, index);
    var dea = valueAt(macd.dea, index);
    var hist = valueAt(macd.hist, index);
    var prevDif = valueAt(macd.dif, prev);
    var prevDea = valueAt(macd.dea, prev);
    var prevHist = valueAt(macd.hist, prev);
    var golden = prevDif != null && prevDea != null && dif != null && dea != null &&
      prevDif <= prevDea && dif > dea;
    var death = prevDif != null && prevDea != null && dif != null && dea != null &&
      prevDif >= prevDea && dif < dea;
    var macdState = dif == null || dea == null ? '数据不足' : golden ? '金叉' : death ? '死叉' :
      dif > dea ? '多头' : '空头';
    var histState = hist == null ? '--' : hist > 0 ? '红柱' : hist < 0 ? '绿柱' : '零轴';
    var histChange = hist != null && prevHist != null ? hist - prevHist : null;
    // 与告警同一口径：|DIF−DEA| 不到收盘价 0.02% 时，换复权口径或数据源就可能翻面。
    var macdGapPct = dif != null && dea != null && close ? Math.abs(dif - dea) / close * 100 : null;
    var macdEdge = macdGapPct != null && macdGapPct < 0.02;

    var k = valueAt(kdj.k, index);
    var d = valueAt(kdj.d, index);
    var j = valueAt(kdj.j, index);
    var kdjState = k == null || d == null ? '数据不足' :
      k > 80 || j > 100 ? '超买' : k < 20 || j < 0 ? '超卖' : k > d ? '偏多' : '偏空';

    var rsi6 = valueAt(rsi[6], index);
    var rsi12 = valueAt(rsi[12], index);
    var rsi24 = valueAt(rsi[24], index);
    var rsiState = rsi6 == null ? '数据不足' : rsi6 > 70 ? '超买' : rsi6 < 30 ? '超卖' : '中性';

    var upper = valueAt(boll.upper, index);
    var mid = valueAt(boll.mid, index);
    var lower = valueAt(boll.lower, index);
    var bollState = upper == null || mid == null || lower == null ? '数据不足' :
      close > upper ? '上轨上方' : close < lower ? '下轨下方' : close >= mid ? '中轨上方' : '中轨下方';
    var bollWidth = upper != null && lower != null && mid ? (upper - lower) / mid * 100 : null;

    var momentum20 = n > 20 ? pctChange(close, closes[n - 21]) : null;
    var returns20 = [];
    for (var r = Math.max(1, n - 20); r < n; r += 1) {
      var change = pctChange(closes[r], closes[r - 1]);
      if (change != null) returns20.push(change / 100);
    }
    var vol20 = window.Indicators.annualizedVolatility(returns20, 252);
    var high20 = -Infinity;
    var low20 = Infinity;
    for (var h = Math.max(0, n - 20); h < n; h += 1) {
      if (finite(bars[h].high)) high20 = Math.max(high20, Number(bars[h].high));
      if (finite(bars[h].low)) low20 = Math.min(low20, Number(bars[h].low));
    }
    var distanceHigh20 = Number.isFinite(high20) ? pctChange(close, high20) : null;
    var distanceLow20 = Number.isFinite(low20) ? pctChange(close, low20) : null;
    var volumeRatio20 = null;
    if (volumes.length > 20) {
      var sum = 0;
      for (var v = n - 20; v < n - 1; v += 1) sum += Number(volumes[v]);
      var avgVolume = sum / 19;
      if (avgVolume > 0) volumeRatio20 = Number(volumes[n - 1]) / avgVolume;
    }

    var summaryParts = [];
    summaryParts.push(periodLabel(period) + '：收盘 ' + close.toFixed(2));
    if (ma20 != null && ma40 != null) {
      summaryParts.push('位于 MA20/MA40 ' + (close >= ma20 && close >= ma40 ? '上方' : '下方'));
    }
    summaryParts.push('均线' + trend);
    summaryParts.push('MACD ' + macdState + '（' + histState + '）');
    if (momentum20 != null) summaryParts.push('20 日动量 ' + (momentum20 > 0 ? '+' : '') + momentum20.toFixed(2) + '%');
    if (vol20 != null) summaryParts.push('20 日年化波动 ' + (vol20 * 100).toFixed(1) + '%');
    if (distanceHigh20 != null) summaryParts.push('距 20 日高点 ' + distanceHigh20.toFixed(2) + '%');

    return {
      close: close,
      trend: trend,
      ma20: ma20,
      ma40: ma40,
      ma250: ma250,
      ma40Distance: ma40Distance,
      ma250Distance: ma250Distance,
      macdState: macdState,
      histState: histState,
      hist: hist,
      histChange: histChange,
      macdGapPct: macdGapPct,
      macdEdge: macdEdge,
      kdjState: kdjState,
      k: k,
      d: d,
      j: j,
      rsi6: rsi6,
      rsi12: rsi12,
      rsi24: rsi24,
      rsiState: rsiState,
      bollState: bollState,
      bollWidth: bollWidth,
      momentum20: momentum20,
      vol20: vol20,
      distanceHigh20: distanceHigh20,
      distanceLow20: distanceLow20,
      volumeRatio20: volumeRatio20,
      summary: summaryParts.join('；') + '。规则生成，仅供课程学习。'
    };
  }

  function toneForTrend(trend) {
    if (trend === '多头排列') return 'up';
    if (trend === '空头排列') return 'down';
    return 'flat';
  }

  function toneForMacd(state) {
    if (state === '金叉' || state === '多头') return 'up';
    if (state === '死叉' || state === '空头') return 'down';
    return 'flat';
  }

  function numberText(value, digits) {
    return finite(value) ? Number(value).toFixed(digits == null ? 1 : digits) : '--';
  }

  function card(label, value, detail, tone) {
    return '<div class="signal-card"><span class="signal-label">' + label + '</span>' +
      '<span class="signal-value ' + (tone || 'flat') + '">' + value + '</span>' +
      '<span class="signal-detail">' + detail + '</span></div>';
  }

  function render(options) {
    var bars = options.bars;
    var period = options.period;
    var stock = options.stock;
    if (!bars || bars.length < 20) {
      options.grid.innerHTML = '<div class="analysis-empty">日线样本不足，至少需要 20 根。</div>';
      options.summary.textContent = '';
      options.subtitle.textContent = stock.name + ' ' + stock.symbol + ' · 数据不足';
      return;
    }
    var s = compute(bars, period);
    options.subtitle.textContent = stock.name + ' ' + stock.symbol + ' · ' +
      periodLabel(period) + ' · 规则生成';
    var html = '';
    html += card('趋势', s.trend, 'MA5/10/20/60', toneForTrend(s.trend));
    html += card('MA40', s.ma40 == null ? '--' : s.ma40Distance >= 0 ? '上方' : '下方',
      s.ma40 == null ? '样本不足' : '偏离 ' + (s.ma40Distance > 0 ? '+' : '') + s.ma40Distance.toFixed(2) + '%',
      s.ma40 == null ? 'flat' : s.ma40Distance >= 0 ? 'up' : 'down');
    var ma250Label = period === 'day' ? '距年线' : '距MA250';
    var ma250Detail = s.ma250 == null
      ? 'MA250 样本不足'
      : 'MA250 ' + numberText(s.ma250, 2) + (period === 'day' ? '' : '（' + periodLabel(period) + '）');
    html += card(ma250Label, s.ma250Distance == null ? '--' :
      (s.ma250Distance > 0 ? '+' : '') + s.ma250Distance.toFixed(2) + '%',
      ma250Detail,
      s.ma250Distance == null ? 'flat' : s.ma250Distance >= 0 ? 'up' : 'down');
    var macdDetail = s.histState +
      (s.histChange == null ? '' : ' · ' + (s.histChange > 0 ? '放大' : '缩短'));
    if (s.macdEdge) macdDetail += ' · DIF−DEA≈0 临界';
    html += card('MACD', s.macdState, macdDetail, toneForMacd(s.macdState));
    html += card('KDJ', s.kdjState,
      s.k == null ? '样本不足' : 'K ' + s.k.toFixed(1) + ' / D ' + s.d.toFixed(1) + ' / J ' + s.j.toFixed(1),
      s.kdjState === '超买' ? 'up' : s.kdjState === '超卖' ? 'down' : 'flat');
    html += card('RSI', s.rsiState,
      s.rsi6 == null ? '样本不足' : 'RSI6 ' + numberText(s.rsi6) + ' / 12 ' +
        numberText(s.rsi12) + ' / 24 ' + numberText(s.rsi24),
      s.rsiState === '超买' ? 'up' : s.rsiState === '超卖' ? 'down' : 'flat');
    html += card('BOLL', s.bollState,
      s.bollWidth == null ? '样本不足' : '带宽 ' + s.bollWidth.toFixed(1) + '%', 'flat');
    html += card('20 日动量', s.momentum20 == null ? '--' : (s.momentum20 > 0 ? '+' : '') + s.momentum20.toFixed(2) + '%',
      '收盘相对 20 根前', s.momentum20 == null ? 'flat' : s.momentum20 > 0 ? 'up' : 'down');
    html += card('20 日波动', s.vol20 == null ? '--' : (s.vol20 * 100).toFixed(1) + '%',
      '年化，252 交易日', 'flat');
    html += card('距 20 日高点', s.distanceHigh20 == null ? '--' : s.distanceHigh20.toFixed(2) + '%',
      s.distanceLow20 == null ? '' : '距低点 ' + s.distanceLow20.toFixed(2) + '%', 'flat');
    options.grid.innerHTML = html;
    options.summary.innerHTML = '<strong>分析摘要</strong><br>' + s.summary;
    if (options.poolList) renderPool(options.poolList);
  }

  function rank() {
    var snap = window.SNAPSHOT || {};
    var key = (snap.meta && snap.meta.fetchedAt ? snap.meta.fetchedAt : '') + '|' +
      (window.ACTIVE_POOL_GROUP || '');
    if (rankCache.key === key && rankCache.list) return rankCache.list;

    var rows = [];
    window.UNIVERSE.forEach(function (stock) {
      var bars = window.PriceHistory.dailyBars(stock.symbol);
      if (bars.length < 60) return;
      var s = compute(bars, 'day');
      rows.push({ stock: stock, s: s });
    });
    if (!rows.length) return [];

    var momentum = rows.map(function (row) { return row.s.momentum20; }).filter(finite);
    var vol = rows.map(function (row) { return row.s.vol20; }).filter(finite);
    var volume = rows.map(function (row) { return row.s.volumeRatio20; }).filter(finite);
    var momAvg = mean(momentum);
    var momSd = stdev(momentum);
    var volAvg = mean(vol);
    var volSd = stdev(vol);
    var volumeAvg = mean(volume);
    var volumeSd = stdev(volume);

    rows.forEach(function (row) {
      var s = row.s;
      var trendScore = s.trend === '多头排列' ? 1 : s.trend === '空头排列' ? -1 : 0;
      var macdScore = s.macdState === '金叉' ? 1 : s.macdState === '死叉' ? -1 :
        s.macdState === '多头' ? 0.5 : s.macdState === '空头' ? -0.5 : 0;
      var score = 50
        + 18 * zScore(s.momentum20, momAvg, momSd)
        + 15 * trendScore
        + 8 * macdScore
        + 5 * zScore(s.volumeRatio20, volumeAvg, volumeSd)
        - 8 * zScore(s.vol20, volAvg, volSd);
      score = Math.max(0, Math.min(100, score));

      var reasons = [];
      if (s.momentum20 != null) reasons.push('20日动量 ' + (s.momentum20 > 0 ? '+' : '') + s.momentum20.toFixed(1) + '%');
      if (s.trend !== '震荡') reasons.push(s.trend);
      if (s.macdState === '金叉' || s.macdState === '死叉') reasons.push('MACD ' + s.macdState);
      if (s.volumeRatio20 != null && s.volumeRatio20 > 1.2) reasons.push('量能 ' + s.volumeRatio20.toFixed(1) + '×');
      if (s.vol20 != null) reasons.push('波动 ' + (s.vol20 * 100).toFixed(0) + '%');
      row.score = score;
      row.reasons = reasons.slice(0, 3);
    });

    rows.sort(function (a, b) { return b.score - a.score; });
    rankCache = { key: key, list: rows };
    return rows;
  }

  function renderPool(poolList) {
    if (!poolList) return;
    var rows = rank().slice(0, 5);
    if (!rows.length) {
      poolList.innerHTML = '<div class="analysis-empty">观察池暂无可用数据</div>';
      return;
    }
    poolList.innerHTML = rows.map(function (row, index) {
      return '<div class="pool-item">' +
        '<span class="pool-rank">' + (index + 1) + '</span>' +
        '<span class="pool-name">' + row.stock.name + '<small>' + row.stock.symbol + '</small></span>' +
        '<span class="pool-score">' + row.score.toFixed(0) + '</span>' +
        '<span class="pool-reasons">' + row.reasons.join(' · ') + '</span>' +
        '</div>';
    }).join('');
  }

  window.SignalEngine = {
    compute: compute,
    render: render,
    rank: rank,
    renderPool: renderPool
  };
})();
