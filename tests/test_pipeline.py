from nba_tracker.pipeline import make_issue_body
from nba_tracker.source import parse_standings
import json


def test_move_rule_reports_win_percentage_point_change_and_roster_changes(payload_factory):
    old_payload = payload_factory()
    new_payload = payload_factory()
    old_entries = old_payload["children"][0]["standings"]["entries"]
    new_entries = new_payload["children"][0]["standings"]["entries"]
    for stat in old_entries[0]["stats"]:
        if stat["name"] == "winPercent":
            stat["value"] = 0.600
    for stat in new_entries[0]["stats"]:
        if stat["name"] == "winPercent":
            stat["value"] = 0.700
        elif stat["name"] == "wins":
            stat["value"] = 21
        elif stat["name"] == "overall":
            stat["summary"] = "21-9"
    # One team appears, and the final team disappears.
    new_payload["children"][1]["standings"]["entries"][-1]["team"]["id"] = "999999"

    snapshots = {
        "2026-11-10": parse_standings(json.dumps(old_payload)),
        "2026-11-11": parse_standings(json.dumps(new_payload)),
    }
    body = make_issue_body(
        "2026-11-11",
        {"ok": True, "count": 30},
        snapshots,
    )

    assert "absolute change in win percentage" in body
    assert "Team 1" in body
    assert "+10.00" in body
    assert "Appeared" in body
    assert "Disappeared" in body
    assert "Team 30" in body


def test_first_successful_run_is_reported_as_baseline(payload_factory):
    rows = parse_standings(json.dumps(payload_factory()))
    body = make_issue_body("2026-11-11", {"ok": True}, {"2026-11-11": rows})
    assert "baseline snapshot" in body
    assert "No daily movers" in body


def test_failed_source_still_creates_daily_issue_body():
    body = make_issue_body(
        "2026-11-11",
        {"ok": False, "error": "HTTPError: 403"},
        {"2026-11-10": []},
    )
    assert "Source failed" in body
    assert "No raw snapshot was saved" in body

