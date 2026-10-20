# Spin XI — Football Wheel Game

Pick a formation, spin a wheel to land on a team, choose a player from that
team for a vacant position, and repeat until you have a full XI. Then see how
your team scored in that round using real match stats.

The live game is the **Premier League 2026/27**, one round per FPL gameweek,
scored with the official **Fantasy Premier League** points system. The wheel
only offers clubs with a fixture in the gameweek (blank gameweeks shrink it,
double gameweeks score both matches).

Saved teams from the archived **Premier League 2025/26** and **World Cup 2026**
games still open from history.

## Play it

**Live site:** https://spanalytic.github.io/spin-xi/ (GitHub Pages, repo
`spanalytic/spin-xi`). Each player's teams/history live in their own browser
(localStorage) — share the link and everyone plays independently.

The home page shows the next gameweek with a kick-off deadline and a Play
button. Entries for a gameweek close at its first kick-off, then Play moves on
to the following gameweek automatically (no code change needed each week).

**Shared leaderboard** (🏆 tab): sign in once (see *Player sign-in* below;
without Firebase set up, players just type a name) and every finished team is
submitted automatically. The board has a page per gameweek (‹ › to browse)
and a **Season** table that adds up each player's gameweeks. Each player gets
**one team per gameweek**: the first one entered on time counts, and any more
are saved as practice. A team entered **at least 12 hours before the deadline
earns one re-spin**, usable any time until kick-off: the player taps one player
to drop, spins, and picks a replacement (same position) from the club the wheel
lands on. That offsets the edge late entrants get from team and injury news.
Re-spins need sign-in, because eligibility is judged from the server's
timestamp on the original team. Submissions store the *picks*, not the score — every
viewer's browser recomputes points from the match data, so the board updates
live as games finish (⏳ marks rounds still in play). Storage is a free
anonymous key/value service (textdb.online, board id in `app.js`); it's
trust-based and fine for a friends game, but if the game grows it should move
to a real backend (e.g. Supabase/Firebase). "Save name" also re-submits all
locally saved teams under the new name.

## Player sign-in

Players can sign in with **Google** or an **emailed sign-in link** (no
passwords). Signed-in players' teams go into Firebase (Firestore) instead of
textdb, follow them to any device, and are stamped with the server's clock so
a team can't be backdated past the deadline. Nobody can edit or delete a team
once it's entered, or write to anyone else's. A re-spin is stored as a new
team that names the one it re-spins, and the rules only accept it if every
other pick, the gameweek and the formation match that team. Playing without signing in still
works as practice. Teams entered before sign-in existed stay on the board, and
signing in on the browser that entered them links them to the account.

It switches on when `web/firebase-config.js` holds a Firebase project;
until then the site keeps the name-only textdb board. One-off setup:

1. https://console.firebase.google.com → **Create a project** (e.g. `spin-xi`,
   Google Analytics off).
2. **Build → Authentication → Get started → Sign-in method**:
   - enable **Google** (pick your support email, Save);
   - enable **Email/Password**, then switch on **Email link (passwordless
     sign-in)**, Save.
3. **Authentication → Settings → Authorized domains → Add domain**:
   `spanalytic.github.io`.
4. **Build → Firestore Database → Create database** → Standard edition,
   location `europe-west2 (London)`, **production mode**.
5. **Firestore → Rules**: replace everything with the contents of
   `firestore.rules` from this repo → **Publish**.
6. **Project settings (gear) → General → Your apps → Web (`</>`)** → register
   the app as `Spin XI` (no Hosting) and copy the `firebaseConfig` values into
   `web/firebase-config.js`.

The free Spark plan is plenty: the board reads one document per player.

To test locally against the Firebase emulators, run
`firebase emulators:start --only auth,firestore --project demo-spinxi` and set
`emulator: { auth: "http://127.0.0.1:9099", firestore: "127.0.0.1:8080" }` in
the config.

Locally: double-click `start.bat`, or run
`python -m http.server 8317 --directory web` and open http://localhost:8317

## Emails (re-spin reminders and results)

Signed-in players can tick **"Email me a reminder when I have a re-spin to
use, and my results after each gameweek"** (in the box under their name, and
offered once on the results page after they enter a team). Nobody gets email
without ticking it. The **Refresh FPL scores** job runs `mailer.py`, which
sends, once per gameweek each:

- a **re-spin reminder** 3 hours before the first kick-off, to players who
  still have a re-spin left (saying how many, and flagging any doubtful or
  injured players in their team);
- their **results** once FPL confirms the gameweek's final points: score,
  place on the gameweek board, the season table, and each player's points.

Every email has an unsubscribe link (`?unsubscribe=<code>` on the site); the
job turns that player's emails off before it next sends. Choices live in
Firestore `prefs/{uid}` (private to the player) and email addresses come from
Firebase Auth, so they're never on the public board.

One-off setup (GitHub repo → **Settings → Secrets and variables → Actions**):

| Name | Kind | Value |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | secret | Firebase console → Project settings → Service accounts → **Generate new private key**; paste the whole JSON file |
| `SMTP_USER` | secret | the Gmail address that sends |
| `SMTP_PASSWORD` | secret | a Gmail **app password** for it (myaccount.google.com/apppasswords, needs 2-Step Verification) |
| `EMAILS_TEST_TO` | variable | your own address: until emails go live, only this address gets anything |
| `EMAILS_LIVE` | variable | `true` to send to every opted-in player |

