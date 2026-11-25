/* 本文件由 tools/build_universe.py 从 js/data/pool.json 生成，请勿手改。
 * 换池子：改 pool.json -> python tools/build_universe.py（或 build_snapshot.py）。
 * UNIVERSE / INDICES / ALL_SYMBOLS 跟随当前分组；
 * UNIVERSE_BY_SYMBOL / ALL_BY_SYMBOL / TX_TO_SYMBOL 覆盖全部分组，
 * 这样切换分组后，另一组的持仓仍能解析名称、读行情，不会被当成未知标的丢掉。
 */
(function () {
  'use strict';
  var POOL = {
  "version": 1,
  "defaultGroup": "course",
  "groups": {
    "course": {
      "label": "课程演示组",
      "stocks": [
        {
          "symbol": "600519",
          "code": "600519",
          "name": "贵州茅台",
          "tx": "sh600519",
          "type": "stock",
          "sector": "食品饮料"
        },
        {
          "symbol": "000858",
          "code": "000858",
          "name": "五粮液",
          "tx": "sz000858",
          "type": "stock",
          "sector": "食品饮料"
        },
        {
          "symbol": "300750",
          "code": "300750",
          "name": "宁德时代",
          "tx": "sz300750",
          "type": "stock",
          "sector": "电力设备"
        },
        {
          "symbol": "002594",
          "code": "002594",
          "name": "比亚迪",
          "tx": "sz002594",
          "type": "stock",
          "sector": "汽车"
        },
        {
          "symbol": "600036",
          "code": "600036",
          "name": "招商银行",
          "tx": "sh600036",
          "type": "stock",
          "sector": "银行"
        },
        {
          "symbol": "601318",
          "code": "601318",
          "name": "中国平安",
          "tx": "sh601318",
          "type": "stock",
          "sector": "非银金融"
        },
        {
          "symbol": "000333",
          "code": "000333",
          "name": "美的集团",
          "tx": "sz000333",
          "type": "stock",
          "sector": "家用电器"
        },
        {
          "symbol": "600900",
          "code": "600900",
          "name": "长江电力",
          "tx": "sh600900",
          "type": "stock",
          "sector": "公用事业"
        },
        {
          "symbol": "601888",
          "code": "601888",
          "name": "中国中免",
          "tx": "sh601888",
          "type": "stock",
          "sector": "商贸零售"
        },
        {
          "symbol": "600887",
          "code": "600887",
          "name": "伊利股份",
          "tx": "sh600887",
          "type": "stock",
          "sector": "食品饮料"
        }
      ],
      "indices": [
        {
          "symbol": "SH000001",
          "code": "000001",
          "name": "上证指数",
          "tx": "sh000001",
          "type": "index"
        },
        {
          "symbol": "SH000300",
          "code": "000300",
          "name": "沪深300",
          "tx": "sh000300",
          "type": "index"
        }
      ]
    },
    "practical": {
      "label": "实战观察组",
      "stocks": [
        {
          "symbol": "000513",
          "code": "000513",
          "name": "丽珠集团",
          "tx": "sz000513",
          "type": "stock",
          "sector": "医药生物"
        },
        {
          "symbol": "300759",
          "code": "300759",
          "name": "康龙化成",
          "tx": "sz300759",
          "type": "stock",
          "sector": "医药生物"
        },
        {
          "symbol": "000963",
          "code": "000963",
          "name": "华东医药",
          "tx": "sz000963",
          "type": "stock",
          "sector": "医药生物"
        },
        {
          "symbol": "000028",
          "code": "000028",
          "name": "国药一致",
          "tx": "sz000028",
          "type": "stock",
          "sector": "医药生物"
        },
        {
          "symbol": "000596",
          "code": "000596",
          "name": "古井贡酒",
          "tx": "sz000596",
          "type": "stock",
          "sector": "食品饮料"
        },
        {
          "symbol": "003006",
          "code": "003006",
          "name": "百亚股份",
          "tx": "sz003006",
          "type": "stock",
          "sector": "美容护理"
        },
        {
          "symbol": "000039",
          "code": "000039",
          "name": "中集集团",
          "tx": "sz000039",
          "type": "stock",
          "sector": "机械设备"
        },
        {
          "symbol": "000977",
          "code": "000977",
          "name": "浪潮信息",
          "tx": "sz000977",
          "type": "stock",
          "sector": "计算机"
        },
        {
          "symbol": "605117",
          "code": "605117",
          "name": "德业股份",
          "tx": "sh605117",
          "type": "stock",
          "sector": "电力设备"
        },
        {
          "symbol": "688825",
          "code": "688825",
          "name": "长鑫科技",
          "tx": "sh688825",
          "type": "stock",
          "sector": "电子",
          "listed": "2026-07-27"
        },
        {
          "symbol": "159915",
          "code": "159915",
          "name": "创业板ETF",
          "tx": "sz159915",
          "type": "etf",
          "sector": "宽基ETF"
        },
        {
          "symbol": "588000",
          "code": "588000",
          "name": "科创50ETF",
          "tx": "sh588000",
          "type": "etf",
          "sector": "宽基ETF"
        }
      ],
      "indices": [
        {
          "symbol": "SH000001",
          "code": "000001",
          "name": "上证指数",
          "tx": "sh000001",
          "type": "index"
        },
        {
          "symbol": "SH000300",
          "code": "000300",
          "name": "沪深300",
          "tx": "sh000300",
          "type": "index"
        },
        {
          "symbol": "SZ399006",
          "code": "399006",
          "name": "创业板指",
          "tx": "sz399006",
          "type": "index"
        },
        {
          "symbol": "SH000688",
          "code": "000688",
          "name": "科创50",
          "tx": "sh000688",
          "type": "index"
        }
      ]
    }
  }
};
  var GROUPS = POOL.groups;
  var allItems = [];
  var allBySymbol = {};
  var txToSymbol = {};
  Object.keys(GROUPS).forEach(function (key) {
    var group = GROUPS[key];
    group.stocks.concat(group.indices).forEach(function (item) {
      if (!allBySymbol[item.symbol]) {
        allBySymbol[item.symbol] = item;
        allItems.push(item);
      }
      txToSymbol[item.tx] = item.symbol;
    });
  });
  function bySymbol(items) {
    return items.reduce(function (map, item) {
      map[item.symbol] = item;
      return map;
    }, {});
  }
  function activate(name) {
    var group = GROUPS[name];
    if (!group) return null;
    window.ACTIVE_POOL_GROUP = name;
    window.POOL_GROUP_LABEL = group.label || name;
    window.UNIVERSE = group.stocks.slice();
    window.INDICES = group.indices.slice();
    window.ALL_SYMBOLS = window.UNIVERSE.concat(window.INDICES);
    window.ACTIVE_BY_SYMBOL = bySymbol(window.ALL_SYMBOLS);
    return name;
  }
  window.POOL = POOL;
  window.POOL_GROUPS = GROUPS;
  window.POOL_ITEMS = allItems;
  window.UNIVERSE_BY_SYMBOL = bySymbol(allItems.filter(function (item) {
    return item.type !== 'index';
  }));
  window.ALL_BY_SYMBOL = allBySymbol;
  window.TX_TO_SYMBOL = txToSymbol;
  window.setPoolGroup = activate;
  window.getPoolGroup = function () { return window.ACTIVE_POOL_GROUP; };
  activate(POOL.defaultGroup);
})();
