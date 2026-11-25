#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 js/data/pool.json 生成 js/data/universe.js。

用法：
    python tools/build_universe.py           # 生成
    python tools/build_universe.py --check   # 只校验，universe.js 过期时返回 1

pool.json 是唯一清单：分组、代码、名称、腾讯代码、类型、行业都写在里面。
换池子只改 pool.json，然后重跑本脚本（build_snapshot.py 也会自动调用）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SYMBOL_RE = re.compile(r"^\d{6}$")
INDEX_SYMBOL_RE = re.compile(r"^(SH|SZ)\d{6}$")
TX_RE = re.compile(r"^(sh|sz)\d{6}$")
TYPES = {"stock", "etf", "index"}

HEADER = """/* 本文件由 tools/build_universe.py 从 js/data/pool.json 生成，请勿手改。
 * 换池子：改 pool.json -> python tools/build_universe.py（或 build_snapshot.py）。
 * UNIVERSE / INDICES / ALL_SYMBOLS 跟随当前分组；
 * UNIVERSE_BY_SYMBOL / ALL_BY_SYMBOL / TX_TO_SYMBOL 覆盖全部分组，
 * 这样切换分组后，另一组的持仓仍能解析名称、读行情，不会被当成未知标的丢掉。
 */
"""


def load_pool(root: Path) -> dict:
    path = root / "js" / "data" / "pool.json"
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def validate(pool: dict) -> list[str]:
    errors: list[str] = []
    groups = pool.get("groups")
    if not isinstance(groups, dict) or not groups:
        return ["pool.json 缺少 groups"]
    default = pool.get("defaultGroup")
    if default not in groups:
        errors.append(f"defaultGroup={default!r} 不在 groups 中")

    seen_tx: dict[str, str] = {}
    for key, group in groups.items():
        label = group.get("label") or key
        stocks = group.get("stocks")
        indices = group.get("indices")
        if not isinstance(stocks, list) or not stocks:
            errors.append(f"{label}: stocks 为空")
            continue
        if not isinstance(indices, list):
            errors.append(f"{label}: indices 不是数组")
            continue
        seen_symbol: set[str] = set()
        for kind, items in (("stocks", stocks), ("indices", indices)):
            for item in items:
                symbol = str(item.get("symbol", ""))
                tx = str(item.get("tx", ""))
                name = str(item.get("name", "")).strip()
                item_type = item.get("type")
                symbol_ok = INDEX_SYMBOL_RE.match(symbol) if kind == "indices" else SYMBOL_RE.match(symbol)
                if not symbol_ok:
                    errors.append(f"{label}/{kind}: symbol 非法 {symbol!r}")
                if symbol in seen_symbol:
                    errors.append(f"{label}: symbol 重复 {symbol}")
                seen_symbol.add(symbol)
                if not TX_RE.match(tx):
                    errors.append(f"{label}/{symbol}: tx 非法 {tx!r}")
                elif tx in seen_tx and seen_tx[tx] != symbol:
                    errors.append(f"{label}/{symbol}: tx 与其他分组重复 {tx}")
                seen_tx[tx] = symbol
                if not name:
                    errors.append(f"{label}/{symbol}: 缺 name")
                if item_type not in TYPES:
                    errors.append(f"{label}/{symbol}: type 非法 {item_type!r}")
                if kind == "indices" and item_type != "index":
                    errors.append(f"{label}/{symbol}: indices 里的 type 必须是 index")
                if kind == "stocks" and item_type == "index":
                    errors.append(f"{label}/{symbol}: stocks 里不应出现 index")
                if TX_RE.match(tx) and tx[2:] != symbol[-6:]:
                    errors.append(f"{label}/{symbol}: tx 与 symbol 不一致 {tx}")
    return errors


def build_js(pool: dict) -> str:
    payload = json.dumps(pool, ensure_ascii=False, indent=2)
    return (
        HEADER
        + "(function () {\n"
        + "  'use strict';\n"
        + "  var POOL = " + payload + ";\n"
        + "  var GROUPS = POOL.groups;\n"
        + "  var allItems = [];\n"
        + "  var allBySymbol = {};\n"
        + "  var txToSymbol = {};\n"
        + "  Object.keys(GROUPS).forEach(function (key) {\n"
        + "    var group = GROUPS[key];\n"
        + "    group.stocks.concat(group.indices).forEach(function (item) {\n"
        + "      if (!allBySymbol[item.symbol]) {\n"
        + "        allBySymbol[item.symbol] = item;\n"
        + "        allItems.push(item);\n"
        + "      }\n"
        + "      txToSymbol[item.tx] = item.symbol;\n"
        + "    });\n"
        + "  });\n"
        + "  function bySymbol(items) {\n"
        + "    return items.reduce(function (map, item) {\n"
        + "      map[item.symbol] = item;\n"
        + "      return map;\n"
        + "    }, {});\n"
        + "  }\n"
        + "  function activate(name) {\n"
        + "    var group = GROUPS[name];\n"
        + "    if (!group) return null;\n"
        + "    window.ACTIVE_POOL_GROUP = name;\n"
        + "    window.POOL_GROUP_LABEL = group.label || name;\n"
        + "    window.UNIVERSE = group.stocks.slice();\n"
        + "    window.INDICES = group.indices.slice();\n"
        + "    window.ALL_SYMBOLS = window.UNIVERSE.concat(window.INDICES);\n"
        + "    window.ACTIVE_BY_SYMBOL = bySymbol(window.ALL_SYMBOLS);\n"
        + "    return name;\n"
        + "  }\n"
        + "  window.POOL = POOL;\n"
        + "  window.POOL_GROUPS = GROUPS;\n"
        + "  window.POOL_ITEMS = allItems;\n"
        + "  window.UNIVERSE_BY_SYMBOL = bySymbol(allItems.filter(function (item) {\n"
        + "    return item.type !== 'index';\n"
        + "  }));\n"
        + "  window.ALL_BY_SYMBOL = allBySymbol;\n"
        + "  window.TX_TO_SYMBOL = txToSymbol;\n"
        + "  window.setPoolGroup = activate;\n"
        + "  window.getPoolGroup = function () { return window.ACTIVE_POOL_GROUP; };\n"
        + "  activate(POOL.defaultGroup);\n"
        + "})();\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="从 pool.json 生成 universe.js")
    parser.add_argument("--check", action="store_true", help="只检查 universe.js 是否为最新")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    pool = load_pool(root)
    errors = validate(pool)
    if errors:
        print("pool.json 校验失败：")
        for item in errors:
            print(" -", item)
        return 1

    out_path = root / "js" / "data" / "universe.js"
    content = build_js(pool)

    if args.check:
        current = out_path.read_text(encoding="utf-8") if out_path.exists() else ""
        if current != content:
            print("universe.js 与 pool.json 不一致，请运行 python tools/build_universe.py")
            return 1
        print("universe.js 与 pool.json 一致")
        return 0

    out_path.write_text(content, encoding="utf-8")
    groups = ", ".join(f"{key}({len(g['stocks'])}+{len(g['indices'])})" for key, g in pool["groups"].items())
    print(f"已写入 {out_path}；分组：{groups}；默认 {pool['defaultGroup']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
