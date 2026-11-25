(function () {
  'use strict';

  var SESSION_MINUTES = 241;

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  /**
   * 把 HHMM 映射到 09:30—15:00 的交易分钟轴，午休不计入横轴。
   */
  function sessionPosition(hhmm) {
    var n = Number(hhmm);
    if (!Number.isFinite(n)) return null;
    var hh = Math.floor(n / 100);
    var mm = n % 100;
    var minutes = hh * 60 + mm;
    if (n >= 930 && n <= 1130) return minutes - (9 * 60 + 30);
    if (n >= 1300 && n <= 1500) return 121 + (minutes - 13 * 60);
    return null;
  }

  function draw(canvas, series, options) {
    if (!canvas) return false;
    var points = series && Array.isArray(series.points) ? series.points : [];
    var width = canvas.clientWidth;
    var height = canvas.clientHeight;
    if (!width || !height || points.length === 0) return false;

    var dpr = window.devicePixelRatio || 1;
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    var ctx = canvas.getContext('2d');
    if (!ctx) return false;

    var opts = options || {};
    var up = opts.up || '#f2555f';
    var down = opts.down || '#2fbf71';
    var accent = opts.accent || '#4c8dff';
    var grid = opts.grid || 'rgba(139, 154, 171, 0.14)';
    var text = opts.text || '#8b9aab';
    var prevClose = finite(series.prevClose) ? Number(series.prevClose) : null;
    var prices = points.map(function (point) { return Number(point.price); })
      .filter(function (value) { return Number.isFinite(value); });
    if (prices.length === 0) return false;

    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    if (prevClose != null) {
      min = Math.min(min, prevClose);
      max = Math.max(max, prevClose);
    }
    if (max === min) {
      min -= 0.01;
      max += 0.01;
    }
    var padding = Math.max((max - min) * 0.08, 0.01);
    min -= padding;
    max += padding;

    var plot = {
      left: 48,
      right: 14,
      top: 14,
      bottom: 24
    };
    plot.width = Math.max(1, width - plot.left - plot.right);
    plot.height = Math.max(1, height - plot.top - plot.bottom);

    function y(value) {
      return plot.top + (max - value) / (max - min) * plot.height;
    }

    function x(point, index) {
      var pos = sessionPosition(point.hhmm);
      if (pos == null) pos = index;
      return plot.left + Math.max(0, Math.min(SESSION_MINUTES, pos)) / SESSION_MINUTES * plot.width;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '10px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';

    // 横向网格与价格刻度
    ctx.strokeStyle = grid;
    ctx.fillStyle = text;
    ctx.lineWidth = 1;
    for (var i = 0; i <= 4; i += 1) {
      var value = max - (max - min) * i / 4;
      var lineY = y(value);
      ctx.beginPath();
      ctx.moveTo(plot.left, lineY);
      ctx.lineTo(width - plot.right, lineY);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(value.toFixed(2), plot.left - 7, lineY);
    }

    // 昨收基准线
    if (prevClose != null) {
      var baseY = y(prevClose);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(231, 176, 75, 0.65)';
      ctx.beginPath();
      ctx.moveTo(plot.left, baseY);
      ctx.lineTo(width - plot.right, baseY);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#e7b04b';
      ctx.textAlign = 'right';
      ctx.fillText('昨收 ' + prevClose.toFixed(2), width - plot.right, baseY - 8);
    }

    var last = points[points.length - 1].price;
    var lineColor = prevClose == null ? accent : (last > prevClose ? up : last < prevClose ? down : text);
    var coords = points.map(function (point, index) {
      return { x: x(point, index), y: y(Number(point.price)) };
    });

    // 面积填充
    var gradient = ctx.createLinearGradient(0, plot.top, 0, plot.top + plot.height);
    gradient.addColorStop(0, lineColor + '33');
    gradient.addColorStop(1, lineColor + '00');
    ctx.beginPath();
    ctx.moveTo(coords[0].x, plot.top + plot.height);
    coords.forEach(function (point) { ctx.lineTo(point.x, point.y); });
    ctx.lineTo(coords[coords.length - 1].x, plot.top + plot.height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // 分时线
    ctx.beginPath();
    coords.forEach(function (point, index) {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 最新点
    var lastPoint = coords[coords.length - 1];
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();

    // 时间刻度
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.fillText('09:30', plot.left, height - 10);
    ctx.textAlign = 'center';
    ctx.fillText('11:30', plot.left + plot.width * (120 / SESSION_MINUTES), height - 10);
    ctx.textAlign = 'right';
    ctx.fillText('15:00', width - plot.right, height - 10);

    return true;
  }

  window.IntradayChart = {
    SESSION_MINUTES: SESSION_MINUTES,
    sessionPosition: sessionPosition,
    draw: draw
  };
})();
