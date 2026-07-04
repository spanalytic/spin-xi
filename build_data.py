"""Build the Spin XI app data for the 2025/26 Premier League season.

Two phases:
  1. download  - snapshot the FPL API (bootstrap, fixtures, 38x gameweek live stats)
                 into data/raw/ so the app keeps working after the API resets
                 for the 26/27 season.
  2. transform - merge FPL data with detailed player positions from the FotMob
                 match JSONs in PyCharmMiscProject, and emit the JSON files the
                 web app consumes into web/data/.

Usage:
    python build_data.py            # download (skips existing raw files) + transform
    python build_data.py transform  # transform only, from existing raw snapshots
"""

import csv
import json
import sys
import time
import glob
import unicodedata
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "data"

FOTMOB_EVENTS_DIR = Path(r"C:\Users\thoma\PyCharmMiscProject\data\match_events_epl\2025-2026")
OWN_FIXTURES_CSV = Path(r"C:\Users\thoma\PyCharmMiscProject\data\fixtures\ENG-Premier League_fixtures.csv")
OWN_SEASON = "2025/2026"

FPL_BASE = "https://fantasy.premierleague.com/api"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# FPL team name -> FotMob team name (as used in the match JSONs / fixtures CSV)
TEAM_NAME_MAP = {
    "Arsenal": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brighton": "Brighton & Hove Albion",
    "Burnley": "Burnley",
    "Chelsea": "Chelsea",
    "Crystal Palace": "Crystal Palace",
    "Everton": "Everton",
    "Fulham": "Fulham",
    "Leeds": "Leeds United",
    "Liverpool": "Liverpool",
    "Man City": "Manchester City",
    "Man Utd": "Manchester United",
    "Newcastle": "Newcastle United",
    "Nott'm Forest": "Nottingham Forest",
    "Sunderland": "Sunderland",
    "Spurs": "Tottenham Hotspur",
    "West Ham": "West Ham United",
    "Wolves": "Wolverhampton",
}

# Fallback detailed positions when a player never appeared in the FotMob data
FPL_TYPE_DEFAULT_POS = {1: ["GK"], 2: ["DC"], 3: ["MC"], 4: ["ST"]}

# wheel colours (EPL keyed by FPL short name)
EPL_COLORS = {
    "ARS": "#EF0107", "AVL": "#670E36", "BUR": "#6C1D45", "BOU": "#B50E12",
    "BRE": "#E30613", "BHA": "#0057B8", "CHE": "#034694", "CRY": "#1B458F",
    "EVE": "#003399", "FUL": "#111111", "LEE": "#1D428A", "LIV": "#C8102E",
    "MCI": "#6CABDD", "MUN": "#DA291C", "NEW": "#241F20", "NFO": "#DD0000",
    "SUN": "#EB172B", "TOT": "#132257", "WHU": "#7A263A", "WOL": "#FDB913",
}
EPL_DARK_TEXT = {"MCI", "WOL"}

# ---------------- World Cup 2026 ----------------
WC_FIXTURES_CSV = Path(r"C:\Users\thoma\PyCharmMiscProject\data\fixtures\world-cup-2026_fixtures.csv")
WC_EVENTS_DIR = Path(r"C:\Users\thoma\PyCharmMiscProject\data\match_events_world_cup_2026\2026-2026")
WC_SEASON = "2026/2026"
WC_ROUNDS = [("1", "Group Matchday 1", "MD1"), ("2", "Group Matchday 2", "MD2"),
             ("3", "Group Matchday 3", "MD3"), ("Round of 32", "Round of 32", "R32"),
             ("Round of 16", "Round of 16", "R16"), ("Quarter-Finals", "Quarter-Finals", "QF"),
             ("Semi-Finals", "Semi-Finals", "SF"), ("Bronze Final", "Bronze Final", "3RD"),
             ("Final", "Final", "FIN")]
