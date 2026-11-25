(function () {
  'use strict';

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function emptyLike(values) {
    var out = [];
    for (var i = 0; i < (values ? values.length : 0); i += 1) out.push(null);
    return out;
  }

  /**
   * 简单移动平均。不足 period 根或窗口内有缺失值时返回 null。
   * 不修改入参。
   */
  function sma(values, period) {
    var out = emptyLike(values);
    if (!Array.isArray(values) || !(period > 0)) return out;
    for (var i = period - 1; i < values.length; i += 1) {
      var sum = 0;
      var ok = true;
      for (var j = i - period + 1; j <= i; j += 1) {
        if (!finite(values[j])) {
          ok = false;
          break;
        }
        sum += Number(values[j]);
      }
      if (ok) out[i] = sum / period;
    }
    return out;
  }

  /**
   * 指数移动平均。alpha = 2 / (period + 1)，首值用第一根有效值。
   * 遇到缺失值重置，避免把缺口当成 0。
   */
  function ema(values, period) {
    var out = emptyLike(values);
    if (!Array.isArray(values) || !(period > 0)) return out;
    var alpha = 2 / (period + 1);
    var prev = null;
    for (var i = 0; i < values.length; i += 1) {
      if (!finite(values[i])) {
        prev = null;
        continue;
      }
      var value = Number(values[i]);
      prev = prev == null ? value : alpha * value + (1 - alpha) * prev;
      out[i] = prev;
    }
    return out;
  }

  /**
   * MACD(12, 26, 9)。
   * DIF = EMA12 - EMA26；DEA = EMA9(DIF)；柱 = 2 * (DIF - DEA)（国内常用口径）。
   * DIF 从第 26 根、DEA/柱从第 34 根开始有值。
   */
  function macd(closes, fastPeriod, slowPeriod, signalPeriod) {
    var fast = fastPeriod || 12;
    var slow = slowPeriod || 26;
    var signal = signalPeriod || 9;
    var n = closes ? closes.length : 0;
    var dif = emptyLike(closes);
    var dea = emptyLike(closes);
    var hist = emptyLike(closes);
    if (!Array.isArray(closes) || n === 0) {
      return { dif: dif, dea: dea, hist: hist };
    }

    var fastEma = ema(closes, fast);
    var slowEma = ema(closes, slow);
    for (var i = 0; i < n; i += 1) {
      if (i >= slow - 1 && fastEma[i] != null && slowEma[i] != null) {
        dif[i] = fastEma[i] - slowEma[i];
      }
    }

    var rawDea = ema(dif, signal);
    var firstDea = slow - 1 + signal - 1;
    for (var k = firstDea; k < n; k += 1) {
      if (rawDea[k] != null) {
        dea[k] = rawDea[k];
        hist[k] = 2 * (dif[k] - dea[k]);
      }
    }
    return { dif: dif, dea: dea, hist: hist };
  }

  /**
   * KDJ(9, 3, 3)。bars 为 { high, low, close } 对象数组。
   * RSV = (C - L9) / (H9 - L9) * 100；K/D 用 2/3 前值 + 1/3 新值；J = 3K - 2D。
   * K/D 初值 50；最高等于最低时 RSV 记 0。
   */
  function kdj(bars, nPeriod, kPeriod, dPeriod) {
    var n = nPeriod || 9;
    var kp = kPeriod || 3;
    var dp = dPeriod || 3;
    var length = bars ? bars.length : 0;
    var kOut = emptyLike(bars);
    var dOut = emptyLike(bars);
    var jOut = emptyLike(bars);
    if (!Array.isArray(bars) || length === 0) {
      return { k: kOut, d: dOut, j: jOut };
    }

    var prevK = null;
    var prevD = null;
    for (var i = n - 1; i < length; i += 1) {
      var highest = -Infinity;
      var lowest = Infinity;
      var ok = true;
      for (var j = i - n + 1; j <= i; j += 1) {
        if (!bars[j] || !finite(bars[j].high) || !finite(bars[j].low) || !finite(bars[j].close)) {
          ok = false;
          break;
        }
        highest = Math.max(highest, Number(bars[j].high));
        lowest = Math.min(lowest, Number(bars[j].low));
      }
      if (!ok) {
        kOut[i] = null;
        dOut[i] = null;
        jOut[i] = null;
        continue;
      }
      var close = Number(bars[i].close);
      var rsv = highest === lowest ? 0 : (close - lowest) / (highest - lowest) * 100;
      var k = prevK == null ? 50 : ((kp - 1) / kp) * prevK + (1 / kp) * rsv;
      var d = prevD == null ? 50 : ((dp - 1) / dp) * prevD + (1 / dp) * k;
      prevK = k;
      prevD = d;
      kOut[i] = k;
      dOut[i] = d;
      jOut[i] = 3 * k - 2 * d;
    }
    return { k: kOut, d: dOut, j: jOut };
  }

  function rsiValue(avgGain, avgLoss) {
    if (avgGain === 0 && avgLoss === 0) return 50;
    if (avgLoss === 0) return 100;
    return 100 * avgGain / (avgGain + avgLoss);
  }

  /**
   * RSI，Wilder 平滑。默认 14；全平盘记 50，只涨记 100。
   */
  function rsi(closes, period) {
    var p = period || 14;
    var n = closes ? closes.length : 0;
    var out = emptyLike(closes);
    if (!Array.isArray(closes) || n <= p) return out;

    var gain = 0;
    var loss = 0;
    for (var i = 1; i <= p; i += 1) {
      if (!finite(closes[i]) || !finite(closes[i - 1])) return out;
      var diff = Number(closes[i]) - Number(closes[i - 1]);
      if (diff > 0) gain += diff;
      else loss -= diff;
    }
    var avgGain = gain / p;
    var avgLoss = loss / p;
    out[p] = rsiValue(avgGain, avgLoss);

    for (var k = p + 1; k < n; k += 1) {
      if (!finite(closes[k]) || !finite(closes[k - 1])) {
        out[k] = null;
        continue;
      }
      var change = Number(closes[k]) - Number(closes[k - 1]);
      var up = change > 0 ? change : 0;
      var down = change < 0 ? -change : 0;
      avgGain = (avgGain * (p - 1) + up) / p;
      avgLoss = (avgLoss * (p - 1) + down) / p;
      out[k] = rsiValue(avgGain, avgLoss);
    }
    return out;
  }

  /**
   * BOLL(20, 2)：中轨 SMA20，上下轨 ±2 倍总体标准差。
   * 标准差为 0 时三线重合，避免除零。
   */
  function boll(closes, period, mult) {
    var p = period || 20;
    var m = mult == null ? 2 : mult;
    var n = closes ? closes.length : 0;
    var mid = emptyLike(closes);
    var upper = emptyLike(closes);
    var lower = emptyLike(closes);
    if (!Array.isArray(closes) || n === 0) {
      return { mid: mid, upper: upper, lower: lower };
    }

    for (var i = p - 1; i < n; i += 1) {
      var sum = 0;
      var ok = true;
      for (var j = i - p + 1; j <= i; j += 1) {
        if (!finite(closes[j])) {
          ok = false;
          break;
        }
        sum += Number(closes[j]);
      }
      if (!ok) continue;
      var mean = sum / p;
      var variance = 0;
      for (var k = i - p + 1; k <= i; k += 1) {
        var delta = Number(closes[k]) - mean;
        variance += delta * delta;
      }
      var std = Math.sqrt(variance / p);
      mid[i] = mean;
      upper[i] = mean + m * std;
      lower[i] = mean - m * std;
    }
    return { mid: mid, upper: upper, lower: lower };
  }

  function volumeMA(volumes, period) {
    return sma(volumes, period);
  }

  function mean(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    var sum = 0;
    var count = 0;
    for (var i = 0; i < values.length; i += 1) {
      if (finite(values[i])) {
        sum += Number(values[i]);
        count += 1;
      }
    }
    return count === 0 ? null : sum / count;
  }

  /**
   * 标准差。sample 为 true 时按 n-1 计算。
   */
  function stdev(values, sample) {
    var avg = mean(values);
    if (avg == null) return null;
    var sum = 0;
    var count = 0;
    for (var i = 0; i < values.length; i += 1) {
      if (!finite(values[i])) continue;
      var delta = Number(values[i]) - avg;
      sum += delta * delta;
      count += 1;
    }
    var denom = sample ? count - 1 : count;
    if (denom <= 0) return null;
    return Math.sqrt(sum / denom);
  }

  /**
   * 最大回撤，返回负数（如 -0.25 表示 -25%）。样本不足返回 null。
   */
  function maxDrawdown(values) {
    if (!Array.isArray(values) || values.length < 2) return null;
    var peak = -Infinity;
    var worst = 0;
    var seen = false;
    for (var i = 0; i < values.length; i += 1) {
      if (!finite(values[i])) continue;
      var value = Number(values[i]);
      if (value <= 0) continue;
      seen = true;
      if (value > peak) peak = value;
      var drawdown = value / peak - 1;
      if (drawdown < worst) worst = drawdown;
    }
    return seen ? worst : null;
  }

  /**
   * 年化波动率。returns 为日收益率小数，默认 252 个交易日。
   */
  function annualizedVolatility(returns, periodsPerYear) {
    if (!Array.isArray(returns)) return null;
    var clean = returns.filter(finite);
    if (clean.length < 2) return null;
    var sd = stdev(clean, true);
    if (sd == null) return null;
    return sd * Math.sqrt(periodsPerYear || 252);
  }

  function lastValid(series) {
    if (!Array.isArray(series)) return null;
    for (var i = series.length - 1; i >= 0; i -= 1) {
      if (series[i] != null && Number.isFinite(Number(series[i]))) return Number(series[i]);
    }
    return null;
  }

  window.Indicators = {
    sma: sma,
    ema: ema,
    macd: macd,
    kdj: kdj,
    rsi: rsi,
    boll: boll,
    volumeMA: volumeMA,
    mean: mean,
    stdev: stdev,
    maxDrawdown: maxDrawdown,
    annualizedVolatility: annualizedVolatility,
    lastValid: lastValid
  };
})();
