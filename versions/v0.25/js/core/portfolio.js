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
    var cost = Number(holding.cost);
    var costCents = toCents(holding.cost);
    var priceCents = quote && quote.price != null ? toCents(quote.price) : null;
    var prevCloseCents = quote && quote.prevClose != null ? toCents(quote.prevClose) : null;

    var costTotal = Number.isFinite(cost) && Number.isInteger(shares)
      ? Math.round(cost * shares * 100)
      : null;
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
      errors.symbol = '该股票已持仓，请用“加仓”或“修正”';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  function validateIncrease(input, holding) {
    var errors = {};
    var addShares = Number(input && input.shares);
    var addCost = Number(input && input.cost);

    if (!holding) {
      errors.symbol = '请选择已有持仓';
    }
    if (!Number.isInteger(addShares) || addShares <= 0) {
      errors.shares = '新增股数必须是大于 0 的整数';
    } else if (holding && Number(holding.shares) + addShares > 1000000) {
      errors.shares = '加仓后总股数不能超过 1,000,000';
    }
    if (!Number.isFinite(addCost) || addCost <= 0) {
      errors.cost = '本次成本价必须大于 0';
    } else if (addCost > 100000) {
      errors.cost = '本次成本价不能超过 100,000 元';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  function validateReduce(input, holding) {
    var errors = {};
    var reduceShares = Number(input && input.shares);

    if (!holding) {
      errors.symbol = '请选择已有持仓';
    } else if (!Number.isInteger(reduceShares) || reduceShares <= 0) {
      errors.shares = '减持股数必须是大于 0 的整数';
    } else if (reduceShares > Number(holding.shares)) {
      errors.shares = '减持股数不能超过现有 ' + Number(holding.shares) + ' 股';
    }

    return { ok: Object.keys(errors).length === 0, errors: errors };
  }

  /**
   * 加仓按加权平均合并为一条持仓。
   * 总成本先按“分”求和再除以总股数，避免先算平均再相乘造成累计误差。
   */
  function mergeHolding(holding, addShares, addCost) {
    var oldShares = Number(holding.shares);
    var oldCost = Number(holding.cost);
    var addedShares = Number(addShares);
    var addedCost = Number(addCost);
    var totalShares = oldShares + addedShares;
    var totalCostCents = Math.round(oldCost * oldShares * 100) +
      Math.round(addedCost * addedShares * 100);
    var cost = totalCostCents / totalShares / 100;

    return {
      symbol: holding.symbol,
      shares: totalShares,
      cost: Number(cost.toFixed(6))
    };
  }

  function reduceHolding(holding, reduceShares) {
    var remaining = Number(holding.shares) - Number(reduceShares);
    if (remaining <= 0) return null;
    return {
      symbol: holding.symbol,
      shares: remaining,
      cost: Number(holding.cost)
    };
  }

  window.Portfolio = {
    toCents: toCents,
    computePosition: computePosition,
    computePortfolio: computePortfolio,
    validateHolding: validateHolding,
    validateIncrease: validateIncrease,
    validateReduce: validateReduce,
    mergeHolding: mergeHolding,
    reduceHolding: reduceHolding
  };
})();