WC_SHORT = {
    "Mexico": "MEX", "South Africa": "RSA", "Canada": "CAN", "USA": "USA",
    "Argentina": "ARG", "Brazil": "BRA", "England": "ENG", "France": "FRA",
    "Spain": "ESP", "Portugal": "POR", "Germany": "GER", "Netherlands": "NED",
    "Belgium": "BEL", "Croatia": "CRO", "Morocco": "MAR", "Switzerland": "SUI",
    "Colombia": "COL", "Ghana": "GHA", "Egypt": "EGY", "Australia": "AUS",
    "Cape Verde": "CPV", "Norway": "NOR", "Paraguay": "PAR", "Japan": "JPN",
    "South Korea": "KOR", "Iran": "IRN", "Saudi Arabia": "KSA", "Qatar": "QAT",
    "Uzbekistan": "UZB", "Jordan": "JOR", "Ecuador": "ECU", "Uruguay": "URU",
    "Panama": "PAN", "Costa Rica": "CRC", "Haiti": "HAI", "Curacao": "CUW",
    "Senegal": "SEN", "Ivory Coast": "CIV", "Tunisia": "TUN", "Algeria": "ALG",
    "DR Congo": "COD", "Austria": "AUT", "Scotland": "SCO", "Czechia": "CZE",
    "Italy": "ITA", "New Zealand": "NZL", "Iraq": "IRQ", "Bolivia": "BOL",
    "United Arab Emirates": "UAE", "Suriname": "SUR",
    "Bosnia and Herzegovina": "BIH", "Turkey": "TUR", "Ukraine": "UKR",
}
WC_COLORS = {
    "MEX": "#006847", "RSA": "#007A4D", "CAN": "#D80621", "USA": "#1F2A64",
    "ARG": "#74ACDF", "BRA": "#FFDF00", "ENG": "#FFFFFF", "FRA": "#0055A4",
    "ESP": "#AA151B", "POR": "#006600", "GER": "#000000", "NED": "#FF6600",
    "BEL": "#E30613", "CRO": "#ED1C24", "MAR": "#C1272D", "SUI": "#D52B1E",
    "COL": "#FCD116", "GHA": "#006B3F", "EGY": "#CE1126", "AUS": "#FFCD00",
    "CPV": "#003893", "NOR": "#BA0C2F", "PAR": "#D52B1E", "JPN": "#BC002D",
    "KOR": "#CD2E3A", "IRN": "#239F40", "KSA": "#165D31", "QAT": "#8A1538",
    "UZB": "#0099B5", "JOR": "#007A3D", "ECU": "#FFDD00", "URU": "#7EB2DD",
    "PAN": "#DA121A", "CRC": "#002B7F", "HAI": "#00209F", "CUW": "#002B7F",
    "SEN": "#00853F", "CIV": "#F77F00", "TUN": "#E70013", "ALG": "#006233",
    "COD": "#007FFF", "AUT": "#ED2939", "SCO": "#005EB8", "CZE": "#11457E",
    "ITA": "#008C45", "NZL": "#000000", "IRQ": "#CE1126", "BOL": "#007934",
    "UAE": "#00732F", "SUR": "#377E3F", "BIH": "#002F6C", "TUR": "#E30A17",
}
WC_LIGHT = {"BRA", "COL", "AUS", "ECU", "ENG", "ARG", "URU", "CPV"}  # dark text on these

# detailed lineup position -> broad group (how the player ACTUALLY lined up)
DETAIL_GROUP = {"GK": "G", "DC": "D", "DL": "D", "DR": "D",
                "DM": "M", "MC": "M", "AM": "M", "ML": "M", "MR": "M",
                "LW": "F", "RW": "F", "ST": "F"}
POS_TYPE = {"G": 1, "D": 2, "M": 3, "F": 4}

EPL_SHORT = {
    "Arsenal": "ARS", "Aston Villa": "AVL", "Bournemouth": "BOU", "Brentford": "BRE",
    "Brighton & Hove Albion": "BHA", "Burnley": "BUR", "Chelsea": "CHE",
    "Crystal Palace": "CRY", "Everton": "EVE", "Fulham": "FUL", "Leeds United": "LEE",
    "Liverpool": "LIV", "Manchester City": "MCI", "Manchester United": "MUN",
    "Newcastle United": "NEW", "Nottingham Forest": "NFO", "Sunderland": "SUN",
    "Tottenham Hotspur": "TOT", "West Ham United": "WHU", "Wolverhampton": "WOL",
}

# Scoring table (mirrors web/app.js) for the season points-per-game figure,
# using the player's FPL position type as the scoring category
CAT_BY_TYPE = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
GOAL_PTS = {"GK": 10, "DEF": 6, "MID": 5, "FWD": 4}
CS_PTS = {"GK": 4, "DEF": 4, "MID": 1, "FWD": 0}


def score_row(row, cat):
    """Points for one player-fixture under the game's scoring rules."""
    pts = 0
    mp = row.get("mp", 0)
    if mp > 0:
        pts += 2 if mp >= 60 else 1
    pts += row.get("gs", 0) * GOAL_PTS[cat]
    pts += row.get("a", 0) * 3
    pts += row.get("cs", 0) * CS_PTS[cat]
    if cat == "GK":
        pts += row.get("sv", 0) // 3
    pts += row.get("ps", 0) * 5
    pts -= row.get("pm", 0) * 2
    if cat in ("GK", "DEF"):
        pts -= row.get("gc", 0) // 2
    pts -= row.get("yc", 0)
    pts -= row.get("rc", 0) * 3
    pts -= row.get("og", 0) * 2
    dc = row.get("dc", 0)
    if (cat == "DEF" and dc >= 10) or (cat in ("MID", "FWD") and dc >= 12):
        pts += 2
    pts += row.get("b", 0)  # official FPL bonus points (BPS top-3 per match)
    return pts


# Stat identifiers we keep from the FPL "explain" per-fixture breakdown
STAT_KEYS = {
    "minutes": "mp",
    "goals_scored": "gs",
    "assists": "a",
    "clean_sheets": "cs",
    "goals_conceded": "gc",
    "own_goals": "og",
    "penalties_saved": "ps",
    "penalties_missed": "pm",
    "yellow_cards": "yc",
    "red_cards": "rc",
    "saves": "sv",
    "defensive_contribution": "dc",
    "bonus": "b",
}


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def download():
    RAW.mkdir(parents=True, exist_ok=True)

    targets = [("bootstrap.json", f"{FPL_BASE}/bootstrap-static/"),
               ("fixtures.json", f"{FPL_BASE}/fixtures/")]
    targets += [(f"live_gw{gw}.json", f"{FPL_BASE}/event/{gw}/live/") for gw in range(1, 39)]

    for fname, url in targets:
        path = RAW / fname
        if path.exists() and path.stat().st_size > 100:
            continue
        print(f"downloading {fname} ...", flush=True)
        data = fetch(url)
        path.write_text(json.dumps(data), encoding="utf-8")
        time.sleep(0.6)
    print("download complete")


