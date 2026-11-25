(function () {
  'use strict';

  var stocks = [
    { symbol: '600519', name: '贵州茅台', tx: 'sh600519', sector: '食品饮料' },
    { symbol: '000858', name: '五粮液', tx: 'sz000858', sector: '食品饮料' },
    { symbol: '300750', name: '宁德时代', tx: 'sz300750', sector: '电力设备' },
    { symbol: '002594', name: '比亚迪', tx: 'sz002594', sector: '汽车' },
    { symbol: '600036', name: '招商银行', tx: 'sh600036', sector: '银行' },
    { symbol: '601318', name: '中国平安', tx: 'sh601318', sector: '非银金融' },
    { symbol: '000333', name: '美的集团', tx: 'sz000333', sector: '家用电器' },
    { symbol: '600900', name: '长江电力', tx: 'sh600900', sector: '公用事业' },
    { symbol: '601888', name: '中国中免', tx: 'sh601888', sector: '商贸零售' },
    { symbol: '600887', name: '伊利股份', tx: 'sh600887', sector: '食品饮料' }
  ];

  var indices = [
    { symbol: 'SH000001', code: '000001', name: '上证指数', tx: 'sh000001' },
    { symbol: 'SH000300', code: '000300', name: '沪深300', tx: 'sz399300' }
  ];

  var all = stocks.concat(indices);

  window.UNIVERSE = stocks;
  window.INDICES = indices;
  window.ALL_SYMBOLS = all;
  window.UNIVERSE_BY_SYMBOL = stocks.reduce(function (map, item) {
    map[item.symbol] = item;
    return map;
  }, {});
  window.ALL_BY_SYMBOL = all.reduce(function (map, item) {
    map[item.symbol] = item;
    return map;
  }, {});
  window.TX_TO_SYMBOL = all.reduce(function (map, item) {
    map[item.tx] = item.symbol;
    return map;
  }, {});
})();
