"""Spin XI emails: re-spin reminders and gameweek results, opt-in only.

Players tick a box on the site (Firestore prefs/{uid}.emails). The scheduled
"Refresh FPL scores" GitHub job runs this after each refresh:

    python mailer.py due       # anything to send right now? (no Firebase needed)
    python mailer.py run       # file unsubscribes, then send whatever is due
    python mailer.py preview   # write sample emails to mail-preview/ (sends nothing)
    python mailer.py test      # send the sample emails to EMAILS_TEST_TO only

What gets sent, once per gameweek each:
  - a re-spin reminder REMIND_HOURS before the first kick-off, to opted-in
    players whose team was in 12+ hours early and who haven't re-spun yet;
  - results once FPL confirms the gameweek's final points, to opted-in
    players who had a team in it.

Settings come from the environment (GitHub secrets / variables):
  FIREBASE_SERVICE_ACCOUNT  the Firebase admin key (JSON). Reads the players,
                            their emails (from Firebase Auth) and their choice.
  SMTP_USER, SMTP_PASSWORD  the mailbox that sends (e.g. a Gmail address and
                            an app password); SMTP_HOST / SMTP_PORT default to
                            Gmail. MAIL_FROM overrides the From line.
  EMAILS_LIVE               "true" sends to every opted-in player. Otherwise
                            only addresses in EMAILS_TEST_TO get anything, and
                            the rest are logged as skipped.
  MAIL_DRY_RUN              "1" writes .eml files to mail-out/ instead of sending.
For the Firebase emulators set FIRESTORE_EMULATOR_HOST and
FIREBASE_AUTH_EMULATOR_HOST (no key needed) and MAIL_SECRET.
"""

import base64
import functools
import hashlib
import hmac
import html
import json
import os
import re
import smtplib
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import SMTP as SMTP_POLICY
from email.utils import formataddr, make_msgid
from pathlib import Path
from zoneinfo import ZoneInfo

from build_data import CAT_BY_TYPE, score_row

ROOT = Path(__file__).parent
COMP = "epl2627"
DATA = ROOT / "web" / "data" / COMP
SITE = os.environ.get("SITE_URL") or "https://spanalytic.github.io/spin-xi/"
UK = ZoneInfo("Europe/London")

FIRST_GW = 7                      # emails started in Gameweek 7
REMIND_HOURS = 3                  # re-spin reminder this long before kick-off


def respin_tiers():
    """[(how early, re-spins earned)], read from RESPIN_TIERS in app.js so the
    two never disagree (12 hours -> 1 if app.js predates the tiers)."""
    js = (ROOT / "web" / "app.js").read_text(encoding="utf-8")
    tiers = [(timedelta(hours=int(h)), int(n)) for h, n in
             re.findall(r"\{\s*before:\s*(\d+)\s*\*\s*HOUR_MS,\s*count:\s*(\d+)\s*\}", js)]
    return sorted(tiers, reverse=True) or [(timedelta(hours=12), 1)]


RESPIN_TIERS = respin_tiers()
DEADLINE_GRACE = timedelta(minutes=10)   # same clock-skew allowance as the board
RESULTS_FOR = timedelta(days=10)  # stop trying to send a gameweek's results after this

TEXTDB = "https://textdb.online/spinxi26_b7wq4x9r_"   # the old name-only board

# each formation's slots, as scoring categories (from FORMATIONS in app.js)
ROLE_CAT = {"GK": "GK", "LB": "DEF", "RB": "DEF", "CB": "DEF",
            "CDM": "MID", "CM": "MID", "CAM": "MID", "LM": "MID", "RM": "MID",
            "LAM": "MID", "RAM": "MID", "LW": "FWD", "RW": "FWD", "ST": "FWD"}
FORMATIONS = {
    "4-3-3": "GK LB CB CB RB CM CM CM LW ST RW",
    "4-4-2": "GK LB CB CB RB LM CM CM RM ST ST",
    "4-2-3-1": "GK LB CB CB RB CDM CDM LAM CAM RAM ST",
    "4-5-1": "GK LB CB CB RB LM CM CM CM RM ST",
    "3-4-3": "GK CB CB CB LM CM CM RM LW ST RW",
    "3-5-2": "GK CB CB CB LM CM CM CM RM ST ST",
    "5-3-2": "GK LB CB CB CB RB CM CM CM ST ST",
    "5-4-1": "GK LB CB CB CB RB LM CM CM RM ST",
}
FORMATION_CATS = {f: [ROLE_CAT[r] for r in roles.split()] for f, roles in FORMATIONS.items()}