# characters NFKD can't decompose to ascii
TRANSLIT = str.maketrans({"ø": "o", "Ø": "O", "æ": "ae", "Æ": "ae", "ß": "ss",
                          "đ": "d", "Đ": "d", "ð": "d", "Ð": "d",
                          "þ": "th", "Þ": "th", "ł": "l", "Ł": "l"})
# spelling variants between our data and FPL (applied after normalisation)
NAME_ALIASES = {
    "yehor yarmolyuk": "yegor yarmoliuk",
}


def norm(name):
    """Normalise a name for matching: strip accents, lowercase, alpha only."""
    s = unicodedata.normalize("NFKD", (name or "").translate(TRANSLIT))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = "".join(c if c.isalpha() else " " for c in s.lower())
    s = " ".join(s.split())
    return NAME_ALIASES.get(s, s)


def load_fotmob_players():
    """Scan 25/26 EPL match JSONs -> {fotmob_team: {norm_name: set(positions)}}."""
    by_team = defaultdict(lambda: defaultdict(set))
    league_wide = defaultdict(set)  # norm_name -> positions (all teams)
    name_teams = defaultdict(set)   # norm_name -> teams it appeared for
    for fp in glob.glob(str(FOTMOB_EVENTS_DIR / "*.json")):
        with open(fp, encoding="utf-8") as f:
            j = json.load(f)
        team_names = {True: j.get("home_team"), False: j.get("away_team")}
        lu = j.get("lineups") or {}
        for side, is_home in (("home", True), ("away", False)):
            team = team_names[is_home]
            for grp in ("starting_xi", "substitutes"):
                for p in (lu.get(side) or {}).get(grp, []):
                    n = norm(p.get("player_name"))
                    if not n:
                        continue
                    pos = set(p.get("detailed_positions") or [])
                    by_team[team][n] |= pos
                    league_wide[n] |= pos
                    name_teams[n].add(team)
    return by_team, league_wide, name_teams


def match_positions(bootstrap):
    """Attach detailed FotMob positions to every FPL player."""
    by_team, league_wide, name_teams = load_fotmob_players()

    fpl_team_name = {t["id"]: t["name"] for t in bootstrap["teams"]}
    matched = unmatched = 0
    results = {}
    unmatched_players = []

    for el in bootstrap["elements"]:
        fot_team = TEAM_NAME_MAP[fpl_team_name[el["team"]]]
        team_players = by_team.get(fot_team, {})

        full = norm(f"{el['first_name']} {el['second_name']}")
        web = norm(el["web_name"])
        second = norm(el["second_name"])

        pos = None
        # 1. full name, same team
        if full in team_players:
            pos = team_players[full]
        # 2. web name, same team
        elif web in team_players:
            pos = team_players[web]
        # 3. full or web name unique league-wide
        elif full in league_wide and len(name_teams[full]) == 1:
            pos = league_wide[full]
        elif web in league_wide and len(name_teams[web]) == 1:
            pos = league_wide[web]
        else:
            # 4a. reverse containment: FotMob name tokens all appear in the FPL
            #     full name (FotMob "Gabriel Magalhaes" vs FPL "Gabriel dos
            #     Santos Magalhaes"), unique hit within the team only
            full_tokens = set(full.split())
            hits = [p for n, p in team_players.items() if set(n.split()) <= full_tokens]
            if len(hits) == 1:
                pos = hits[0]
            else:
                # 4b. forward containment with initial expansion: every token of
                #     an FPL key is an exact FotMob token, or is a single letter
                #     matching a FotMob token's initial (FPL "L.Paqueta" vs
                #     FotMob "Lucas Paqueta"), unique hit only
                def covers(key_tokens, fot_tokens):
                    return all(
                        t in fot_tokens or (len(t) == 1 and any(f[0] == t for f in fot_tokens))
                        for t in key_tokens)
                cand_keys = [k.split() for k in (full, web, second) if k]
                hits = [p for n, p in team_players.items()
                        if any(covers(k, set(n.split())) for k in cand_keys)]
                if len(hits) == 1:
                    pos = hits[0]

        if pos:
            matched += 1
            results[el["id"]] = sorted(pos)
        else:
            unmatched += 1
            results[el["id"]] = FPL_TYPE_DEFAULT_POS[el["element_type"]]
            unmatched_players.append(
                f"{el['web_name']} | {el['first_name']} {el['second_name']} | "
                f"{fpl_team_name[el['team']]} | type={el['element_type']} | mins={el['minutes']}")

    print(f"position matching: {matched} matched, {unmatched} fell back to FPL type")
    report = RAW / "unmatched_positions.txt"
    report.write_text("\n".join(unmatched_players), encoding="utf-8")
    print(f"unmatched list -> {report}")
    return results


