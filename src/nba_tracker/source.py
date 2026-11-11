"""ESPN NBA standings source adapter."""

from __future__ import annotations

import json
from datetime import date
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCE_ID = "espn"
SOURCE_NAME = "ESPN"
BASE_URL = "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"

# ESPN's conference standings response does not include division names. The
# NBA's current team-to-division assignments fill that presentation field.
TEAM_DIVISIONS = {
    "ATL": "Southeast", "BOS": "Atlantic", "BKN": "Atlantic", "CHA": "Southeast",
    "CHI": "Central", "CLE": "Central", "DAL": "Southwest", "DEN": "Northwest",
    "DET": "Central", "GSW": "Pacific", "HOU": "Southwest", "IND": "Central",
    "LAC": "Pacific", "LAL": "Pacific", "MEM": "Southwest", "MIA": "Southeast",
    "MIL": "Central", "MIN": "Northwest", "NOP": "Southwest", "NYK": "Atlantic",
    "OKC": "Northwest", "ORL": "Southeast", "PHI": "Atlantic", "PHX": "Pacific",
    "POR": "Northwest", "SAC": "Pacific", "SAS": "Southwest", "TOR": "Atlantic",
    "UTA": "Northwest", "WAS": "Southeast",
}


def current_season(today: date | None = None) -> str:
    """Return the NBA season label for a date (for example, 2026-27)."""
    today = today or date.today()
    start_year = today.year if today.month >= 10 else today.year - 1
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def request_url(season: str | None = None) -> str:
    """Build an ESPN request for the selected season's regular-season table."""
    season_label = season or current_season()
    try:
        end_year = int(season_label.split("-", maxsplit=1)[0]) + 1
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid NBA season label: {season_label!r}") from exc
    params = {"season": str(end_year), "seasontype": "2"}
    return f"{BASE_URL}?{urlencode(params)}"


def fetch_raw(season: str | None = None, timeout: int = 30) -> bytes:
    """Download the source response without transforming it for raw archival."""
    request = Request(
        request_url(season),
        headers={
            "Accept": "application/json",
            "User-Agent": "nba-standings-tracker/0.1",
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
        raise ValueError(f"ESPN standings field {field!r} is empty")
    return float(value)


def _as_int(value: object, field: str) -> int:
    if value is None or value == "":
        raise ValueError(f"ESPN standings field {field!r} is empty")
    return int(float(value))


def _stat_value(stats: dict[str, dict], name: str) -> object:
    stat = stats.get(name)
    if not stat:
        raise ValueError(f"ESPN standings response is missing {name!r}")
    return stat.get("value")


def _stat_summary(stats: dict[str, dict], name: str) -> str:
    stat = stats.get(name, {})
    return str(stat.get("summary") or stat.get("displayValue") or "")


def parse_standings(raw: bytes | str) -> list[dict[str, object]]:
    """Convert ESPN's conference standings response into common team rows."""
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"ESPN response is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("ESPN response root must be an object")

    conferences = payload.get("children")
    if not isinstance(conferences, list):
        raise ValueError("ESPN response does not contain conference standings")

    rows: list[dict[str, object]] = []
    for conference_group in conferences:
        if not isinstance(conference_group, dict):
            continue
        standings = conference_group.get("standings")
        if not isinstance(standings, dict):
            continue
        entries = standings.get("entries")
        if not isinstance(entries, list):
            continue
        conference = str(
            conference_group.get("abbreviation") or conference_group.get("name") or ""
        ).strip()

        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("ESPN standings entry is not an object")
            team = entry.get("team")
            if not isinstance(team, dict):
                raise ValueError("ESPN standings entry is missing its team")
            team_id = str(team.get("id", "")).strip()
            if not team_id:
                raise ValueError("ESPN standings team is missing its ID")

            raw_stats = entry.get("stats")
            if not isinstance(raw_stats, list):
                raise ValueError(f"ESPN standings entry {team_id} has no stats list")
            stats = {
                str(stat.get("name")): stat
                for stat in raw_stats
                if isinstance(stat, dict) and stat.get("name")
            }

            wins = _as_int(_stat_value(stats, "wins"), "wins")
            losses = _as_int(_stat_value(stats, "losses"), "losses")
            abbreviation = str(team.get("abbreviation", "")).strip().upper()
            item = str(team.get("displayName") or " ".join(
                part for part in (team.get("location"), team.get("name")) if part
            )).strip()
            if not item:
                item = team_id

            rows.append(
                {
                    "item_id": team_id,
                    "item": item,
                    "source": SOURCE_ID,
                    "conference": conference,
                    "division": TEAM_DIVISIONS.get(abbreviation, ""),
                    "rank": 0,
                    "wins": wins,
                    "losses": losses,
                    "win_pct": round(_as_float(_stat_value(stats, "winPercent"), "winPercent"), 3),
                    "points_for_pg": round(
                        _as_float(_stat_value(stats, "avgPointsFor"), "avgPointsFor"), 1
                    ),
                    "points_against_pg": round(
                        _as_float(_stat_value(stats, "avgPointsAgainst"), "avgPointsAgainst"), 1
                    ),
                    "point_diff_pg": round(
                        _as_float(_stat_value(stats, "differential"), "differential"), 1
                    ),
                    "games_back": round(
                        _as_float(_stat_value(stats, "gamesBehind"), "gamesBehind"), 1
                    ),
                    "streak": _stat_summary(stats, "streak"),
                    "record": _stat_summary(stats, "overall") or f"{wins}-{losses}",
                    "home_record": _stat_summary(stats, "Home"),
                    "road_record": _stat_summary(stats, "Road"),
                    "last10": _stat_summary(stats, "Last Ten Games"),
                }
            )

    if len(rows) < 10:
        raise ValueError(f"ESPN response returned only {len(rows)} teams; expected at least 10")
    if len({row["item_id"] for row in rows}) != len(rows):
        raise ValueError("ESPN response contains duplicate team IDs")
    rows.sort(
        key=lambda row: (
            -float(row["win_pct"]),
            -int(row["wins"]),
            -float(row["point_diff_pg"]),
            str(row["item_id"]),
        )
    )
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows
