"""One-off check (run on GitHub Actions, which can reach the Premier League
image servers): how many player photos and club badges each URL pattern serves."""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

core = json.load(open("web/data/epl2627/core.json", encoding="utf-8"))
UA = {"User-Agent": "Mozilla/5.0 (spin-xi image check)"}


def ok(url):
    try:
        req = urllib.request.Request(url, headers=UA, method="GET")
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(64)
            return r.status == 200 and len(body) > 0
    except Exception:
        return False


PHOTO = {
    "legacy": "https://resources.premierleague.com/premierleague/photos/players/110x140/p{code}.png",
    "pl25": "https://resources.premierleague.com/premierleague25/photos/players/110x140/{code}.png",
    "legacy250": "https://resources.premierleague.com/premierleague/photos/players/250x250/p{code}.png",
}
BADGE = {
    "70": "https://resources.premierleague.com/premierleague/badges/70/t{code}.png",
    "100x2": "https://resources.premierleague.com/premierleague/badges/100/t{code}@x2.png",
    "rbsvg": "https://resources.premierleague.com/premierleague/badges/rb/t{code}.svg",
    "pl25svg": "https://resources.premierleague.com/premierleague25/badges/{code}.svg",
}

with ThreadPoolExecutor(16) as pool:
    for label, pat in BADGE.items():
        res = list(pool.map(lambda t: ok(pat.format(code=t["code"])), core["teams"]))
        print(f"badge {label}: {sum(res)}/{len(res)}")
    players = core["players"]
    results = {}
    for label, pat in PHOTO.items():
        results[label] = list(pool.map(lambda p: ok(pat.format(code=p["code"])), players))
        print(f"photo {label}: {sum(results[label])}/{len(players)}")
    none = [p for i, p in enumerate(players) if not any(r[i] for r in results.values())]
    print(f"players with no photo anywhere: {len(none)}")
    for p in none[:40]:
        print("  ", p["name"], p["team"], p["code"], p["mins"], "mins")
    only25 = sum(1 for i in range(len(players)) if results["pl25"][i] and not results["legacy"][i])
    onlyleg = sum(1 for i in range(len(players)) if results["legacy"][i] and not results["pl25"][i])
    print(f"pl25 only: {only25}, legacy only: {onlyleg}")
    json.dump({p["code"]: [k for k in PHOTO if results[k][i]] for i, p in enumerate(players)},
              open(sys.argv[1] if len(sys.argv) > 1 else "probe.json", "w"))
