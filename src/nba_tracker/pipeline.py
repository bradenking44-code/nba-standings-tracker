"""Daily collection, deterministic rebuild, and GitHub issue reporting."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .history import build_status, load_snapshots, write_history, write_status
from .source import SOURCE_ID, SOURCE_NAME, current_season, fetch_raw, parse_standings

def _project_root() -> Path:
    """Find the checked-out project, including when this package is installed."""
    configured_root = os.environ.get("NBA_TRACKER_ROOT")
    candidates = [Path(configured_root)] if configured_root else []
    candidates.append(Path.cwd())
    candidates.extend(Path(__file__).resolve().parents)
    for candidate in candidates:
        root = candidate.resolve()
        if (root / "pyproject.toml").is_file() and (root / "data").is_dir():
            return root
    raise RuntimeError(
        "Could not find the NBA tracker project root; run from the repository or set NBA_TRACKER_ROOT."
    )


ROOT = _project_root()
RAW_DIR = ROOT / "data" / "raw"
HISTORY_PATH = ROOT / "data" / "history.csv"
STATUS_PATH = ROOT / "data" / "status.json"
ISSUE_PATH = ROOT / "data" / "daily_issue.md"


def _github_request(method: str, url: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        url,
        data=data,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
            "User-Agent": "nba-standings-tracker",
        },
    )
    with urlopen(request, timeout=30) as response:
        raw = response.read()
    return json.loads(raw) if raw else {}


def _find_issue(owner_repo: str, title: str, token: str) -> dict | None:
    url = f"https://api.github.com/repos/{owner_repo}/issues?state=all&per_page=100"
    issues = _github_request("GET", url, token)
    return next(
        (issue for issue in issues if issue.get("title") == title and "pull_request" not in issue),
        None,
    )


def publish_issue(today: str, body: str) -> None:
    token = os.environ.get("GITHUB_TOKEN", "")
    owner_repo = os.environ.get("GITHUB_REPOSITORY", "")
    if not token or not owner_repo:
        print("GitHub issue update skipped (GITHUB_TOKEN/GITHUB_REPOSITORY not set).")
        return

    title = f"NBA Standings — {today}"
    issue = _find_issue(owner_repo, title, token)
    api_root = f"https://api.github.com/repos/{owner_repo}/issues"
    if issue:
        _github_request("PATCH", f"{api_root}/{issue['number']}", token, {"body": body})
        print(f"Updated issue #{issue['number']}: {title}")
    else:
        issue = _github_request("POST", api_root, token, {"title": title, "body": body})
        print(f"Created issue #{issue.get('number')}: {title}")

    previous_date = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    previous_title = f"NBA Standings — {previous_date}"
    previous_issue = _find_issue(owner_repo, previous_title, token)
    if previous_issue and previous_issue.get("state") == "open":
        _github_request(
            "PATCH",
            f"{api_root}/{previous_issue['number']}",
            token,
            {"state": "closed"},
        )
        print(f"Closed previous issue #{previous_issue['number']}: {previous_title}")


def _fmt_pct(value: object) -> str:
    return f"{float(value):.3f}"


def make_issue_body(
    run_date: str,
    source_result: dict[str, object],
    snapshots: dict[str, list[dict[str, object]]],
) -> str:
    lines = [
        f"## NBA standings snapshot — {run_date}",
        "",
        "Daily standings are archived as one row per team. Changes are ranked by absolute "
        "change in win percentage in percentage points from the previous successful snapshot; "
        "ties use point-differential change, then team ID.",
        "",
    ]
    current = snapshots.get(run_date, []) if source_result.get("ok") else []
    previous_days = sorted(day for day in snapshots if day < run_date)
    if not source_result.get("ok"):
        retry_note = (
            f"An earlier successful attempt saved {len(snapshots[run_date])} teams for today; "
            "that snapshot remains in history."
            if run_date in snapshots
            else "No successful snapshot was saved for today. The most recent standings remain in history."
        )
        lines.extend(
            [
                f"**Source failed:** {source_result.get('error', 'unknown error')}",
                "",
                retry_note,
            ]
        )
        return "\n".join(lines) + "\n"

    lines.extend([f"**Teams captured:** {len(current)}", ""])
    if not previous_days:
        lines.extend(
            [
                "This is the baseline snapshot. Future issues will compare each team with the "
                "previous successful snapshot.",
                "",
                "No daily movers are available yet.",
            ]
        )
        return "\n".join(lines) + "\n"

    previous_day = previous_days[-1]
    previous = snapshots[previous_day]
    old_by_id = {str(row["item_id"]): row for row in previous}
    new_by_id = {str(row["item_id"]): row for row in current}
    added = sorted(new_by_id.keys() - old_by_id.keys())
    removed = sorted(old_by_id.keys() - new_by_id.keys())
    lines.extend([f"Compared with **{previous_day}**:", ""])

    if added:
        lines.append("**Appeared:** " + ", ".join(str(new_by_id[key]["item"]) for key in added))
    else:
        lines.append("**Appeared:** none")
    if removed:
        lines.append("**Disappeared:** " + ", ".join(str(old_by_id[key]["item"]) for key in removed))
    else:
        lines.append("**Disappeared:** none")
    lines.extend(
        [
            "",
            "### Biggest win-percentage moves",
            "",
            "| Team | Previous record | Current record | Win% change (pp) | Previous point diff | Current point diff |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
        ]
    )

    movers = []
    for team_id in old_by_id.keys() & new_by_id.keys():
        old, new = old_by_id[team_id], new_by_id[team_id]
        delta = (float(new["win_pct"]) - float(old["win_pct"])) * 100
        diff_delta = abs(float(new["point_diff_pg"]) - float(old["point_diff_pg"]))
        movers.append((abs(delta), diff_delta, team_id, delta, old, new))
    movers.sort(key=lambda row: (-row[0], -row[1], row[2]))
    changed = [row for row in movers if row[0] > 0][:5]
    if changed:
        for _magnitude, _diff_delta, _team_id, delta, old, new in changed:
            lines.append(
                f"| {new['item']} | {old['record']} | {new['record']} | {delta:+.2f} | "
                f"{float(old['point_diff_pg']):+.1f} | {float(new['point_diff_pg']):+.1f} |"
            )
    else:
        lines.append("| No standings values moved | — | — | 0.00 | — | — |")
    lines.extend(["", f"**Previous successful snapshot:** {previous_day}"])
    return "\n".join(lines) + "\n"


def _save_raw(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as file_stream:
        with gzip.GzipFile(fileobj=file_stream, mode="wb", mtime=0) as compressed:
            compressed.write(raw)


def run_pipeline(now: datetime | None = None) -> dict[str, object]:
    now = now or datetime.now(timezone.utc)
    now = now.astimezone(timezone.utc)
    run_date = now.date().isoformat()
    raw_path = RAW_DIR / run_date / f"{SOURCE_ID}.json.gz"
    # A successful rerun overwrites today's archive. If a retry fails, retain
    # an earlier successful snapshot for this date instead of deleting it.

    source_result: dict[str, object]
    season = current_season(date.fromisoformat(run_date))
    try:
        raw = fetch_raw(season=season)
        rows = parse_standings(raw)
        _save_raw(raw_path, raw)
        source_result = {
            "id": SOURCE_ID,
            "name": SOURCE_NAME,
            "ok": True,
            "count": len(rows),
            "error": "",
        }
        print(f"{SOURCE_NAME}: saved {len(rows)} teams to {raw_path.relative_to(ROOT)}")
    except Exception as exc:  # a source error should not abort history/status reporting
        source_result = {
            "id": SOURCE_ID,
            "name": SOURCE_NAME,
            "ok": False,
            "count": 0,
            "error": f"{type(exc).__name__}: {exc}",
        }
        print(f"{SOURCE_NAME} failed: {source_result['error']}", file=sys.stderr)

    snapshots = load_snapshots(RAW_DIR)
    history_count = write_history(HISTORY_PATH, snapshots)
    status = build_status(snapshots, now, [source_result], run_date)
    status["season"] = season
    write_status(STATUS_PATH, status)
    issue_body = make_issue_body(run_date, source_result, snapshots)
    ISSUE_PATH.write_text(issue_body, encoding="utf-8")
    publish_issue(run_date, issue_body)
    print(f"Rebuilt {history_count} history rows across {len(snapshots)} successful dates.")
    return status


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect and rebuild NBA standings history.")
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="rebuild history.csv from saved raw snapshots without contacting the NBA source",
    )
    args = parser.parse_args()
    if args.build_only:
        snapshots = load_snapshots(RAW_DIR)
        count = write_history(HISTORY_PATH, snapshots)
        print(f"Rebuilt {count} rows from {len(snapshots)} successful dates.")
        return
    run_pipeline()


if __name__ == "__main__":
    main()

