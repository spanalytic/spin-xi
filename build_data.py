"""Build the Spin XI app data.

Premier League 2026/27 (the live game) comes straight from the FPL API, so
every stat, position and bonus point matches fantasy.premierleague.com:

    python build_data.py fpl            # fetch the latest FPL data + rebuild (web/data/epl2627)
    python build_data.py fpl-transform  # rebuild from the snapshots in data/raw/2627
    python build_data.py fpl-due        # is a match on? (the scheduled refresh checks this)
    python build_data.py fpl-next       # minutes until the next match window (0 = on now)
    python build_data.py fpl-assets     # save club badges + check which player photos exist

Archived competitions, built from our own match-events files:

    python build_data.py                # Premier League 25/26 + World Cup 2026
    python build_data.py epl            # Premier League 25/26 only
    python build_data.py wc             # World Cup 2026 only
    python build_data.py download       # 25/26 FPL snapshot (photos for the 25/26 build)
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
        # FPL availability: d doubtful, i injured, s suspended, u left/unavailable,
        # n not eligible (e.g. on loan). Only flagged players carry these keys.
        if el["status"] != "a":
            players[-1].update({"st": el["status"], "news": el["news"],
                                "chance": el["chance_of_playing_next_round"]})

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
        # FPL availability: d doubtful, i injured, s suspended, u left/unavailable,
        # n not eligible (e.g. on loan). Only flagged players carry these keys.
        if el["status"] != "a":
            players[-1].update({"st": el["status"], "news": el["news"],
                                "chance": el["chance_of_playing_next_round"]})

    core = {"season": "World Cup 2026", "teams": teams, "players": players,
            "fixtures": fix_out, "events": events}
    (out / "core.json").write_text(json.dumps(core), encoding="utf-8")
    if missing:
        print(f"WARNING: {len(missing)} finished WC fixtures without a match file:", missing[:6])
    print(f"wrote {out / 'core.json'} ({len(players)} players, {len(teams)} teams, "
          f"{len(fix_out)} fixtures, {len(events)} rounds)")


# ---------------- Premier League from the FPL API ----------------
# The live game: every stat, position and bonus point comes straight from
# fantasy.premierleague.com, so scores match FPL exactly.
FPL_SEASON = "2026/27"
FPL_COMP = "epl2627"                    # web/data/<comp>/, also the app's comp id
FPL_RAW = RAW / "2627"                  # raw API snapshots for this season

# wheel colours for clubs not in EPL_COLORS (promoted / recently relegated)
EXTRA_COLORS = {
    "COV": "#59CBE8", "HUL": "#F5A12D", "IPS": "#0044A9", "LEI": "#003090",
    "SOU": "#D71920", "SHU": "#EE2737", "WBA": "#122F67", "MID": "#E11B22",
    "NOR": "#00A650", "WAT": "#FBEE23", "MIL": "#001D5E", "WRE": "#D71920",
}
EXTRA_DARK_TEXT = {"COV", "HUL", "WAT"}


def download_fpl(raw=FPL_RAW):
    """Snapshot the FPL API for the current season. Bootstrap and fixtures
    are always refreshed; a gameweek's live stats are re-fetched until FPL
    marks that gameweek finished and data-checked."""
    raw.mkdir(parents=True, exist_ok=True)
    bootstrap = fetch(f"{FPL_BASE}/bootstrap-static/")
    (raw / "bootstrap.json").write_text(json.dumps(bootstrap), encoding="utf-8")
    (raw / "fixtures.json").write_text(json.dumps(fetch(f"{FPL_BASE}/fixtures/")), encoding="utf-8")
    now = time.time()
    for ev in bootstrap["events"]:
        path = raw / f"live_gw{ev['id']}.json"
        if ev["deadline_time_epoch"] > now:
            continue                    # not started yet, nothing to score
        if path.exists() and ev["finished"] and ev["data_checked"]:
            continue                    # final, already have it
        print(f"downloading live_gw{ev['id']}.json ...", flush=True)
        path.write_text(json.dumps(fetch(f"{FPL_BASE}/event/{ev['id']}/live/")), encoding="utf-8")
        time.sleep(0.6)
    print("FPL download complete")


PHOTO_URLS = {
    # the 2025 Premier League site moved photos; newer players only exist there
    "pl25": "https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png",
    "legacy": "https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png",
}
BADGE_URL = "https://resources.premierleague.com/premierleague25/badges/{code}.svg"
BADGE_DIR = ROOT / "web" / "img" / "badges"
PHOTO_RECHECK_DAYS = 3                  # players without a photo get one eventually


def url_ok(url):
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status == 200 and len(r.read(64)) > 0
    except Exception:
        return False


def download_fpl_assets(raw=FPL_RAW):
    """Club badges (saved into the site so they always load) and which photo
    URL works for each player (cached; players with no photo get a kit
    avatar in the browser and are re-checked every few days)."""
    from concurrent.futures import ThreadPoolExecutor
    bootstrap = json.loads((raw / "bootstrap.json").read_text(encoding="utf-8"))
    BADGE_DIR.mkdir(parents=True, exist_ok=True)
    for t in bootstrap["teams"]:
        path = BADGE_DIR / f"t{t['code']}.svg"
        if path.exists():
            continue
        try:
            req = urllib.request.Request(BADGE_URL.format(code=t["code"]), headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
            if body.lstrip().startswith(b"<"):
                path.write_bytes(body)
                print(f"saved badge for {t['name']}")
        except Exception as e:
            print(f"badge for {t['name']} unavailable: {e}")

    cache_path = raw / "photos.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    now = time.time()
    todo = [el["code"] for el in bootstrap["elements"]
            if str(el["code"]) not in cache
            or (not cache[str(el["code"])]["src"]
                and now - cache[str(el["code"])]["t"] > PHOTO_RECHECK_DAYS * 86400)]

    def resolve(code):
        for src, pat in PHOTO_URLS.items():
            if url_ok(pat.format(code=code)):
                return code, src
        return code, ""

    with ThreadPoolExecutor(12) as pool:
        for code, src in pool.map(resolve, todo):
            cache[str(code)] = {"src": src, "t": int(now)}
    if todo:
        cache_path.write_text(json.dumps(cache, sort_keys=True), encoding="utf-8")
    have = sum(1 for el in bootstrap["elements"] if cache.get(str(el["code"]), {}).get("src"))
    print(f"photos: checked {len(todo)}, {have}/{len(bootstrap['elements'])} players have one")


def fpl_photo(code, cache=None):
    """(img, fallback img) for a player; '' img means no photo exists."""
    hit = (cache or {}).get(str(code))
    if hit is not None:
        return (PHOTO_URLS[hit["src"]].format(code=code) if hit["src"] else ""), ""
    # not checked yet: let the browser try both
    return PHOTO_URLS["pl25"].format(code=code), PHOTO_URLS["legacy"].format(code=code)


def fpl_refresh_due(raw=FPL_RAW, now=None):
    """Should the scheduled job fetch from FPL right now? Keeps API calls to
    match windows instead of hitting FPL every few minutes all week."""
    from datetime import datetime, timedelta, timezone
    now = now or datetime.now(timezone.utc)
    try:
        bootstrap = json.loads((raw / "bootstrap.json").read_text(encoding="utf-8"))
        fixtures = json.loads((raw / "fixtures.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return True, "no snapshot yet"
    # a match is on (or just finished and bonus is being added)
    for f in fixtures:
        if not f.get("kickoff_time"):
            continue
        ko = datetime.fromisoformat(f["kickoff_time"].replace("Z", "+00:00"))
        if ko - timedelta(minutes=5) <= now <= ko + timedelta(hours=3):
            return True, f"match window (kick-off {f['kickoff_time']})"
    # a gameweek has started but FPL hasn't confirmed its final points: check hourly
    started = [e for e in bootstrap["events"]
               if datetime.fromtimestamp(e["deadline_time_epoch"], timezone.utc) <= now]
    if any(not e["data_checked"] for e in started) and now.minute < 15:
        return True, "waiting for FPL to confirm final points"
    # once an hour, pick up injury news and rescheduled fixtures
    if now.minute < 10:
        return True, "hourly injury news and fixture check"
    return False, "no match on"


def fpl_minutes_to_match(raw=FPL_RAW, now=None):
    """Minutes until the next match window opens (0 while one is on), or None
    when no fixture is left. A window runs from 5 minutes before kick-off to
    3 hours after, the same as fpl_refresh_due."""
    from datetime import datetime, timedelta, timezone
    now = now or datetime.now(timezone.utc)
    fixtures = json.loads((raw / "fixtures.json").read_text(encoding="utf-8"))
    best = None
    for f in fixtures:
        if not f.get("kickoff_time"):
            continue
        ko = datetime.fromisoformat(f["kickoff_time"].replace("Z", "+00:00"))
        start, end = ko - timedelta(minutes=5), ko + timedelta(hours=3)
        if start <= now <= end:
            return 0
        if start > now:
            mins = int((start - now).total_seconds() // 60)
            best = mins if best is None else min(best, mins)
    return best


def transform_fpl(raw=FPL_RAW, comp=FPL_COMP, season=FPL_SEASON):
    """Build the app data from FPL API snapshots (bootstrap, fixtures and
    per-gameweek live stats). Player ids, positions and every stat are FPL's
    own; the build checks our scoring against FPL's points for every row."""
    out = OUT / comp
    out.mkdir(parents=True, exist_ok=True)
    bootstrap = json.loads((raw / "bootstrap.json").read_text(encoding="utf-8"))
    fixtures = json.loads((raw / "fixtures.json").read_text(encoding="utf-8"))

    teams = []
    for t in sorted(bootstrap["teams"], key=lambda t: t["name"]):
        short = t["short_name"]
        teams.append({
            "id": t["id"], "name": t["name"], "short": short, "code": t["code"],
            "color": EPL_COLORS.get(short) or EXTRA_COLORS.get(short, "#444444"),
            "tcol": "#1a1a2e" if short in EPL_DARK_TEXT | EXTRA_DARK_TEXT else "#ffffff",
            "badge": (f"img/badges/t{t['code']}.svg" if (BADGE_DIR / f"t{t['code']}.svg").exists()
                      else BADGE_URL.format(code=t["code"])),
        })

    # postponed fixtures have no gameweek until FPL reschedules them
    fixtures_by_gw = defaultdict(list)
    for f in fixtures:
        if not f["event"]:
            continue
        done = f.get("finished_provisional") or f.get("finished")
        fixtures_by_gw[f["event"]].append({
            "gw": f["event"], "h": f["team_h"], "a": f["team_a"],
            "hs": f["team_h_score"] if done else None,
            "as": f["team_a_score"] if done else None,
            "ko": f["kickoff_time"],
        })

    elements = [el for el in bootstrap["elements"] if el["element_type"] in CAT_BY_TYPE]
    cat_by_id = {el["id"]: CAT_BY_TYPE[el["element_type"]] for el in elements}
    season_totals = defaultdict(lambda: {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
    fix_out, events = [], []
    rows_checked, mismatches = 0, []
    for ev in bootstrap["events"]:
        gw = ev["id"]
        gw_fixtures = sorted(fixtures_by_gw.get(gw, []), key=lambda f: f["ko"] or "")
        fix_out += gw_fixtures
        gw_stats = {}
        live_path = raw / f"live_gw{gw}.json"
        live = json.loads(live_path.read_text(encoding="utf-8")) if live_path.exists() else {"elements": []}
        for el in live["elements"]:
            if el["id"] not in cat_by_id:
                continue
            fixture_rows = []
            for block in el.get("explain", []):
                row = {}
                for st in block.get("stats", []):
                    key = STAT_KEYS.get(st["identifier"])
                    if key and st["value"]:
                        row[key] = st["value"]
                if not row:
                    continue            # unused sub with nothing to score
                row.setdefault("mp", 0)
                fpl_pts = sum(st["points"] for st in block.get("stats", []))
                ours = score_row(row, cat_by_id[el["id"]])
                rows_checked += 1
                if ours != fpl_pts:
                    mismatches.append(f"GW{gw} player {el['id']}: ours {ours} vs FPL {fpl_pts} {row}")
                fixture_rows.append(row)
                tot = season_totals[el["id"]]
                tot["mp"] += row["mp"]
                tot["gs"] += row.get("gs", 0)
                tot["a"] += row.get("a", 0)
                tot["gp"] += 1 if row["mp"] else 0
                tot["pts"] += ours
            if fixture_rows:
                gw_stats[str(el["id"])] = fixture_rows
        (out / f"gw{gw}.json").write_text(json.dumps(gw_stats), encoding="utf-8")
        kos = [f["ko"] for f in gw_fixtures if f["ko"]]
        events.append({
            "gw": gw, "name": ev["name"],
            # entries lock at the gameweek's first kick-off (FPL's own deadline is earlier)
            "deadline": min(kos) if kos else ev["deadline_time"],
            "finished": bool(gw_fixtures) and all(f["hs"] is not None for f in gw_fixtures),
            "checked": bool(ev.get("data_checked")),   # FPL has confirmed final points
        })

    photo_cache_path = raw / "photos.json"
    photo_cache = (json.loads(photo_cache_path.read_text(encoding="utf-8"))
                   if photo_cache_path.exists() else None)
    players = []
    for el in elements:
        img, img2 = fpl_photo(el["code"], photo_cache)
        tot = season_totals.get(el["id"], {"mp": 0, "gs": 0, "a": 0, "gp": 0, "pts": 0})
        players.append({
            "id": el["id"], "code": el["code"],
            "name": el["web_name"],
            "full": f"{el['first_name']} {el['second_name']}".strip(),
            "team": el["team"], "type": el["element_type"], "pos": [],
            "img": img, **({"img2": img2} if img2 else {}),
            "mins": tot["mp"], "g": tot["gs"], "a": tot["a"],
            "gp": tot["gp"], "pts": tot["pts"],
        })
        # FPL availability: d doubtful, i injured, s suspended, u left/unavailable,
        # n not eligible (e.g. on loan). Only flagged players carry these keys.
        if el["status"] != "a":
            players[-1].update({"st": el["status"], "news": el["news"],
                                "chance": el["chance_of_playing_next_round"]})

    core = {"season": f"Premier League {season}", "teams": teams, "players": players,
            "fixtures": fix_out, "events": events}
    (out / "core.json").write_text(json.dumps(core), encoding="utf-8")
    print(f"wrote {out / 'core.json'} ({len(players)} players, {len(teams)} teams, "
          f"{len(fix_out)} fixtures, {len(events)} gameweeks)")
    print(f"scoring check: {rows_checked - len(mismatches)}/{rows_checked} player-fixture rows match FPL points")
    for m in mismatches[:10]:
        print("  MISMATCH", m)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "transform"
    if cmd == "download":
        download()                      # snapshot the FPL API (bootstrap etc.)
    elif cmd == "fpl":
        download_fpl()                  # Premier League 26/27: fetch from the FPL API
        download_fpl_assets()
        transform_fpl()
    elif cmd == "fpl-assets":
        download_fpl_assets()           # badges + player photo check only
    elif cmd == "fpl-due":
        due, why = fpl_refresh_due()    # used by the scheduled GitHub job
        print(f"due={'true' if due else 'false'}  # {why}")
    elif cmd == "fpl-next":
        mins = fpl_minutes_to_match()   # used by the live-match GitHub job
        print("none" if mins is None else mins)
    elif cmd == "fpl-transform":
        transform_fpl()                 # rebuild from the existing FPL snapshots
    elif cmd == "wc":
        transform_wc()                  # World Cup 2026 only
    elif cmd == "epl":
        transform()                     # EPL only
    else:
        transform()                     # both competitions from our own stats
        transform_wc()
