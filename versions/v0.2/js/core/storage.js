(function () {
  'use strict';

  var VERSION = 2;
  var KEY = 'guji.holdings.v2';
  var LEGACY_KEY = 'guji.holdings.v1';
  var BACKUP_PREFIX = 'guji.holdings.corrupt.';
  var SAMPLE_HOLDINGS = [
    { symbol: '600519', shares: 100, cost: 1500 },
    { symbol: '300750', shares: 200, cost: 180 }
  ];

  function sample() {
    return SAMPLE_HOLDINGS.map(function (item) {
      return { symbol: item.symbol, shares: item.shares, cost: item.cost };
    });
  }

  /**
   * 只保留合法且不重复的持仓。非法条目计入 rejected，供提示使用。
   */
  function normalizeList(list) {
    var seen = {};
    var out = [];
    var rejected = 0;

    (Array.isArray(list) ? list : []).forEach(function (holding) {
      if (!holding || !window.UNIVERSE_BY_SYMBOL[holding.symbol]) {
        rejected += 1;
        return;
      }
      var shares = Number(holding.shares);
      var cost = Number(holding.cost);
      if (!Number.isInteger(shares) || shares <= 0 || shares > 1000000 ||
          !Number.isFinite(cost) || cost <= 0 || cost > 100000) {
        rejected += 1;
        return;
      }
      if (seen[holding.symbol]) {
        rejected += 1;
        return;
      }
      seen[holding.symbol] = true;
      out.push({ symbol: holding.symbol, shares: shares, cost: cost });
    });

    return { holdings: out, rejected: rejected };
  }

  /**
   * decode 只做解析和分类，不读写 localStorage，便于自检页直接测试。
   */
  function decode(raw) {
    if (raw == null) {
      return { status: 'empty', holdings: [], rejected: 0, message: '' };
    }

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        status: 'corrupt',
        holdings: [],
        rejected: 0,
        message: '本地持仓数据不是合法 JSON'
      };
    }

    if (Array.isArray(parsed)) {
      var legacy = normalizeList(parsed);
      return {
        status: 'legacy',
        holdings: legacy.holdings,
        rejected: legacy.rejected,
        message: ''
      };
    }

    if (parsed && typeof parsed === 'object' &&
        parsed.version === VERSION && Array.isArray(parsed.holdings)) {
      var current = normalizeList(parsed.holdings);
      return {
        status: current.rejected > 0 ? 'partial' : 'ok',
        holdings: current.holdings,
        rejected: current.rejected,
        message: ''
      };
    }

    return {
      status: 'invalid',
      holdings: [],
      rejected: 0,
      message: '本地持仓数据结构无法识别'
    };
  }

  function backup(storage, raw, now) {
    if (raw == null) return null;
    var stamp = new Date(now == null ? Date.now() : now)
      .toISOString()
      .replace(/[:.]/g, '-');
    var key = BACKUP_PREFIX + stamp;
    var suffix = 1;

    try {
      while (storage.getItem(key) != null) {
        key = BACKUP_PREFIX + stamp + '-' + suffix;
        suffix += 1;
      }
      storage.setItem(key, raw);
      return key;
    } catch (err) {
      return null;
    }
  }

  function read(storage, fallbackFactory) {
    var makeFallback = fallbackFactory || sample;
    var raw;
    var sourceKey;

    try {
      raw = storage.getItem(KEY);
      sourceKey = KEY;
      if (raw == null) {
        raw = storage.getItem(LEGACY_KEY);
        sourceKey = LEGACY_KEY;
      }
    } catch (err) {
      return {
        holdings: makeFallback(),
        status: 'unavailable',
        message: '浏览器本地存储不可用，持仓只在本次页面有效',
        backupKey: null,
        shouldPersist: false
      };
    }

    if (raw == null) {
      return {
        holdings: makeFallback(),
        status: 'sample',
        message: '',
        backupKey: null,
        shouldPersist: true
      };
    }

    var decoded = decode(raw);

    if (decoded.status === 'ok' || decoded.status === 'legacy') {
      return {
        holdings: decoded.holdings,
        status: decoded.status,
        message: decoded.status === 'legacy' ? '已从 v1 旧版本迁移持仓数据' : '',
        backupKey: null,
        shouldPersist: decoded.status === 'legacy'
      };
    }

    var backupKey = backup(storage, raw);

    if (decoded.status === 'partial') {
      return {
        holdings: decoded.holdings,
        status: 'partial',
        message: '有 ' + decoded.rejected + ' 条持仓格式异常，已忽略并' +
          (backupKey ? '备份原文' : '尝试备份原文失败（备份不可用）'),
        backupKey: backupKey,
        shouldPersist: !!backupKey
      };
    }

    var prefix = decoded.status === 'corrupt'
      ? '本地持仓数据损坏，已恢复示例持仓'
      : '本地持仓结构无法识别，已恢复示例持仓';

    return {
      holdings: makeFallback(),
      status: decoded.status,
      message: prefix + (backupKey
        ? '；原文已备份为 ' + backupKey
        : '；原文备份失败，未覆盖旧数据'),
      backupKey: backupKey,
      shouldPersist: !!backupKey
    };
  }

  function save(storage, holdings) {
    try {
      storage.setItem(KEY, JSON.stringify({
        version: VERSION,
        holdings: holdings || []
      }));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err && err.message ? err.message : '浏览器本地存储不可用'
      };
    }
  }

  window.HoldingStore = {
    VERSION: VERSION,
    KEY: KEY,
    LEGACY_KEY: LEGACY_KEY,
    BACKUP_PREFIX: BACKUP_PREFIX,
    sample: sample,
    normalizeList: normalizeList,
    decode: decode,
    read: read,
    save: save,
    backup: backup
  };
})();