def build_name_resolver(bootstrap):
    """Resolve a lineup player name (within an FPL team) to an FPL player id.

    Falls back to league-wide unique matches so that mid-season transfers
    (recorded under their final FPL club) still resolve for earlier matches.
    """
    def covers(key_tokens, toks):
        return all(t in toks or (len(t) == 1 and any(f[0] == t for f in toks))
                   for t in key_tokens)

    recs = []
    for el in bootstrap["elements"]:
        full = norm(f"{el['first_name']} {el['second_name']}")
        web = norm(el["web_name"])
        second = norm(el["second_name"])
        recs.append({
            "id": el["id"], "team": el["team"], "full": full, "web": web,
            "full_tokens": set(full.split()),
            "keys": [k.split() for k in (full, web, second) if k],
        })
    by_team = defaultdict(list)
    for r in recs:
        by_team[r["team"]].append(r)

    cache = {}

    def passes(cands, n, toks):
        exact = [r for r in cands if r["full"] == n or r["web"] == n]
        if len(exact) == 1:
            return exact[0]["id"]
        rev = [r for r in cands if toks <= r["full_tokens"]]
        if len(rev) == 1:
            return rev[0]["id"]
        fwd = [r for r in cands if any(covers(k, toks) for k in r["keys"])]
        if len(fwd) == 1:
            return fwd[0]["id"]
        return None

    def resolve(team_id, name):
        key = (team_id, name)
        if key not in cache:
            n = norm(name)
            toks = set(n.split())
            cache[key] = passes(by_team[team_id], n, toks) or passes(recs, n, toks)
        return cache[key]

    return resolve


def load_own_match_index():
    """Index the 25/26 match JSONs by (home, away); the folder also contains
    24/25 strays, so candidates keep their date for closest-date selection."""
    index = defaultdict(list)
    for fp in glob.glob(str(FOTMOB_EVENTS_DIR / "*.json")):
        with open(fp, encoding="utf-8") as f:
            j = json.load(f)
        date = j.get("date") or (j.get("match_time_utc") or "")[:10]
        index[(j.get("home_team"), j.get("away_team"))].append((date, fp))
    return index


