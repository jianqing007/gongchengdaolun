(function () {
  'use strict';

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function mean(values) {
    return window.Indicators.mean(values);
  }

  function covariance(a, b) {
    if (!a.length || a.length !== b.length) return null;
    var ma = mean(a);
    var mb = mean(b);
    if (ma == null || mb == null) return null;
    var sum = 0;
    for (var i = 0; i < a.length; i += 1) sum += (a[i] - ma) * (b[i] - mb);
    return a.length > 1 ? sum / (a.length - 1) : null;
  }

  function compute(holdings, quotes, windowDays) {
    if (!Array.isArray(holdings) || holdings.length === 0) {
      return { ok: false, reason: 'empty' };
    }
    var windowSize = windowDays || 60;
    var indexBars = window.PriceHistory.dailyBars('SH000300');
    if (indexBars.length < 30) return { ok: false, reason: 'index' };

    var indexMap = {};
    indexBars.forEach(function (bar) { indexMap[bar.date] = Number(bar.close); });

    var series = [];
    for (var h = 0; h < holdings.length; h += 1) {
      var holding = holdings[h];
      var bars = window.PriceHistory.dailyBars(holding.symbol);
      if (bars.length < 30) return { ok: false, reason: 'stock', symbol: holding.symbol };
      var map = {};
      bars.forEach(function (bar) { map[bar.date] = Number(bar.close); });
      series.push({ holding: holding, map: map, last: bars[bars.length - 1] });
    }

    var dates = [];
    var dateLimit = Math.max(windowSize + 1, 251);
    for (var i = indexBars.length - 1; i >= 0 && dates.length < dateLimit; i -= 1) {
      var date = indexBars[i].date;
      var complete = series.every(function (item) { return finite(item.map[date]); });
      if (complete) dates.unshift(date);
    }
    if (dates.length < 21) return { ok: false, reason: 'insufficient' };

    var values = series.map(function (item) {
      var quote = quotes && quotes[item.holding.symbol];
      var price = quote && quote.price != null ? Number(quote.price) : Number(item.last.close);
      return Number(item.holding.shares) * price;
    });
    var totalValue = values.reduce(function (sum, value) { return sum + value; }, 0);
    if (!(totalValue > 0)) return { ok: false, reason: 'value' };
    var weights = values.map(function (value) { return value / totalValue; });

    var portfolioReturns = [];
    var indexReturns = [];
    var equity = [1];

    for (var t = 1; t < dates.length; t += 1) {
      var portfolioReturn = 0;
      var ok = true;
      for (var s = 0; s < series.length; s += 1) {
        var prevClose = series[s].map[dates[t - 1]];
        var close = series[s].map[dates[t]];
        if (!finite(prevClose) || !finite(close) || Number(prevClose) === 0) {
          ok = false;
          break;
        }
        portfolioReturn += weights[s] * (Number(close) / Number(prevClose) - 1);
      }
      var indexPrev = indexMap[dates[t - 1]];
      var indexClose = indexMap[dates[t]];
      if (!ok || !finite(indexPrev) || !finite(indexClose) || Number(indexPrev) === 0) continue;
      var indexReturn = Number(indexClose) / Number(indexPrev) - 1;
      portfolioReturns.push(portfolioReturn);
      indexReturns.push(indexReturn);
      equity.push(equity[equity.length - 1] * (1 + portfolioReturn));
    }

    if (portfolioReturns.length < 20) return { ok: false, reason: 'insufficient' };

    var tail = function (array, size) {
      return array.slice(Math.max(0, array.length - size));
    };
    var vol20 = window.Indicators.annualizedVolatility(tail(portfolioReturns, 20), 252);
    var vol60 = window.Indicators.annualizedVolatility(tail(portfolioReturns, 60), 252);
    var vol250 = window.Indicators.annualizedVolatility(tail(portfolioReturns, 250), 252);
    var drawdown = window.Indicators.maxDrawdown(tail(equity, 61));
    var cov = covariance(tail(portfolioReturns, 60), tail(indexReturns, 60));
    var varIndex = window.Indicators.stdev(tail(indexReturns, 60), true);
    var sdPortfolio = window.Indicators.stdev(tail(portfolioReturns, 60), true);
    var beta = cov != null && varIndex != null && varIndex !== 0 ? cov / (varIndex * varIndex) : null;
    var correlation = cov != null && varIndex != null && sdPortfolio != null && varIndex !== 0 && sdPortfolio !== 0
      ? cov / (varIndex * sdPortfolio)
      : null;

    var topWeight = Math.max.apply(null, weights);
    var hhi = weights.reduce(function (sum, weight) { return sum + weight * weight; }, 0);

    return {
      ok: true,
      days: portfolioReturns.length,
      window: windowSize,
      totalValue: totalValue,
      topWeight: topWeight,
      hhi: hhi,
      effective: hhi > 0 ? 1 / hhi : null,
      vol20: vol20,
      vol60: vol60,
      vol250: vol250,
      maxDrawdown: drawdown,
      beta: beta,
      correlation: correlation
    };
  }

  function pct(value, digits) {
    if (!finite(value)) return '--';
    return (Number(value) * 100).toFixed(digits == null ? 1 : digits) + '%';
  }

  function num(value, digits) {
    if (!finite(value)) return '--';
    return Number(value).toFixed(digits == null ? 2 : digits);
  }

  function card(label, value, detail, tone) {
    return '<div class="risk-card"><span class="risk-label">' + label + '</span>' +
      '<span class="risk-value ' + (tone || 'flat') + '">' + value + '</span>' +
      '<span class="risk-detail">' + detail + '</span></div>';
  }

  function render(options) {
    var grid = options.grid;
    var note = options.note;
    if (!grid) return;
    var result = compute(options.holdings, options.quotes, 60);
    if (!result.ok) {
      var message = result.reason === 'empty'
        ? '还没有持仓，先在右侧建仓或载入示例。'
        : result.reason === 'index'
          ? '沪深 300 日线样本不足，无法计算组合风险。'
          : result.reason === 'stock'
            ? '持仓中的 ' + result.symbol + ' 日线不足，无法计算。'
            : '可用交易日不足 20 个，暂时无法计算组合风险。';
      grid.innerHTML = '<div class="analysis-empty">' + message + '</div>';
      note.textContent = '';
      return;
    }

    var html = '';
    html += card('第一大权重', pct(result.topWeight), '单票集中度',
      result.topWeight > 0.3 ? 'warn' : 'flat');
    html += card('等效持股数', num(result.effective, 1), '1 / HHI');
    html += card('20 日波动', pct(result.vol20), '年化');
    html += card('60 日波动', pct(result.vol60), '年化');
    html += card('60 日最大回撤', pct(Math.abs(result.maxDrawdown || 0)), '峰值到谷底');
    html += card('β（60 日）', num(result.beta, 2), '相对沪深 300',
      result.beta != null && result.beta > 1.2 ? 'warn' : 'flat');
    html += card('相关系数', num(result.correlation, 2), '与沪深 300');
    html += card('有效样本', result.days + ' 天', '组合日收益');
    grid.innerHTML = html;

    note.textContent = '假设：当前权重不变、每日再平衡、无现金/手续费；使用前复权收盘价与 252 个交易日/年。' +
      '单票权重超过 30% 会标黄，β 高于 1.2 会标黄。风险指标是历史统计，不代表未来。';
  }

  window.RiskEngine = {
    compute: compute,
    render: render
  };
})();
