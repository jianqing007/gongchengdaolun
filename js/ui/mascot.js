/* ==========================================================================
 * 股迹 v0.7 · 右下角吉祥物（用户提供贴纸素材 + 站点交互接线）
 * ---------------------------------------------------------------------------
 * 美术素材：assets/涨涨涨_Q弹.svg → 构建为 js/ui/mascot-art.js 的
 * window.MASCOT_SVG 字符串（素材自带 idle 呼吸动画与 bounce Q 弹关键帧；
 * 生成时已剥离其内嵌脚本与固定尺寸内联样式）。
 * 本文件负责交互：点击触发素材内的 bounce 动画 + 随机语录气泡；
 * 上涨告警时欢呼（cheer）。原内嵌脚本的"remove → reflow → add"重触发
 * 语义在此以同样方式实现（innerHTML 注入的 script 不会执行）。
 * ========================================================================== */
(function () {
  'use strict';

  var PHRASES = [
    { text: '涨涨涨！📈', weight: 2 },
    { text: '红红火火！🔥', weight: 1 },
    { text: '点点我，好运+1', weight: 1 },
    { text: '嘘…我在盯盘呢', weight: 1 },
    { text: '今天也想红一点~', weight: 1 },
    { text: '又是看盘的一天', weight: 1 }
  ];
  var CHEER_TEXT = '涨啦！🎉';
  var BUBBLE_MS = 2800;      // 气泡停留时长
  var BUBBLE_FADE_MS = 260;  // 气泡淡出时长

  var els = { btn: null, figure: null, bubble: null, wrap: null };
  var lastPhrase = '';
  var bubbleTimer = null;
  var leaveTimer = null;

  /* ---- 素材来自 js/ui/mascot-art.js（必须在 mascot.js 之前加载） ---- */
  function getArtSvg() {
    var art = window.MASCOT_SVG;
    return typeof art === 'string' && art.indexOf('<svg') === 0 ? art : '';
  }

  /* ---- 语录池：加权随机 + 不连续重复 ---- */
  function pickPhrase() {
    var pool = PHRASES.filter(function (p) { return p.text !== lastPhrase; });
    var bag = [];
    pool.forEach(function (p) {
      for (var i = 0; i < p.weight; i++) bag.push(p.text);
    });
    var text = bag[Math.floor(Math.random() * bag.length)] || PHRASES[0].text;
    lastPhrase = text;
    return text;
  }

  /* ---- Q 弹：触发素材内置 bounce 动画（remove → reflow → add 可连点重触发） ---- */
  function boing() {
    if (!els.wrap) return;
    els.wrap.classList.remove('bounce');
    void els.wrap.getBoundingClientRect(); // 强制 reflow，让动画可重复触发
    els.wrap.classList.add('bounce');
  }

  /* ---- 气泡：弹入 → 停留 → 淡出 ---- */
  function speak(text) {
    if (!els.bubble) return;
    els.bubble.textContent = text;
    els.bubble.classList.remove('is-on', 'is-leaving');
    void els.bubble.offsetWidth;
    els.bubble.classList.add('is-on');
    window.clearTimeout(bubbleTimer);
    window.clearTimeout(leaveTimer);
    bubbleTimer = window.setTimeout(function () {
      els.bubble.classList.add('is-leaving');
      leaveTimer = window.setTimeout(function () {
        els.bubble.classList.remove('is-on', 'is-leaving');
      }, BUBBLE_FADE_MS);
    }, BUBBLE_MS);
  }

  function onInteract() {
    boing();
    speak(pickPhrase());
  }

  /* ---- 上涨告警欢呼（app.js showToast 钩子调用） ---- */
  function cheer() {
    boing();
    speak(CHEER_TEXT);
  }

  function init() {
    if (els.btn) return;
    var art = getArtSvg();
    if (!art) return; // 素材模块缺失时静默降级：不渲染吉祥物，不影响主功能

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'mascot-btn';
    btn.className = 'mascot-btn';
    btn.title = '点我抽个好彩头';
    btn.setAttribute('aria-label', '吉祥物：点一下抽取好运语录');

    var figure = document.createElement('span');
    figure.className = 'mascot-figure';
    figure.innerHTML = art;

    var bubble = document.createElement('span');
    bubble.className = 'mascot-bubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');

    btn.appendChild(figure);
    btn.appendChild(bubble);
    document.body.appendChild(btn);

    els.btn = btn;
    els.figure = figure;
    els.bubble = bubble;
    els.wrap = figure.querySelector('#wrap'); // 素材内 Q 弹动画载体

    // 素材规则 #wrap.bounce 优先级高于 #wrap：动画播完后若类不摘，
    // idle 呼吸会一直被顶掉；播完即摘类，呼吸自然回归。
    els.wrap.addEventListener('animationend', function (event) {
      if (event.animationName === 'bounce') {
        els.wrap.classList.remove('bounce');
      }
    });

    btn.addEventListener('click', onInteract);
  }

  window.Mascot = { init: init, boing: boing, cheer: cheer };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
