# -*- coding: utf-8 -*-
"""构建吉祥物素材模块 tools/build_mascot_art.py

从用户原始素材 assets/涨涨涨_Q弹.svg 生成 js/ui/mascot-art.js：
  1. 把内嵌位图 PNG 的纯白背景转为透明——从画布四边泛洪填充，
     仅"与边框连通"的近白像素变透明；角色内部被描边包住的白色
     （思考泡、蕾丝褶边、白裙等）不受影响；
  2. 剥离素材内嵌 <script>（innerHTML 注入不会执行，交互由
     js/ui/mascot.js 实现）与根节点固定尺寸/白底内联样式；
  3. 根 <svg> 挂 class="mascot-svg"，尺寸走站点 CSS；
  4. 导出 window.MASCOT_SVG 字符串。

用法：python tools/build_mascot_art.py（在项目根目录执行）
"""
import base64
import io
import json
import re
import sys
from collections import deque

from PIL import Image

ASSET = 'assets/涨涨涨_Q弹.svg'
OUT = 'js/ui/mascot-art.js'
WHITE_MIN = 245  # min(R,G,B) >= 该值视为近白


def remove_white_background(png_bytes):
    """边缘泛洪：与画布边框连通的近白像素 → 透明。"""
    img = Image.open(io.BytesIO(png_bytes)).convert('RGBA')
    w, h = img.size
    px = img.load()

    def is_near_white(x, y):
        r, g, b, a = px[x, y]
        return a > 0 and min(r, g, b) >= WHITE_MIN

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if is_near_white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_near_white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] \
                    and is_near_white(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return img


def main():
    src = io.open(ASSET, encoding='utf-8').read()

    m = re.search(r'href="data:image/png;base64,([^"]+)"', src)
    if not m:
        sys.exit('未找到内嵌 PNG')
    img = remove_white_background(base64.b64decode(m.group(1)))
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    out_png = base64.b64encode(buf.getvalue()).decode('ascii')
    src = src[:m.start(1)] + out_png + src[m.end(1):]

    # 剥离内嵌脚本与根节点内联样式，挂站点类
    out = re.sub(r'<script[\s\S]*?</script>', '', src)
    out = re.sub(r'(<svg[^>]*?) style="[^"]*"', r'\1', out, count=1)
    out = out.replace('<svg id="sticker"', '<svg id="sticker" class="mascot-svg"', 1)
    assert 'class="mascot-svg"' in out and '<script' not in out

    header = (
        '/* ==========================================================================\n'
        ' * 股迹 v0.7 · 吉祥物美术素材模块（用户提供，本文件由 tools/build_mascot_art.py 生成）\n'
        ' * --------------------------------------------------------------------------\n'
        ' * 源文件：assets/涨涨涨_Q弹.svg。生成时处理：内嵌位图白底转透明（边缘泛洪，\n'
        ' * 角色内部白色不受影响）；剥离内嵌脚本与固定尺寸内联样式。\n'
        ' * Q 弹与语录气泡的交互由 js/ui/mascot.js 实现。改动素材后重跑构建脚本。\n'
        ' * ========================================================================== */\n'
    )
    body = 'window.MASCOT_SVG = ' + json.dumps(out, ensure_ascii=False) + ';\n'
    io.open(OUT, 'w', encoding='utf-8', newline='\n').write(header + body)
    print('OK ->', OUT, '| png', len(out_png), 'b64 chars | svg', len(out), 'chars')


if __name__ == '__main__':
    main()