Another provider works too: set the `SMTP_HOST` / `SMTP_PORT` variables (and
`MAIL_FROM` for the From line). To check the setup, run the workflow by hand
with **Send me a test email** ticked. `python mailer.py preview` writes sample
emails to `mail-preview/` without sending anything.

## Updating during the season

Scores refresh automatically, in two GitHub Actions:

- **Live match scores** (`.github/workflows/live-scores.yml`) covers matches.
  GitHub runs scheduled jobs late or skips them when busy (on GW7 the
  10-minute schedule only fired every ~4 hours), so this job doesn't depend on
  frequent ticks: the first one that lands within 6 hours of a kick-off stays
  alive, refreshes every 5 minutes through each match window (kick-off to 3
  hours after), and hands over to a fresh run when it nears GitHub's 6-hour
  limit with matches still to come. Scores trail the real match by about
  5-10 minutes.
- **Refresh FPL scores** (`.github/workflows/refresh-scores.yml`) does the
  hourly jobs between matches: injury news, rescheduled fixtures, and
  checking until FPL confirms a gameweek's final points.

Open pages reload the data every 5 minutes (or hit ↻ Refresh on the board).
To kick off live updates by hand: GitHub → Actions → Live match scores → Run
workflow.

To run it by hand: GitHub → Actions → Refresh FPL scores → Run workflow. A manual run
always republishes the site, so use it after merging a site change.

Manual deploy from your PC still works:

```
deploy.bat          fetch the latest FPL stats, rebuild + publish
deploy.bat offline  rebuild from the FPL snapshots already fetched + publish
```

## How it works

- **Formations**: 4-3-3, 4-4-2, 4-5-1, 3-4-3, 3-5-2, 5-3-2, 5-4-1.
- **Positions**: players are eligible by their official FPL position
  (Goalkeeper / Defender / Midfielder / Forward). Any defender can fill any
  back-line slot (LB/CB/RB/wing-back), any midfielder any midfield slot, etc.
  The picker also shows each player's average FPL points per game this season.
- **Scoring** is the official FPL 2026/27 points system (unchanged from
  2025/26; FPL only retuned how bonus points are decided):

  | Event | Points |
  |---|---|
  | Played under 60 min | 1 |
  | Played 60+ min | 2 |
  | Goal (GK / DEF / MID / FWD) | 10 / 6 / 5 / 4 |
  | Assist | 3 |
  | Clean sheet, 60+ min (GK, DEF / MID) | 4 / 1 |
  | Every 3 saves (GK) | 1 |
  | Penalty save | 5 |
  | Penalty miss | -2 |
  | Every 2 goals conceded (GK, DEF) | -1 |
  | Yellow / red card | -1 / -3 |
  | Own goal | -2 |
  | Defensive contribution: 10+ clearances, blocks, interceptions & tackles (DEF) or 12+ incl. recoveries (MID/FWD) | 2 |
  | Bonus points (top 3 on FPL's BPS per match) | 1-3 |

  Every stat comes from FPL itself (the `event/{gw}/live` endpoint), so there
  are no approximations: bonus is FPL's own BPS result, assists use FPL's
  definition, and so on. The build re-scores every player-fixture row and
  checks it against FPL's own points (on the 25/26 snapshot: 11,493/11,493
  rows and all 841 season totals match).

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

**Premier League 2026/27** comes entirely from the FPL API:

- `data/raw/2627/` — snapshots of `bootstrap-static`, `fixtures` and
  `event/{gw}/live` (finished, data-checked gameweeks aren't re-fetched)
- `web/data/epl2627/core.json` — clubs, players, fixtures, gameweeks
- `web/data/epl2627/gw1.json` … — per-player, per-fixture FPL stats

```
python build_data.py fpl            # fetch from the FPL API + rebuild
python build_data.py fpl-transform  # rebuild from data/raw/2627 only
```

Club badges are saved into the site (`web/img/badges`) by the build.
Player photos load from the Premier League's image server; the build records
which photo address works for each player (`data/raw/2627/photos.json`,
re-checked every few days for players without one), and players with no
photo get a shirt in their club's colours instead.
`python build_data.py fpl-assets` does just this step.

**Archived games** (Premier League 2025/26, World Cup 2026) were built from our
own match-events JSONs in `PyCharmMiscProject` and stay in `web/data/epl` and
`web/data/wc2026` so saved teams keep working:

```
python build_data.py                # build both archived competitions
python build_data.py epl            # Premier League 25/26 only
python build_data.py wc             # World Cup 2026 only
python build_data.py download       # refresh the 25/26 FPL snapshot (photos)
```

## Next season (27/28)

When FPL resets for 27/28, bump `FPL_SEASON`, `FPL_COMP` and `FPL_RAW` in
`build_data.py` and `LIVE_SITE_COMP` (plus a `COMP_LABELS` entry) in
`web/app.js`, then run `deploy.bat`. Using a new comp id keeps the old
season's saved teams and data intact.
