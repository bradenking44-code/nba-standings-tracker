"""Deterministic history and status builders for saved raw snapshots."""

from __future__ import annotations

import csv
import gzip
import json
from datetime import datetime
from pathlib import Path

from .source import SOURCE_ID, parse_standings

HISTORY_FIELDS = [
    "date",
    "item_id",
    "item",
    "source",
    "conference",
    "division",
    "rank",
    "wins",
    "losses",
    "win_pct",
    "points_for_pg",
    "points_against_pg",
    "point_diff_pg",
    "games_back",
    "streak",
    "record",
    "home_record",
    "road_record",
    "last10",
]


def load_snapshots(raw_dir: Path) -> dict[str, list[dict[str, object]]]:
    """Load every successful gzip JSON source snapshot, grouped by UTC date."""
    snapshots: dict[str, list[dict[str, object]]] = {}
    if not raw_dir.exists():
        return snapshots
    for path in sorted(raw_dir.glob(f"*/{SOURCE_ID}.json.gz")):
        run_date = path.parent.name
        with gzip.open(path, "rb") as stream:
            rows = parse_standings(stream.read())
        snapshots[run_date] = rows
    return snapshots


def flatten_history(
    snapshots: dict[str, list[dict[str, object]]]
) -> list[dict[str, object]]:
    history: list[dict[str, object]] = []
    for run_date in sorted(snapshots):
        for source_row in snapshots[run_date]:
            history.append({"date": run_date, **source_row})
    return sorted(history, key=lambda row: (str(row["date"]), str(row["item_id"])))


def write_history(path: Path, snapshots: dict[str, list[dict[str, object]]]) -> int:
    rows = flatten_history(snapshots)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=HISTORY_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


def build_status(
    snapshots: dict[str, list[dict[str, object]]],
    run_time: datetime,
    source_results: list[dict[str, object]],
    run_date: str,
) -> dict[str, object]:
    successful_dates = sorted(snapshots)
    current_result = next((row for row in source_results if row.get("id") == SOURCE_ID), {})
    current_ok = bool(current_result.get("ok"))
    current_rows = snapshots.get(run_date, []) if current_ok else []

    previous_dates = [day for day in successful_dates if day < run_date]
    new_today = 0
    gone_today = 0
    if current_ok and previous_dates:
        previous_ids = {str(row["item_id"]) for row in snapshots[previous_dates[-1]]}
        current_ids = {str(row["item_id"]) for row in current_rows}
        new_today = len(current_ids - previous_ids)
        gone_today = len(previous_ids - current_ids)

    return {
        "run_time": run_time.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "first_run_date": successful_dates[0] if successful_dates else "",
        "days_with_success": len(successful_dates),
        "items": len(current_rows),
        "new_today": new_today,
        "gone_today": gone_today,
        "sources": [
            {
                "name": str(result.get("name", "")),
                "ok": bool(result.get("ok")),
                "count": int(result.get("count", 0)),
                "error": str(result.get("error", "") or ""),
            }
            for result in source_results
        ],
        "latest_snapshot_date": successful_dates[-1] if successful_dates else "",
    }


def write_status(path: Path, status: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(status, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

