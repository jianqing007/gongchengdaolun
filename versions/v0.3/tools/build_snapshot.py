#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""采集前复权日线，生成 js/data/snapshot.js（断网兜底 + 后续指标计算）。

用法：python tools/build_snapshot.py
依赖：Python 3 标准库 + 系统 curl（Windows 10/11 自带）。
腾讯接口单次最多约 640 根 K 线，脚本按结束日期向前翻页，拼接 2015 年至今的数据。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

STOCKS = [
    ("600519", "贵州茅台", "sh600519", "食品饮料"),
    ("000858", "五粮液", "sz000858", "食品饮料"),
    ("300750", "宁德时代", "sz300750", "电力设备"),
    ("002594", "比亚迪", "sz002594", "汽车"),
    ("600036", "招商银行", "sh600036", "银行"),
    ("601318", "中国平安", "sh601318", "非银金融"),
    ("000333", "美的集团", "sz000333", "家用电器"),
    ("600900", "长江电力", "sh600900", "公用事业"),
    ("601888", "中国中免", "sh601888", "商贸零售"),
    ("600887", "伊利股份", "sh600887", "食品饮料"),
]

INDICES = [
    ("SH000001", "上证指数", "sh000001"),
    ("SH000300", "沪深300", "sz399300"),
]

BASE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
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


def fetch_page(tx_code: str, end: date) -> list[list]:
    url = (
        f"{BASE_URL}?param={tx_code},day,{TARGET_START.isoformat()},{end.isoformat()},640,qfq"
    )
    payload = fetch_json(url)
    data = payload.get("data") or {}
    item = data.get(tx_code) or {}
    bars = item.get("qfqday") or item.get("day") or []
    return bars


def fetch_all_bars(tx_code: str) -> list[list]:
    """从最新日期向前翻页，直到覆盖 2015-01-01 或没有更多数据。"""
    end = date.today()
    by_date: dict[str, list] = {}
    for _ in range(10):
        raw = fetch_page(tx_code, end)
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
        if earliest <= TARGET_START.isoformat():
            break
        end = date.fromisoformat(earliest) - timedelta(days=1)
        time.sleep(0.5)

    bars = [by_date[key] for key in sorted(by_date.keys())]
    bars = [bar for bar in bars if bar[0] >= TARGET_START.isoformat()]
    if len(bars) < 100:
        raise RuntimeError(f"K 线数量异常：{len(bars)}")
    return bars


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    out_path = root / "js" / "data" / "snapshot.js"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cn_tz = timezone(timedelta(hours=8))
    fetched_at = datetime.now(cn_tz).isoformat(timespec="seconds")

    snapshot = {
        "meta": {
            "source": "腾讯证券公开历史行情接口",
            "adjust": "前复权",
            "period": "日线",
            "fetchedAt": fetched_at,
            "fields": ["date", "open", "close", "high", "low", "volume"],
            "note": "volume 单位为手；仅用于课程学习。",
        },
        "stocks": {},
        "indices": {},
    }

    failures: list[str] = []

    for symbol, name, tx_code, sector in STOCKS:
        print(f"采集 {symbol} {name} ...", flush=True)
        try:
            bars = fetch_all_bars(tx_code)
            snapshot["stocks"][symbol] = {
                "symbol": symbol,
                "name": name,
                "tx": tx_code,
                "sector": sector,
                "bars": bars,
            }
            print(f"  {len(bars)} 根，{bars[0][0]} → {bars[-1][0]}", flush=True)
        except Exception as exc:  # noqa: BLE001 - 采集脚本需要容错
            failures.append(f"{symbol} {name}: {exc}")
            print(f"  失败：{exc}", flush=True)
        time.sleep(0.6)

    for symbol, name, tx_code in INDICES:
        print(f"采集 {symbol} {name} ...", flush=True)
        try:
            bars = fetch_all_bars(tx_code)
            snapshot["indices"][symbol] = {
                "symbol": symbol,
                "code": symbol.replace("SH", ""),
                "name": name,
                "tx": tx_code,
                "bars": bars,
            }
            print(f"  {len(bars)} 根，{bars[0][0]} → {bars[-1][0]}", flush=True)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{symbol} {name}: {exc}")
            print(f"  失败：{exc}", flush=True)
        time.sleep(0.6)

    if not snapshot["stocks"]:
        print("没有采集到任何股票数据，未写入文件。")
        return 1

    js = "window.SNAPSHOT = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n"
    expected = len(STOCKS) + len(INDICES)
    got = len(snapshot["stocks"]) + len(snapshot["indices"])

    if failures or got < expected:
        # 采集不完整时只写 partial，绝不覆盖可用的 snapshot.js。
        partial_path = out_path.with_name("snapshot.partial.js")
        partial_path.write_text(js, encoding="utf-8")
        size_mb = partial_path.stat().st_size / 1024 / 1024
        print(f"\n采集不完整（{got}/{expected}），已写入 {partial_path}（{size_mb:.2f} MB），未覆盖 snapshot.js。")
        print("以下标采集失败，请重跑：")
        for item in failures:
            print(" -", item)
        return 1

    out_path.write_text(js, encoding="utf-8")
    size_mb = out_path.stat().st_size / 1024 / 1024
    print(f"\n已写入 {out_path}（{size_mb:.2f} MB）")
    print(f"股票 {len(snapshot['stocks'])} 只，指数 {len(snapshot['indices'])} 个，采集时间 {fetched_at}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
