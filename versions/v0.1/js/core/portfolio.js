(function () {
  'use strict';

  /**
   * 金额统一用“分”的整数计算，展示层再转元，避免 0.1+0.2 一类浮点误差。
   */
  function toCents(value) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function computePosition(holding, quote) {
    var shares = Number(holding.shares);
    var costCents = toCents(holding.cost);
    var priceCents = quote && quote.price != null ? toCents(quote.price) : null;
    var prevCloseCents = quote && quote.prevClose != null ? toCents(quote.prevClose) : null;

    var costTotal = Number.isFinite(costCents) && Number.isFinite(shares) ? costCents * shares : null;
    var marketValue = priceCents != null ? priceCents * shares : null;
    var pnl = marketValue != null && costTotal != null ? marketValue - costTotal : null;
    var pnlPct = pnl != null && costTotal > 0 ? pnl / costTotal : null;
    var dayPnl = priceCents != null && prevCloseCents != null ? (priceCents - prevCloseCents) * shares : null;

    return {
      symbol: holding.symbol,
      shares: shares,
      costCents: costCents,
      costTotal: costTotal,
      priceCents: priceCents,
      prevCloseCents: prevCloseCents,
      marketValue: marketValue,
      pnl: pnl,
      pnlPct: pnlPct,
      dayPnl: dayPnl,
      weight: null
    };
  }

  function computePortfolio(holdings, quotes) {
    var positions = (holdings || []).map(function (holding) {
      return computePosition(holding, quotes ? quotes[holding.symbol] : null);
    });

    var totals = positions.reduce(function (acc, pos) {
      acc.costTotal += pos.costTotal || 0;
      acc.marketValue += pos.marketValue || 0;
      acc.pnl += pos.pnl || 0;
      acc.dayPnl += pos.dayPnl || 0;
      return acc;
    }, { costTotal: 0, marketValue: 0, pnl: 0, dayPnl: 0, pnlPct: null });

    positions.forEach(function (pos) {
      pos.weight = totals.marketValue > 0 && pos.marketValue != null ? pos.marketValue / totals.marketValue : null;
    });

    totals.pnlPct = totals.costTotal > 0 ? totals.pnl / totals.costTotal : null;
    totals.count = positions.length;
    return { positions: positions, totals: totals };
  }

  /**
   * 编辑时传入 editingSymbol，允许保存同一只股票；若改成另一只已存在的股票则拒绝。
   */
  function validateHolding(input, holdings, editingSymbol) {
    var errors = {};
    var symbol = String(input && input.symbol != null ? input.symbol : '');
    var shares = Number(input && input.shares);
    var cost = Number(input && input.cost);

    if (!window.UNIVERSE_BY_SYMBOL[symbol]) {
      errors.symbol = '请选择自选股列表中的股票';
    }

    if (!Number.isInteger(shares) || shares <= 0) {
      errors.shares = '股数必须是大于 0 的整数';
    } else if (shares > 1000000) {
      errors.shares = '股数不能超过 1,000,000';
    }

    if (!Number.isFinite(cost) || cost <= 0) {
      errors.cost = '成本价必须大于 0';
    } else if (cost > 100000) {
      errors.cost = '成本价不能超过 100,000 元';
    }

    var duplicate = (holdings || []).some(function (holding) {
      return holding.symbol === symbol && holding.symbol !== editingSymbol;
    });
    if (duplicate) {
      errors.symbol = '该股票已在持仓中';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  window.Portfolio = {
    toCents: toCents,
    computePosition: computePosition,
    computePortfolio: computePortfolio,
    validateHolding: validateHolding
  };
})();
