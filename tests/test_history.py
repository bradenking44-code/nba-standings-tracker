import csv
import gzip
import io
import json
from datetime import datetime, timezone

from nba_tracker.history import build_status, load_snapshots, write_history
from nba_tracker.source import parse_standings


def write_snapshot(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, mode="wb", mtime=0) as stream:
        stream.write(json.dumps(payload).encode())
    path.write_bytes(compressed.getvalue())


def test_history_is_date_then_team_sorted_and_rebuild_is_reproducible(tmp_path, payload_factory):
    raw_dir = tmp_path / "raw"
    write_snapshot(raw_dir / "2026-11-12" / "nba_stats.json.gz", payload_factory())
    write_snapshot(raw_dir / "2026-11-11" / "nba_stats.json.gz", payload_factory())

    snapshots = load_snapshots(raw_dir)
    history = tmp_path / "history.csv"
    assert write_history(history, snapshots) == 60
    first_build = history.read_bytes()
    assert write_history(history, load_snapshots(raw_dir)) == 60
    assert history.read_bytes() == first_build

    with history.open(newline="", encoding="utf-8") as stream:
        rows = list(csv.DictReader(stream))
    assert (rows[0]["date"], rows[0]["item_id"]) == ("2026-11-11", "1610612700")
    assert (rows[-1]["date"], rows[-1]["item_id"]) == ("2026-11-12", "1610612729")


def test_same_day_rerun_replaces_snapshot_instead_of_duplicating_rows(tmp_path, payload_factory):
    raw_path = tmp_path / "raw" / "2026-11-11" / "nba_stats.json.gz"
    first = payload_factory()
    write_snapshot(raw_path, first)
    assert len(load_snapshots(raw_path.parents[1])["2026-11-11"]) == 30

    replacement = payload_factory()
    replacement["resultSets"][0]["rowSet"][0][10] = 21
    replacement["resultSets"][0]["rowSet"][0][12] = 0.7
    write_snapshot(raw_path, replacement)
    rows = load_snapshots(raw_path.parents[1])["2026-11-11"]
    assert len(rows) == 30
    assert rows[0]["wins"] == 21


def test_status_counts_successful_dates_and_daily_additions(payload_factory):
    first_rows = payload_factory()["resultSets"][0]["rowSet"]
    second_rows = payload_factory()["resultSets"][0]["rowSet"][:-1]
    snapshots = {
        "2026-11-10": parse_standings(json.dumps(payload_factory()).encode()),
        "2026-11-11": parse_standings(json.dumps(payload_factory(team_rows=second_rows)).encode()),
    }
    status = build_status(
        snapshots,
        datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc),
        [{"id": "nba_stats", "name": "NBA Stats", "ok": True, "count": 29}],
        "2026-11-11",
    )
    assert status["first_run_date"] == "2026-11-10"
    assert status["days_with_success"] == 2
    assert status["items"] == 29
    assert status["new_today"] == 0
    assert status["gone_today"] == 1
    assert len(first_rows) == 30