def extract_match_rows(j, home_key, away_key, resolve_player, cat_by_id):
    """One match JSON -> {player_id: stat row} under FPL-style rules.

    resolve_player(team_key, lineup_player_dict) -> stable player id (FPL id
    for the EPL build, the FotMob player id for the World Cup build).
    """
    lu = j.get("lineups") or {}
    entries = []                       # (pid, side, starter, stats, mp, position)
    name_maps = {"home": {}, "away": {}}
    id_map = {}                        # fotmob player_id -> stable id
    unresolved = []
    for side, team_key in (("home", home_key), ("away", away_key)):
        for grp, starter in (("starting_xi", True), ("substitutes", False)):
            for p in ((lu.get(side) or {}).get(grp) or []):
                name = p.get("player_name") or ""
                pid = resolve_player(team_key, p)
                if pid is None:
                    unresolved.append(name)
                    continue
                name_maps[side][norm(name)] = pid
                if p.get("player_id"):
                    id_map[p["player_id"]] = pid
                st = p.get("statistics") or {}
                entries.append((pid, side, starter, st, st.get("minutes_played") or 0,
                                p.get("position")))

    # knockout games can run 120 minutes; shootout penalties are logged after
    match_total = max([90] + [e[4] for e in entries])

    def lookup(side, fot_id, name):
        pid = id_map.get(fot_id)
        if pid is None and name:
            pid = name_maps[side].get(norm(name))
        return pid

    home_fot_id = j.get("home_team_id")
    goals = {"home": [], "away": []}   # (minute, fot_id, name, assist_id, assist_name, is_og)
    cards = []                         # (side, fot_id, name, card_type)
    for e in j.get("events", []):
        side = "home" if e.get("team_id") == home_fot_id else "away"
        if e.get("type") == "Goal":
            minute = min(max(e.get("minute") or 90, 1), match_total)
            goals[side].append((minute,
                                e.get("player_id"), e.get("player_name") or e.get("player") or "",
                                e.get("assist_id"), e.get("assist_name") or e.get("assist") or "",
                                bool(e.get("is_own_goal")) or e.get("goal_type") == "own_goal"))
        elif e.get("type") == "Card":
            cards.append((side, e.get("player_id"),
                          e.get("player_name") or e.get("player") or "", e.get("card_type")))

    rows = {}

    def row(pid):
        return rows.setdefault(pid, {"mp": 0})

    for pid, side, starter, st, mp, _pos in entries:
        if mp <= 0:
            continue
        r = row(pid)
        r["mp"] += mp
        opp = "away" if side == "home" else "home"
        # on-pitch window: starters [0, mp], subs [total-mp, total]
        conceded = sum(1 for g in goals[opp]
                       if (starter and g[0] <= mp) or (not starter and g[0] >= match_total - mp))
        cat = cat_by_id.get(pid)
        if conceded:
            r["gc"] = r.get("gc", 0) + conceded
        if mp >= 60 and conceded == 0:
            r["cs"] = r.get("cs", 0) + 1
        if st.get("saves"):
            r["sv"] = r.get("sv", 0) + st["saves"]
        if cat in ("DEF", "MID", "FWD"):
            dc = (st.get("total_clearance") or 0) + (st.get("interceptions") or 0) \
                + (st.get("total_tackles") or 0)
            if cat in ("MID", "FWD"):
                dc += st.get("ball_recovery") or 0
            if dc:
                r["dc"] = r.get("dc", 0) + dc

    # penalties from the shot map: any failed penalty is a miss (-2) for the
    # shooter; a saved one also credits the defending keeper on the pitch (+5).
    # Shots after the final whistle (minute > match_total) are shootout kicks
    # and don't score.
    for s in j.get("shots", []) or []:
        if (s.get("situation") or "").lower() != "penalty" or s.get("event_type") == "Goal":
            continue
        if (s.get("minute") or 0) > match_total:
            continue
        side = "home" if s.get("team_id") == home_fot_id else "away"
        opp = "away" if side == "home" else "home"
        minute = min(max(s.get("minute") or 90, 1), match_total)
        pid = lookup(side, s.get("player_id"), s.get("player_name") or "")
        if pid is not None and pid in rows:
            rows[pid]["pm"] = rows[pid].get("pm", 0) + 1
        if s.get("event_type") == "AttemptSaved":
            for gpid, sd, starter, _st, mp, pos in entries:
                on_pitch = (starter and minute <= mp) or (not starter and minute >= match_total - mp)
                if sd == opp and pos == "G" and mp > 0 and on_pitch and gpid in rows:
                    rows[gpid]["ps"] = rows[gpid].get("ps", 0) + 1
                    break

    # goals, assists and own goals from events (goal is recorded against the
    # benefiting team; an own goal's scorer plays for the opposing side)
    for side in ("home", "away"):
        opp = "away" if side == "home" else "home"
        for _, fot_id, scorer, a_fot_id, assist, is_og in goals[side]:
            sid = lookup(side, fot_id, scorer)
            if is_og or (sid is None or sid not in rows):
                ogid = lookup(opp, fot_id, scorer) or sid
                if ogid is not None and ogid in rows:
                    rows[ogid]["og"] = rows[ogid].get("og", 0) + 1
            else:
                rows[sid]["gs"] = rows[sid].get("gs", 0) + 1
            aid = lookup(side, a_fot_id, assist) if (a_fot_id or assist) else None
            if aid is not None and aid in rows and not is_og:
                rows[aid]["a"] = rows[aid].get("a", 0) + 1

    # cards; a second-yellow red (-3) absorbs the first yellow, FPL-style
    second_yellow = set()
    for side, fot_id, player, card_type in cards:
        pid = lookup(side, fot_id, player) or lookup("away" if side == "home" else "home", fot_id, player)
        if pid is None or pid not in rows:
            continue
        if card_type == "Yellow":
            rows[pid]["yc"] = rows[pid].get("yc", 0) + 1
        elif card_type in ("Red", "YellowRed"):
            rows[pid]["rc"] = rows[pid].get("rc", 0) + 1
            if card_type == "YellowRed":
                second_yellow.add(pid)
    for pid in second_yellow:
        if rows[pid].get("yc"):
            rows[pid]["yc"] -= 1

    # house bonus: top three match ratings get 3/2/1 (FPL tie rules)
    rated = []
    for pid, side, starter, st, mp, _pos in entries:
        if mp > 0 and st.get("rating") and pid in rows:
            rated.append((st["rating"], pid))
    rated.sort(reverse=True)
    for i, (rating, pid) in enumerate(rated[:8]):
        ahead = sum(1 for r, _ in rated if r > rating)
        pts = {0: 3, 1: 2, 2: 1}.get(ahead, 0)
        if pts:
            rows[pid]["b"] = rows[pid].get("b", 0) + pts

    return rows, unresolved


