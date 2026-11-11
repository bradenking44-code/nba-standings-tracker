import pytest


TEAM_ABBREVIATIONS = [
    "BOS", "BKN", "NYK", "PHI", "TOR", "CHI", "CLE", "DET", "IND", "MIL",
    "ATL", "CHA", "MIA", "ORL", "WAS", "DEN", "MIN", "OKC", "POR", "UTA",
    "GSW", "LAC", "LAL", "PHX", "SAC", "DAL", "HOU", "MEM", "NOP", "SAS",
]


def _stat(name, value=None, display_value="", summary=""):
    stat = {"name": name, "value": value, "displayValue": display_value}
    if summary:
        stat["summary"] = summary
    return stat


def make_payload(count=30):
    teams = []
    for index in range(count):
        wins = 20 - index // 2
        losses = 10 + index // 2
        conference_index = index if index < count // 2 else index - count // 2
        abbreviation = TEAM_ABBREVIATIONS[index]
        teams.append(
            {
                "conference": "East" if index < count // 2 else "West",
                "entry": {
                    "team": {
                        "id": str(1610612700 + index),
                        "location": "City",
                        "name": f"Team {index + 1}",
                        "displayName": f"City Team {index + 1}",
                        "abbreviation": abbreviation,
                    },
                    "stats": [
                        _stat("avgPointsAgainst", 112.1 + index * 0.1),
                        _stat("avgPointsFor", 118.4 - index * 0.2),
                        _stat("differential", 6.3 - index * 0.3),
                        _stat("gamesBehind", float(conference_index)),
                        _stat("losses", losses),
                        _stat("streak", 2 if index % 2 == 0 else -1, "W 2" if index % 2 == 0 else "L 1"),
                        _stat("winPercent", round(wins / (wins + losses), 3)),
                        _stat("wins", wins),
                        _stat("overall", display_value=f"{wins}-{losses}", summary=f"{wins}-{losses}"),
                        _stat("Home", display_value="11-4", summary="11-4"),
                        _stat("Road", display_value="9-6", summary="9-6"),
                        _stat("Last Ten Games", display_value="7-3", summary="7-3"),
                    ],
                },
            }
        )

    east = [team["entry"] for team in teams if team["conference"] == "East"]
    west = [team["entry"] for team in teams if team["conference"] == "West"]
    return {
        "children": [
            {
                "name": "Eastern Conference",
                "abbreviation": "East",
                "standings": {"season": 2027, "entries": east},
            },
            {
                "name": "Western Conference",
                "abbreviation": "West",
                "standings": {"season": 2027, "entries": west},
            },
        ]
    }


@pytest.fixture
def payload_factory():
    return make_payload
