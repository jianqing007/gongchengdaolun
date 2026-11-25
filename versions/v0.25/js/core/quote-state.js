(function () {
  'use strict';

  var BACKOFF_STEPS = [3000, 6000, 12000, 30000];

  function backoffDelay(failures) {
    if (!failures || failures <= 0) return 0;
    return BACKOFF_STEPS[Math.min(failures, BACKOFF_STEPS.length) - 1];
  }

  function isLatest(currentId, incomingId) {
    return currentId === incomingId;
  }

  function latestQuoteTime(quotes, symbols) {
    var latest = null;
    (symbols || Object.keys(quotes || {})).forEach(function (item) {
      var symbol = typeof item === 'string' ? item : item && item.symbol;
      var quote = quotes && symbol ? quotes[symbol] : null;
      if (quote && Number.isFinite(quote.time) && (latest == null || quote.time > latest)) {
        latest = quote.time;
      }
    });
    return latest;
  }

  function missingItems(items, quotes) {
    return (items || []).filter(function (item) {
      var quote = quotes && quotes[item.symbol];
      return !quote || quote.price == null;
    });
  }

  window.QuoteState = {
    backoffDelay: backoffDelay,
    isLatest: isLatest,
    latestQuoteTime: latestQuoteTime,
    missingItems: missingItems
  };
})();