def transform():
    """Build the EPL app data entirely from our own match-events stats.
    Player identities come straight from the lineups (like the World Cup
    build); the local FPL snapshot is only used to attach player photos."""
    out = OUT / "epl"
    out.mkdir(parents=True, exist_ok=True)

    # cosmetic photo enrichment from the local FPL snapshot (no API calls)
    bootstrap = json.loads((RAW / "bootstrap.json").read_text(encoding="utf-8"))
    resolve = build_name_resolver(bootstrap)
    photo_by_fpl_id = {
        el["id"]: f"https://resources.premierleague.com/premierleague/photos/players/110x140/p{el['code']}.png"
        for el in bootstrap["elements"]}
    fpl_badge_by_name = {
        TEAM_NAME_MAP[t["name"]]: f"https://resources.premierleague.com/premierleague/badges/70/t{t['code']}.png"
        for t in bootstrap["teams"]}
    fpl_team_by_name = {TEAM_NAME_MAP[t["name"]]: t["id"] for t in bootstrap["teams"]}

    # teams + fixtures from our own fixtures CSV (FotMob team ids)
    rows_csv = [r for r in csv.DictReader(open(OWN_FIXTURES_CSV, encoding="utf-8"))
                if r["season"] == OWN_SEASON]
    team_names = {}
    for r in rows_csv:
        team_names[int(r["home_id"])] = r["home_team"]
        team_names[int(r["away_id"])] = r["away_team"]
    teams = []
    for tid, name in sorted(team_names.items(), key=lambda x: x[1]):
        short = EPL_SHORT.get(name, name[:3].upper())
        teams.append({
            "id": tid, "name": name, "short": short, "code": tid,
            "color": EPL_COLORS.get(short, "#444444"),
            "tcol": "#1a1a2e" if short in EPL_DARK_TEXT else "#ffffff",
            "badge": fpl_badge_by_name.get(name, ""),
        })

    fixtures_by_gw = defaultdict(list)
    for r in rows_csv:
        gw = int(r["round"])
        hs = as_ = None
        if r["finished"] == "True" and "-" in (r["score"] or ""):
            hs, as_ = (int(x) for x in r["score"].split("-"))
        fixtures_by_gw[gw].append({
            "gw": gw, "h": int(r["home_id"]), "a": int(r["away_id"]),
            "hs": hs, "as": as_, "ko": r["utc_time"],
            "_home": r["home_team"], "_away": r["away_team"], "_date": r["date"],
        })

    # pick the match file for every fixture (closest date; folder has strays)
    match_index = load_own_match_index()
    file_cache = {}
    missing_files = []

    def datekey(s):
        return int(s[:4]) * 372 + int(s[5:7]) * 31 + int(s[8:10]) if s else 0

    for gw in sorted(fixtures_by_gw):
        for fx in fixtures_by_gw[gw]:
            candidates = match_index.get((fx["_home"], fx["_away"]), [])
            fx["_file"] = min(candidates, key=lambda c: abs(datekey(c[0]) - datekey(fx["_date"]))
                              if c[0] else 10**9)[1] if candidates else None
            if fx["_file"] is None:
                missing_files.append(f"GW{gw} {fx['_home']} v {fx['_away']}")

    def load(path):
        if path not in file_cache:
            file_cache[path] = json.load(open(path, encoding="utf-8"))
        return file_cache[path]

    # player DB pre-scan: id = lineup player_id, category from where they
    # actually lined up (majority of detailed positions across the season)
    player_info = {}
    pos_votes = defaultdict(Counter)
    for gw in sorted(fixtures_by_gw):
        for fx in fixtures_by_gw[gw]:
            if not fx["_file"]:
                continue
            j = load(fx["_file"])
            for side, csv_tid in (("home", fx["h"]), ("away", fx["a"])):
                for grp in ("starting_xi", "substitutes"):
                    for p in ((j.get("lineups") or {}).get(side) or {}).get(grp) or []:
                        pid = p.get("player_id")
                        if not pid:
                            continue
                        detailed = [DETAIL_GROUP[d] for d in (p.get("detailed_positions") or [])
                                    if d in DETAIL_GROUP]
                        if detailed:
                            pos_votes[pid].update(detailed)
                        else:
                            pos_votes[pid][p.get("position")] += 1
                        info = player_info.setdefault(pid, {"name": p.get("player_name"), "team": csv_tid})
                        if p.get("short_name"):
                            info["short"] = p["short_name"]
                        info["team"] = csv_tid
    cat_by_id = {}
    for pid, votes in pos_votes.items():
        player_info[pid]["type"] = POS_TYPE.get(votes.most_common(1)[0][0], 3)
        cat_by_id[pid] = CAT_BY_TYPE[player_info[pid]["type"]]

    resolve_player = lambda team, p: p.get("player_id")

    season_totals = defaultdict(lambda: {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
    fix_out, events = [], []
    for gw in sorted(fixtures_by_gw):
        gw_stats = defaultdict(list)
        for fx in fixtures_by_gw[gw]:
            if fx["_file"]:
                rows, _ = extract_match_rows(load(fx["_file"]), fx["h"], fx["a"],
                                             resolve_player, cat_by_id)
                for pid, row_ in rows.items():
                    gw_stats[pid].append(row_)
            fix_out.append({k: v for k, v in fx.items() if not k.startswith("_")})

        (out / f"gw{gw}.json").write_text(
            json.dumps({str(pid): rows for pid, rows in gw_stats.items()}), encoding="utf-8")
        for pid, fixture_rows in gw_stats.items():
            tot = season_totals[pid]
            for r in fixture_rows:
                tot["mp"] += r.get("mp", 0)
                tot["gs"] += r.get("gs", 0)
                tot["a"] += r.get("a", 0)
                tot["gp"] += 1
                tot["pts"] += score_row(r, cat_by_id[pid])
        kos = [fx["ko"] for fx in fixtures_by_gw[gw]]
        events.append({"gw": gw, "name": f"Gameweek {gw}", "deadline": min(kos),
                       "finished": all(fx["hs"] is not None for fx in fixtures_by_gw[gw])})

    players = []
    photo_hits = 0
    for pid, info in player_info.items():
        tot = season_totals.get(pid, {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
        fpl_id = resolve(fpl_team_by_name.get(team_names[info["team"]]), info["name"] or "")
        img = photo_by_fpl_id.get(fpl_id)
        if img:
            photo_hits += 1
        players.append({
            "id": pid, "code": pid,
            "name": info.get("short") or info["name"], "full": info["name"],
            "team": info["team"], "type": info.get("type", 3), "pos": [],
            "img": img,
            "mins": tot["mp"], "g": tot["gs"], "a": tot["a"],
            "gp": tot["gp"], "pts": tot["pts"],
        })

    core = {"season": "Premier League 2025/26", "teams": teams, "players": players,
            "fixtures": fix_out, "events": events}
    (out / "core.json").write_text(json.dumps(core), encoding="utf-8")

    if missing_files:
        print(f"WARNING: {len(missing_files)} fixtures without a match JSON:", missing_files[:5])
    print(f"photos matched for {photo_hits}/{len(players)} players")
    print(f"wrote {out / 'core.json'} ({len(players)} players, {len(fix_out)} fixtures) + {len(events)} gameweek stat files")


def transform_wc():
    """Build the World Cup 2026 app data purely from our own match-events
    files. Player identities come straight from the lineups (FotMob ids)."""
    out = OUT / "wc2026"
    out.mkdir(parents=True, exist_ok=True)

    fixtures_rows = [r for r in csv.DictReader(open(WC_FIXTURES_CSV, encoding="utf-8"))
                     if r["season"] == WC_SEASON]

    def team_known(r):
        return "/" not in r["home_team"] and "/" not in r["away_team"] \
            and not r["home_team"].startswith(("Winner", "Loser")) \
            and not r["away_team"].startswith(("Winner", "Loser"))

    # teams from fixtures with real ids
    team_names = {}
    for r in fixtures_rows:
        if team_known(r):
            team_names[int(r["home_id"])] = r["home_team"]
            team_names[int(r["away_id"])] = r["away_team"]
    teams = []
    for tid, name in sorted(team_names.items(), key=lambda x: x[1]):
        short = WC_SHORT.get(name, name[:3].upper())
        teams.append({
            "id": tid, "name": name, "short": short, "code": tid,
            "color": WC_COLORS.get(short, "#3a5b8c"),
            "tcol": "#1a1a2e" if short in WC_LIGHT else "#ffffff",
            "badge": f"https://images.fotmob.com/image_resources/logo/teamlogo/{tid}.png",
        })

    # player DB from lineups: id = FotMob player id. Position category comes
    # from where they ACTUALLY lined up each match (detailed_positions),
    # majority vote — not FotMob's career-level "usual position" (which e.g.
    # still calls Perisic a forward while Croatia play him at left-back).
    detail_group = {"GK": "G", "DC": "D", "DL": "D", "DR": "D",
                    "DM": "M", "MC": "M", "AM": "M", "ML": "M", "MR": "M",
                    "LW": "F", "RW": "F", "ST": "F"}
    player_info = {}
    pos_votes = defaultdict(Counter)
    for fp in glob.glob(str(WC_EVENTS_DIR / "*.json")):
        j = json.load(open(fp, encoding="utf-8"))
        for side, tid in (("home", j.get("home_team_id")), ("away", j.get("away_team_id"))):
            for grp in ("starting_xi", "substitutes"):
                for p in ((j.get("lineups") or {}).get(side) or {}).get(grp) or []:
                    pid = p.get("player_id")
                    if not pid:
                        continue
                    detailed = [detail_group[d] for d in (p.get("detailed_positions") or [])
                                if d in detail_group]
                    if detailed:
                        pos_votes[pid].update(detailed)
                    else:
                        pos_votes[pid][p.get("position")] += 1
                    info = player_info.setdefault(pid, {"name": p.get("player_name"), "team": tid})
                    if p.get("short_name"):
                        info["short"] = p["short_name"]
                    info["team"] = tid
    pos_type = {"G": 1, "D": 2, "M": 3, "F": 4}
    cat_by_id = {}
    for pid, votes in pos_votes.items():
        best = votes.most_common(1)[0][0]
        player_info[pid]["type"] = pos_type.get(best, 3)
        cat_by_id[pid] = CAT_BY_TYPE[player_info[pid]["type"]]

    resolve_player = lambda team, p: p.get("player_id")

    round_order = {key: i + 1 for i, (key, _, _) in enumerate(WC_ROUNDS)}
    fixtures_by_gw = defaultdict(list)
    for r in fixtures_rows:
        gw = round_order.get(r["round"])
        if gw is None:
            continue
        hs = as_ = None
        if r["finished"] == "True" and "-" in (r["score"] or ""):
            hs, as_ = (int(x) for x in r["score"].split("-"))
        fixtures_by_gw[gw].append({
            "gw": gw,
            "h": int(r["home_id"]) if team_known(r) else None,
            "a": int(r["away_id"]) if team_known(r) else None,
            "hs": hs, "as": as_, "ko": r["utc_time"],
            "_mid": r["match_id"], "_known": team_known(r),
        })

    season_totals = defaultdict(lambda: {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
    missing = []
    fix_out, events = [], []
    for gw, (rkey, rname, rshort) in zip(sorted(fixtures_by_gw), WC_ROUNDS):
        gw_stats = defaultdict(list)
        for fx in fixtures_by_gw[gw]:
            path = WC_EVENTS_DIR / f"{fx['_mid']}.json"
            if fx["_known"] and path.exists():
                j = json.load(open(path, encoding="utf-8"))
                rows, _ = extract_match_rows(j, fx["h"], fx["a"], resolve_player, cat_by_id)
                for pid, row_ in rows.items():
                    gw_stats[pid].append(row_)
            elif fx["_known"] and fx["hs"] is not None:
                missing.append(f"{rshort} {fx['_mid']}")
            fix_out.append({k: v for k, v in fx.items() if not k.startswith("_")})
        (out / f"gw{gw}.json").write_text(
            json.dumps({str(pid): rows for pid, rows in gw_stats.items()}), encoding="utf-8")
        for pid, fixture_rows in gw_stats.items():
            tot = season_totals[pid]
            for r in fixture_rows:
                tot["mp"] += r.get("mp", 0)
                tot["gs"] += r.get("gs", 0)
                tot["a"] += r.get("a", 0)
                tot["gp"] += 1
                tot["pts"] += score_row(r, cat_by_id[pid])
        kos = [fx["ko"] for fx in fixtures_by_gw[gw]]
        events.append({"gw": gw, "name": rname, "short": rshort, "deadline": min(kos),
                       "finished": all(fx["hs"] is not None for fx in fixtures_by_gw[gw])})

    players = []
    for pid, info in player_info.items():
        tot = season_totals.get(pid, {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
        players.append({
            "id": pid, "code": pid,
            "name": info.get("short") or info["name"], "full": info["name"],
            "team": info["team"], "type": info.get("type", 3), "pos": [],
            "img": f"https://images.fotmob.com/image_resources/playerimages/{pid}.png",
            "mins": tot["mp"], "g": tot["gs"], "a": tot["a"],
            "gp": tot["gp"], "pts": tot["pts"],
        })

    core = {"season": "World Cup 2026", "teams": teams, "players": players,
            "fixtures": fix_out, "events": events}
    (out / "core.json").write_text(json.dumps(core), encoding="utf-8")
    if missing:
        print(f"WARNING: {len(missing)} finished WC fixtures without a match file:", missing[:6])
    print(f"wrote {out / 'core.json'} ({len(players)} players, {len(teams)} teams, "
          f"{len(fix_out)} fixtures, {len(events)} rounds)")


def transform_fpl():
    """Legacy: build the per-gameweek stats from the FPL API snapshots."""
    OUT.mkdir(parents=True, exist_ok=True)
    bootstrap = json.loads((RAW / "bootstrap.json").read_text(encoding="utf-8"))
    fixtures = json.loads((RAW / "fixtures.json").read_text(encoding="utf-8"))

    positions = match_positions(bootstrap)

    teams = [{
        "id": t["id"],
        "name": t["name"],
        "short": t["short_name"],
        "code": t["code"],
    } for t in bootstrap["teams"]]

    fix_out = [{
        "gw": f["event"],
        "h": f["team_h"],
        "a": f["team_a"],
        "hs": f["team_h_score"],
        "as": f["team_a_score"],
        "ko": f["kickoff_time"],
    } for f in fixtures if f["event"]]

    # Per-gameweek, per-player, per-fixture stats from the live "explain" data
    cat_by_id = {el["id"]: CAT_BY_TYPE[el["element_type"]] for el in bootstrap["elements"]}
    season_totals = defaultdict(lambda: {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
    for gw in range(1, 39):
        live = json.loads((RAW / f"live_gw{gw}.json").read_text(encoding="utf-8"))
        gw_stats = {}
        for el in live["elements"]:
            fixtures_stats = []
            for block in el.get("explain", []):
                row = {}
                for s in block.get("stats", []):
                    key = STAT_KEYS.get(s["identifier"])
                    if key:
                        row[key] = s["value"]
                if row.get("mp"):
                    fixtures_stats.append(row)
            if fixtures_stats:
                gw_stats[str(el["id"])] = fixtures_stats
                tot = season_totals[el["id"]]
                for row in fixtures_stats:
                    tot["mp"] += row.get("mp", 0)
                    tot["gs"] += row.get("gs", 0)
                    tot["a"] += row.get("a", 0)
                    tot["gp"] += 1
                    tot["pts"] += score_row(row, cat_by_id[el["id"]])
        (OUT / f"gw{gw}.json").write_text(json.dumps(gw_stats), encoding="utf-8")

    players = []
    for el in bootstrap["elements"]:
        tot = season_totals.get(el["id"], {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
        players.append({
            "id": el["id"],
            "code": el["code"],
            "name": el["web_name"],
            "full": f"{el['first_name']} {el['second_name']}".strip(),
            "team": el["team"],
            "type": el["element_type"],
            "pos": positions[el["id"]],
            "mins": tot["mp"],
            "g": tot["gs"],
            "a": tot["a"],
            "gp": tot["gp"],
            "pts": tot["pts"],
        })

    core = {
        "season": "2025/26",
        "teams": teams,
        "players": players,
        "fixtures": fix_out,
        "events": [{
            "gw": e["id"],
            "name": e["name"],
            "deadline": e["deadline_time"],
            "finished": e["finished"],
        } for e in bootstrap["events"]],
    }
    (OUT / "core.json").write_text(json.dumps(core), encoding="utf-8")
    print(f"wrote {OUT / 'core.json'} ({len(players)} players, {len(fix_out)} fixtures) + 38 gameweek stat files")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "transform"
    if cmd == "download":
        download()                      # snapshot the FPL API (bootstrap etc.)
    elif cmd == "transform-fpl":
        transform_fpl()                 # legacy: score from FPL API stats
    elif cmd == "wc":
        transform_wc()                  # World Cup 2026 only
    elif cmd == "epl":
        transform()                     # EPL only
    else:
        transform()                     # both competitions from our own stats
        transform_wc()
