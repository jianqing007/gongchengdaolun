(function () {
  'use strict';

  // 买点闸门只看这两只：创业板指代表成长风格，科创 50 代表硬科技风险偏好。
  var GATE_INDICES = [
    { symbol: 'SZ399006', name: '创业板指' },
    { symbol: 'SH000688', name: '科创50' }
  ];
  var SHORT_MA = 20;
  var LONG_MA = 250;
  var STREAK_GATE = 3;

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function pctText(value, digits) {
    if (!finite(value)) return '--';
    var n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits) + '%';
  }

  function priceText(value) {
    return finite(value) ? Number(value).toFixed(2) : '--';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 单只指数的闸门状态。
   * - 距年线：收盘 / MA250 - 1
   * - DIF 连续拐头向上天数：从最后一根往前数 dif[i] > dif[i-1] 的连续天数
   * - 一级闸门“企稳萌芽”：连升 >= 3 天
   * - 二级闸门“买点解锁”：收盘站上 MA20
   */
  function compute(symbol) {
    var meta = window.PriceHistory.meta(symbol) || {};
    var bars = window.PriceHistory.dailyBars(symbol);
    var name = meta.name || symbol;
    if (!Array.isArray(bars) || bars.length < SHORT_MA + 1) {
      return { ok: false, symbol: symbol, name: name, reason: '日线不足 ' + (SHORT_MA + 1) + ' 根' };
    }

    var closes = bars.map(function (bar) { return Number(bar.close); });
    var n = closes.length;
    var close = closes[n - 1];
    var prev = closes[n - 2];
    var ma20 = window.Indicators.lastValid(window.Indicators.sma(closes, SHORT_MA));
    var ma250 = window.Indicators.lastValid(window.Indicators.sma(closes, LONG_MA));
    var macd = window.Indicators.macd(closes, 12, 26, 9);
    var dif = window.Indicators.lastValid(macd.dif);
    var dea = window.Indicators.lastValid(macd.dea);

    var state = '数据不足';
    var prevDif = macd.dif[n - 2];
    var prevDea = macd.dea[n - 2];
    if (dif != null && dea != null && finite(prevDif) && finite(prevDea)) {
      if (prevDif <= prevDea && dif > dea) state = '金叉';
      else if (prevDif >= prevDea && dif < dea) state = '死叉';
      else state = dif > dea ? '多头' : '空头';
    }

    var streak = 0;
    if (dif != null) {
      for (var i = n - 1; i > 0; i -= 1) {
        if (!finite(macd.dif[i]) || !finite(macd.dif[i - 1])) break;
        if (Number(macd.dif[i]) <= Number(macd.dif[i - 1])) break;
        streak += 1;
      }
    }

    var pct20 = n > SHORT_MA
      ? (close / closes[n - 1 - SHORT_MA] - 1) * 100
      : null;
    var distMa250 = ma250 ? (close / ma250 - 1) * 100 : null;
    var aboveMa20 = ma20 != null && close > ma20;
    var gate1 = streak >= STREAK_GATE;
    var gate2 = aboveMa20;

    return {
      ok: true,
      symbol: symbol,
      name: name,
      date: bars[n - 1].date,
      close: close,
      pctDay: prev ? (close / prev - 1) * 100 : null,
      ma20: ma20,
      ma250: ma250,
      distMa250: distMa250,
      dif: dif,
      dea: dea,
      macdState: state,
      difStreak: streak,
      aboveMa20: aboveMa20,
      pct20: pct20,
      gate1: gate1,
      gate2: gate2,
      // 两层闸门都过才算“买点解锁”；只过一层时明确写出差在哪。
      gateLabel: gate1 && gate2 ? '买点解锁' : gate1 ? '企稳萌芽' : gate2 ? '价在线上' : '未达成'
    };
  }

  function badge(on, text) {
    return '<span class="gate-badge ' + (on ? 'is-on' : '') + '">' + text + '</span>';
  }

  function card(item) {
    if (!item.ok) {
      return '<div class="gate-card is-empty"><div class="gate-head"><strong>' +
        esc(item.name) + '</strong><span class="muted">' + esc(item.reason) + '</span></div></div>';
    }
    var tone = item.pctDay == null ? 'flat' : item.pctDay > 0 ? 'up' : item.pctDay < 0 ? 'down' : 'flat';
    var ma250Tone = item.distMa250 == null ? 'flat' : item.distMa250 >= 0 ? 'up' : 'down';
    var macdTone = item.macdState === '金叉' || item.macdState === '多头' ? 'up' :
      item.macdState === '死叉' || item.macdState === '空头' ? 'down' : 'flat';

    var rows = [
      ['距年线', pctText(item.distMa250), item.ma250 == null ? 'MA250 样本不足' : 'MA250 ' + priceText(item.ma250), ma250Tone],
      ['MA20', item.ma20 == null ? '--' : (item.aboveMa20 ? '上方' : '下方'),
        item.ma20 == null ? '样本不足' : 'MA20 ' + priceText(item.ma20), item.aboveMa20 ? 'up' : 'down'],
      ['MACD', item.macdState,
        item.dif == null ? '样本不足' : 'DIF ' + item.dif.toFixed(3) + ' / DEA ' + item.dea.toFixed(3), macdTone],
      ['DIF 连升', item.difStreak + ' 天', '≥3 天达成一级闸门', item.gate1 ? 'up' : 'flat'],
      ['近 20 日', pctText(item.pct20), '收盘相对 20 根前', item.pct20 == null ? 'flat' : item.pct20 > 0 ? 'up' : 'down']
    ];

    return '<div class="gate-card" data-gate="' + item.symbol + '">' +
      '<div class="gate-head">' +
        '<div><strong>' + esc(item.name) + '</strong><span class="gate-code">' + esc(item.symbol) + ' · ' + esc(item.date) + '</span></div>' +
        '<div class="gate-price"><b>' + priceText(item.close) + '</b>' +
          '<span class="' + tone + '">' + pctText(item.pctDay) + '</span></div>' +
      '</div>' +
      '<div class="gate-rows">' + rows.map(function (row) {
        return '<div class="gate-row"><span>' + row[0] + '</span>' +
          '<b class="' + row[3] + '">' + row[1] + '</b><small>' + row[2] + '</small></div>';
      }).join('') + '</div>' +
      '<div class="gate-badges">' +
        badge(item.gate1, '一级闸门 · ' + (item.gate1 ? '企稳萌芽达成' : 'DIF 连升 ' + item.difStreak + '/3 天')) +
        badge(item.gate2, '二级闸门 · ' + (item.gate2 ? '买点解锁' : '收盘未收复 MA20')) +
      '</div>' +
    '</div>';
  }

  function render(options) {
    var grid = options && options.grid;
    if (!grid) return;
    var items = GATE_INDICES.map(function (item) { return compute(item.symbol); });
    grid.innerHTML = items.map(card).join('');
    if (options.note) {
      var ready = items.filter(function (item) { return item.ok; });
      if (!ready.length) {
        options.note.textContent = '快照中没有创业板指/科创50 日线，先运行 python tools/build_snapshot.py --update。';
      } else {
        var passed = ready.filter(function (item) { return item.gate1 && item.gate2; }).length;
        options.note.textContent = '闸门口径：DIF 连升 ≥3 天为一级“企稳萌芽”，收盘站上 MA20 为二级“买点解锁”。' +
          '两只指数当前 ' + passed + '/' + ready.length + ' 同时满足。规则生成，不构成投资建议。';
      }
    }
  }

  window.GateEngine = {
    GATE_INDICES: GATE_INDICES,
    SHORT_MA: SHORT_MA,
    LONG_MA: LONG_MA,
    STREAK_GATE: STREAK_GATE,
    compute: compute,
    render: render
  };
})();
