/* 股迹 v0.5 · 信号卡分享图：用 Canvas 合成当前标的信号卡并导出 PNG。
 * 纯前端生成，不上传任何数据；图片内容与页面卡片一致，均由规则计算。 */
(function () {
  'use strict';

  var W = 1080;
  var H = 660;
  var S = 2; // 2 倍采样，导出 2160×1320 更清晰

  function cssVar(name, fallback) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  function num(value, digits) {
    var n = Number(value);
    return value == null || !Number.isFinite(n) ? '--' : n.toFixed(digits == null ? 1 : digits);
  }

  function toneColor(tone, colors) {
    if (tone === 'up') return colors.up;
    if (tone === 'down') return colors.down;
    return colors.text;
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    var lines = [];
    var current = '';
    Array.from(String(text)).forEach(function (ch) {
      var probe = current + ch;
      if (ctx.measureText(probe).width > maxWidth && current) {
        lines.push(current);
        current = ch;
        if (lines.length >= maxLines) current = '';
      } else {
        current = probe;
      }
    });
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length === maxLines) {
      var last = lines[maxLines - 1];
      if (ctx.measureText(String(text).slice(lines.join('').length)).width > 0) {
        lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
      }
    }
    return lines;
  }

  function metrics(s, period) {
    var ma250Label = period === 'day' ? '距年线' : '距MA250';
    var macdDetail = s.histState + (s.histChange == null ? '' : (s.histChange > 0 ? ' · 放大' : ' · 缩短'));
    if (s.macdEdge) macdDetail += ' · DIF−DEA≈0 临界';
    return [
      { label: '趋势', value: s.trend, detail: 'MA5/10/20/60',
        tone: s.trend === '多头排列' ? 'up' : s.trend === '空头排列' ? 'down' : 'flat' },
      { label: 'MA40', value: s.ma40 == null ? '--' : (s.ma40Distance >= 0 ? '上方' : '下方'),
        detail: s.ma40 == null ? '样本不足' : '偏离 ' + (s.ma40Distance > 0 ? '+' : '') + s.ma40Distance.toFixed(2) + '%',
        tone: s.ma40 == null ? 'flat' : (s.ma40Distance >= 0 ? 'up' : 'down') },
      { label: ma250Label,
        value: s.ma250Distance == null ? '--' : (s.ma250Distance > 0 ? '+' : '') + s.ma250Distance.toFixed(2) + '%',
        detail: s.ma250 == null ? 'MA250 样本不足' : 'MA250 ' + num(s.ma250, 2),
        tone: s.ma250Distance == null ? 'flat' : (s.ma250Distance >= 0 ? 'up' : 'down') },
      { label: 'MACD', value: s.macdState, detail: macdDetail,
        tone: s.macdState === '金叉' || s.macdState === '多头' ? 'up'
          : s.macdState === '死叉' || s.macdState === '空头' ? 'down' : 'flat' },
      { label: 'KDJ', value: s.kdjState,
        detail: s.k == null ? '样本不足' : 'K ' + s.k.toFixed(1) + ' / D ' + s.d.toFixed(1) + ' / J ' + s.j.toFixed(1),
        tone: s.kdjState === '超买' ? 'up' : s.kdjState === '超卖' ? 'down' : 'flat' },
      { label: 'RSI', value: s.rsiState,
        detail: s.rsi6 == null ? '样本不足' : 'RSI6 ' + num(s.rsi6) + ' / 12 ' + num(s.rsi12) + ' / 24 ' + num(s.rsi24),
        tone: s.rsiState === '超买' ? 'up' : s.rsiState === '超卖' ? 'down' : 'flat' },
      { label: 'BOLL', value: s.bollState,
        detail: s.bollWidth == null ? '样本不足' : '带宽 ' + s.bollWidth.toFixed(1) + '%', tone: 'flat' },
      { label: '20 日动量',
        value: s.momentum20 == null ? '--' : (s.momentum20 > 0 ? '+' : '') + s.momentum20.toFixed(2) + '%',
        detail: '收盘相对 20 根前',
        tone: s.momentum20 == null ? 'flat' : (s.momentum20 > 0 ? 'up' : 'down') },
      { label: '20 日波动',
        value: s.vol20 == null ? '--' : (s.vol20 * 100).toFixed(1) + '%',
        detail: '年化，252 交易日', tone: 'flat' },
      { label: '距 20 日高点',
        value: s.distanceHigh20 == null ? '--' : s.distanceHigh20.toFixed(2) + '%',
        detail: s.distanceLow20 == null ? '' : '距低点 ' + s.distanceLow20.toFixed(2) + '%', tone: 'flat' }
    ];
  }

  function build(payload) {
    if (!payload || !payload.signals || !payload.stock) return null;
    var s = payload.signals;
    var stock = payload.stock;
    var quote = payload.quote;
    var colors = {
      up: cssVar('--up', '#f2555f'),
      down: cssVar('--down', '#2fbf71'),
      accent: cssVar('--accent', '#4c8dff'),
      text: cssVar('--text', '#e8eef6'),
      muted: cssVar('--muted', '#8b9aab'),
      line: cssVar('--line', '#1e2a38')
    };

    var canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(S, S);

    var font = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

    // 背景
    ctx.fillStyle = '#0d141d';
    ctx.fillRect(0, 0, W, H);
    var glow = ctx.createRadialGradient(W * 0.85, -40, 40, W * 0.85, -40, 520);
    glow.addColorStop(0, 'rgba(76, 141, 255, 0.14)');
    glow.addColorStop(1, 'rgba(76, 141, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, 320);

    // 品牌行
    ctx.fillStyle = colors.accent;
    roundRect(ctx, 48, 44, 40, 40, 11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 20px ' + font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('股', 68, 65);
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    ctx.font = '650 20px ' + font;
    ctx.fillText('股迹 · 信号卡', 100, 58);
    ctx.fillStyle = colors.muted;
    ctx.font = '12px ' + font;
    ctx.fillText('规则生成 · 不构成投资建议 · 仅供课程学习', 100, 80);
    ctx.textAlign = 'right';
    ctx.fillText(payload.periodText || '日K', W - 48, 64);

    // 标的与价格
    ctx.textAlign = 'left';
    ctx.fillStyle = colors.text;
    ctx.font = '650 30px ' + font;
    ctx.fillText(stock.name, 48, 130);
    var nameWidth = ctx.measureText(stock.name).width;
    ctx.fillStyle = colors.muted;
    ctx.font = '14px ' + font;
    ctx.fillText(stock.symbol + ' · ' + (payload.periodText || '日K') + ' · 规则计算', 48 + nameWidth + 14, 132);

    var price = quote && quote.price != null ? Number(quote.price) : null;
    var pct = quote && quote.pct != null ? Number(quote.pct) : null;
    var tone = pct == null ? 'flat' : pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    ctx.fillStyle = toneColor(tone, colors);
    ctx.font = '650 44px ' + font;
    ctx.fillText(price == null ? '--' : price.toFixed(2), 48, 186);
    var priceWidth = ctx.measureText(price == null ? '--' : price.toFixed(2)).width;
    ctx.font = '650 20px ' + font;
    ctx.fillText(pct == null ? '--' : (pct > 0 ? '+' : '') + pct.toFixed(2) + '%', 48 + priceWidth + 16, 190);
    if (quote && quote.change != null) {
      ctx.fillStyle = colors.muted;
      ctx.font = '13px ' + font;
      ctx.fillText('涨跌 ' + (quote.change > 0 ? '+' : '') + Number(quote.change).toFixed(2), 48 + priceWidth + 150, 190);
    }

    // 分隔线
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(48, 226);
    ctx.lineTo(W - 48, 226);
    ctx.stroke();

    // 指标网格 2×5
    var rows = metrics(s, payload.period);
    var colX = [48, W / 2 + 26];
    var colW = W / 2 - 74;
    var rowY0 = 268;
    var rowH = 62;
    rows.forEach(function (item, index) {
      var x = colX[index % 2];
      var y = rowY0 + Math.floor(index / 2) * rowH;
      ctx.textAlign = 'left';
      ctx.fillStyle = colors.muted;
      ctx.font = '12px ' + font;
      ctx.fillText(item.label, x, y);
      ctx.fillStyle = toneColor(item.tone, colors);
      ctx.font = '650 21px ' + font;
      ctx.fillText(String(item.value), x, y + 22);
      var valueWidth = ctx.measureText(String(item.value)).width;
      ctx.fillStyle = colors.muted;
      ctx.font = '11.5px ' + font;
      // 明细放在数值右侧，同一行
      ctx.fillText(String(item.detail || ''), x + valueWidth + 12, y + 22);
      void colW;
    });

    // 摘要
    var summaryY = rowY0 + 5 * rowH + 8;
    ctx.fillStyle = colors.muted;
    ctx.font = '650 13px ' + font;
    ctx.textAlign = 'left';
    ctx.fillText('分析摘要', 48, summaryY);
    ctx.fillStyle = colors.text;
    ctx.font = '13px ' + font;
    var summaryLines = wrapText(ctx, s.summary, W - 96, 3);
    summaryLines.forEach(function (line, index) {
      ctx.fillText(line, 48, summaryY + 22 + index * 20);
    });

    // 页脚
    ctx.fillStyle = colors.muted;
    ctx.font = '12px ' + font;
    ctx.strokeStyle = colors.line;
    ctx.beginPath();
    ctx.moveTo(48, H - 62);
    ctx.lineTo(W - 48, H - 62);
    ctx.stroke();
    ctx.fillText('数据截至 ' + (payload.snapshotDate || '--') + ' · 腾讯证券公开行情 · 前复权日线',
      48, H - 34);
    ctx.textAlign = 'right';
    ctx.fillText('股迹 v0.5 · guji', W - 48, H - 34);

    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function download(canvas, filename) {
    if (!canvas) return;
    var link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename || 'guji-signal-card.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  window.ShareCard = { build: build, download: download };
})();
