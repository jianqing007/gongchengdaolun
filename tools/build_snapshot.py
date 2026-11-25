#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""采集日线，生成 js/data/snapshot.js（断网兜底 + 指标/回测数据）。

用法：
    python tools/build_snapshot.py            # 全量采集（2015 年起）
    python tools/build_snapshot.py --update   # 增量：只补现有快照最后日期之后
    python tools/build_snapshot.py --update --full   # 强制全量

清单唯一来源是 js/data/pool.json：
  - 脚本按分组取并集，一次采完所有分组，切换分组不需要重新采集；
  - type=stock 用前复权（qfq），type=etf / index 不复权（腾讯对指数与 ETF 无复权概念）。

增量模式会多取约 10 天重叠数据核对复权价：若腾讯因分红重新调整了历史前复权价，
重叠区间的收盘价会变化，此时自动改为全量重采，避免新旧价格拼接出假跳空。

采集不完整时只写 snapshot.partial.js，绝不覆盖正在使用的 snapshot.js。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import build_universe

BASE_URLS = [
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get",
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get",
    "https://ifzq.gtimg.cn/appstock/app/fqkline/get",
]
BASE_URL = BASE_URLS[0]
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0 Safari/537.36"
    ),
    "Referer": "https://gu.qq.com/",
    "Accept": "application/json,text/plain,*/*",
}
TARGET_START = date(2015, 1, 1)
MIN_BARS = 20
CURL = shutil.which("curl")


def fetch_json(url: str, timeout: int = 30) -> dict:
    """优先系统 curl（Windows 的 schannel 对部分站点更稳），失败再退回 urllib。"""
    if CURL:
        cmd = [CURL, "-sS", "--max-time", str(timeout), "-H", "User-Agent: " + HEADERS["User-Agent"],
               "-H", "Referer: " + HEADERS["Referer"]]
        if os.name == "nt":
            cmd.append("--ssl-no-revoke")
        cmd.append(url)
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout + 5)
        if proc.returncode == 0 and proc.stdout.strip():
            return json.loads(proc.stdout.decode("utf-8"))
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"curl 失败（{proc.returncode}）：{err[:200]}")

    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_page(tx_code: str, start: date, end: date, adjust: str) -> list[list]:
    """按 BASE_URLS 依次尝试；某个域名被 WAF 拦或返回非 JSON 时自动换下一个。"""
    global BASE_URL
    ordered = [BASE_URL] + [url for url in BASE_URLS if url != BASE_URL]
    last_error: Exception | None = None
    for base in ordered:
        url = f"{base}?param={tx_code},day,{start.isoformat()},{end.isoformat()},640,{adjust}"
        try:
            payload = fetch_json(url)
        except Exception as exc:  # noqa: BLE001 - WAF 会返回 HTML，需要换域名
            last_error = exc
            continue
        if not isinstance(payload, dict) or payload.get("code") not in (0, None):
            last_error = RuntimeError(f"{base} 返回异常：{str(payload)[:120]}")
            continue
        BASE_URL = base
        data = payload.get("data") or {}
        item = data.get(tx_code) or {}
        bars = item.get("qfqday") or item.get("day") or []
        return bars
    if last_error:
        raise last_error
    return []


def fetch_all_bars(tx_code: str, adjust: str, start: date = TARGET_START) -> list[list]:
    """从最新日期向前翻页，直到覆盖 start 或没有更多数据。"""
    end = date.today()
    by_date: dict[str, list] = {}
    for _ in range(40):
        raw = fetch_page(tx_code, start, end, adjust)
        if not raw:
            break
        for row in raw:
            if len(row) < 6:
                continue
            by_date[row[0]] = [
                row[0],
                float(row[1]),
                float(row[2]),
                float(row[3]),
                float(row[4]),
                int(float(row[5])),
            ]
        earliest = min(by_date.keys())
        if earliest <= start.isoformat():
            break
        end = date.fromisoformat(earliest) - timedelta(days=1)
        time.sleep(0.4)

    bars = [by_date[key] for key in sorted(by_date.keys())]
    bars = [bar for bar in bars if bar[0] >= start.isoformat()]
    return bars


def merge_bars(existing: list[list], new: list[list]) -> list[list]:
    by_date = {bar[0]: bar for bar in existing}
    for bar in new:
        by_date[bar[0]] = bar
    return [by_date[key] for key in sorted(by_date.keys())]


def adjustment_changed(existing: list[list], fetched: list[list]) -> bool:
    """重叠日期上的收盘价明显不同，说明前复权因子被重算过。"""
    old = {bar[0]: bar for bar in existing}
    checked = 0
    for bar in fetched:
        base = old.get(bar[0])
        if not base:
            continue
        checked += 1
        tolerance = max(0.011, abs(float(bar[2])) * 1e-4)
        if abs(float(base[2]) - float(bar[2])) > tolerance:
            return True
    return False


