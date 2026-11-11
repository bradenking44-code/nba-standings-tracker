"""NBA Stats standings source adapter."""

from __future__ import annotations

import json
from datetime import date
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE_ID = "nba_stats"
SOURCE_NAME = "NBA Stats"
BASE_URL = "https://stats.nba.com/stats/leaguestandingsv3"


def current_season(today: date | None = None) -> str:
    """Return the NBA season label for a date (for example, 2026-27)."""
    today = today or date.today()
    start_year = today.year if today.month >= 10 else today.year - 1
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def request_url(season: str | None = None) -> str:
    params = {
        "LeagueID": "00",
        "Season": season or current_season(),
        "SeasonType": "Regular Season",
        "Section": "overall",
    }
    return f"{BASE_URL}?{urlencode(params)}"


def fetch_raw(season: str | None = None, timeout: int = 30) -> bytes:
    """Download the source response without transforming it for raw archival."""
    request = Request(
        request_url(season),
        headers={
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.nba.com",
            "Referer": "https://www.nba.com/",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            ),
            "x-nba-stats-origin": "stats",
            "x-nba-stats-token": "true",
        },
    )
    with urlopen(request, timeout=timeout) as response:
        raw = response.read()
    # Parse before returning so HTML errors or schema changes are not archived
    # as successful source runs.
    parse_standings(raw)
    return raw


def _as_float(value: object, field: str) -> float:
    if value is None or value == "":
        raise ValueError(f"NBA standings field {field!r} is empty")
    return float(value)


def _as_int(value: object, field: str) -> int:
    if value is None or value == "":
        raise ValueError(f"NBA standings field {field!r} is empty")
    return int(float(value))


def _result_sets(payload: dict) -> list[dict]:
    result_sets = payload.get("resultSets") or payload.get("resultSet")
    if isinstance(result_sets, dict):
        result_sets = [result_sets]
    if not isinstance(result_sets, list):
        raise ValueError("NBA response does not contain resultSets")
    return [item for item in result_sets if isinstance(item, dict)]


def _standings_table(payload: dict) -> tuple[list[str], list[list[object]]]:
    for result_set in _result_sets(payload):
        headers = result_set.get("headers")
        rows = result_set.get("rowSet")
        if isinstance(headers, list) and isinstance(rows, list):
            normalized = {str(name).casefold() for name in headers}
            if {"teamid", "wins", "losses", "winpct"}.issubset(normalized):
                return [str(name) for name in headers], rows
    raise ValueError("NBA response has no recognizable standings table")


def parse_standings(raw: bytes | str) -> list[dict[str, object]]:
    """Convert a raw NBA Stats JSON response into common team rows."""
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"NBA response is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("NBA response root must be an object")

    headers, raw_rows = _standings_table(payload)
    rows: list[dict[str, object]] = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, list) or len(raw_row) != len(headers):
            raise ValueError("NBA standings row does not match its headers")
        source_row = {header.casefold(): value for header, value in zip(headers, raw_row)}
        team_id = str(source_row.get("teamid", "")).strip()
        if not team_id:
            raise ValueError("NBA standings row is missing TeamID")
        city = str(source_row.get("teamcity", "") or "").strip()
        name = str(source_row.get("teamname", "") or "").strip()
        team_name = " ".join(part for part in (city, name) if part)
        if not team_name:
            team_name = str(source_row.get("teamslug", team_id)).strip()

        rows.append(
            {
                "item_id": team_id,
                "item": team_name,
                "source": SOURCE_ID,
                "conference": str(source_row.get("conference", "") or ""),
                "division": str(source_row.get("division", "") or ""),
                "rank": _as_int(source_row.get("playoffrank"), "PlayoffRank"),
                "wins": _as_int(source_row.get("wins"), "WINS"),
                "losses": _as_int(source_row.get("losses"), "LOSSES"),
                "win_pct": round(_as_float(source_row.get("winpct"), "WinPCT"), 3),
                "points_for_pg": round(_as_float(source_row.get("points_pg"), "Points_PG"), 1),
                "points_against_pg": round(
                    _as_float(source_row.get("opppoints_pg"), "OppPoints_PG"), 1
                ),
                "point_diff_pg": round(
                    _as_float(source_row.get("diffpoints_pg"), "DiffPoints_PG"), 1
                ),
                "games_back": round(
                    _as_float(source_row.get("conferencegamesback"), "ConferenceGamesBack"), 1
                ),
                "streak": str(source_row.get("currentstreak", "") or ""),
                "record": str(source_row.get("record", "") or ""),
                "home_record": str(source_row.get("home", "") or ""),
                "road_record": str(source_row.get("road", "") or ""),
                "last10": str(source_row.get("l10", "") or ""),
            }
        )
    if len(rows) < 10:
        raise ValueError(f"NBA response returned only {len(rows)} teams; expected at least 10")
    if len({row["item_id"] for row in rows}) != len(rows):
        raise ValueError("NBA response contains duplicate TeamID values")
    return sorted(rows, key=lambda row: str(row["item_id"]))

