#!/usr/bin/env python3
"""One-time backfill of historical metal prices (default: past 3 years).

Discovers products via the daily snapshot API used by scraper.py, then for
each product fetches its full historical series from BigMint's public chart
endpoint:

    https://www.bigmint.co/prices_tg/graph/{product_id}/{currency}/{flag}

The product ID + flag + currency are parsed from each item's `href` field
in the daily feed (e.g. `.../pig-iron-exw-durgapur-india-1096-f-INR`).
Returned points (`[[ts_ms, price], ...]`) are filtered to the cutoff date and
merged into prices.csv using the same wide-format layout as scraper.py.

Run this once after setup. The daily scheduled scraper picks up new days
automatically from then on.

Usage:
  python backfill_history.py              # 3 years (default)
  python backfill_history.py --years 5
"""
import argparse
import re
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

from scraper import (
    CSV_PATH,
    fetch_items,
    format_commodity,
    load_csv,
    write_csv,
)

GRAPH_URL = "https://www.bigmint.co/prices_tg/graph/{pid}/{currency}/{flag}"
HREF_RE = re.compile(r"-(\d+)-([a-z]+)-([A-Z]+)/?$")


def parse_href(href):
    """Return (product_id, flag, currency) parsed from a BigMint detail URL."""
    m = HREF_RE.search(href or "")
    if not m:
        return None, None, None
    return m.group(1), m.group(2), m.group(3)


def fetch_history(pid, flag, currency):
    url = GRAPH_URL.format(pid=pid, currency=currency, flag=flag)
    resp = requests.get(
        url,
        headers={
            "Accept": "application/json",
            "Referer": "https://www.bigmint.co/",
            "User-Agent": "Mozilla/5.0 (compatible; metal-prices-scraper)",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("point") or []


def main(years):
    items = fetch_items()
    if not items:
        print("ERROR: API returned no metal price items", file=sys.stderr)
        return 1

    ist = ZoneInfo("Asia/Kolkata")
    today = datetime.now(ist).date()
    cutoff = today - timedelta(days=365 * years)
    print(f"Backfilling from {cutoff} to {today}")

    metadata, dated_rows = load_csv(CSV_PATH)

    for idx, item in enumerate(items, start=1):
        title = (item.get("Title") or "").strip()
        grade = (item.get("GradeSize") or "").strip()
        if not title:
            continue

        key = (title, grade)
        metadata[key] = {
            "Title": title,
            "Grade": grade,
            "Commodity": format_commodity(item),
            "Currency": item.get("Currency", ""),
        }

        pid, flag, currency = parse_href(item.get("href"))
        prefix = f"[{idx:2d}/{len(items)}] {title[:48]:48s} ({grade[:25]:25s})"
        if not pid:
            print(f"{prefix} SKIP (no product ID in href)")
            continue

        try:
            points = fetch_history(pid, flag, currency)
        except Exception as e:
            print(f"{prefix} FAILED: {e}")
            continue

        added = 0
        for entry in points:
            if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                continue
            ts_ms, price = entry[0], entry[1]
            if price in (None, ""):
                continue
            try:
                d = datetime.fromtimestamp(float(ts_ms) / 1000, tz=ist).date()
            except (TypeError, ValueError, OSError):
                continue
            if d < cutoff or d > today:
                continue
            dated_rows.setdefault(d.strftime("%Y-%m-%d"), {})[key] = str(price)
            added += 1
        print(f"{prefix} +{added:4d} pts")
        time.sleep(0.4)

    write_csv(CSV_PATH, metadata, dated_rows)
    print(f"\nWrote {CSV_PATH} - {len(dated_rows)} dated rows total")
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Backfill historical metal prices")
    p.add_argument("--years", type=int, default=3, help="Years of history (default: 3)")
    args = p.parse_args()
    sys.exit(main(args.years))