def utcnow():
    return datetime.now(timezone.utc)


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def load_core():
    return json.loads((DATA / "core.json").read_text(encoding="utf-8"))


def gw_stats(gw):
    return json.loads((DATA / f"gw{gw}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- what's due

def reminder_gw(core, now):
    """The gameweek whose re-spin reminder is due now, or None."""
    for ev in core["events"]:
        dl = parse_time(ev["deadline"])
        if ev["gw"] >= FIRST_GW and dl - timedelta(hours=REMIND_HOURS) <= now < dl - timedelta(minutes=5):
            return ev["gw"]
    return None


def results_gw(core, now):
    """The latest gameweek with final points confirmed, while still recent."""
    done = [ev for ev in core["events"]
            if ev["checked"] and ev["gw"] >= FIRST_GW and now - parse_time(ev["deadline"]) < RESULTS_FOR]
    return done[-1]["gw"] if done else None


def due(core, now):
    """Cheap check for the GitHub job: (due, why). Results are retried hourly
    until sent; the Firestore state stops a second send."""
    gw = reminder_gw(core, now)
    if gw:
        return True, f"GW{gw} re-spin reminder window"
    gw = results_gw(core, now)
    if gw and now.minute < 10:
        return True, f"GW{gw} final points confirmed"
    return False, "nothing to send"


# ---------------------------------------------------------------- the game's rules (ported from app.js)

class Game:
    def __init__(self, core):
        self.core = core
        self.players = {p["id"]: p for p in core["players"]}
        self.teams = {t["id"]: t for t in core["teams"]}
        self.deadlines = {ev["gw"]: parse_time(ev["deadline"]) for ev in core["events"]}
        self.fixtures = defaultdict(list)
        for f in core["fixtures"]:
            self.fixtures[(f["gw"], f["h"])].append(f)
            self.fixtures[(f["gw"], f["a"])].append(f)
        self._stats = {}

    def stats(self, gw):
        if gw not in self._stats:
            self._stats[gw] = gw_stats(gw)
        return self._stats[gw]

    def deadline(self, gw):
        return self.deadlines.get(gw, datetime.min.replace(tzinfo=timezone.utc))

    def on_time(self, e):
        return e["ts"] <= self.deadline(e["gw"]) + DEADLINE_GRACE

    def respins_earned(self, base):
        return next((n for before, n in RESPIN_TIERS if base["ts"] <= self.deadline(base["gw"]) - before), 0)

    def valid_respin(self, base, r):
        i = r.get("respinSlot")
        a, b = base.get("picks") or [], r.get("picks") or []
        cats = FORMATION_CATS.get(r.get("formation"), [])
        if r["gw"] != base["gw"] or r.get("formation") != base.get("formation"):
            return False
        if not isinstance(i, int) or not 0 <= i < len(cats) or len(a) != 11 or len(b) != 11:
            return False
        p = self.players.get(b[i])
        if not p or not self.on_time(r) or r["ts"] < base["ts"]:
            return False
        if b[i] in a or any(k != i and pid != a[k] for k, pid in enumerate(b)):
            return False
        if CAT_BY_TYPE.get(p["type"]) != cats[i]:
            return False
        return r.get("captain") in b if base.get("captain") == a[i] else r.get("captain") == base.get("captain")

    def counted(self, entries, gw):
        """The team that counts for a player in a gameweek, as countedEntry in
        app.js: {entry, base, earned, left}. Each re-spin names the team it
        re-spins, so the first team and its re-spins form a chain; entry is
        its last valid link and left the re-spins still unused (a re-spin
        that isn't valid still uses one up)."""
        mine = sorted((e for e in entries if e["gw"] == gw and e.get("picks") and self.on_time(e)),
                      key=lambda e: e["ts"])
        base = next((e for e in mine if not e.get("respinOf")), None)
        if not base:
            return None
        earned = self.respins_earned(base)
        entry, used = base, 0
        while used < earned:
            nxt = next((e for e in mine if e.get("respinOf") == entry["id"]), None)
            if not nxt:
                break
            used += 1
            if not self.valid_respin(entry, nxt):
                break
            entry = nxt
        return {"entry": entry, "base": base, "earned": earned, "left": earned - used}

    def score(self, entry):
        """(total, [(player, points, captain?)]) with the captain doubled."""
        stats = self.stats(entry["gw"])
        total, lines = 0, []
        for pid in entry["picks"]:
            p = self.players.get(pid)
            pts = sum(score_row(row, CAT_BY_TYPE[p["type"]]) for row in stats.get(str(pid), [])) if p else 0
            cap = pid == entry.get("captain")
            if cap:
                pts *= 2
            total += pts
            lines.append((p, pts, cap))
        return total, lines

    def upcoming_flag(self, p, gw):
        """'doubtful (75%)' / 'out' for a flagged player whose match is still ahead."""
        if not p or not p.get("st"):
            return None
        if not any(f["hs"] is None for f in self.fixtures.get((gw, p["team"]), [])):
            return None
        chance = p.get("chance")
        if p["st"] == "d" and chance:
            return f"doubtful ({chance}%)", p.get("news") or ""
        return "out", p.get("news") or ""


def ms_to_dt(ms):
    return datetime.fromtimestamp((ms or 0) / 1000, timezone.utc)


def entry_key(e):
    """Same as lbEntryKey in app.js (ts in ms)."""
    if e.get("id"):
        return e["id"]
    picks = ",".join(str(p) for p in e.get("picks") or [])
    return f"{e.get('comp')}|{e['gw']}|{e.get('_ms') or ''}|{picks}|{e.get('captain') or ''}"


def account_entries(data):
    out = []
    for eid, e in (data.get("entries") or {}).items():
        if e.get("comp") != COMP:
            continue
        at = e.get("at")
        out.append({**e, "id": eid, "ts": at if isinstance(at, datetime) else ms_to_dt(0)})
    return out


def textdb_read(key):
    try:
        with urllib.request.urlopen(TEXTDB + key, timeout=20) as r:
            txt = r.read().decode("utf-8")
        return json.loads(txt) if txt.strip()[:1] in ("[", "{") else None
    except Exception as e:  # the old board is best-effort
        print(f"  old board read failed for {key}: {e}")
        return None


def board_players(accounts, claims):
    """Everyone on the leaderboard, as lbLoadPlayers builds it in app.js:
    [{owner, name, entries}], old name-only players folded into the account
    that claimed their name."""
    players = []
    for slug in textdb_read("members") or []:
        rec = textdb_read(f"p_{slug}")
        if not isinstance(rec, dict):
            continue
        entries = []
        for e in rec.get("entries") or []:
            if e and e.get("comp") == COMP and "gw" in e:
                entries.append({**e, "_ms": e.get("ts"), "ts": ms_to_dt(e.get("ts"))})
        owner = claims.get(slug) or "L:" + slug
        name = accounts[owner]["name"] if owner in accounts else rec.get("name") or "Player"
        players.append({"owner": owner, "name": name, "entries": entries})
    for uid, a in accounts.items():
        players.append({"owner": uid, "name": a["name"], "entries": a["entries"]})
    return players


def board_rows(game, players, gws):
    """One row per player per gameweek, deduped the way renderBoard does."""
    by_key = {}
    for pd in players:
        for e in pd["entries"]:
            if e["gw"] not in gws or not game.on_time(e):
                continue
            k = entry_key(e)
            prev = by_key.get(k)
            earlier = prev is not None and e["ts"] < prev["e"]["ts"]
            if not prev or (earlier if pd["owner"] == prev["owner"] else not earlier):
                by_key[k] = {"owner": pd["owner"], "name": pd["name"], "e": e}
    by_owner = defaultdict(lambda: {"name": "", "entries": []})
    for v in by_key.values():
        by_owner[v["owner"]]["name"] = v["name"]
        by_owner[v["owner"]]["entries"].append(v["e"])
    rows = []
    for owner, p in by_owner.items():
        for gw in sorted({e["gw"] for e in p["entries"]}):
            c = game.counted(p["entries"], gw)
            if c:
                total, _ = game.score(c["entry"])
                rows.append({"owner": owner, "name": p["name"], "gw": gw,
                             "entry": c["entry"], "base": c["base"], "total": total})
    return rows


def gw_table(rows, gw):
    rows = [r for r in rows if r["gw"] == gw]
    return sorted(rows, key=lambda r: (-r["total"], r["base"]["ts"]))


def season_table(rows, up_to):
    tot = defaultdict(lambda: {"total": 0, "gws": 0, "name": ""})
    for r in rows:
        if r["gw"] <= up_to:
            t = tot[r["owner"]]
            t["total"] += r["total"]
            t["gws"] += 1
            t["name"] = r["name"]
    return sorted(({"owner": o, **t} for o, t in tot.items()), key=lambda t: (-t["total"], -t["gws"]))


# ---------------------------------------------------------------- emails

def place(table, owner):
    """'3rd', or 'joint 2nd' when tied on points."""
    me = next(r for r in table if r["owner"] == owner)
    rank = 1 + sum(r["total"] > me["total"] for r in table)
    tied = sum(r["total"] == me["total"] for r in table) > 1
    return ("joint " if tied else "") + ordinal(rank), rank


def ordinal(n):
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def unsub_code(secret, uid):
    mac = hmac.new(secret.encode(), uid.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode()[:32]


def unsub_url(secret, uid):
    return f"{SITE}?unsubscribe={unsub_code(secret, uid)}"


def kickoff_label(dt):
    local = dt.astimezone(UK)
    return f"{local:%H:%M} on {local:%A} {local.day} {local:%B} (UK time)"


BRAND = "#1fc16b"


def wrap_html(title, body_html, button, unsub):
    label, url = button
    return f"""<!doctype html><html><body style="margin:0;background:#f2f4f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px 24px">
<tr><td style="font-size:13px;font-weight:bold;letter-spacing:1px;color:{BRAND};text-transform:uppercase">Spin XI</td></tr>
<tr><td style="font-size:22px;font-weight:bold;padding:6px 0 14px">{html.escape(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5">{body_html}</td></tr>
<tr><td style="padding:20px 0 4px"><a href="{html.escape(url)}" style="display:inline-block;background:{BRAND};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">{html.escape(label)}</a></td></tr>
</table>
<p style="max-width:520px;font-size:12px;color:#6b7280;line-height:1.5;margin:14px auto 0">You're getting this because you ticked the email box on Spin XI.
<a href="{html.escape(unsub)}" style="color:#6b7280">Unsubscribe</a></p>
</td></tr></table></body></html>"""


def respin_word(n):
    return {1: "one re-spin", 2: "two re-spins"}.get(n, f"{n} re-spins")


def reminder_email(game, name, c, unsub):
    """c: the player's counted team (Game.counted) with re-spins left."""
    team, gw, left = c["entry"], c["entry"]["gw"], c["left"]
    ko = kickoff_label(game.deadline(gw))
    flagged = []
    for pid in team["picks"]:
        p = game.players.get(pid)
        f = game.upcoming_flag(p, gw)
        if f:
            flagged.append((p["name"], f[0], f[1]))
    have = (f"You've still got {respin_word(left)} left" if left < c["earned"]
            else f"You entered your Gameweek {gw} team early, so you've got {respin_word(left)}")
    subject = (f"Your Gameweek {gw} re-spin is still unused" if left == c["earned"] == 1
               else f"You've got {respin_word(left)} left for Gameweek {gw}")
    how = ("each one swaps a player for a pick from a fresh spin of the wheel" if left > 1 else
           "drop a player, spin the wheel and pick a replacement from the club it lands on")
    until = "They're" if left > 1 else "It's"
    text = [f"Hi {name},", "", f"{have}: {how}. {until} yours until kick-off at {ko}."]
    body = (f"<p>Hi {html.escape(name)},</p><p>{html.escape(have).replace(respin_word(left), f'<b>{respin_word(left)}</b>')}: "
            f"{how}. {until} yours until kick-off at <b>{html.escape(ko)}</b>.</p>")
    if flagged:
        text += ["", "Worth a look in your team:"] + [f"  {n}: {s}. {news}".rstrip() for n, s, news in flagged]
        body += "<p>Worth a look in your team:</p><ul style='padding-left:18px'>" + "".join(
            f"<li><b>{html.escape(n)}</b>: {html.escape(s)}{'. ' + html.escape(news) if news else ''}</li>"
            for n, s, news in flagged) + "</ul>"
    text += ["", f"Use your re-spin: {SITE}", "", f"Unsubscribe: {unsub}"]
    return subject, "\n".join(text), wrap_html(subject, body, ("Use your re-spin", SITE), unsub)


def results_email(game, name, row, table, season, owner, unsub):
    gw = row["gw"]
    total, lines = game.score(row["entry"])
    where, rank = place(table, owner)
    s_me = next((t for t in season if t["owner"] == owner), None)
    s_line = (f"Season so far: {s_me['total']} points, {place(season, owner)[0]} of {len(season)}."
              if s_me else "")
    subject = f"Gameweek {gw}: you scored {total} ({where} of {len(table)})"
    winners = [r["name"] for r in table if r["total"] == table[0]["total"] and r["owner"] != owner]
    if rank == 1:
        lead = (f"You won Gameweek {gw} with {total} points, top of {len(table)}." if not winners else
                f"You tied for first in Gameweek {gw} with {total} points, level with {', '.join(winners)}.")
    else:
        lead = (f"Your Gameweek {gw} team scored {total} points, {where} of {len(table)}. "
                f"{' and '.join(winners)} {'won' if len(winners) == 1 else 'shared'} it with {table[0]['total']}.")
    respun = row["entry"] is not row["base"]
    text = [f"Hi {name},", "", lead] + ([s_line] if s_line else []) + [""]
    text.append(f"Your {row['entry'].get('formation', '')}{' (after your re-spin)' if respun else ''}:")
    trs = []
    for p, pts, cap in lines:
        pname = (p["name"] if p else "Unknown") + (" (C)" if cap else "")
        club = game.teams.get(p["team"], {}).get("short", "") if p else ""
        text.append(f"  {pname:<24} {club:<4} {pts:>3}")
        trs.append(f"<tr><td style='padding:5px 0;border-bottom:1px solid #eef0f3'>{html.escape(pname)}</td>"
                   f"<td style='padding:5px 8px;border-bottom:1px solid #eef0f3;color:#6b7280'>{html.escape(club)}</td>"
                   f"<td align='right' style='padding:5px 0;border-bottom:1px solid #eef0f3;font-weight:bold'>{pts}</td></tr>")
    note = " (after your re-spin)" if respun else ""
    text += [f"  {'Total':<29} {total:>3}", ""]
    text += [f"Leaderboard: {SITE}", "", f"Unsubscribe: {unsub}"]
    body = (f"<p>Hi {html.escape(name)},</p><p>{html.escape(lead)}</p>"
            + (f"<p>{html.escape(s_line)}</p>" if s_line else "")
            + f"<p style='margin-bottom:6px'><b>Your {html.escape(row['entry'].get('formation', ''))}{note}</b></p>"
            + "<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='font-size:14px'>"
            + "".join(trs)
            + f"<tr><td style='padding:8px 0;font-weight:bold'>Total</td><td></td>"
              f"<td align='right' style='padding:8px 0;font-weight:bold'>{total}</td></tr></table>")
    return subject, "\n".join(text), wrap_html(subject, body, ("Open Spin XI", SITE), unsub)


class Outbox:
    """Sends through SMTP (or writes .eml files on a dry run), only to
    allowed addresses until EMAILS_LIVE is on."""

    def __init__(self):
        self.live = os.environ.get("EMAILS_LIVE", "").lower() == "true"
        self.test_to = {a.strip().lower() for a in os.environ.get("EMAILS_TEST_TO", "").split(",") if a.strip()}
        self.dry = os.environ.get("MAIL_DRY_RUN") == "1"
        self.user = os.environ.get("SMTP_USER", "")
        self.sender = os.environ.get("MAIL_FROM") or formataddr(("Spin XI", self.user or "spin-xi@localhost"))
        self.smtp = None
        self.sent = self.skipped = 0

    def allowed(self, to):
        return self.live or to.lower() in self.test_to

    def send(self, to, subject, text, html_body, unsub):
        msg = EmailMessage(policy=SMTP_POLICY.clone(max_line_length=998))   # keeps the unsubscribe URL whole
        msg["From"] = self.sender
        msg["To"] = to
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid(domain="spin-xi")
        msg["List-Unsubscribe"] = f"<{unsub}>"
        msg.set_content(text)
        msg.add_alternative(html_body, subtype="html")
        if self.dry:
            out = ROOT / "mail-out"
            out.mkdir(exist_ok=True)
            (out / f"{self.sent + 1:03d}-{to.replace('@', '_at_')}.eml").write_bytes(bytes(msg))
        else:
            if self.smtp is None:
                host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
                port = int(os.environ.get("SMTP_PORT") or 465)
                self.smtp = smtplib.SMTP_SSL(host, port, timeout=30) if port == 465 else smtplib.SMTP(host, port, timeout=30)
                if port != 465:
                    self.smtp.starttls()
                self.smtp.login(self.user, os.environ["SMTP_PASSWORD"])
            self.smtp.send_message(msg)
        self.sent += 1

    def close(self):
        if self.smtp:
            self.smtp.quit()


# ---------------------------------------------------------------- Firebase

@functools.cache
def connect():
    import firebase_admin
    from firebase_admin import credentials
    key = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if key:
        info = json.loads(key)
        app = firebase_admin.initialize_app(credentials.Certificate(info))
        secret = os.environ.get("MAIL_SECRET") or info["private_key"]
    elif os.environ.get("FIRESTORE_EMULATOR_HOST"):
        from google.auth.credentials import AnonymousCredentials

        class Anonymous(credentials.Base):     # the emulators take no key
            def get_credential(self):
                return AnonymousCredentials()
        app = firebase_admin.initialize_app(Anonymous(), {"projectId": os.environ.get("GCLOUD_PROJECT", "demo-spinxi")})
        secret = os.environ["MAIL_SECRET"]
    else:
        raise SystemExit("FIREBASE_SERVICE_ACCOUNT is not set")
    from firebase_admin import auth, firestore
    return firestore.client(app), auth, secret


def file_unsubscribes(db, secret):
    """Match each opened unsubscribe link to its player and turn emails off."""
    from google.cloud import firestore as gfs
    codes = list(db.collection("unsubscribes").stream())
    if not codes:
        return
    by_code = {unsub_code(secret, d.id): d.id for d in db.collection("prefs").stream()}
    for d in codes:
        uid = by_code.get(d.id)
        if uid:
            db.collection("prefs").document(uid).set({"emails": False, "updated": gfs.SERVER_TIMESTAMP})
            print(f"  unsubscribed {uid}")
            d.reference.delete()
        elif utcnow() - (d.get("at") or utcnow()) > timedelta(days=30):
            d.reference.delete()


def opted_in(db, auth):
    """{uid: email} for players who ticked the box and have a usable address."""
    from firebase_admin.auth import UidIdentifier
    from google.cloud.firestore_v1.base_query import FieldFilter
    uids = [d.id for d in db.collection("prefs").where(filter=FieldFilter("emails", "==", True)).stream()]
    emails = {}
    for i in range(0, len(uids), 100):
        res = auth.get_users([UidIdentifier(u) for u in uids[i:i + 100]])
        for u in res.users:
            if u.email and not u.disabled:
                emails[u.uid] = u.email
    return emails


def load_accounts(db):
    accounts = {}
    for d in db.collection("players").stream():
        data = d.to_dict()
        accounts[d.id] = {"name": data.get("name") or "Player", "entries": account_entries(data)}
    claims = {d.id: d.to_dict().get("uid") for d in db.collection("legacy").stream()}
    return accounts, claims


def send_batch(db, kind, gw, outbox, items):
    """items: [(uid, email, (subject, text, html), unsub_url)]. Each email is
    recorded as sent straight away, so a rerun never sends it twice; the
    gameweek is then marked done for this kind of email."""
    from google.cloud import firestore as gfs
    ref = db.collection("mailstate").document(f"gw{gw}")
    state = (ref.get().to_dict() or {})
    if state.get(f"{kind}Done"):
        print(f"  GW{gw} {kind} emails already sent")
        return
    sent = state.get("sent", {})
    for uid, email, (subject, text, html_body), unsub in items:
        if f"{kind}:{uid}" in sent:
            continue
        if not outbox.allowed(email):
            outbox.skipped += 1
            print(f"  skipped {uid} (emails not live yet)")
            continue
        outbox.send(email, subject, text, html_body, unsub)
        ref.set({"sent": {f"{kind}:{uid}": gfs.SERVER_TIMESTAMP}}, merge=True)
        print(f"  sent {kind} to {uid}: {subject}")
    ref.set({f"{kind}Done": gfs.SERVER_TIMESTAMP}, merge=True)


def run(now=None):
    now = now or utcnow()
    core = load_core()
    game = Game(core)
    r_gw, res_gw = reminder_gw(core, now), results_gw(core, now)
    if not r_gw and not res_gw:
        print("nothing to send")
        return
    db, auth, secret = connect()
    file_unsubscribes(db, secret)
    emails = opted_in(db, auth)
    print(f"{len(emails)} player(s) opted in")
    if not emails:
        return
    accounts, claims = load_accounts(db)
    outbox = Outbox()
    try:
        if r_gw:
            items = []
            for uid, email in emails.items():
                acc = accounts.get(uid)
                c = acc and game.counted(acc["entries"], r_gw)
                if not c:
                    continue
                if c["left"] <= 0:
                    continue
                unsub = unsub_url(secret, uid)
                items.append((uid, email, reminder_email(game, acc["name"], c, unsub), unsub))
            print(f"GW{r_gw} re-spin reminder: {len(items)} eligible")
            send_batch(db, "reminder", r_gw, outbox, items)
        if res_gw:
            rows = board_rows(game, board_players(accounts, claims),
                              {ev["gw"] for ev in core["events"] if ev["gw"] <= res_gw})
            table, season = gw_table(rows, res_gw), season_table(rows, res_gw)
            items = []
            for row in table:
                uid = row["owner"]
                if uid in emails:
                    unsub = unsub_url(secret, uid)
                    items.append((uid, emails[uid],
                                  results_email(game, row["name"], row, table, season, uid, unsub), unsub))
            print(f"GW{res_gw} results: {len(items)} of {len(table)} teams opted in")
            send_batch(db, "results", res_gw, outbox, items)
    finally:
        outbox.close()
    print(f"sent {outbox.sent}, skipped {outbox.skipped}")


def samples():
    """A sample results and reminder email built from the real data."""
    core = load_core()
    game = Game(core)
    gw = max(ev["gw"] for ev in core["events"] if ev["checked"])
    ids = [p["id"] for p in sorted(core["players"], key=lambda p: -p["pts"])]
    by_cat = defaultdict(list)
    for pid in ids:
        by_cat[CAT_BY_TYPE[game.players[pid]["type"]]].append(pid)
    picks = [by_cat[c].pop(0) for c in FORMATION_CATS["4-3-3"]]
    dl = game.deadline(gw)
    me = {"id": "e1", "gw": gw, "formation": "4-3-3", "picks": picks, "captain": picks[9],
          "ts": dl - timedelta(hours=20)}
    other = {**me, "id": "e2", "ts": dl - timedelta(hours=30)}
    rows = [{"owner": "me", "name": "Thomas", "gw": gw, "entry": me, "base": me, "total": game.score(me)[0]},
            {"owner": "x", "name": "Sam", "gw": gw, "entry": other, "base": other, "total": game.score(me)[0] + 9}]
    table = gw_table(rows, gw)
    season = season_table(rows, gw)
    unsub = f"{SITE}?unsubscribe={'x' * 32}"
    return unsub, {
        "results": results_email(game, "Thomas", rows[0], table, season, "me", unsub),
        "reminder": reminder_email(game, "Thomas", {"entry": me, "base": me, "earned": 1, "left": 1}, unsub),
    }


def preview():
    out = ROOT / "mail-preview"
    out.mkdir(exist_ok=True)
    for name, (subject, text, html_body) in samples()[1].items():
        (out / f"{name}.html").write_text(html_body, encoding="utf-8")
        (out / f"{name}.txt").write_text(f"Subject: {subject}\n\n{text}", encoding="utf-8")
        print(f"wrote {out / name}.html ({subject})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "due"
    if cmd == "due":
        ok, why = due(load_core(), utcnow())
        print(f"due={'true' if ok else 'false'}  # {why}")
    elif cmd == "run":
        run()
    elif cmd == "preview":
        preview()
    elif cmd == "test":
        # check the mail setup: both sample emails to EMAILS_TEST_TO only
        unsub, mails = samples()
        outbox = Outbox()
        outbox.live = False
        if not outbox.test_to:
            raise SystemExit("Set the EMAILS_TEST_TO variable to your email address first")
        for to in sorted(outbox.test_to):
            for subject, text, html_body in mails.values():
                outbox.send(to, "[Test] " + subject, text, html_body, unsub)
        outbox.close()
        print(f"sent {outbox.sent} test email(s)")
    else:
        raise SystemExit(__doc__)
