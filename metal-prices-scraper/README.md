# Metal Prices Scraper

Captures daily metal prices from EEPC India's BigMint feed and appends them to a CSV. Runs on GitHub Actions twice a day:

- **12:00 PM IST** — initial daily capture
- **10:58 PM IST** — evening re-check. If prices changed during the day, that same date's row is overwritten with the new values. If nothing changed, the file is left untouched (no commit).

Because it runs on GitHub's servers, it does not depend on your laptop being on.

## Files

- `scraper.py` — fetches the daily JSON feed and updates `prices.csv`
- `backfill_history.py` — one-time / on-demand backfill of past historical prices (default: 3 years)
- `requirements.txt` — Python dependencies (`requests`, `tzdata` on Windows)
- `prices.csv` — the data file (grows by one row per day)

GitHub Actions workflows live in `.github/workflows/` at the repo root:

- `metal-prices-scrape.yml` — the daily scheduled scraper (12:00 PM + 10:58 PM IST)
- `metal-prices-backfill.yml` — on-demand historical backfill (you trigger it manually)

## CSV layout

Wide format: each metal product is one column. The first 4 rows describe each column; every subsequent row is one day.

| (col A)    | (col B)                       | (col C)                      | ... |
|------------|-------------------------------|------------------------------|-----|
| Product    | Pig Iron, Exw-Durgapur, India | Pig Iron, DAP-Ludhiana, India| ... |
| Grade      | Steel Grade                   | Foundry Grade                | ... |
| Commodity  | Scrap & Metallics / Pig Iron  | Scrap & Metallics / Pig Iron | ... |
| Currency   | INR                           | INR                          | ... |
| 2026-05-12 | 38150                         | 43500                        | ... |
| 2026-05-13 | 38200                         | 43600                        | ... |

If a new product appears in the feed later, it is appended as a new column. Past dates get an empty cell for that column. Products that disappear from the feed keep their column (so historical data is preserved).

## Setup (one-time)

1. Push the branch to GitHub and merge it to `main`. **GitHub only runs scheduled workflows on the repo's default branch.**
2. In the GitHub repo: **Settings → Actions → General → Workflow permissions** — select **"Read and write permissions"** so the workflow can commit the updated CSV back.
3. Done. The two cron jobs will run automatically every day.

## Manual run / testing

Repo's **Actions** tab → **"Scrape Metal Prices"** → **"Run workflow"**.

## Historical backfill

The CSV ships pre-seeded with **3 years of historical prices** (back to 2023-05-13). To re-backfill, or to fetch more (or fewer) years:

Repo's **Actions** tab → **"Backfill Metal Prices History"** → **"Run workflow"** → enter the number of years (default 3). The workflow merges the historical points into `prices.csv` and commits the result.

### How the backfill works

For each product the daily feed lists, the script extracts BigMint's internal product ID from its detail-page URL and calls the public chart endpoint:

```
https://www.bigmint.co/prices_tg/graph/{product_id}/{currency}/f
```

It returns `[[timestamp_ms, price], ...]` going back many years. The script filters to your chosen window and merges into `prices.csv`.

Notes:
- Most products are **daily** (~250 trading days/year). A few are **weekly** (e.g. Rebar, HRC) so they only have 1 row per week historically. The daily scraper fills these in daily going forward.
- Future-dated points (BigMint sometimes publishes a weekly assessment dated to the upcoming Friday) are filtered out.

## Run locally (optional)

```
pip install -r metal-prices-scraper/requirements.txt
python metal-prices-scraper/scraper.py           # today's prices
python metal-prices-scraper/backfill_history.py  # 3-year backfill
python metal-prices-scraper/backfill_history.py --years 5
```

## Data sources

```
Daily snapshot:  https://bigmint.co/getApiData/EEPC_qkoeI6XB7YZhxupVE2Oe93
Historical:      https://www.bigmint.co/prices_tg/graph/{id}/{currency}/f
```

Both are the same endpoints loaded by the public EEPC / BigMint pages. The daily one is what powers **Metal Prices** on https://www.eepcindia.org/big-mint; the historical one is what powers the chart on each product's BigMint detail page.

## Notes

- GitHub Actions cron is best-effort. Runs can occasionally be delayed by 5–15 minutes during peak load on the free tier.
- For private repos, the free tier gives 2000 Action-minutes/month. This workflow uses roughly **45 minutes/month** (2 runs/day × ~45s each).
- For public repos, Actions are unlimited.
