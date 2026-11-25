(function () {
  'use strict';

  function finite(value) {
    return value != null && Number.isFinite(Number(value));
  }

  function sigmoid(z) {
    if (z >= 0) {
      var e = Math.exp(-z);
      return 1 / (1 + e);
    }
    var e2 = Math.exp(z);
    return e2 / (1 + e2);
  }

  function stdev(values) {
    return window.Indicators.stdev(values, true);
  }

  function mean(values) {
    return window.Indicators.mean(values);
  }

  function nextBusinessDates(lastDate, count) {
    var dates = [];
    var d = new Date(lastDate + 'T00:00:00Z');
    while (dates.length < count) {
      d.setUTCDate(d.getUTCDate() + 1);
      var day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  /**
   * Holt 双指数平滑（对数价格）。网格搜索 alpha/beta，最小化一步 SSE。
   */
  function fitHolt(logValues, alpha, beta) {
    var level = logValues[0];
    var trend = logValues.length > 1 ? logValues[1] - logValues[0] : 0;
    var sse = 0;
    var errors = [];
    for (var i = 1; i < logValues.length; i += 1) {
      var predicted = level + trend;
      var error = logValues[i] - predicted;
      errors.push(error);
      sse += error * error;
      var nextLevel = alpha * logValues[i] + (1 - alpha) * (level + trend);
      var nextTrend = beta * (nextLevel - level) + (1 - beta) * trend;
      level = nextLevel;
      trend = nextTrend;
    }
    return { sse: sse, level: level, trend: trend, errors: errors };
  }

  function bestHolt(logValues) {
    var best = null;
    for (var alpha = 0.1; alpha <= 0.91; alpha += 0.1) {
      for (var beta = 0.01; beta <= 0.31; beta += 0.02) {
        var fit = fitHolt(logValues, alpha, beta);
        if (!best || fit.sse < best.sse) {
          best = { sse: fit.sse, level: fit.level, trend: fit.trend, errors: fit.errors, alpha: alpha, beta: beta };
        }
      }
    }
    return best;
  }

  function holtForecast(closes, lastDate, horizon, trainWindow) {
    var values = closes.slice(Math.max(0, closes.length - (trainWindow || 750)));
    if (values.length < 60) return null;
    var logValues = values.map(function (value) { return Math.log(value); });
    var fit = bestHolt(logValues);
    var sigma = stdev(fit.errors);
    if (!finite(sigma) || sigma <= 0) sigma = 0.0001;
    var dates = nextBusinessDates(lastDate, horizon);
    var current = closes[closes.length - 1];
    var forecast = [];
    for (var h = 1; h <= horizon; h += 1) {
      var logPrice = fit.level + h * fit.trend;
      var band = 1.2816 * sigma * Math.sqrt(h);
      var price = Math.exp(logPrice);
      forecast.push({
        step: h,
        date: dates[h - 1],
        price: price,
        lower: Math.exp(logPrice - band),
        upper: Math.exp(logPrice + band),
        change: (price / current - 1) * 100
      });
    }
    return { forecast: forecast, alpha: fit.alpha, beta: fit.beta, sigma: sigma };
  }

  function holtEvaluation(closes, initialTrain, horizon, trainWindow, alpha, beta) {
    var errors = [];
    var naiveErrors = [];
    var logCloses = closes.map(function (value) { return Math.log(value); });
    for (var t = initialTrain; t + horizon < closes.length; t += 20) {
      var windowValues = logCloses.slice(Math.max(0, t - trainWindow + 1), t + 1);
      if (windowValues.length < 60) continue;
      var fit = fitHolt(windowValues, alpha, beta);
      var predicted = Math.exp(fit.level + horizon * fit.trend);
      var actual = closes[t + horizon];
      errors.push(Math.abs(predicted - actual));
      naiveErrors.push(Math.abs(closes[t] - actual));
    }
    if (!errors.length) return { mae: null, naiveMae: null, samples: 0 };
    return {
      mae: mean(errors),
      naiveMae: mean(naiveErrors),
      samples: errors.length
    };
  }

  function featureAt(closes, volumes, ma20, macdHist, rsi14, vol20, volumeMA20, index) {
    if (index < 26 || index >= closes.length) return null;
    var values = [
      closes[index] / closes[index - 5] - 1,
      closes[index] / closes[index - 20] - 1,
      ma20[index] == null ? null : closes[index] / ma20[index] - 1,
      macdHist[index] == null ? null : macdHist[index] / closes[index],
      vol20[index],
      volumeMA20[index] == null ? null : volumes[index] / volumeMA20[index],
      rsi14[index] == null ? null : rsi14[index] / 100
    ];
    if (!values.every(finite)) return null;
    return values.map(Number);
  }

  function prepare(bars) {
    var closes = bars.map(function (bar) { return Number(bar.close); });
    var volumes = bars.map(function (bar) { return Number(bar.volume); });
    var ma20 = window.Indicators.sma(closes, 20);
    var macd = window.Indicators.macd(closes, 12, 26, 9);
    var rsi14 = window.Indicators.rsi(closes, 14);
    var volumeMA20 = window.Indicators.sma(volumes, 20);
    var returns = [null];
    for (var i = 1; i < closes.length; i += 1) {
      returns.push(closes[i - 1] ? closes[i] / closes[i - 1] - 1 : null);
    }
    var vol20 = new Array(closes.length).fill(null);
    for (var j = 20; j < closes.length; j += 1) {
      var windowReturns = returns.slice(j - 19, j + 1).filter(finite);
      if (windowReturns.length >= 10) {
        var sd = stdev(windowReturns);
        vol20[j] = sd == null ? null : sd * Math.sqrt(252);
      }
    }

    var samples = [];
    for (var k = 26; k < bars.length - 1; k += 1) {
      var x = featureAt(closes, volumes, ma20, macd.hist, rsi14, vol20, volumeMA20, k);
      if (!x) continue;
      samples.push({ x: x, y: closes[k + 1] > closes[k] ? 1 : 0 });
    }
    var lastX = featureAt(closes, volumes, ma20, macd.hist, rsi14, vol20, volumeMA20, bars.length - 1);
    return { samples: samples, lastX: lastX, closes: closes };
  }

  function standardizer(samples) {
    var dims = samples[0].x.length;
    var means = new Array(dims).fill(0);
    var sds = new Array(dims).fill(1);
    for (var d = 0; d < dims; d += 1) {
      var values = samples.map(function (sample) { return sample.x[d]; });
      means[d] = mean(values) || 0;
      var sd = stdev(values);
      sds[d] = sd && sd > 0 ? sd : 1;
    }
    return { means: means, sds: sds };
  }

  function transform(x, stats) {
    return x.map(function (value, index) {
      return (value - stats.means[index]) / stats.sds[index];
    });
  }

  function trainLogistic(samples, stats, options) {
    var opts = options || {};
    var iterations = opts.iterations || 300;
    var learningRate = opts.learningRate || 0.15;
    var l2 = opts.l2 == null ? 0.001 : opts.l2;
    var dims = samples[0].x.length;
    var weights = new Array(dims).fill(0);
    var bias = 0;
    var count = samples.length;
    var xs = samples.map(function (sample) { return transform(sample.x, stats); });
    var ys = samples.map(function (sample) { return sample.y; });

    for (var iter = 0; iter < iterations; iter += 1) {
      var gradW = new Array(dims).fill(0);
      var gradB = 0;
      for (var i = 0; i < count; i += 1) {
        var z = bias;
        for (var d = 0; d < dims; d += 1) z += weights[d] * xs[i][d];
        var error = sigmoid(z) - ys[i];
        gradB += error;
        for (var j = 0; j < dims; j += 1) gradW[j] += error * xs[i][j];
      }
      for (var k = 0; k < dims; k += 1) {
        weights[k] -= learningRate * (gradW[k] / count + l2 * weights[k]);
      }
      bias -= learningRate * gradB / count;
    }
    return { weights: weights, bias: bias };
  }

  function predictProbability(model, x, stats) {
    var z = model.bias;
    for (var i = 0; i < model.weights.length; i += 1) {
      z += model.weights[i] * (x[i] - stats.means[i]) / stats.sds[i];
    }
    return sigmoid(z);
  }

  function auc(pairs) {
    var positives = pairs.filter(function (pair) { return pair.y === 1; }).length;
    var negatives = pairs.length - positives;
    if (positives === 0 || negatives === 0) return null;
    var sorted = pairs.slice().sort(function (a, b) { return a.p - b.p; });
    var ranks = new Array(sorted.length);
    var i = 0;
    while (i < sorted.length) {
      var j = i;
      while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j += 1;
      var rank = (i + j) / 2 + 1;
      for (var k = i; k <= j; k += 1) ranks[k] = rank;
      i = j + 1;
    }
    var positiveRankSum = 0;
    for (var m = 0; m < sorted.length; m += 1) {
      if (sorted[m].y === 1) positiveRankSum += ranks[m];
    }
    return (positiveRankSum - positives * (positives + 1) / 2) / (positives * negatives);
  }

  function evaluate(predictions) {
    var tp = 0;
    var fp = 0;
    var tn = 0;
    var fn = 0;
    predictions.forEach(function (item) {
      var predicted = item.p >= 0.5 ? 1 : 0;
      if (predicted === 1 && item.y === 1) tp += 1;
      else if (predicted === 1 && item.y === 0) fp += 1;
      else if (predicted === 0 && item.y === 0) tn += 1;
      else fn += 1;
    });
    var total = predictions.length;
    var positives = predictions.filter(function (item) { return item.y === 1; }).length;
    var accuracy = total ? (tp + tn) / total : null;
    var precision = tp + fp > 0 ? tp / (tp + fp) : null;
    var recall = tp + fn > 0 ? tp / (tp + fn) : null;
    var baseline = total ? Math.max(positives, total - positives) / total : null;
    return {
      total: total,
      accuracy: accuracy,
      precision: precision,
      recall: recall,
      baseline: baseline,
      auc: auc(predictions),
      confusion: { tp: tp, fp: fp, tn: tn, fn: fn }
    };
  }

  function run(bars, options) {
    var opts = options || {};
    var horizon = opts.horizon || 5;
    var trainWindow = opts.trainWindow || 750;
    var retrainEvery = opts.retrainEvery || 60;
    if (!Array.isArray(bars) || bars.length < 250) {
      throw new Error('至少需要 250 根日线才能做预测/回测');
    }
    var prepared = prepare(bars);
    var samples = prepared.samples;
    if (samples.length < 300 || !prepared.lastX) {
      throw new Error('可用样本不足 300 个，暂时无法做 walk-forward');
    }

    var initialTrain = Math.max(250, Math.floor(samples.length * 0.5));
    if (samples.length - initialTrain < 60) initialTrain = Math.max(250, samples.length - 60);
    var predictions = [];
    var model = null;
    var stats = null;

    for (var t = initialTrain; t < samples.length; t += 1) {
      if (!model || (t - initialTrain) % retrainEvery === 0) {
        var start = Math.max(0, t - trainWindow);
        var train = samples.slice(start, t);
        stats = standardizer(train);
        model = trainLogistic(train, stats, { iterations: 320, learningRate: 0.15, l2: 0.001 });
      }
      predictions.push({
        p: predictProbability(model, samples[t].x, stats),
        y: samples[t].y
      });
    }

    var metrics = evaluate(predictions);
    var finalStart = Math.max(0, samples.length - trainWindow);
    var finalSamples = samples.slice(finalStart);
    var finalStats = standardizer(finalSamples);
    var finalModel = trainLogistic(finalSamples, finalStats, { iterations: 500, learningRate: 0.15, l2: 0.001 });
    var probability = predictProbability(finalModel, prepared.lastX, finalStats);

    var closes = prepared.closes;
    var lastDate = bars[bars.length - 1].date;
    var holt = holtForecast(closes, lastDate, horizon, trainWindow);
    var holtEval = holtEvaluation(closes, initialTrain, horizon, trainWindow, holt.alpha, holt.beta);
    var lastForecast = holt.forecast[holt.forecast.length - 1];

    var summary = '样本外方向命中率 ' + (metrics.accuracy * 100).toFixed(1) +
      '%（基准 ' + (metrics.baseline * 100).toFixed(1) + '%，样本 ' + metrics.total +
      '）；次日上涨概率 ' + (probability * 100).toFixed(1) + '%；5 日区间 ' +
      lastForecast.lower.toFixed(2) + '—' + lastForecast.upper.toFixed(2) +
      '；Holt 5 日 MAE ' + (holtEval.mae == null ? '--' : holtEval.mae.toFixed(2)) +
      '（朴素 ' + (holtEval.naiveMae == null ? '--' : holtEval.naiveMae.toFixed(2)) + '）。' +
      '模型只使用历史日线，不构成投资建议。';

    return {
      asOf: lastDate,
      currentClose: closes[closes.length - 1],
      horizon: horizon,
      forecast: holt.forecast,
      holt: { alpha: holt.alpha, beta: holt.beta, sigma: holt.sigma, mae: holtEval.mae, naiveMae: holtEval.naiveMae, samples: holtEval.samples },
      logistic: {
        probability: probability,
        accuracy: metrics.accuracy,
        baseline: metrics.baseline,
        auc: metrics.auc,
        precision: metrics.precision,
        recall: metrics.recall,
        total: metrics.total,
        confusion: metrics.confusion
      },
      summary: summary
    };
  }

  function pct(value, digits) {
    return finite(value) ? (Number(value) * 100).toFixed(digits == null ? 1 : digits) + '%' : '--';
  }

  function num(value, digits) {
    return finite(value) ? Number(value).toFixed(digits == null ? 2 : digits) : '--';
  }

  function card(label, value, detail, tone) {
    return '<div class="forecast-card"><span class="forecast-label">' + label + '</span>' +
      '<span class="forecast-value ' + (tone || 'flat') + '">' + value + '</span>' +
      '<span class="forecast-detail">' + detail + '</span></div>';
  }

  function render(options) {
    var result = options.result;
    if (!result) {
      options.grid.innerHTML = '<div class="analysis-empty">点击“运行回测”生成预测与样本外评估。</div>';
      options.detail.textContent = '使用日线快照，walk-forward 只使用当时可见的数据；不构成投资建议。';
      if (options.status) options.status.textContent = '尚未运行';
      return;
    }
    var probability = result.logistic.probability;
    var last = result.forecast[result.forecast.length - 1];
    var html = '';
    html += card('次日上涨概率', pct(probability), '逻辑回归 · 样本外校准未保证',
      probability >= 0.55 ? 'up' : probability <= 0.45 ? 'down' : 'flat');
    html += card('5 日预测区间', last.lower.toFixed(2) + '—' + last.upper.toFixed(2),
      'Holt · 80% 近似区间', last.change >= 0 ? 'up' : 'down');
    html += card('样本外命中率', pct(result.logistic.accuracy),
      '基准 ' + pct(result.logistic.baseline) + ' · 样本 ' + result.logistic.total,
      result.logistic.accuracy > result.logistic.baseline ? 'up' : 'down');
    html += card('AUC', num(result.logistic.auc, 3), '0.5 接近随机');
    html += card('精确率 / 召回率',
      pct(result.logistic.precision) + ' / ' + pct(result.logistic.recall), '阈值 0.5');
    html += card('Holt 5 日 MAE',
      result.holt.mae == null ? '--' : result.holt.mae.toFixed(2),
      '朴素 ' + (result.holt.naiveMae == null ? '--' : result.holt.naiveMae.toFixed(2)) +
      ' · ' + result.holt.samples + ' 段');
    options.grid.innerHTML = html;

    var rows = result.forecast.map(function (item) {
      return '<div class="forecast-row"><span>T+' + item.step + ' ' + item.date + '</span>' +
        '<b>' + item.price.toFixed(2) + '</b>' +
        '<span class="muted">' + item.lower.toFixed(2) + '—' + item.upper.toFixed(2) + '</span>' +
        '<span class="' + (item.change >= 0 ? 'up' : 'down') + '">' +
        (item.change > 0 ? '+' : '') + item.change.toFixed(2) + '%</span></div>';
    }).join('');
    options.detail.innerHTML = '<div class="forecast-list">' + rows + '</div>' +
      '<p class="analysis-note">' + result.summary + '</p>';
    options.status.textContent = '基于 ' + result.asOf + ' 收盘 · 样本外 ' + result.logistic.total + ' 天';
  }

  window.ForecastEngine = {
    run: run,
    render: render,
    _internals: { prepare: prepare, auc: auc, evaluate: evaluate }
  };
})();
