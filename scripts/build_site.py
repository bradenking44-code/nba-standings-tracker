"""Assemble the static GitHub Pages artifact from site source and current data."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(output: Path) -> Path:
    source = ROOT / "site"
    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(source, output)
    data_output = output / "data"
    data_output.mkdir(parents=True, exist_ok=True)
    for filename in ("history.csv", "status.json"):
        data_source = ROOT / "data" / filename
        if data_source.exists():
            shutil.copy2(data_source, data_output / filename)
    if not (data_output / "history.csv").exists():
        (data_output / "history.csv").write_text(
            "date,item_id,item,source,conference,division,rank,wins,losses,win_pct,"
            "points_for_pg,points_against_pg,point_diff_pg,games_back,streak,record,"
            "home_record,road_record,last10\n",
            encoding="utf-8",
        )
    if not (data_output / "status.json").exists():
        (data_output / "status.json").write_text(
            '{"run_time":"","first_run_date":"","days_with_success":0,'
            '"items":0,"new_today":0,"gone_today":0,"season":"","sources":[]}\n',
            encoding="utf-8",
        )
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "build" / "site")
    args = parser.parse_args()
    print(f"Built site at {build(args.output)}")


if __name__ == "__main__":
    main()