def load_existing(path: Path) -> dict | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    prefix = "window.SNAPSHOT = "
    if not text.startswith(prefix):
        return None
    raw = text[len(prefix):].rstrip()
    if raw.endswith(";"):
        raw = raw[:-1]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def collect_item(item: dict, existing: dict | None, update: bool, full: bool) -> tuple[list[list], str]:
    adjust = "qfq" if item.get("type") == "stock" else ""
    tx = item["tx"]
    old = []
    if update and not full and existing:
        old = (existing.get("stocks", {}).get(item["symbol"]) or
               existing.get("indices", {}).get(item["symbol"]) or {}).get("bars") or []
    if not old:
        bars = fetch_all_bars(tx, adjust)
        if len(bars) < MIN_BARS:
            raise RuntimeError(f"K 线数量异常：{len(bars)}")
        return bars, "全量"

    last_date = date.fromisoformat(old[-1][0])
    overlap_start = max(TARGET_START, last_date - timedelta(days=10))
    fetched = fetch_all_bars(tx, adjust, overlap_start)
    if adjustment_changed(old, fetched):
        bars = fetch_all_bars(tx, adjust)
        if len(bars) < MIN_BARS:
            raise RuntimeError(f"K 线数量异常：{len(bars)}")
        return bars, "复权变化→全量"
    merged = merge_bars(old, fetched)
    added = len(merged) - len(old)
    return merged, f"增量 +{added}"


def main() -> int:
    parser = argparse.ArgumentParser(description="采集日线生成 snapshot.js")
    parser.add_argument("--update", action="store_true", help="增量更新（默认全量）")
    parser.add_argument("--full", action="store_true", help="与 --update 同用时强制全量")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    pool_path = root / "js" / "data" / "pool.json"
    pool = json.loads(pool_path.read_text(encoding="utf-8"))
    errors = build_universe.validate(pool)
    if errors:
        print("pool.json 校验失败：")
        for item in errors:
            print(" -", item)
        return 1

    # universe.js 由同一份 pool.json 生成，采集前先对齐。
    universe_path = root / "js" / "data" / "universe.js"
    universe_path.write_text(build_universe.build_js(pool), encoding="utf-8")

    items: list[dict] = []
    seen: set[str] = set()
    for group in pool["groups"].values():
        for item in group["stocks"] + group["indices"]:
            if item["symbol"] in seen:
                continue
            seen.add(item["symbol"])
            items.append(item)

    out_path = root / "js" / "data" / "snapshot.js"
    existing = load_existing(out_path) if args.update else None
    if args.update and existing:
        print(f"增量模式：现有快照 {out_path.name}，"
              f"{len(existing.get('stocks', {}))} 只股票 / {len(existing.get('indices', {}))} 个指数")
    elif args.update:
        print("增量模式：没有可读的现有快照，改为全量。")

    cn_tz = timezone(timedelta(hours=8))
    fetched_at = datetime.now(cn_tz).isoformat(timespec="seconds")
    snapshot = {
        "meta": {
            "source": "腾讯证券公开历史行情接口",
            "adjust": "股票前复权；ETF/指数不复权",
            "period": "日线",
            "fetchedAt": fetched_at,
            "fields": ["date", "open", "close", "high", "low", "volume"],
            "note": "volume 单位为手；仅用于课程学习。",
            "poolVersion": pool.get("version", 1),
        },
        "stocks": {},
        "indices": {},
    }

    failures: list[str] = []
    modes: dict[str, int] = {}

    for item in items:
        symbol = item["symbol"]
        print(f"采集 {symbol} {item['name']} ({item['type']}) ...", flush=True)
        try:
            bars, mode = collect_item(item, existing, args.update, args.full)
            modes[mode] = modes.get(mode, 0) + 1
            entry = {
                "symbol": symbol,
                "name": item["name"],
                "tx": item["tx"],
                "type": item["type"],
                "sector": item.get("sector", ""),
                "bars": bars,
            }
            if item["type"] == "index":
                entry["code"] = item.get("code", symbol)
                snapshot["indices"][symbol] = entry
            else:
                snapshot["stocks"][symbol] = entry
            print(f"  {mode}：{len(bars)} 根，{bars[0][0]} → {bars[-1][0]}", flush=True)
        except Exception as exc:  # noqa: BLE001 - 采集脚本需要容错
            failures.append(f"{symbol} {item['name']}: {exc}")
            print(f"  失败：{exc}", flush=True)
        time.sleep(0.5)

    if not snapshot["stocks"]:
        print("没有采集到任何股票数据，未写入文件。")
        return 1

    snapshot["meta"]["lastDate"] = max(
        entry["bars"][-1][0]
        for section in ("stocks", "indices")
        for entry in snapshot[section].values()
    )
    snapshot["meta"]["symbols"] = len(snapshot["stocks"]) + len(snapshot["indices"])

    js = "window.SNAPSHOT = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n"
    expected = len(items)
    got = len(snapshot["stocks"]) + len(snapshot["indices"])

    if failures or got < expected:
        # 采集不完整时只写 partial，绝不覆盖可用的 snapshot.js。
        partial_path = out_path.with_name("snapshot.partial.js")
        partial_path.write_text(js, encoding="utf-8")
        size_mb = partial_path.stat().st_size / 1024 / 1024
        print(f"\n采集不完整（{got}/{expected}），已写入 {partial_path}（{size_mb:.2f} MB），未覆盖 snapshot.js。")
        print("以下标的采集失败，请重跑：")
        for item in failures:
            print(" -", item)
        return 1

    out_path.write_text(js, encoding="utf-8")
    partial_path = out_path.with_name("snapshot.partial.js")
    if partial_path.exists():
        partial_path.unlink()
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\n已写入 {out_path}（{size_mb:.2f} MB）")
    print(f"股票/ETF {len(snapshot['stocks'])} 只，指数 {len(snapshot['indices'])} 个，"
          f"数据截至 {snapshot['meta']['lastDate']}")
    print("模式：" + "，".join(f"{key} {value} 个" for key, value in sorted(modes.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
