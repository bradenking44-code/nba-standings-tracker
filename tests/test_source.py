import json
from datetime import date

import pytest

from nba_tracker.source import current_season, parse_standings, request_url


def test_current_season_uses_october_as_season_boundary():
    assert current_season(date(2026, 11, 11)) == "2026-27"
    assert current_season(date(2027, 6, 20)) == "2026-27"
    assert current_season(date(2027, 10, 1)) == "2027-28"


def test_request_url_selects_regular_season_overall():
    url = request_url("2026-27")
    assert "season=2027" in url
    assert "seasontype=2" in url


def test_parse_standings_maps_source_fields_to_common_columns(payload_factory):
    payload = payload_factory()
    rows = parse_standings(json.dumps(payload).encode())

    assert len(rows) == 30
    first = rows[0]
    assert first["item_id"] == "1610612700"
    assert first["item"] == "City Team 1"
    assert first["source"] == "espn"
    assert first["conference"] == "East"
    assert first["division"] == "Atlantic"
    assert first["rank"] == 1
    assert first["wins"] == 20
    assert first["losses"] == 10
    assert first["win_pct"] == 0.667
    assert first["points_for_pg"] == 118.4
    assert first["points_against_pg"] == 112.1
    assert first["point_diff_pg"] == 6.3
    assert first["games_back"] == 0.0
    assert first["streak"] == "W 2"
    assert first["record"] == "20-10"


def test_parser_fails_closed_for_invalid_or_too_small_responses(payload_factory):
    with pytest.raises(ValueError, match="valid JSON"):
        parse_standings(b"not json")
    with pytest.raises(ValueError, match="only 9 teams"):
        parse_standings(json.dumps(payload_factory(count=9)))


def test_parser_rejects_duplicate_team_ids(payload_factory):
    payload = payload_factory()
    east_entries = payload["children"][0]["standings"]["entries"]
    east_entries[1]["team"]["id"] = east_entries[0]["team"]["id"]
    with pytest.raises(ValueError, match="duplicate team IDs"):
        parse_standings(json.dumps(payload))

