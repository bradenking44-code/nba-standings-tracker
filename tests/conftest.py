import pytest


HEADERS = [
    "TeamID", "TeamCity", "TeamName", "TeamSlug", "Conference", "ConferenceRecord",
    "PlayoffRank", "Division", "DivisionRecord", "DivisionRank", "WINS", "LOSSES",
    "WinPCT", "Record", "HOME", "ROAD", "L10", "ConferenceGamesBack", "CurrentStreak",
    "Points_PG", "OppPoints_PG", "DiffPoints_PG",
]


def make_payload(team_rows=None, count=30):
    if team_rows is None:
        team_rows = []
        for index in range(count):
            wins = 20 - index // 2
            losses = 10 + index // 2
            conference = "East" if index < count // 2 else "West"
            conference_index = index if conference == "East" else index - count // 2
            team_rows.append(
                [
                    1610612700 + index,
                    "City",
                    f"Team {index + 1}",
                    f"team-{index + 1}",
                    conference,
                    "10-5",
                    conference_index + 1,
                    "Atlantic" if conference == "East" else "Northwest",
                    "5-2",
                    1,
                    wins,
                    losses,
                    round(wins / (wins + losses), 3),
                    f"{wins}-{losses}",
                    "11-4",
                    "9-6",
                    "7-3",
                    float(index),
                    "W 2" if index % 2 == 0 else "L 1",
                    118.4 - index * 0.2,
                    112.1 + index * 0.1,
                    6.3 - index * 0.3,
                ]
            )
    return {"resultSets": [{"name": "Standings", "headers": HEADERS, "rowSet": team_rows}]}


@pytest.fixture
def payload_factory():
    return make_payload

