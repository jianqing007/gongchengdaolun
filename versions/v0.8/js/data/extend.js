/* ==========================================================================
 * 股迹 v0.8 · 日线快照页面内续读（js/data/extend.js）
 * ---------------------------------------------------------------------------
 * 快照 js/data/snapshot.js 是打包时点的静态文件；本模块在页面加载后从腾讯
 * 日线接口拉取"快照末日之后"的增量 K 线，经前复权一致性校验后，交给
 * PriceHistory.applyExtension() 在内存中合并渲染。
 * - 不改写快照文件，不影响 tests.html 的确定性用例；
 * - 复权校验口径与 tools/build_snapshot.py 完全一致：重叠窗 10 个日历日、
 *   容差 max(0.011, 收盘×1e-4)、股票用前复权(qfq)、ETF/指数不复权；
 * - 任何标的检测到复权因子变化即整体停用续读并提示（内存里无法像
 *   build_snapshot 那样按标的重建全量，如实降级比带病合并诚实）；
 * - 全部失败/接口不可用时静默保持快照现状。
 * ========================================================================== */
(function () {
  'use strict';

  var HOSTS = [
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
    'https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get',
    'https://ifzq.gtimg.cn/appstock/app/fqkline/get'
  ];
  var OVERLAP_DAYS = 10; // 重叠校验窗口（日历日），与 build_snapshot.py 一致
  var BARS_NEED = 64;    // 每次拉取根数上限，足够覆盖重叠窗 + 新增
  var TIMEOUT_MS = 8000;
  var CONCURRENCY = 4;

  var status = {
    state: 'idle',        // idle | running | done | mismatch | failed
    snapshotDate: '',     // 快照最后一个交易日
    extendedDate: '',     // 续读后最后一个交易日（done 时有值）
    applied: 0,           // 新增 K 线根数
    okSymbols: 0,
    totalSymbols: 0,
    mismatch: [],         // 检测到复权因子变化的标的
    error: '',
    finishedAt: 0
  };

  function todayBeijing() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function addDays(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function snapshotEntries() {
    var snap = window.SNAPSHOT || {};
    var out = [];
    Object.keys(snap.stocks || {}).forEach(function (symbol) {
      var entry = snap.stocks[symbol];
      if (entry && entry.tx && Array.isArray(entry.bars) && entry.bars.length) {
        out.push({ symbol: symbol, tx: entry.tx, adjust: 'qfq', bars: entry.bars });
      }
    });
    Object.keys(snap.indices || {}).forEach(function (symbol) {
      var entry = snap.indices[symbol];
      if (entry && entry.tx && Array.isArray(entry.bars) && entry.bars.length) {
        out.push({ symbol: symbol, tx: entry.tx, adjust: '', bars: entry.bars });
      }
    });
    return out;
  }

  function maxBarDate(bars) {
    return bars.length ? String(bars[bars.length - 1][0]) : '';
  }

  /* 与 build_snapshot.py adjustment_changed 逐条一致：
     重叠日期收盘价差 > max(0.011, |fetched收盘|×1e-4) 视为复权因子重算。 */
  function adjustmentChanged(oldBars, fetched) {
    var old = {};
    oldBars.forEach(function (bar) { old[bar[0]] = bar; });
    for (var i = 0; i < fetched.length; i += 1) {
      var base = old[fetched[i][0]];
      if (!base) continue;
      var tolerance = Math.max(0.011, Math.abs(fetched[i][2]) * 1e-4);
      if (Math.abs(base[2] - fetched[i][2]) > tolerance) return true;
    }
    return false;
  }

  function fetchBarsFrom(host, entry, startISO, endISO, signal) {
    // param 不做整体编码（逗号分隔，与 build_snapshot.py 的 curl URL 同构；
    // tx 代码只含字母数字，无保留字符）
    var url = host + '?param=' + entry.tx + ',day,' + startISO + ',' + endISO + ',' + BARS_NEED + ',' + entry.adjust;
    return fetch(url, { signal: signal, cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (payload) {
      if (!payload || (payload.code !== 0 && payload.code !== null)) {
        throw new Error('接口返回异常');
      }
      var data = payload.data || {};
      var item = data[entry.tx] || {};
      var rows = item.qfqday || item.day || [];
      if (!Array.isArray(rows)) throw new Error('没有日线数据');
      var bars = [];
      rows.forEach(function (row) {
        if (!Array.isArray(row) || row.length < 6) return;
        var date = String(row[0]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        var o = Number(row[1]), c = Number(row[2]), h = Number(row[3]), l = Number(row[4]);
        var v = Number(row[5]);
        if (![o, c, h, l, v].every(Number.isFinite)) return;
        bars.push([date, o, c, h, l, Math.round(v)]);
      });
      if (!bars.length) throw new Error('日线数据为空');
      return bars;
    });
  }

  function fetchBars(entry, startISO, endISO) {
    var hostIndex = 0;
    function attempt() {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
      return fetchBarsFrom(HOSTS[hostIndex], entry, startISO, endISO, controller.signal)
        .catch(function (err) {
          clearTimeout(timer);
          hostIndex += 1;
          if (hostIndex < HOSTS.length) return attempt();
          throw err;
        }).then(function (bars) {
          clearTimeout(timer);
          return bars;
        });
    }
    return attempt();
  }

  /* 并发受控地拉取全部标的：全部完成（无论成败）后才 resolve，
     避免提前 resolve 让慢链路的结果丢失。 */
  function fetchAll(entries, startISO, endISO) {
    return new Promise(function (resolve) {
      var results = {};
      var index = 0;
      var completed = 0;
      var total = entries.length;
      if (!total) return resolve(results);

      function finish() {
        completed += 1;
        if (completed >= total) return resolve(results);
        if (index < total) launch();
      }
      function launch() {
        var entry = entries[index];
        index += 1;
        fetchBars(entry, startISO, endISO).then(
          function (bars) { results[entry.symbol] = bars; finish(); },
          function () { results[entry.symbol] = null; finish(); } // 单标的失败只影响自己
        );
      }
      var i = 0;
      for (; i < CONCURRENCY && index < total; i += 1) launch();
    });
  }

  function run() {
    if (status.state === 'running') return Promise.resolve(status);
    var entries = snapshotEntries();
    if (!entries.length || !window.PriceHistory) {
      status.state = 'failed';
      status.error = '快照为空或数据层未就绪';
      return Promise.resolve(status);
    }

    var lastDates = entries.map(function (entry) { return maxBarDate(entry.bars); });
    var last = lastDates.reduce(function (a, b) { return b > a ? b : a; }, '');
    if (!last) {
      status.state = 'failed';
      status.error = '快照没有可用日期';
      return Promise.resolve(status);
    }

    status = {
      state: 'running',
      snapshotDate: last,
      extendedDate: '',
      applied: 0,
      okSymbols: 0,
      totalSymbols: entries.length,
      mismatch: [],
      error: '',
      finishedAt: 0
    };

    var startISO = addDays(last, -OVERLAP_DAYS);
    var endISO = todayBeijing();

    return fetchAll(entries, startISO, endISO).then(function (results) {
      var extension = {};
      var mismatch = [];
      var applied = 0;
      var okSymbols = 0;
      var extendedDate = '';

      entries.forEach(function (entry) {
        var fetched = results[entry.symbol];
        if (!fetched) return;
        // 复权校验：重叠窗内收盘价必须一致
        var overlapValid = !adjustmentChanged(entry.bars.slice(-16), fetched);
        if (!overlapValid) {
          mismatch.push(entry.symbol);
          return;
        }
        // 只保留晚于该标的快照末日的行（快照里各标的末日可能不同）；
        // 接口偶尔返回重复行，按日期去重后升序
        var ownLast = maxBarDate(entry.bars);
        var seen = {};
        var clean = [];
        fetched.forEach(function (bar) {
          if (bar[0] <= ownLast || seen[bar[0]]) return;
          seen[bar[0]] = true;
          clean.push(bar);
        });
        clean.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
        okSymbols += 1; // 拉到且校验通过（含无新增的），都算成功
        if (clean.length) {
          extension[entry.symbol] = clean;
          applied += clean.length;
          if (clean[clean.length - 1][0] > extendedDate) {
            extendedDate = clean[clean.length - 1][0];
          }
        }
      });

      if (mismatch.length) {
        status.state = 'mismatch';
        status.mismatch = mismatch.sort();
        status.error = '前复权因子变化，续读停用';
        status.finishedAt = Date.now();
        return status;
      }

      if (okSymbols === 0) {
        status.state = 'failed';
        status.error = '行情接口不可用，本次未续读';
        status.finishedAt = Date.now();
        return status;
      }

      if (applied > 0) {
        window.PriceHistory.applyExtension(extension);
      }
      status.state = 'done';
      status.extendedDate = extendedDate;
      status.applied = applied;
      status.okSymbols = okSymbols;
      status.finishedAt = Date.now();
      return status;
    }).catch(function (err) {
      status.state = 'failed';
      status.error = err && err.message ? String(err.message) : '网络错误';
      status.finishedAt = Date.now();
      return status;
    });
  }

  window.SnapshotExtend = {
    run: run,
    status: function () {
      return JSON.parse(JSON.stringify(status));
    }
  };
})();
