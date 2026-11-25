/* 股迹 v0.5 · 动效工具：数字滚动与涨跌闪烁。
 * 纯前端实现，无第三方依赖；系统开启"减少动态效果"时全部退化为直接赋值。 */
(function () {
  'use strict';

  var TWEEN_MS = 420;
  var reduceQuery = null;

  function enabled() {
    try {
      if (!reduceQuery && window.matchMedia) {
        reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      }
      return !reduceQuery || !reduceQuery.matches;
    } catch (err) {
      return true;
    }
  }

  /* 数字滚动：把 element 的文本从上一次的数值平滑滚到新数值。
   * raw 为 null 或非有限数时按 '--' 处理；format(value) 返回展示文本。 */
  function setNum(element, raw, format) {
    if (!element) return;
    var next = Number(raw);
    if (raw == null || !Number.isFinite(next)) {
      stopTween(element);
      element._motionVal = null;
      if (element.textContent !== '--') element.textContent = '--';
      return;
    }
    var prev = element._motionVal;
    element._motionVal = next;
    var target = format(next);
    if (!enabled() || !Number.isFinite(prev) || prev === next) {
      stopTween(element);
      if (element.textContent !== target) element.textContent = target;
      return;
    }
    runTween(element, prev, next, format);
  }

  function stopTween(element) {
    if (element._motionRaf) {
      window.cancelAnimationFrame(element._motionRaf);
      element._motionRaf = 0;
    }
  }

  function runTween(element, from, to, format) {
    stopTween(element);
    var start = 0;
    function frame(ts) {
      if (!start) start = ts;
      var t = Math.min(1, (ts - start) / TWEEN_MS);
      var eased = 1 - Math.pow(1 - t, 3);
      var text = format(from + (to - from) * eased);
      if (element.textContent !== text) element.textContent = text;
      if (t < 1) {
        element._motionRaf = window.requestAnimationFrame(frame);
      } else {
        element._motionRaf = 0;
        var final = format(to);
        if (element.textContent !== final) element.textContent = final;
      }
    }
    element._motionRaf = window.requestAnimationFrame(frame);
  }

  /* 涨跌闪烁：direction > 0 闪红（A 股惯例涨红）、< 0 闪绿、0 不闪。 */
  function flash(element, direction) {
    if (!element || !enabled()) return;
    var n = Number(direction);
    if (!Number.isFinite(n) || n === 0) return;
    element.classList.remove('flash-up', 'flash-down');
    void element.offsetWidth;
    element.classList.add(n > 0 ? 'flash-up' : 'flash-down');
    if (!element._flashBound) {
      element._flashBound = true;
      element.addEventListener('animationend', function (event) {
        if (event.animationName === 'flash-up' || event.animationName === 'flash-down') {
          element.classList.remove('flash-up', 'flash-down');
        }
      });
    }
  }

  window.Motion = {
    enabled: enabled,
    setNum: setNum,
    flash: flash
  };
})();
