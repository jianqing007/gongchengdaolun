(function () {
  'use strict';

  /**
   * 快照最后日期之后已经过去的交易日数（只按周一至周五，不处理法定节假日）。
   * 传入的日期与“今天”都按北京时间的日历日计算。
   * 例：2026-10-30（周五）→ 2026-10-31（周六）为 0；
   *     2026-10-30 → 2026-11-03（周二）为 2（周一、周二）。
   */
  function tradingDaysAfter(dateStr, nowMs) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return 0;
    var parts = dateStr.split('-');
    var cursor = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isFinite(cursor)) return 0;

    var now = new Date(nowMs == null ? Date.now() : nowMs);
    var china = new Date(now.getTime() + 8 * 3600 * 1000);
    var today = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate());

    var count = 0;
    for (var i = 0; i < 400; i += 1) {
      cursor += 24 * 3600 * 1000;
      if (cursor > today) break;
      var day = new Date(cursor).getUTCDay();
      if (day !== 0 && day !== 6) count += 1;
    }
    return count;
  }

  window.Freshness = { tradingDaysAfter: tradingDaysAfter };
})();
