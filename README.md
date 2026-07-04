# Spin XI — Football Wheel Game

Pick a formation, spin a wheel to land on a team, choose a player from that
team for a vacant position, and repeat until you have a full XI. Then see how
your team scored in that round using real match stats.

Two competitions (switch with the pills in the top bar):

- **Premier League 2025/26** — all 38 gameweeks
- **World Cup 2026** — group matchdays, R32, R16, QF, SF, bronze final, final.
  The wheel only offers teams that have a fixture in the selected round. For
  rounds that haven't been played yet you can pick a team now and re-open it
  from history later — the score refreshes automatically once the data has
  been rebuilt. Knockout scoring is extra-time aware (120-minute windows) and
  shootout kicks are excluded.

## Run it

Double-click `start.bat`, or run:

```
python -m http.server 8317 --directory web
```

then open http://localhost:8317

## How it works

- **Formations**: 4-3-3, 4-4-2, 4-5-1, 3-4-3, 3-5-2, 5-3-2, 5-4-1.
- **Positions**: players are eligible by their official FPL position
  (Goalkeeper / Defender / Midfielder / Forward). Any defender can fill any
  back-line slot (LB/CB/RB/wing-back), any midfielder any midfield slot, etc.
  The picker also shows each player's average points per game for the season
  under this scoring system.
- **Scoring** is by position category:

  | Event | Points |
  |---|---|
  | Played under 60 min | 1 |
  | Played 60+ min | 2 |
  | Goal (GK / DEF / MID / FWD) | 10 / 6 / 5 / 4 |
  | Assist | 3 |
  | Clean sheet (GK, DEF / MID) | 4 / 1 |
  | Every 3 saves (GK) | 1 |
  | Penalty save | 5 |
  | Penalty miss | -2 |
  | Every 2 goals conceded (GK, DEF) | -1 |
  | Yellow / red card | -1 / -3 |
  | Own goal | -2 |
  | Defensive contribution: 10+ clearances/interceptions/tackles (DEF) or 12+ incl. recoveries (MID/FWD), per match | 2 |
  | Bonus points: top 3 match ratings per game | 1-3 |

  Penalties come from the shot map (`situation: "penalty"`): any failed
  penalty is a miss (-2) for the taker, and a saved one credits the on-pitch
  keeper (+5) — both reconcile exactly with FPL's official 25/26 totals
  (11 saved, 15 missed).

  Differences from official FPL scoring (limits of our own data): bonus uses
  the top-3 player match ratings per game (FPL tie rules applied) instead of
  FPL's proprietary BPS; defensive contribution can't count blocked shots;
  assists follow the data provider's stricter definition; clean sheets and
  goals conceded use the player's estimated on-pitch window.

  Double gameweeks are scored per fixture (minutes, saves and conceded
  thresholds apply per match, as in FPL).
- **Captain**: after completing your XI you must pick a captain (tap a player
  on the pitch — one choice, locked in). The captain scores double points,
  negatives included.
- **Rules**: a club can come up multiple times; a player can only be picked
  once; if a club has no players that fit your remaining slots you re-spin.
- **History**: every completed team is saved in the browser (localStorage)
  with a season total (most recent team per gameweek counts).

## Data

Everything comes from **our own data** for both competitions: the match-events
JSONs in `PyCharmMiscProject` plus the fixtures CSVs (`round` = gameweek).
Player identities are taken straight from the lineups, and each player's
GK/DEF/MID/FWD category is a majority vote over where they *actually lined up*
(detailed positions per match) — not any career-level label. The local FPL
snapshot in `data/raw/` is only used to attach EPL player photos (cosmetic;
players without a photo fall back to initials).

- `web/data/core.json` — teams, players, fixtures, gameweeks
- `web/data/gw1.json` … `gw38.json` — per-player, per-fixture stats for scoring
- `data/raw/` — FPL API snapshot (players/teams) + matching reports

World Cup data is fully self-contained: fixtures from
`world-cup-2026_fixtures.csv` (round column), stats and player identities
straight from `match_events_world_cup_2026` lineups (FotMob player ids,
photos/badges from FotMob's image CDN).

Rebuild with:

```
python build_data.py                # build both competitions
python build_data.py epl            # Premier League only
python build_data.py wc             # World Cup only (run after each WC matchday)
python build_data.py transform-fpl  # legacy: build from the FPL API snapshots
python build_data.py download       # refresh the FPL snapshot (new season)
```

Lineup/event players are matched to FPL identities by name within club (with
league-wide fallback for mid-season transfers); every 25/26 lineup appearance
resolves, and attributed goals reconcile exactly with fixture scores (1045).

Note: the EPL 25/26 match files use SofaScore ids while the World Cup files
use FotMob ids — each competition keys its players consistently within itself,
so this doesn't matter in practice.

Player photos and club badges are loaded from the Premier League CDN with a
graceful fallback to initials, so the app still works fully offline.

## Next season (26/27)

When the new season starts: point `build_data.py` at the live FPL API again
(it will pick up the 26/27 bootstrap/fixtures automatically once the game
resets), re-run it after each gameweek, and the same app plays the new season.
