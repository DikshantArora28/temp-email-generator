#!/usr/bin/env python3
"""Fetch metal prices from EEPC India's BigMint feed and update prices.csv.

Runs twice a day on GitHub Actions: 12:00 PM IST (initial capture) and
10:58 PM IST (re-check). The same date's row is overwritten on the second
run if prices changed; otherwise the file is left unchanged.
"""
import csv
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

API_URL = "https://bigmint.co/getApiData/EEPC_qkoeI6XB7YZhxupVE2Oe93"
CSV_PATH = Path(__file__).parent / "prices.csv"
HEADER_LABELS = ["Product", "Grade", "Commodity", "Currency"]


def fetch_items():
    resp = requests.get(
        API_URL,
        headers={
            "Accept": "application/json",
            "Referer": "https://www.eepcindia.org/",
            "User-Agent": "Mozilla/5.0 (compatible; metal-prices-scraper)",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("price") or []


def format_commodity(item):
    parts = [
        item.get("Commodity", ""),
        item.get("SubCommodity", ""),
        item.get("SubSubCommodity", ""),
    ]
    return " / ".join(p for p in parts if p)


def load_csv(path):
    """Return (metadata, dated_rows) keyed by (title, grade) tuples."""
    metadata = {}
    dated_rows = {}
    if not path.exists():
        return metadata, dated_rows

    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))

    if len(rows) < len(HEADER_LABELS):
        return metadata, dated_rows

    titles = rows[0][1:]
    grades = rows[1][1:] if len(rows) > 1 else []
    commodities = rows[2][1:] if len(rows) > 2 else []
    currencies = rows[3][1:] if len(rows) > 3 else []

    keys = []
    for i, title in enumerate(titles):
        grade = grades[i] if i < len(grades) else ""
        key = (title, grade)
        keys.append(key)
        metadata[key] = {
            "Title": title,
            "Grade": grade,
            "Commodity": commodities[i] if i < len(commodities) else "",
            "Currency": currencies[i] if i < len(currencies) else "",
        }

    for row in rows[len(HEADER_LABELS):]:
        if not row or not row[0].strip():
            continue
        date = row[0]
        prices = {}
        for i, key in enumerate(keys):
            if i + 1 < len(row) and row[i + 1] != "":
                prices[key] = row[i + 1]
        dated_rows[date] = prices

    return metadata, dated_rows


def write_csv(path, metadata, dated_rows):
    keys = list(metadata.keys())
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Product"] + [metadata[k]["Title"] for k in keys])
        w.writerow(["Grade"] + [metadata[k]["Grade"] for k in keys])
        w.writerow(["Commodity"] + [metadata[k]["Commodity"] for k in keys])
        w.writerow(["Currency"] + [metadata[k]["Currency"] for k in keys])
        for date in sorted(dated_rows.keys()):
            w.writerow([date] + [dated_rows[date].get(k, "") for k in keys])


def main():
    items = fetch_items()
    if not items:
        print("ERROR: API returned no metal price items", file=sys.stderr)
        return 1

    today = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d")
    metadata, dated_rows = load_csv(CSV_PATH)

    today_prices = {}
    for item in items:
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
        price = item.get("Price")
        if price not in (None, ""):
            today_prices[key] = str(price)
    dated_rows[today] = today_prices

    write_csv(CSV_PATH, metadata, dated_rows)
    print(f"Wrote {CSV_PATH} for {today}: {len(today_prices)} products")
    return 0


if __name__ == "__main__":
    sys.exit(main())
