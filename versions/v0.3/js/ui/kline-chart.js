(function () {
  'use strict';

  var MA_COLORS = {
    5: '#e7b04b',
    10: '#d977ff',
    20: '#4c8dff',
    30: '#ff9f43',
    40: '#2fbf71',
    60: '#f2555f',
    120: '#00c2d1',
    250: '#b0b8c4'
  };

  var SUB_LABELS = {
    volume: '成交量',
    macd: 'MACD(12,26,9)',
    kdj: 'KDJ(9,3,3)',
    rsi: 'RSI(6,12,24)'
  };

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatVolume(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '--';
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(2) + ' 万手';
    return n.toFixed(0) + ' 手';
  }

  function formatPrice(value) {
    return finite(value) ? Number(value).toFixed(2) : '--';
  }

  function formatSigned(value, digits) {
    if (!finite(value)) return '--';
    var n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(digits == null ? 2 : digits);
  }

  function dateLabel(dateStr, period) {
    if (!dateStr) return '';
    if (period === 'month') return dateStr.slice(0, 7);
    return dateStr.slice(5);
  }

  function periodWord(period) {
    return period === 'week' ? '周' : period === 'month' ? '月' : '日';
  }

  /**
   * 计算主图 + 副图的矩形。副图最多 2 个。
   */
  function layout(canvas, subCount) {
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    var pad = { left: 54, right: 14, top: 16, bottom: 24 };
    var plotWidth = Math.max(1, width - pad.left - pad.right);
    var plotHeight = Math.max(1, height - pad.top - pad.bottom);
    var count = clamp(subCount || 0, 0, 2);
    var gap = 8;
    var subHeight = count === 0 ? 0 : count === 1 ? plotHeight * 0.26 : plotHeight * 0.2;
    var mainHeight = plotHeight - count * subHeight - count * gap;
    var main = { x: pad.left, y: pad.top, w: plotWidth, h: Math.max(40, mainHeight) };
    var subs = [];
    var cursorY = main.y + main.h + gap;
    for (var i = 0; i < count; i += 1) {
      subs.push({ x: pad.left, y: cursorY, w: plotWidth, h: Math.max(36, subHeight) });
      cursorY += subHeight + gap;
    }
    return { width: width, height: height, pad: pad, main: main, subs: subs };
  }

  function visibleStart(bars, range) {
    if (!bars || bars.length === 0) return 0;
    if (!range || range <= 0) return 0;
    return Math.max(0, bars.length - range);
  }

  function mainRange(bars, series, config, start) {
    var min = Infinity;
    var max = -Infinity;
    for (var i = start; i < bars.length; i += 1) {
      var bar = bars[i];
      if (!bar) continue;
      if (finite(bar.low)) min = Math.min(min, Number(bar.low));
      if (finite(bar.high)) max = Math.max(max, Number(bar.high));
    }
    (config.ma || []).forEach(function (period) {
      var arr = series.ma && series.ma[period];
      if (!arr) return;
      for (var i = start; i < arr.length; i += 1) {
        if (finite(arr[i])) {
          min = Math.min(min, Number(arr[i]));
          max = Math.max(max, Number(arr[i]));
        }
      }
    });
    if (config.boll && series.boll) {
      ['upper', 'lower'].forEach(function (key) {
        var arr = series.boll[key];
        if (!arr) return;
        for (var i = start; i < arr.length; i += 1) {
          if (finite(arr[i])) {
            min = Math.min(min, Number(arr[i]));
            max = Math.max(max, Number(arr[i]));
          }
        }
      });
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 1;
    }
    return { min: min, max: max };
  }

  function drawLine(ctx, samples, start, end, xAt, yAt, color, width, dash) {
    if (!samples) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    var started = false;
    ctx.beginPath();
    for (var i = start; i < end; i += 1) {
      if (!finite(samples[i])) {
        if (started) {
          ctx.stroke();
          started = false;
          ctx.beginPath();
        }
        continue;
      }
      var x = xAt(i - start);
      var y = yAt(Number(samples[i]));
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (started) ctx.stroke();
    ctx.restore();
  }

  function drawGrid(ctx, rect, lines, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (var i = 0; i <= lines; i += 1) {
      var y = rect.y + rect.h * i / lines;
      ctx.beginPath();
      ctx.moveTo(rect.x, y);
      ctx.lineTo(rect.x + rect.w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(drawCanvas, payload) {
    if (!drawCanvas) return false;
    var bars = payload && payload.bars ? payload.bars : [];
    if (!bars.length) return false;
    var width = drawCanvas.clientWidth;
    var height = drawCanvas.clientHeight;
    if (!width || !height) return false;

    var config = payload.config || {};
    var series = payload.series || {};
    var colors = payload.colors || {};
    var up = colors.up || '#f2555f';
    var down = colors.down || '#2fbf71';
    var text = colors.text || '#8b9aab';
    var grid = colors.grid || 'rgba(139, 154, 171, 0.14)';
    var accent = colors.accent || '#4c8dff';
    var subplots = (config.subplots || []).slice(0, 2);
    var start = visibleStart(bars, payload.range);
    var count = bars.length - start;
    if (count <= 0) return false;

    var dpr = window.devicePixelRatio || 1;
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    if (drawCanvas.width !== pixelWidth || drawCanvas.height !== pixelHeight) {
      drawCanvas.width = pixelWidth;
      drawCanvas.height = pixelHeight;
    }
    var ctx = drawCanvas.getContext('2d');
    if (!ctx) return false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';

    var L = layout(drawCanvas, subplots.length);
    var priceRange = mainRange(bars, series, config, start);
    var logScale = !!config.log;
    var pMin = priceRange.min;
    var pMax = priceRange.max;
    if (logScale) {
      pMin = Math.max(pMin, 0.01);
      pMax = Math.max(pMax, pMin * 1.01);
    }
    var tMin;
    var tMax;
    if (logScale) {
      pMin = Math.max(pMin, 0.01);
      pMax = Math.max(pMax, pMin * 1.01);
      tMin = Math.log(pMin);
      tMax = Math.log(pMax);
      var logPad = (tMax - tMin) * 0.05;
      tMin -= logPad;
      tMax += logPad;
    } else {
      var priceSpan = pMax - pMin;
      var pricePad = priceSpan > 0 ? priceSpan * 0.06 : Math.max(Math.abs(pMax) * 0.02, 0.01);
      tMin = pMin - pricePad;
      tMax = pMax + pricePad;
    }

    function xAt(index) {
      return L.main.x + (index + 0.5) / count * L.main.w;
    }

    function priceY(value) {
      var number = Number(value);
      var transformed = logScale ? Math.log(Math.max(number, 0.01)) : number;
      return L.main.y + (tMax - transformed) / (tMax - tMin) * L.main.h;
    }

    drawGrid(ctx, L.main, 4, grid);

    // 价格刻度
    ctx.fillStyle = text;
    ctx.textAlign = 'right';
    for (var g = 0; g <= 4; g += 1) {
      var tick = tMax - (tMax - tMin) * g / 4;
      var price = logScale ? Math.exp(tick) : tick;
      var label = logScale
        ? (price >= 1000 ? price.toFixed(0) : price >= 10 ? price.toFixed(1) : price.toFixed(2))
        : price.toFixed(2);
      ctx.fillText(label, L.main.x - 7, L.main.y + L.main.h * g / 4);
    }

    var candleWidth = L.main.w / count;
    var bodyWidth = Math.max(1, Math.min(9, candleWidth * 0.62));

    // BOLL 带
    if (config.boll && series.boll && series.boll.upper && series.boll.lower) {
      var upper = series.boll.upper;
      var lower = series.boll.lower;
      var hasBand = false;
      ctx.save();
      ctx.beginPath();
      for (var u = start; u < bars.length; u += 1) {
        if (!finite(upper[u]) || !finite(lower[u])) continue;
        var ux = xAt(u - start);
        if (!hasBand) {
          ctx.moveTo(ux, priceY(Number(upper[u])));
          hasBand = true;
        } else {
          ctx.lineTo(ux, priceY(Number(upper[u])));
        }
      }
      for (var l = bars.length - 1; l >= start; l -= 1) {
        if (!finite(upper[l]) || !finite(lower[l])) continue;
        ctx.lineTo(xAt(l - start), priceY(Number(lower[l])));
      }
      if (hasBand) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(76, 141, 255, 0.055)';
        ctx.fill();
      }
      ctx.restore();
      drawLine(ctx, upper, start, bars.length, xAt, priceY, 'rgba(122, 167, 255, 0.72)', 1, [4, 3]);
      drawLine(ctx, lower, start, bars.length, xAt, priceY, 'rgba(122, 167, 255, 0.72)', 1, [4, 3]);
      drawLine(ctx, series.boll.mid, start, bars.length, xAt, priceY, 'rgba(122, 167, 255, 0.42)', 1, [2, 3]);
    }

    // K 线
    for (var i = start; i < bars.length; i += 1) {
      var bar = bars[i];
      if (!bar) continue;
      var x = xAt(i - start);
      var color = Number(bar.close) >= Number(bar.open) ? up : down;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceY(Number(bar.high)));
      ctx.lineTo(x, priceY(Number(bar.low)));
      ctx.stroke();

      var bodyTop = priceY(Math.max(Number(bar.open), Number(bar.close)));
      var bodyBottom = priceY(Math.min(Number(bar.open), Number(bar.close)));
      var bodyHeight = Math.max(1, bodyBottom - bodyTop);
      ctx.fillStyle = color;
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
    }

    // 均线
    (config.ma || []).forEach(function (period) {
      drawLine(ctx, series.ma && series.ma[period], start, bars.length, xAt, priceY,
        MA_COLORS[period] || accent, 1.2, null);
    });

    // 十字光标
    var hover = payload.hoverIndex;
    if (hover != null && hover >= start && hover < bars.length) {
      var hx = xAt(hover - start);
      ctx.save();
      ctx.strokeStyle = 'rgba(232, 238, 246, 0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, L.main.y);
      ctx.lineTo(hx, L.main.y + L.main.h);
      ctx.stroke();
      ctx.restore();

      var closeY = priceY(Number(bars[hover].close));
      ctx.beginPath();
      ctx.fillStyle = '#e8eef6';
      ctx.arc(hx, closeY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 日期刻度
    ctx.fillStyle = text;
    ctx.textAlign = 'center';
    var tickCount = Math.min(5, count);
    for (var t = 0; t < tickCount; t += 1) {
      var index = tickCount === 1 ? 0 : Math.round(t * (count - 1) / (tickCount - 1));
      var labelX = xAt(index);
      var label = dateLabel(bars[start + index].date, payload.period);
      if (label) ctx.fillText(label, clamp(labelX, L.main.x + 18, L.main.x + L.main.w - 18), height - 9);
    }

    // 未收盘提示
    var lastBar = bars[bars.length - 1];
    if (lastBar && lastBar.partial) {
      ctx.fillStyle = '#e7b04b';
      ctx.textAlign = 'right';
      ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(periodWord(payload.period) + '线未收盘', L.main.x + L.main.w, L.main.y + 10);
    }

    // 副图
    subplots.forEach(function (kind, index) {
      var rect = L.subs[index];
      if (!rect) return;
      drawGrid(ctx, rect, 2, grid);
      ctx.fillStyle = text;
      ctx.textAlign = 'left';
      ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(SUB_LABELS[kind] || kind, rect.x + 4, rect.y + 8);

      if (kind === 'volume') {
        var volumes = bars.map(function (bar) { return Number(bar.volume); });
        var vmax = 0;
        for (var v = start; v < volumes.length; v += 1) {
          if (finite(volumes[v])) vmax = Math.max(vmax, volumes[v]);
        }
        (series.volumeMA || {}) && [5, 10].forEach(function (period) {
          var arr = series.volumeMA && series.volumeMA[period];
          if (!arr) return;
          for (var k = start; k < arr.length; k += 1) {
            if (finite(arr[k])) vmax = Math.max(vmax, Number(arr[k]));
          }
        });
        vmax = vmax > 0 ? vmax * 1.12 : 1;
        function vY(value) {
          return rect.y + rect.h - Number(value) / vmax * rect.h;
        }
        for (var b = start; b < bars.length; b += 1) {
          var vb = bars[b];
          if (!finite(vb.volume)) continue;
          var vy = vY(vb.volume);
          ctx.fillStyle = Number(vb.close) >= Number(vb.open)
            ? 'rgba(242, 85, 95, 0.55)'
            : 'rgba(47, 191, 113, 0.55)';
          ctx.fillRect(xAt(b - start) - bodyWidth / 2, vy, bodyWidth, rect.y + rect.h - vy);
        }
        drawLine(ctx, series.volumeMA && series.volumeMA[5], start, bars.length, xAt, vY, '#e7b04b', 1, null);
        drawLine(ctx, series.volumeMA && series.volumeMA[10], start, bars.length, xAt, vY, '#4c8dff', 1, null);
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText(formatVolume(vmax), rect.x - 7, rect.y + 8);
        return;
      }

      if (kind === 'macd' && series.macd) {
        var dif = series.macd.dif;
        var dea = series.macd.dea;
        var hist = series.macd.hist;
        var mmin = 0;
        var mmax = 0;
        for (var m = start; m < bars.length; m += 1) {
          [dif && dif[m], dea && dea[m], hist && hist[m]].forEach(function (value) {
            if (finite(value)) {
              mmin = Math.min(mmin, Number(value));
              mmax = Math.max(mmax, Number(value));
            }
          });
        }
        if (mmin === mmax) {
          mmin = -1;
          mmax = 1;
        }
        var mp = (mmax - mmin) * 0.1;
        mmin -= mp;
        mmax += mp;
        function mY(value) {
          return rect.y + (mmax - Number(value)) / (mmax - mmin) * rect.h;
        }
        var zeroY = mY(0);
        ctx.strokeStyle = 'rgba(139, 154, 171, 0.3)';
        ctx.beginPath();
        ctx.moveTo(rect.x, zeroY);
        ctx.lineTo(rect.x + rect.w, zeroY);
        ctx.stroke();
        for (var h = start; h < bars.length; h += 1) {
          if (!finite(hist[h])) continue;
          var hy = mY(hist[h]);
          ctx.fillStyle = Number(hist[h]) >= 0
            ? 'rgba(242, 85, 95, 0.62)'
            : 'rgba(47, 191, 113, 0.62)';
          var hx = xAt(h - start);
          ctx.fillRect(hx - bodyWidth / 2, Math.min(hy, zeroY), bodyWidth, Math.max(1, Math.abs(hy - zeroY)));
        }
        drawLine(ctx, dif, start, bars.length, xAt, mY, '#e7b04b', 1.2, null);
        drawLine(ctx, dea, start, bars.length, xAt, mY, '#4c8dff', 1.2, null);
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText(mmax.toFixed(2), rect.x - 7, rect.y + 8);
        ctx.fillText(mmin.toFixed(2), rect.x - 7, rect.y + rect.h - 6);
        return;
      }

      if (kind === 'kdj' && series.kdj) {
        var kline = series.kdj.k;
        var dline = series.kdj.d;
        var jline = series.kdj.j;
        var kmin = 0;
        var kmax = 100;
        for (var q = start; q < bars.length; q += 1) {
          [kline && kline[q], dline && dline[q], jline && jline[q]].forEach(function (value) {
            if (finite(value)) {
              kmin = Math.min(kmin, Number(value));
              kmax = Math.max(kmax, Number(value));
            }
          });
        }
        var kp = (kmax - kmin) * 0.08 || 1;
        kmin -= kp;
        kmax += kp;
        function kY(value) {
          return rect.y + (kmax - Number(value)) / (kmax - kmin) * rect.h;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(231, 176, 75, 0.35)';
        ctx.setLineDash([3, 3]);
        [20, 80].forEach(function (level) {
          ctx.beginPath();
          ctx.moveTo(rect.x, kY(level));
          ctx.lineTo(rect.x + rect.w, kY(level));
          ctx.stroke();
        });
        ctx.restore();
        drawLine(ctx, kline, start, bars.length, xAt, kY, '#e7b04b', 1.1, null);
        drawLine(ctx, dline, start, bars.length, xAt, kY, '#4c8dff', 1.1, null);
        drawLine(ctx, jline, start, bars.length, xAt, kY, '#d977ff', 1.1, null);
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText('80', rect.x - 7, kY(80));
        ctx.fillText('20', rect.x - 7, kY(20));
        return;
      }

      if (kind === 'rsi' && series.rsi) {
        function rY(value) {
          return rect.y + (100 - Number(value)) / 100 * rect.h;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(231, 176, 75, 0.35)';
        ctx.setLineDash([3, 3]);
        [30, 70].forEach(function (level) {
          ctx.beginPath();
          ctx.moveTo(rect.x, rY(level));
          ctx.lineTo(rect.x + rect.w, rY(level));
          ctx.stroke();
        });
        ctx.restore();
        drawLine(ctx, series.rsi[6], start, bars.length, xAt, rY, '#e7b04b', 1.1, null);
        drawLine(ctx, series.rsi[12], start, bars.length, xAt, rY, '#4c8dff', 1.1, null);
        drawLine(ctx, series.rsi[24], start, bars.length, xAt, rY, '#d977ff', 1.1, null);
        ctx.fillStyle = text;
        ctx.textAlign = 'right';
        ctx.fillText('70', rect.x - 7, rY(70));
        ctx.fillText('30', rect.x - 7, rY(30));
      }
    });

    return true;
  }

  function hitIndex(canvas, payload, clientX) {
    if (!canvas || !payload || !payload.bars || !payload.bars.length) return null;
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left;
    var L = layout(canvas, (payload.config && payload.config.subplots ? payload.config.subplots.length : 0));
    if (x < L.main.x || x > L.main.x + L.main.w) return null;
    var start = visibleStart(payload.bars, payload.range);
    var count = payload.bars.length - start;
    if (count <= 0) return null;
    var index = Math.floor((x - L.main.x) / L.main.w * count);
    index = clamp(index, 0, count - 1);
    return start + index;
  }

  function tooltipHtml(payload, index) {
    var bars = payload && payload.bars ? payload.bars : [];
    var bar = bars[index];
    if (!bar) return '';
    var series = payload.series || {};
    var config = payload.config || {};
    var prev = bars[index - 1];
    var change = prev && finite(prev.close) ? (Number(bar.close) / Number(prev.close) - 1) * 100 : null;
    var range = bar.startDate && bar.endDate && bar.startDate !== bar.endDate
      ? bar.startDate + ' ~ ' + bar.endDate
      : bar.date;
    var tone = Number(bar.close) >= Number(bar.open) ? 'up' : 'down';
    var html = '<div class="kline-tip-head"><strong>' + range + '</strong>' +
      '<span class="' + tone + '">' + formatPrice(bar.close) +
      (change == null ? '' : ' · ' + formatSigned(change) + '%') + '</span></div>';
    html += '<div class="kline-tip-grid">';
    html += '<span>开</span><b>' + formatPrice(bar.open) + '</b>';
    html += '<span>高</span><b>' + formatPrice(bar.high) + '</b>';
    html += '<span>低</span><b>' + formatPrice(bar.low) + '</b>';
    html += '<span>收</span><b>' + formatPrice(bar.close) + '</b>';
    html += '<span>量</span><b>' + formatVolume(bar.volume) + '</b>';
    html += '</div>';

    var rows = [];
    (config.ma || []).forEach(function (period) {
      var value = series.ma && series.ma[period] ? series.ma[period][index] : null;
      if (finite(value)) rows.push(['MA' + period, formatPrice(value)]);
    });
    if (config.boll && series.boll) {
      if (finite(series.boll.upper[index])) rows.push(['BOLL上', formatPrice(series.boll.upper[index])]);
      if (finite(series.boll.mid[index])) rows.push(['BOLL中', formatPrice(series.boll.mid[index])]);
      if (finite(series.boll.lower[index])) rows.push(['BOLL下', formatPrice(series.boll.lower[index])]);
    }
    (config.subplots || []).forEach(function (kind) {
      if (kind === 'macd' && series.macd) {
        rows.push(['DIF', formatSigned(series.macd.dif[index], 3)]);
        rows.push(['DEA', formatSigned(series.macd.dea[index], 3)]);
        rows.push(['MACD柱', formatSigned(series.macd.hist[index], 3)]);
      } else if (kind === 'kdj' && series.kdj) {
        rows.push(['K', formatSigned(series.kdj.k[index], 2)]);
        rows.push(['D', formatSigned(series.kdj.d[index], 2)]);
        rows.push(['J', formatSigned(series.kdj.j[index], 2)]);
      } else if (kind === 'rsi' && series.rsi) {
        rows.push(['RSI6', formatSigned(series.rsi[6][index], 2)]);
        rows.push(['RSI12', formatSigned(series.rsi[12][index], 2)]);
        rows.push(['RSI24', formatSigned(series.rsi[24][index], 2)]);
      }
    });
    if (rows.length) {
      html += '<div class="kline-tip-grid">';
      rows.forEach(function (row) {
        html += '<span>' + row[0] + '</span><b>' + row[1] + '</b>';
      });
      html += '</div>';
    }
    return html;
  }

  window.KlineChart = {
    MA_COLORS: MA_COLORS,
    layout: layout,
    draw: draw,
    hitIndex: hitIndex,
    tooltipHtml: tooltipHtml,
    visibleStart: visibleStart,
    formatVolume: formatVolume
  };
})();
