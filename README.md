# NBA Standings Tracker

[![Tests](https://github.com/bradenking44-code/nba-standings-tracker/actions/workflows/tests.yml/badge.svg)](https://github.com/bradenking44-code/nba-standings-tracker/actions/workflows/tests.yml)

A daily tracker for NBA regular-season standings. A scheduled GitHub Actions workflow saves the source response, rebuilds a deterministic team-by-day history, updates a dated GitHub Issue, commits the data, and publishes the Today, Browse, and Trends pages with GitHub Pages.

## Data source

The collector requests ESPN's NBA standings endpoint:

```text
https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=<ending-year>&seasontype=2
```

It fetches regular-season JSON without an account or API key. The response is compressed unchanged into `data/raw/<UTC date>/espn.json.gz`. The [NBA standings page](https://www.nba.com/standings) is a human-readable league reference. ESPN's endpoint is public-facing but does not provide a versioned API contract; the parser checks the response shape and marks a changed or blocked response as a source failure rather than writing invalid history. Division names are mapped from ESPN team abbreviations because the standings response groups teams by conference only.

The tracker keeps all 30 team rows returned by the source. The stable ESPN team ID is the key that joins the same team between days. The project records daily snapshots, so values remain the same on dates when no NBA games have been completed.

## History columns

`data/history.csv` has one row per team per successful UTC snapshot. Rows are sorted by date and then `item_id`.

| Column | Meaning | Unit or format |
| --- | --- | --- |
| `date` | UTC snapshot date | `YYYY-MM-DD` |
| `item_id` | ESPN team identifier | Stable string key |
| `item` | City and team name | Text |
| `source` | Source identifier | `espn` |
| `conference` | Eastern or Western conference | Text (`East` / `West`) |
| `division` | NBA division | Text |
| `rank` | League-wide position, ordered by win percentage, wins, then point differential | Integer |
| `wins` | Regular-season wins | Games |
| `losses` | Regular-season losses | Games |
| `win_pct` | Winning percentage | Decimal from 0 to 1 |
| `points_for_pg` | Points scored per game | Points per game |
| `points_against_pg` | Opponent points per game | Points per game |
| `point_diff_pg` | Points scored per game minus points allowed per game | Points per game |
| `games_back` | Games behind the conference leader | Games |
| `streak` | Current win or loss streak | Text, such as `W 3` |
| `record` | Overall record | `W-L` text |
| `home_record` | Home record | `W-L` text |
| `road_record` | Road record | `W-L` text |
| `last10` | Record in the last 10 games | `W-L` text |

Missing source values are stored as empty fields. Numeric standings fields retain the source units; win percentage is rounded to three decimals and per-game scoring values to one decimal.

## Daily movement rule

Each dated issue lists teams that appeared or disappeared, then up to five biggest movers by absolute change in win percentage from the previous successful snapshot. Change is reported in percentage points: `(new win_pct - old win_pct) × 100`. Ties are ordered by the absolute change in point differential per game, then by stable team ID. The issue table shows old and new records, win-percentage change, and point differential. A first successful run is the baseline and has no movers. The daily issue is still created when there are no changes or the source fails; a same-day rerun replaces that date's raw snapshot and updates that date's issue.

## Pipeline and site

The daily workflow runs at 12:17 UTC. It continues if the source fails, records the result in `data/status.json`, rebuilds history from saved raw files, and commits the data. Successful snapshots are counted once per UTC date. Issues are titled `NBA Standings — YYYY-MM-DD`; the previous day's issue is closed on the next successful GitHub API update.

Rebuild history from the saved raw files without a network request:

```bash
python -m nba_tracker.pipeline --build-only
```

Run a full local collection:

```bash
python -m nba_tracker.pipeline
```

The full pipeline updates GitHub Issues only when `GITHUB_TOKEN` and `GITHUB_REPOSITORY` are set. In GitHub Actions these use the repository's automatic workflow token. The Actions permissions must allow repository contents and issues writes.

Build and preview the static site locally:

```bash
python scripts/build_site.py
cd build/site
python -m http.server 8000
```

Then open `http://localhost:8000`. GitHub Pages is published by `.github/workflows/pages.yml`; set the repository's Pages build source to **GitHub Actions** if GitHub has not enabled it automatically.

The site provides:

- **Today**: latest standings ranked league-wide from best to worst, each team's change since the previous snapshot, the five biggest moves, source status, and run counts.
- **Browse**: search by team name, filters for conference and division, sort controls for every numeric standings column, and a shortlist saved in browser storage.
- **Trends**: a daily history chart with League rank selected by default, all teams shown, labeled date and metric axes, and a searchable team filter. Rank 1 appears at the top and rank 30 at the bottom. Four findings are computed in the browser from `history.csv`.
- A web-app manifest and service worker. Once loaded online, pages and the latest data remain available offline.

## Setup and checks

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
pytest
```

The tests cover source conversion, the movement rule, deterministic history rebuilding, and replacement of a same-day snapshot. GitHub Actions runs them on each push and pull request.

The assignment requires successful pipeline runs on at least seven different dates before its due date. The daily schedule starts when the workflow is enabled; elapsed days are a course requirement and cannot be met by code changes alone.

## Repository file inventory

| Path | Purpose |
| --- | --- |
| `.gitignore` | Excludes local environments, caches, and generated site output. |
| `README.md` | Project overview, data dictionary, source, move rule, setup, and this file inventory. |
| `pyproject.toml` | Python package metadata, CLI entry point, and pytest configuration. |
| `.github/workflows/pipeline.yml` | Scheduled data collection, dated issue reporting, and daily data commit. |
| `.github/workflows/pages.yml` | Builds and deploys the GitHub Pages artifact. |
| `.github/workflows/tests.yml` | Runs the pytest suite on pushes and pull requests. |
| `src/nba_tracker/__init__.py` | Python package marker. |
| `src/nba_tracker/source.py` | ESPN request, season selection, response parsing, and common-row conversion. |
| `src/nba_tracker/history.py` | Raw snapshot loading, deterministic CSV history, and status JSON builder. |
| `src/nba_tracker/pipeline.py` | Daily collection, compressed raw storage, issue report, and GitHub Issue updates. |
| `scripts/build_site.py` | Copies site assets and current data into the Pages build directory. |
| `tests/conftest.py` | Reusable standings fixture data for the test suite. |
| `tests/test_source.py` | Source mapping, season selection, and invalid-response checks. |
| `tests/test_history.py` | Date sorting, deterministic builds, same-day replacement, and status counts. |
| `tests/test_pipeline.py` | Daily mover, appeared/disappeared team, baseline, and failure-report checks. |
| `data/history.csv` | Canonical team-by-day history. |
| `data/status.json` | Latest run status, source result, date counts, and team counts. |
| `data/daily_issue.md` | Generated body for the dated GitHub Issue. |
| `data/raw/.gitkeep` | Keeps the raw archive directory in Git before the first successful run. |
| `data/raw/<date>/espn.json.gz` | Compressed, unmodified ESPN JSON response for a successful UTC date. |
| `site/index.html` | Today page with the current field, daily movement, and run status. |
| `site/browse.html` | Searchable and sortable team table with filters and saved stars. |
| `site/trends.html` | Daily metric chart and four history-based findings. |
| `site/assets/app.js` | CSV parsing, site rendering, filters, shortlist storage, and browser calculations. |
| `site/assets/site.css` | Shared colors, typography, layout, and responsive styling. |
| `site/manifest.webmanifest` | Installable web-app metadata. |
| `site/sw.js` | Offline cache for the app shell and last-loaded data files. |
| `site/icon.svg` | App and browser icon. |
| `site/.nojekyll` | Tells GitHub Pages to publish the static files directly. |
| `build/site/` | Generated Pages artifact; ignored by Git and recreated by the build script. |

