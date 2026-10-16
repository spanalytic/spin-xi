/* ================================================================
   Spin XI — Premier League wheel game (2026/27 season, FPL scoring)
   ================================================================ */

/* ---------------- formation + position model ---------------- */

// role: pitch label; cat: scoring category = required FPL position
// (players are eligible purely by their FPL position: GK / DEF / MID / FWD)
const ROLES = {
  GK:  { cat: "GK" },
  LB:  { cat: "DEF" }, RB:  { cat: "DEF" }, CB:  { cat: "DEF" },
  CDM: { cat: "MID" }, CM:  { cat: "MID" }, CAM: { cat: "MID" },
  LM:  { cat: "MID" }, RM:  { cat: "MID" }, LAM: { cat: "MID" }, RAM: { cat: "MID" },
  LW:  { cat: "FWD" }, RW:  { cat: "FWD" }, ST:  { cat: "FWD" },
};
const TYPE_CAT = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

// [role, x%, y%] — y: 0 = attacking end (top), 100 = own goal (bottom)
const FORMATIONS = {
  "4-3-3":   [["GK",50,92],["LB",11,72],["CB",36,76],["CB",64,76],["RB",89,72],
              ["CM",27,50],["CM",50,55],["CM",73,50],["LW",16,25],["ST",50,20],["RW",84,25]],
  "4-4-2":   [["GK",50,92],["LB",11,72],["CB",36,76],["CB",64,76],["RB",89,72],
              ["LM",11,47],["CM",37,52],["CM",63,52],["RM",89,47],["ST",37,22],["ST",63,22]],
  "4-2-3-1": [["GK",50,92],["LB",11,72],["CB",36,76],["CB",64,76],["RB",89,72],
              ["CDM",36,58],["CDM",64,58],["LAM",14,36],["CAM",50,39],["RAM",86,36],["ST",50,16]],
  "4-5-1":   [["GK",50,92],["LB",11,72],["CB",36,76],["CB",64,76],["RB",89,72],
              ["LM",8,46],["CM",29,52],["CM",50,47],["CM",71,52],["RM",92,46],["ST",50,20]],
  "3-4-3":   [["GK",50,92],["CB",24,76],["CB",50,78],["CB",76,76],
              ["LM",8,50],["CM",37,54],["CM",63,54],["RM",92,50],["LW",16,25],["ST",50,20],["RW",84,25]],
  "3-5-2":   [["GK",50,92],["CB",24,76],["CB",50,78],["CB",76,76],
              ["LM",6,48],["CM",29,52],["CM",50,57],["CM",71,52],["RM",94,48],["ST",37,20],["ST",63,20]],
  "5-3-2":   [["GK",50,92],["LB",8,70],["CB",28,76],["CB",50,78],["CB",72,76],["RB",92,70],
              ["CM",27,50],["CM",50,55],["CM",73,50],["ST",37,20],["ST",63,20]],
  "5-4-1":   [["GK",50,92],["LB",8,70],["CB",28,76],["CB",50,78],["CB",72,76],["RB",92,70],
              ["LM",11,47],["CM",37,52],["CM",63,52],["RM",89,47],["ST",50,20]],
};

// where each slot sits on the drawn pitch. Players are grouped into lines
// (keeper, defence, midfield, attack; a 4-2-3-1 also has holding and
// attacking midfield lines), each line sits on one row and its players are
// spaced evenly, so cards never overlap whatever the screen width.
const LINE_OF = { GK: "gk", CDM: "dm", LAM: "am", CAM: "am", RAM: "am" };
const LINE_ORDER = ["fwd", "am", "mid", "dm", "def", "gk"];   // top to bottom
function pitchLayout(slots) {
  const lineOf = (s) => LINE_OF[s.role] || ROLES[s.role].cat.toLowerCase();
  const lines = {};
  slots.forEach((s, i) => (lines[lineOf(s)] ||= []).push(i));
  const used = LINE_ORDER.filter((l) => lines[l]);
  const pos = [];
  used.forEach((l, k) => {
    const top = 11 + (k * 77) / Math.max(1, used.length - 1);
    const idx = lines[l].sort((a, b) => slots[a].x - slots[b].x);
    idx.forEach((i, j) => { pos[i] = { left: 6 + ((j + 0.5) * 88) / idx.length, top }; });
  });
  const cols = Math.max(...used.map((l) => lines[l].length));
  return { pos, cols, rows: used.length };
}
function layoutPitch(pitch, slots) {
  const { pos, cols, rows } = pitchLayout(slots);
  pitch.style.setProperty("--cols", cols);
  pitch.classList.toggle("five-lines", rows > 4);   // e.g. 4-2-3-1: smaller cards
  return (el, i) => { el.style.left = pos[i].left + "%"; el.style.top = pos[i].top + "%"; };
}

// no longer selectable, kept so saved teams from history still render
const RETIRED_FORMATIONS = new Set(["4-2-3-1"]);

const CAT_LABEL = { GK: "Goalkeeper", DEF: "Defender", MID: "Midfielder", FWD: "Forward" };
const GOAL_PTS = { GK: 10, DEF: 6, MID: 5, FWD: 4 };
const CS_PTS = { GK: 4, DEF: 4, MID: 1, FWD: 0 };

const LIVE_SITE_COMP = "epl2627";
const COMP_IDS = [LIVE_SITE_COMP];
const COMP_LABELS = { epl2627: "Premier League", epl: "Premier League 25/26", wc2026: "World Cup 2026" };

const HISTORY_KEY = "spinxi_history_v1";

/* ---------------- state ---------------- */

const S = {
  comp: LIVE_SITE_COMP,
  cores: {},           // comp -> {core, teamsById, playersById, playersByTeam}
  core: null,
  teamsById: {},
  playersById: {},
  playersByTeam: {},
  gwStatsCache: {},    // "comp:gw" -> stats
  setup: { gw: null, formation: null },
  game: null,          // { gw, formation, slots:[{role,x,y,player}], wheelTeams, currentClub }
  wheel: { rot: 0, spinning: false },
};

const $ = (id) => document.getElementById(id);

/* ---------------- sound ---------------- */

const SOUND = { ctx: null, timers: [] };

function audioCtx() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return null;
  if (!SOUND.ctx) SOUND.ctx = new Audio();
  if (SOUND.ctx.state === "suspended") SOUND.ctx.resume();
  return SOUND.ctx;
}

function clearSpinSound() {
  for (const timer of SOUND.timers) clearTimeout(timer);
  SOUND.timers = [];
}

function playTone(freq, duration = 0.04, delay = 0, type = "square", gainLevel = 0.025) {
  const ctx = audioCtx();
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(gainLevel, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function playSpinSound(durationMs) {
  clearSpinSound();
  let elapsed = 0;
  let interval = 45;
  let tick = 0;
  const run = () => {
    playTone(420 + (tick % 6) * 38, 0.028, 0, "square", 0.018);
    tick++;
    elapsed += interval;
    interval = Math.min(170, interval + 6);
    if (elapsed < durationMs - 180) {
      const timer = setTimeout(run, interval);
      SOUND.timers.push(timer);
    }
  };
  run();
}

function playLandingSound() {
  clearSpinSound();
  playTone(520, 0.07, 0, "triangle", 0.035);
  playTone(780, 0.1, 0.08, "triangle", 0.04);
}

/* ---------------- data loading ---------------- */

async function loadComp(comp) {
  if (!S.cores[comp]) {
    const res = await fetch(`data/${comp}/core.json`, { cache: "no-cache" });
    const core = await res.json();
    const teamsById = {}, playersById = {}, playersByTeam = {};
    for (const t of core.teams) teamsById[t.id] = t;
    for (const p of core.players) {
      playersById[p.id] = p;
      (playersByTeam[p.team] ||= []).push(p);
    }
    for (const list of Object.values(playersByTeam)) {
      list.sort((a, b) => b.mins - a.mins);
    }
    S.cores[comp] = { core, teamsById, playersById, playersByTeam };
  }
  const c = S.cores[comp];
  S.comp = comp;
  S.core = c.core;
  S.teamsById = c.teamsById;
  S.playersById = c.playersById;
  S.playersByTeam = c.playersByTeam;
  localStorage.setItem("spinxi_comp", comp);
  document.querySelector(".brand-season").textContent = c.core.season;
  renderCompSwitch();
}

// drop cached match data and fetch it again (scores refresh during matches)
async function reloadData() {
  if (S.game) return false;          // never swap data under a team being picked
  const comp = S.comp;
  delete S.cores[comp];
  for (const key of Object.keys(S.gwStatsCache)) {
    if (key.startsWith(comp + ":")) delete S.gwStatsCache[key];
  }
  await loadComp(comp);
  return true;
}

function renderCompSwitch() {
  const el = $("comp-switch");
  el.innerHTML = "";
  el.classList.toggle("hidden", COMP_IDS.length < 2);
  if (COMP_IDS.length < 2) return;
  for (const comp of COMP_IDS) {
    const b = document.createElement("button");
    b.className = "comp-pill" + (comp === S.comp ? " sel" : "");
    b.textContent = COMP_LABELS[comp];
    b.addEventListener("click", async () => {
      if (comp === S.comp) return;
      if (S.game && !confirm("Switch competition? Your current picks will be lost.")) return;
      S.game = null;
      await loadComp(comp);
      goHome();
    });
    el.appendChild(b);
  }
}

async function loadGwStats(gw) {
  const key = `${S.comp}:${gw}`;
  if (!S.gwStatsCache[key]) {
    const res = await fetch(`data/${S.comp}/gw${gw}.json`, { cache: "no-cache" });
    S.gwStatsCache[key] = await res.json();
  }
  return S.gwStatsCache[key];
}

function gwStatsSync(gw) {
  return S.gwStatsCache[`${S.comp}:${gw}`];
}

/* ---------------- scoring engine ---------------- */

// FPL scoring. rows: per-fixture FPL stat objects {mp,gs,a,cs,gc,og,ps,pm,yc,rc,sv,dc,b}; cat: GK/DEF/MID/FWD
// pendingFixture: the player's team still has an unplayed game this round
function scorePlayer(rows, cat, pendingFixture) {
  const lines = [];   // [label, points]
  let total = 0;
  const add = (label, pts) => { lines.push([label, pts]); total += pts; };

  if (!rows || rows.length === 0) {
    return pendingFixture
      ? { total: 0, lines: [["Still to play"]], pending: true }
      : { total: 0, lines: [["Did not play", 0]] };
  }

  let mins = 0, gs = 0, a = 0, cs = 0, og = 0, ps = 0, pm = 0, yc = 0, rc = 0, bonus = 0;
  let minutesPts = 0, savePts = 0, savesTotal = 0, concededPts = 0, concededTotal = 0;
  let dcPts = 0, dcActions = 0;

  for (const r of rows) {
    const mp = r.mp || 0;
    mins += mp;
    if (mp > 0) minutesPts += mp >= 60 ? 2 : 1;
    gs += r.gs || 0; a += r.a || 0; cs += r.cs || 0; og += r.og || 0;
    ps += r.ps || 0; pm += r.pm || 0; yc += r.yc || 0; rc += r.rc || 0;
    bonus += r.b || 0;
    if (cat === "GK") {
      savesTotal += r.sv || 0;
      savePts += Math.floor((r.sv || 0) / 3);
    }
    if (cat === "GK" || cat === "DEF") {
      concededTotal += r.gc || 0;
      concededPts -= Math.floor((r.gc || 0) / 2);
    }
    const dc = r.dc || 0;
    if ((cat === "DEF" && dc >= 10) || ((cat === "MID" || cat === "FWD") && dc >= 12)) {
      dcPts += 2;
      dcActions += dc;
    }
  }

  add(mins ? `Played ${mins} min` : "Did not play", minutesPts);
  if (gs) add(`${gs} goal${gs > 1 ? "s" : ""} (${CAT_LABEL[cat].toLowerCase()})`, gs * GOAL_PTS[cat]);
  if (a) add(`${a} assist${a > 1 ? "s" : ""}`, a * 3);
  if (cs && CS_PTS[cat]) add(`Clean sheet${cs > 1 ? " x" + cs : ""}`, cs * CS_PTS[cat]);
  if (dcPts) add(`Defensive contribution (${dcActions} actions)`, dcPts);
  if (savePts) add(`${savesTotal} saves`, savePts);
  if (ps) add(`${ps} penalty save${ps > 1 ? "s" : ""}`, ps * 5);
  if (pm) add(`${pm} penalty miss${pm > 1 ? "es" : ""}`, pm * -2);
  if (concededPts) add(`${concededTotal} conceded`, concededPts);
  if (yc) add(`${yc} yellow card${yc > 1 ? "s" : ""}`, yc * -1);
  if (rc) add(`Red card`, rc * -3);
  if (og) add(`${og} own goal${og > 1 ? "s" : ""}`, og * -2);
  if (bonus) add(`Bonus points`, bonus);

  return { total, lines };
}

/* ---------------- screens ---------------- */

const SCREENS = ["screen-home", "screen-setup", "screen-game", "screen-results", "screen-board", "screen-howto"];
function show(screen) {
  for (const id of SCREENS) $(id).classList.toggle("hidden", id !== screen);
  const tab = screen === "screen-game" ? "screen-setup" : screen;
  document.querySelectorAll(".nav-tab").forEach((b) => b.classList.toggle("sel", b.dataset.screen === tab));
  window.scrollTo(0, 0);
}

/* ---------------- home / history ---------------- */

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }

function entryComp(h) { return h.comp || "epl"; }
function entryInSeason(h) { return entryComp(h) === S.comp; }

// entries lock at the round's first kick-off
const DEADLINE_GRACE_MS = 10 * 60 * 1000;   // clock-skew tolerance on the board
function roundDeadline(gw) {
  const ev = S.core.events.find((e) => e.gw === gw);
  return ev ? new Date(ev.deadline).getTime() : 0;
}
function entriesOpen(gw) {
  return Date.now() < roundDeadline(gw);
}
function entryOnTime(e) {
  return (e.ts || 0) <= roundDeadline(e.gw) + DEADLINE_GRACE_MS;
}

/* one team per player per gameweek: the first one entered on time counts.
   A team entered at least 12 hours before the deadline earns one re-spin:
   swap one player for a pick from a fresh spin, any time until kick-off. */
const RESPIN_EARLY_MS = 12 * 60 * 60 * 1000;
const byTs = (a, b) => (a.ts || 0) - (b.ts || 0);

function respinEarned(base) {
  return (base.ts || 0) <= roundDeadline(base.gw) - RESPIN_EARLY_MS;
}

// is `r` a fair re-spin of `base`: entered on time, base early enough, the
// same team except one slot (refilled with a player of that position), and
// the captain kept unless the captain was the player replaced
function validRespin(base, r) {
  const i = r.respinSlot;
  const a = base.picks || [], b = r.picks || [];
  const slot = (FORMATIONS[r.formation] || [])[i];
  const p = S.playersById[b[i]];
  if (r.gw !== base.gw || r.formation !== base.formation || !slot || !p) return false;
  if (!respinEarned(base) || !entryOnTime(r) || (r.ts || 0) < (base.ts || 0)) return false;
  if (a.length !== 11 || b.length !== 11 || a.includes(b[i])) return false;
  if (b.some((id, k) => k !== i && id !== a[k])) return false;
  if (TYPE_CAT[p.type] !== ROLES[slot[0]].cat) return false;
  return base.captain === a[i] ? b.includes(r.captain) : r.captain === base.captain;
}

// the team that counts for one player in a gameweek: { entry, base }, where
// entry is the re-spun team when they used their re-spin, else the base
function countedEntry(entries, gw) {
  const mine = entries.filter((e) => e.gw === gw && e.picks && entryOnTime(e));
  const base = mine.filter((e) => !e.respinOf).sort(byTs)[0];
  if (!base) return null;
  const respin = mine.filter((e) => e.respinOf === base.id).sort(byTs)[0];
  return { entry: respin && validRespin(base, respin) ? respin : base, base };
}

// the signed-in player's entries in the live competition
function myEntries() {
  return signedIn() ? A.profile.entries.filter(entryInSeason) : [];
}

// the team a signed-in player can still re-spin for this gameweek, or null
function respinnable(gw) {
  if (!entriesOpen(gw)) return null;
  const entries = myEntries();
  const c = countedEntry(entries, gw);
  if (!c || !respinEarned(c.base) || entries.some((e) => e.respinOf === c.base.id)) return null;
  return c.base;
}

// the gameweek open for entries: the next one whose first kick-off is still
// ahead (falls back to the last gameweek once the season is over)
function liveRound() {
  const evs = S.core.events;
  return evs.find((e) => entriesOpen(e.gw)) || evs[evs.length - 1] || null;
}

// the most recent gameweek that has kicked off (the one being scored now)
function currentRound() {
  const started = S.core.events.filter((e) => !entriesOpen(e.gw));
  return started[started.length - 1] || null;
}

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function renderLiveCard() {
  const lc = $("live-card");
  const fc = $("live-fixtures-card");
  const ev = liveRound();
  if (!ev) {
    fc.classList.add("hidden");
    lc.innerHTML = `
      <div class="hero-tag done">Premier League</div>
      <h1>${S.core.season}</h1>
      <p class="hero-sub">Fixtures for the new gameweek are on their way.</p>
      <button class="big-btn lime" id="live-play">Enter a team</button>`;
    $("live-play").addEventListener("click", () => goSetup());
    return;
  }
  const dl = new Date(ev.deadline);
  const fmt = dl.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const diff = dl - Date.now();
  const open = entriesOpen(ev.gw);
  const cd = ev.finished
    ? "Round complete"
    : diff > 0 ? `Entries close in ${fmtDur(diff)}`
    : "Round in progress";
  lc.innerHTML = `
    <img class="hero-art" src="img/logo.svg" alt="">
    <div class="hero-tag${ev.finished ? " done" : ""}">${ev.finished ? "Round complete" : '<span class="pulse"></span>Live round'}</div>
    <h1>${COMP_LABELS[S.comp]}<br>${ev.name}</h1>
    <div class="hero-meta">
      <span>First kick-off <b>${fmt}</b></span>
      <span class="countdown">${cd}</span>
    </div>
    ${open ? liveEntryHtml(ev) : `<div class="entries-closed">Entries are closed. The first game has kicked off.</div>`}`;
  const lp = $("live-play");
  if (lp) lp.addEventListener("click", () => goSetup({ lockedGw: ev.gw }));
  const lv = $("live-view");
  if (lv) lv.addEventListener("click", () => viewHistoryEntry(countedEntry(myEntries(), ev.gw).entry));
  const lr = $("live-respin");
  if (lr) lr.addEventListener("click", () => startRespin(respinnable(ev.gw)));

  const fx = S.core.fixtures.filter((f) => f.gw === ev.gw);
  fc.classList.toggle("hidden", fx.length === 0);
  fc.innerHTML = `<h3>${ev.name} fixtures</h3><div class="live-fixtures">${fx.map((f) => {
    const h = S.teamsById[f.h], a = S.teamsById[f.a];
    const ko = new Date(f.ko);
    const mid = f.hs !== null && f.hs !== undefined
      ? `<b>${f.hs} – ${f["as"]}</b>`
      : `${ko.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}<br>${ko.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    return `<div class="lf-row">
      <span class="lf-team"><span>${h ? h.name : "TBC"}</span>${teamBadge(h)}</span>
      <span class="lf-mid">${mid}</span>
      <span class="lf-team away">${teamBadge(a)}<span>${a ? a.name : "TBC"}</span></span></div>`;
  }).join("")}</div>`;
}

// the live round's call to action: enter a team, or view it and re-spin
function liveEntryHtml(ev) {
  const short = ev.short || "GW " + ev.gw;
  const c = countedEntry(myEntries(), ev.gw);
  if (!c) {
    const early = roundDeadline(ev.gw) - RESPIN_EARLY_MS;
    const tip = AUTH_ON && Date.now() < early
      ? `<p class="respin-tip">Enter by <b>${new Date(early).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</b> to earn a re-spin you can use right up to kick-off.</p>`
      : "";
    return `<button class="big-btn lime" id="live-play">Enter your ${short} team</button>${tip}`;
  }
  const respin = respinnable(ev.gw);
  const note = respin ? "You entered early, so you have <b>one re-spin</b>: swap one player for a pick from a fresh spin."
    : respinEarned(c.base) ? "You've used your re-spin."
    : "Teams entered 12+ hours before the deadline get a re-spin. Yours was entered later.";
  return `<div class="live-actions">
      <button class="big-btn lime" id="live-view">View your ${short} team</button>
      ${respin ? `<button class="big-btn gold" id="live-respin">Use your re-spin</button>` : ""}
    </div>
    ${note ? `<p class="respin-tip">${note}</p>` : ""}`;
}

function renderHome() {
  renderLiveCard();
  const hist = getHistory().filter(entryInSeason).sort((x, y) => y.ts - x.ts);
  const entries = hist.length;
  const best = hist.reduce((m, h) => Math.max(m, h.score), 0);
  // season total: the team that counts in each gameweek (first one, or its re-spin)
  const counted = new Set(), replaced = new Set();
  for (const gw of new Set(hist.map((h) => h.gw))) {
    const c = countedEntry(hist, gw);
    if (!c) continue;
    counted.add(c.entry.id);
    if (c.entry !== c.base) replaced.add(c.base.id);
  }
  const seasonTotal = hist.filter((h) => counted.has(h.id)).reduce((t, h) => t + h.score, 0);

  $("season-summary").classList.toggle("hidden", entries === 0);
  $("season-summary").innerHTML = entries === 0 ? "" : `
    <div class="stat-card"><div class="num">${seasonTotal}</div><div class="lbl">Season total</div></div>
    <div class="stat-card"><div class="num">${best}</div><div class="lbl">Best gameweek</div></div>
    <div class="stat-card"><div class="num">${entries}</div><div class="lbl">Teams entered</div></div>`;

  const list = $("history-list");
  if (hist.length === 0) {
    list.innerHTML = `<div class="history-empty">No teams yet. Spin up your first XI!</div>`;
    return;
  }
  list.innerHTML = "";
  for (const h of hist) {
    const row = document.createElement("div");
    row.className = "history-row";
    const date = new Date(h.ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const tag = replaced.has(h.id) ? "before re-spin"
      : counted.has(h.id) ? (h.respinOf ? "re-spun" : "")
      : "practice";
    row.innerHTML = `
      <div class="history-gw">${h.label || "GW " + h.gw}</div>
      <div class="history-meta">${COMP_LABELS[entryComp(h)]} &middot; ${h.formation} &middot; picked ${date}
        ${tag ? `<span class="bchip">${tag}</span>` : ""}
        ${teamFaces(h.picks)}</div>
      <div class="history-score">${h.score}<small>pts</small></div>`;
    row.addEventListener("click", () => viewHistoryEntry(h));
    list.appendChild(row);
  }
}

// a row of small photos for a saved team (captain first)
function teamFaces(picks, captain, cls = "faces") {
  if (!picks) return "";
  const ids = captain ? [captain, ...picks.filter((id) => id !== captain)] : picks;
  const html = ids.map((id) => S.playersById[id]).filter(Boolean).map((p) => playerPhoto(p)).join("");
  return html ? `<div class="${cls}">${html}</div>` : "";
}

// re-score saved teams from the latest data so the season total stays current
async function refreshHistoryScores() {
  const hist = getHistory();
  const gws = new Set(hist.filter((h) => entryInSeason(h) && h.picks && !entriesOpen(h.gw)).map((h) => h.gw));
  let changed = false;
  for (const gw of gws) {
    if (!S.core.events.some((e) => e.gw === gw)) continue;
    const stats = await loadGwStats(gw);
    for (const h of hist) {
      if (!entryInSeason(h) || h.gw !== gw || !h.picks) continue;
      const { total } = computeEntryScore(h, stats);
      if (total !== h.score) { h.score = total; changed = true; }
    }
  }
  if (changed) saveHistory(hist);
  return changed;
}

async function viewHistoryEntry(h) {
  if (entryComp(h) !== S.comp) await loadComp(entryComp(h));
  const stats = await loadGwStats(h.gw);
  const slots = FORMATIONS[h.formation].map(([role, x, y], i) => ({
    role, x, y, player: S.playersById[h.picks[i]] || null,
  }));
  const total = renderResults({ gw: h.gw, formation: h.formation, slots, captain: h.captain }, stats, { readonly: true });
  const base = respinnable(h.gw);
  if (base && base.id === h.id) {
    const note = document.createElement("div");
    note.className = "submit-note";
    note.innerHTML = `<button class="nav-btn sel">Use your re-spin</button> Swap one player for a pick from a fresh spin, any time before kick-off.`;
    note.querySelector("button").addEventListener("click", () => startRespin(base));
    $("results-head").appendChild(note);
  }
  // fixtures may have finished since this team was saved — refresh the score
  if (total !== h.score) {
    saveHistory(getHistory().map((x) => (x.id === h.id ? { ...x, score: total } : x)));
  }
  show("screen-results");
}

/* ---------------- setup ---------------- */

function renderSetup(opts = {}) {
  S.setupOpts = opts;
  const locked = !!opts.lockedGw;
  S.setup = { gw: opts.lockedGw || null, formation: null };

  // first visit: sign in (or, without sign-in, ask for a display name)
  const needSignIn = AUTH_ON && !!A.mod && !signedIn() && !S.practising;
  $("signin-gate").classList.toggle("hidden", !needSignIn);
  if (needSignIn) {
    $("signin-gate").innerHTML = signInPanelHtml({
      title: "Sign in to play for the leaderboard",
      practice: true,
    });
    wireSignInPanel($("signin-gate"), {
      onPractice: () => { S.practising = true; renderSetup(S.setupOpts || {}); },
    });
  }
  const needName = needSignIn || (!AUTH_ON && !playerName());
  $("name-gate").classList.toggle("hidden", !needName || AUTH_ON);
  $("setup-step-formation").classList.toggle("hidden", needName);
  $("formation-grid").classList.toggle("hidden", needName);
  document.querySelector(".setup-actions").classList.toggle("hidden", needName);
  if (needName) {
    $("setup-step-gw").classList.add("hidden");
    $("gw-grid").classList.add("hidden");
    if (!AUTH_ON) setTimeout(() => $("gate-name").focus(), 100);
    return;
  }

  $("setup-step-gw").classList.toggle("hidden", locked);
  $("gw-grid").classList.toggle("hidden", locked);
  $("setup-closed-note").classList.toggle("hidden", !(locked && !entriesOpen(opts.lockedGw)));
  const entered = locked && entriesOpen(opts.lockedGw) && countedEntry(myEntries(), opts.lockedGw);
  $("setup-practice-note").classList.toggle("hidden", !entered);
  $("setup-step-formation").textContent = locked
    ? `${gwLabel(opts.lockedGw)} — choose your formation`
    : "2 · Choose your formation";
  const grid = $("gw-grid");
  grid.innerHTML = "";
  for (const ev of S.core.events) {
    const b = document.createElement("button");
    b.className = "gw-btn";
    const d = new Date(ev.deadline);
    b.innerHTML = `<div class="g">${ev.short || "GW " + ev.gw}</div><div class="d">${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>`;
    b.addEventListener("click", () => {
      S.setup.gw = ev.gw;
      grid.querySelectorAll(".gw-btn").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      updateStartBtn();
    });
    grid.appendChild(b);
  }

  const fgrid = $("formation-grid");
  fgrid.innerHTML = "";
  for (const name of Object.keys(FORMATIONS).filter((n) => !RETIRED_FORMATIONS.has(n))) {
    const card = document.createElement("div");
    card.className = "form-card";
    const dots = FORMATIONS[name]
      .map(([, x, y]) => `<div class="dot" style="left:${x}%;top:${y}%"></div>`)
      .join("");
    card.innerHTML = `<div class="fname">${name}</div><div class="form-mini">${dots}</div>`;
    card.addEventListener("click", () => {
      S.setup.formation = name;
      fgrid.querySelectorAll(".form-card").forEach((x) => x.classList.remove("sel"));
      card.classList.add("sel");
      updateStartBtn();
    });
    fgrid.appendChild(card);
  }
  updateStartBtn();
}

function updateStartBtn() {
  $("setup-start").disabled = !(S.setup.gw && S.setup.formation);
}

/* ---------------- game ---------------- */

// the wheel only offers teams that have a fixture in this round
function roundWheelTeams(gw) {
  const inRound = new Set();
  for (const f of S.core.fixtures) {
    if (f.gw === gw && f.h && f.a) { inRound.add(f.h); inRound.add(f.a); }
  }
  const teams = S.core.teams.filter((t) => inRound.has(t.id));
  return teams.length < 2 ? S.core.teams : teams;
}

async function startGame() {
  const { gw, formation } = S.setup;
  await loadGwStats(gw);
  S.game = {
    gw, formation,
    slots: FORMATIONS[formation].map(([role, x, y]) => ({ role, x, y, player: null })),
    wheelTeams: roundWheelTeams(gw),
    captain: null,
    currentClub: null,
  };
  S.placing = null;
  $("wheel-result").innerHTML = "Spin to get your first club!";
  $("score-btn").textContent = "Enter my Team";
  $("score-btn").classList.add("hidden");
  $("spin-btn").disabled = false;
  renderPitch();
  renderGameStatus();
  resetSpinner();
  show("screen-game");
}

/* ---------------- re-spin ----------------
   The player taps the one player to replace, spins, and picks from the club
   it lands on. The club is remembered on this device as soon as the wheel
   is spun, so leaving and coming back can't fish for a better one. */

const RESPIN_KEY = "spinxi_respin_v1";
function respinMemo(baseId) {
  try { return (JSON.parse(localStorage.getItem(RESPIN_KEY)) || {})[baseId] || null; }
  catch { return null; }
}
function setRespinMemo(baseId, value) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(RESPIN_KEY)) || {}; } catch {}
  if (value) all[baseId] = value; else delete all[baseId];
  localStorage.setItem(RESPIN_KEY, JSON.stringify(all));
}

async function startRespin(base) {
  if (!base) return;
  if (entryComp(base) !== S.comp) await loadComp(entryComp(base));
  await loadGwStats(base.gw);
  S.game = {
    gw: base.gw,
    formation: base.formation,
    slots: FORMATIONS[base.formation].map(([role, x, y], i) => ({
      role, x, y, player: S.playersById[base.picks[i]] || null,
    })),
    wheelTeams: roundWheelTeams(base.gw),
    captain: base.captain,
    currentClub: null,
    respin: { base, slot: null },
  };
  S.placing = null;
  $("score-btn").textContent = "Enter re-spun team";
  $("score-btn").classList.add("hidden");
  resetSpinner();
  show("screen-game");
  // already spun on this device: carry on with the club it landed on
  const memo = respinMemo(base.id);
  const team = memo && S.teamsById[memo.team];
  if (team && S.game.slots[memo.slot]) {
    chooseRespinSlot(memo.slot);
    S.game.respin.spun = true;
    $("spin-btn").disabled = true;
    onWheelLanded(team);
    return;
  }
  $("spin-btn").disabled = true;
  renderPitch();
  renderGameStatus();
}

// pick (or change) the player to replace; only allowed before spinning
function chooseRespinSlot(i) {
  const g = S.game, r = g.respin;
  if (r.slot !== null) g.slots[r.slot].player = r.removed;
  if (r.slot === i) {
    // tapped the ringed player again: keep them
    r.slot = null;
    r.removed = null;
    g.captain = r.base.captain;
    $("spin-btn").disabled = true;
    renderPitch();
    renderGameStatus();
    return;
  }
  const slot = g.slots[i];
  r.slot = i;
  r.removed = slot.player;
  slot.player = null;
  g.captain = r.base.captain === r.removed?.id ? null : r.base.captain;
  $("spin-btn").disabled = false;
  renderPitch();
  renderGameStatus();
}

function pickedIds() {
  const ids = new Set(S.game.slots.filter((s) => s.player).map((s) => s.player.id));
  if (S.game.respin?.removed) ids.add(S.game.respin.removed.id);   // a re-spin must change the player
  return ids;
}
function vacantSlots() {
  return S.game.slots.filter((s) => !s.player);
}
function filledCount() {
  return S.game.slots.filter((s) => s.player).length;
}

function playerFitsSlot(player, slot) {
  return TYPE_CAT[player.type] === ROLES[slot.role].cat;
}

// vacant slots this player could fill
function fittingVacantSlots(player) {
  return vacantSlots().filter((s) => playerFitsSlot(player, s));
}

function renderGameStatus() {
  const n = filledCount();
  $("game-status").innerHTML = `
    <span><b>${gwLabel(S.game.gw)}</b> &middot; ${S.game.formation}</span>
    <span class="status-count">${n}<small> / 11 picked</small></span>`;
  $("captain-banner").classList.toggle("hidden", !(n === 11 && !S.game.captain));
  const r = S.game.respin;
  if (r && !r.spun) {
    $("score-btn").classList.add("hidden");
    $("wheel-result").innerHTML = r.slot === null
      ? `<b>Re-spin:</b> tap the player you want to replace.`
      : `Spin for a new ${CAT_LABEL[ROLES[S.game.slots[r.slot].role].cat].toLowerCase()} to replace <b>${escapeHtml(r.removed.name)}</b>. Tap them again, or someone else, to change your mind.`;
    return;
  }
  if (n === 11 && r) {
    $("spin-btn").disabled = true;
    $("score-btn").classList.toggle("hidden", !S.game.captain);
    $("wheel-result").innerHTML = S.game.captain
      ? `<b>${escapeHtml(S.game.slots[r.slot].player.name)}</b> is in. Enter the team to use your re-spin.`
      : `<b>Team complete!</b> Your captain was swapped out, so tap a player to pick a new one.`;
    return;
  }
  if (n === 11) {
    $("spin-btn").disabled = true;
    if (!S.game.captain) {
      $("score-btn").classList.add("hidden");
      $("wheel-result").innerHTML = `<b>Team complete!</b> Pick your captain by tapping a player on the pitch. You can change captain before you enter your team.`;
    } else {
      $("score-btn").classList.remove("hidden");
      $("wheel-result").innerHTML = `<b>${S.playersById[S.game.captain].name}</b> is captain. Tap another player to change before you enter your team.`;
    }
  }
}

/* ---------------- images: photos, kit avatars, badges ---------------- */

const svgUri = (svg) => "data:image/svg+xml," + encodeURIComponent(svg);

// a shirt in the club's colours, for players the Premier League has no photo of
function kitAvatar(team, isGk) {
  const body = isGk ? "#1f2937" : (team && team.color) || "#64748b";
  const trim = isGk ? "#c6f432" : (team && team.tcol) || "#ffffff";
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" fill="#e6ebf1"/>
<path d="M23 15l-11 5-6 13 8 4 3-5v26h30V32l3 5 8-4-6-13-11-5c-2 4-5 6-9 6s-7-2-9-6z" fill="${body}" stroke="rgba(0,0,0,.2)" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M23 15c2 4 5 6 9 6s7-2 9-6" fill="none" stroke="${trim}" stroke-width="2.4"/>
</svg>`);
}

// a plain shield in the club's colours, if the real badge can't load
function crestFallback(team) {
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 46">
<path d="M20 1l18 6v14c0 12-8 20-18 24C10 41 2 33 2 21V7z" fill="${team.color || "#64748b"}" stroke="rgba(0,0,0,.2)"/>
<text x="20" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="11" fill="${team.tcol || "#fff"}">${team.short || ""}</text>
</svg>`);
}

// <img onerror>: try the alternative URL, then the drawn fallback
window.imgFail = (img) => {
  const next = img.dataset.alt;
  if (next) { img.dataset.alt = ""; img.src = next; return; }
  img.onerror = null;
  img.src = img.dataset.fb;
};

function playerPhoto(p, cls = "") {
  const fb = kitAvatar(S.teamsById[p.team], p.type === 1);
  if (!p.img) return `<img class="photo ${cls}" src="${fb}" alt="">`;
  return `<img class="photo ${cls}" src="${p.img}" alt="" loading="lazy"
    data-alt="${p.img2 || ""}" data-fb="${fb}" onerror="imgFail(this)">`;
}

const PL_BADGE = (code) => `https://resources.premierleague.com/premierleague25/badges/${code}.svg`;

function teamBadge(team, cls = "") {
  if (!team) return "";
  // badges are saved into the site by the build; the Premier League's copy is the backup
  const remote = S.comp === LIVE_SITE_COMP ? PL_BADGE(team.code) : "";
  const src = team.badge || remote;
  return `<img class="badge-img ${cls}" src="${src}" alt="" title="${escapeHtml(team.name)}"
    data-alt="${src === remote ? "" : remote}" data-fb="${crestFallback(team)}" onerror="imgFail(this)">`;
}

// "ARS (H)" for a player whose match is still to come
function nextOpponent(p, gw) {
  const f = teamFixtures(p.team, gw).find((x) => x.hs === null || x.hs === undefined);
  if (!f) return "–";
  const home = f.h === p.team;
  const opp = S.teamsById[home ? f.a : f.h];
  return `${opp ? opp.short : "TBC"} (${home ? "H" : "A"})`;
}

function renderPitch() {
  const pitch = $("pitch");
  pitch.innerHTML = `
    <div class="pen-box bottom"></div><div class="six-box bottom"></div>`;
  const place = layoutPitch(pitch, S.game.slots);
  S.game.slots.forEach((slot, i) => {
    const el = document.createElement("div");
    el.className = "slot" + (slot.player ? " filled" : "");
    place(el, i);
    if (slot.player) {
      const isCap = S.game.captain === slot.player.id;
      const r = S.game.respin;
      const choosingRespin = r && !r.spun;
      const pickingCaptain = filledCount() === 11 && !choosingRespin && (!r || r.base.captain === r.removed?.id);
      if (choosingRespin) {
        el.classList.add("respin-select");
        el.title = "Replace this player";
        el.addEventListener("click", () => chooseRespinSlot(i));
      }
      if (pickingCaptain) {
        el.classList.add("cap-select");
        if (isCap) el.classList.add("cap-picked");
        if (!S.game.captain) el.classList.add("cap-prompt");
      }
      el.innerHTML = `
        ${isCap ? '<div class="cap-badge">C</div>' : ""}${availDot(slot.player, S.game.gw)}
        <div class="disc">${playerPhoto(slot.player)}${teamBadge(S.teamsById[slot.player.team])}</div>
        <div class="nameplate">${escapeHtml(slot.player.name)}</div>`;
      if (pickingCaptain) {
        el.title = isCap ? "Captain selected" : "Pick as captain";
        el.addEventListener("click", () => {
          S.game.captain = slot.player.id;
          renderPitch();
          renderGameStatus();
        });
      }
    } else if (S.game.respin?.slot === i && S.game.respin.removed) {
      // the player being re-spun stays in view, ringed in red, until replaced
      const r = S.game.respin, p = r.removed;
      el.classList.add("filled", "respin-out");
      el.innerHTML = `${availDot(p, S.game.gw)}
        <div class="disc">${playerPhoto(p)}${teamBadge(S.teamsById[p.team])}</div>
        <div class="nameplate">${escapeHtml(p.name)}</div>`;
      if (!r.spun) {
        el.classList.add("respin-select");
        el.title = "Keep this player";
        el.addEventListener("click", () => chooseRespinSlot(i));
      }
    } else {
      el.innerHTML = `
        <div class="disc">${ROLES[slot.role].cat}</div>`;
      if (S.placing && playerFitsSlot(S.placing, slot)) {
        el.classList.add("placeable");
        el.addEventListener("click", () => placePlayer(S.placing, slot));
      }
    }
    pitch.appendChild(el);
  });
}

function placePlayer(player, slot) {
  slot.player = player;
  S.placing = null;
  closePicker();
  renderPitch();
  renderGameStatus();
  if (filledCount() < 11) {
    $("wheel-result").innerHTML = `<b>${player.name}</b> placed (${ROLES[slot.role].cat}). Spin again!`;
  }
}

/* ---------------- wheel ---------------- */

function wheelTeams() {
  return (S.game && S.game.wheelTeams) || S.core.teams;
}

const REEL_ROW_H = 46;      // must match .reel-row height in the CSS

function resetSpinner() {
  const box = $("spinner");
  box.classList.remove("landed", "spinning", "blur");
  box.style.removeProperty("--team-color");
  const strip = $("reel-strip");
  strip.style.transform = "translateY(0)";
  strip.innerHTML = `<div class="reel-row"></div><div class="reel-row muted">Ready to spin…</div>`;
}

function spinWheel() {
  if (S.wheel.spinning || !S.game || filledCount() === 11) return;
  S.wheel.spinning = true;
  $("spin-btn").disabled = true;
  $("wheel-result").innerHTML = "";
  const dur = 3000;
  playSpinSound(dur);

  const teams = wheelTeams();
  const target = teams[Math.floor(Math.random() * teams.length)];
  const r = S.game.respin;
  if (r) {
    r.spun = true;
    setRespinMemo(r.base.id, { slot: r.slot, team: target.id });
    renderPitch();
  }
  const box = $("spinner");
  const strip = $("reel-strip");

  // build the reel: a long run of random teams, the winner near the end,
  // plus padding rows below so the overshoot never shows an empty gap
  const rows = [];
  for (let i = 0; i < 44; i++) rows.push(teams[Math.floor(Math.random() * teams.length)]);
  rows.push(target);
  rows.push(teams[Math.floor(Math.random() * teams.length)]);
  rows.push(teams[Math.floor(Math.random() * teams.length)]);
  const targetIdx = rows.length - 3;
  strip.innerHTML = rows
    .map((t) => `<div class="reel-row">${teamBadge(t)}${t.name}</div>`)
    .join("");
  strip.style.transform = "translateY(0)";
  box.classList.remove("landed");
  box.classList.add("spinning", "blur");
  box.style.removeProperty("--team-color");

  // scroll so the winner ends up in the centre band (row 2 of 3 visible)
  const yFinal = (targetIdx - 1) * REEL_ROW_H;
  const t0 = performance.now();
  let done = false;

  // ease-out cubic with a small "clunk" overshoot at the end
  function ease(t) {
    const c1 = 0.5, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function finish() {
    if (done) return;
    done = true;
    S.wheel.spinning = false;
    strip.style.transform = `translateY(${-yFinal}px)`;
    box.classList.remove("spinning", "blur");
    box.classList.add("landed");
    if (target.color) box.style.setProperty("--team-color", target.color);
    playLandingSound();
    const rowEl = strip.children[targetIdx];
    rowEl.innerHTML = `${teamBadge(target)}<b>${target.name}</b>`;
    setTimeout(() => onWheelLanded(target), 650);
  }

  function frame(now) {
    if (done) return;
    const t = Math.min(1, (now - t0) / dur);
    strip.style.transform = `translateY(${-yFinal * ease(t)}px)`;
    if (t > 0.72) box.classList.remove("blur");
    if (t < 1) requestAnimationFrame(frame);
    else finish();
  }
  requestAnimationFrame(frame);
  // guarantee landing even if rAF is throttled (hidden tab etc.)
  setTimeout(finish, dur + 500);
}

function onWheelLanded(team) {
  S.game.currentClub = team;
  $("wheel-result").innerHTML = `The wheel says… <b>${team.name}</b>!`;
  openPicker(team);
}

/* ---------------- player picker ---------------- */

function teamFixtures(teamId, gw) {
  return S.core.fixtures.filter((f) => f.gw === gw && (f.h === teamId || f.a === teamId));
}

function gwLabel(gw) {
  const ev = S.core.events.find((e) => e.gw === gw);
  return (ev && ev.short) || `GW ${gw}`;
}

function fixturesLabel(team, gw) {
  const fx = teamFixtures(team.id, gw);
  if (fx.length === 0) {
    return `<span class="fixt warn">No fixture in ${gwLabel(gw)}, so these players can't score</span>`;
  }
  const parts = fx.map((f) => {
    const home = f.h === team.id;
    const opp = S.teamsById[home ? f.a : f.h];
    return `${opp ? opp.name : "TBC"} <b>(${home ? "H" : "A"})</b>`;
  });
  const pending = fx.some((f) => f.hs === null || f.hs === undefined);
  return `<span class="fixt">${gwLabel(gw)}: vs ${parts.join(" &amp; vs ")}${pending ? " · not played yet" : ""}</span>`;
}

function playsThisGw(p) {
  const stats = S.game ? gwStatsSync(S.game.gw) : null;
  return !!(stats && stats[String(p.id)]);
}

// FPL availability flag for a player: null when fit, else { out, label, news }
function availability(p) {
  if (!p.st || p.st === "a") return null;
  const doubt = p.st === "d" && p.chance !== 0;
  const label = doubt ? `${p.chance ?? 50}%`
    : { i: "Injured", s: "Suspended", u: "Unavailable", n: "Unavailable" }[p.st] || "Out";
  return { out: !doubt, label, news: p.news || "" };
}

// FPL's flag for a player whose match this gameweek is still to come
function upcomingAvail(p, gw) {
  const pending = teamFixtures(p.team, gw).some((f) => f.hs === null || f.hs === undefined);
  return pending ? availability(p) : null;
}
// small badge for a player's pitch card: "75%" or "OUT", FPL's news on hover
function availDot(p, gw) {
  const av = upcomingAvail(p, gw);
  if (!av) return "";
  return `<div class="avail-dot ${av.out ? "out" : "doubt"}" title="${escapeHtml(av.news || av.label)}">${av.out ? "OUT" : av.label}</div>`;
}

function openPicker(team) {
  const picked = pickedIds();
  const roster = (S.playersByTeam[team.id] || []).filter((p) => !picked.has(p.id));
  // if the fixture hasn't been played yet, we can't know who features
  const pending = teamFixtures(team.id, S.game.gw).some((f) => f.hs === null || f.hs === undefined);
  // players who actually play this gameweek first, then best points-per-game
  const ppgOf = (p) => (p.gp ? p.pts / p.gp : -1);
  const isOut = (p) => (availability(p)?.out ? 1 : 0);
  // before kick-off, players ruled out by FPL drop to the bottom
  const byBest = (a, b) =>
    (pending ? isOut(a) - isOut(b) : playsThisGw(b) - playsThisGw(a)) || ppgOf(b) - ppgOf(a);
  const pickable = roster.filter((p) => fittingVacantSlots(p).length > 0).sort(byBest);
  const rest = roster.filter((p) => fittingVacantSlots(p).length === 0).sort(byBest);

  const vacantByCat = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const s of vacantSlots()) vacantByCat[ROLES[s.role].cat]++;
  const needs = Object.entries(vacantByCat)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${n} ${CAT_LABEL[cat].toLowerCase()}${n > 1 ? "s" : ""}`)
    .join(" · ");
  const head = $("picker-head");
  head.style.setProperty("--club", team.color || "");
  head.style.setProperty("--club-text", team.tcol || "");
  head.innerHTML = `<div class="crest">${teamBadge(team)}</div>
    <div>
      <div class="club">${team.name}</div>
      <div class="fixture-line">${fixturesLabel(team, S.game.gw)}</div>
      <div class="sub">Pick a player — still needed: ${needs}</div>
    </div>`;

  const body = $("picker-body");
  body.innerHTML = "";

  if (pickable.length === 0) {
    body.innerHTML = `
      <div class="picker-empty">
        <div><b>${team.name}</b> have no players that fit your remaining positions.</div>
        <button class="big-btn" id="respin-btn">Spin Again</button>
      </div>`;
    $("respin-btn").addEventListener("click", () => { closePicker(); spinWheel(); });
  } else {
    for (const p of pickable) body.appendChild(playerRow(p, team, true, pending));
    if (rest.length) {
      const note = document.createElement("div");
      note.className = "picker-note";
      note.textContent = "No fit for your vacant positions:";
      body.appendChild(note);
      for (const p of rest) body.appendChild(playerRow(p, team, false, pending));
    }
  }
  // a re-spin can be turned down: the team stays exactly as entered
  const kept = S.game.respin?.removed;
  if (kept) {
    const keep = document.createElement("button");
    keep.className = "nav-btn keep-btn";
    keep.textContent = `Keep ${kept.name}`;
    keep.addEventListener("click", () => { closePicker(); S.game = null; goHome(); });
    body.prepend(keep);
  }
  $("modal-backdrop").classList.remove("hidden");
}

function playerRow(p, team, pickable, pending) {
  const fits = fittingVacantSlots(p);
  const row = document.createElement("div");
  row.className = "player-row" + (pickable ? " pickable" : " dim");
  const chips = `<span class="chip${pickable ? " fit" : ""}">${TYPE_CAT[p.type]}</span>`;
  const ppg = p.gp ? (p.pts / p.gp).toFixed(1) : "–";
  const dnp = (pending || playsThisGw(p)) ? "" : `<span class="dnp">Does not play this GW · </span>`;
  // FPL's injury news is current, so it's only shown for fixtures still to come
  const av = pending ? availability(p) : null;
  const flag = av ? `<span class="avail ${av.out ? "out" : "doubt"}" title="${escapeHtml(av.news)}">${av.label}</span>` : "";
  const news = av && av.news ? `<div class="player-news ${av.out ? "out" : "doubt"}">${escapeHtml(av.news)}</div>` : "";
  row.innerHTML = `
    ${playerPhoto(p)}
    <div class="player-main">
      <div class="player-name">${p.name}${flag}</div>
      <div class="player-sub">${dnp}${p.full !== p.name ? p.full + " · " : ""}${p.mins} mins · ${p.g}G ${p.a}A this season</div>
      ${news}
    </div>
    <div class="ppg">${ppg}<span>pts/gm</span></div>
    <div class="pos-chips">${chips}</div>`;

  if (pickable) {
    // players go straight into the next vacant slot for their position
    row.addEventListener("click", () => placePlayer(p, fits[0]));
  }
  return row;
}

function closePicker() {
  $("modal-backdrop").classList.add("hidden");
  if (S.game && filledCount() < 11 && !S.wheel.spinning) $("spin-btn").disabled = false;
}

/* ---------------- shared leaderboard ----------------
   Storage: textdb.online (free, CORS-friendly, no accounts). Each player
   writes only their own key; a members key is the directory. Entries store
   the PICKS, not the score — every viewer recomputes scores from their own
   match data, so the board stays live as games finish. */

const LB = {
  read: "https://textdb.online/",
  write: "https://textdb.online/update",
  board: "spinxi26_b7wq4x9r",
};
const NAME_KEY = "spinxi_player_name";
const NAME_SLUG_KEY = "spinxi_player_slug";
const PENDING_SUBMITS_KEY = "spinxi_pending_submits_v1";

/* ---------------- player sign-in ----------------
   When web/firebase-config.js holds a Firebase project, players sign in with
   Google or an emailed link and the board lives in Firestore (login.js).
   Teams entered before sign-in existed stay on textdb and are still shown;
   signing in on the browser that entered them links them to the account.
   Without a config the site keeps the name-only textdb board. */
const AUTH_ON = !!window.SPINXI_FIREBASE;
const A = { mod: null, user: null, profile: null, failed: false, ready: Promise.resolve() };

function startAuth() {
  if (!AUTH_ON) return;
  A.ready = import("./login.js?v=16")
    .then((mod) => { A.mod = mod; return mod.start(window.SPINXI_FIREBASE, onAuthChange); })
    .catch((e) => { console.warn("sign-in unavailable", e); A.failed = true; renderAccount(); });
}
function signedIn() { return !!(A.user && A.profile); }

async function onAuthChange(user) {
  A.user = user;
  A.profile = null;
  if (user) {
    try { A.profile = await setUpProfile(user); }
    catch (e) { console.warn("profile load failed", e); }
  }
  renderAccount();
  closeSignIn();
  if (signedIn()) {
    mergeRemoteHistory();
    adoptLocalTeams();
    await retryPendingSubmits();
  }
  // the live card shows this player's team and re-spin
  if (!$("screen-home").classList.contains("hidden")) renderHome();
  if (!$("screen-board").classList.contains("hidden")) renderBoard();
  if (!$("screen-setup").classList.contains("hidden")) renderSetup(S.setupOpts || {});
}

// first sign-in: keep the name this browser already used on the board and
// link its old textdb teams to the account
async function setUpProfile(user) {
  let profile = await A.mod.getProfile(user.uid);
  const localName = localStorage.getItem(NAME_KEY) || "";
  const localSlug = localStorage.getItem(NAME_SLUG_KEY) || playerSlug(localName);
  if (localSlug) await A.mod.claimLegacy(localSlug);
  if (!profile) {
    const name = (localName || user.displayName.split(" ")[0] || user.email.split("@")[0] || "Player").slice(0, 20);
    await A.mod.saveName(name);
    profile = { uid: user.uid, name, entries: [] };
  }
  return profile;
}

// a gameweek still open that this device entered before signing in (e.g. on
// the old name-only board): its first team joins the account, so it counts
// there and, entered early enough, earns the re-spin
function adoptLocalTeams() {
  const hist = getHistory().filter((h) => entryInSeason(h) && h.picks && !h.respinOf && entriesOpen(h.gw));
  for (const gw of new Set(hist.map((h) => h.gw))) {
    if (countedEntry(myEntries(), gw)) continue;
    const c = countedEntry(hist, gw);
    if (c) queuePendingSubmit(c.base);
  }
}

// teams entered on another device show up in Your Teams
function mergeRemoteHistory() {
  const hist = getHistory();
  const have = new Set(hist.map((h) => h.id));
  let changed = false;
  for (const e of A.profile.entries) {
    if (have.has(e.id)) continue;
    hist.push({ ...e, score: 0 });
    changed = true;
  }
  if (changed) saveHistory(hist);
  return changed;
}

function renderAccount() {
  const btn = $("nav-account");
  if (!AUTH_ON) { btn.classList.add("hidden"); return; }
  btn.classList.remove("hidden");
  btn.textContent = signedIn() ? A.profile.name : "Sign in";
  btn.classList.toggle("in", signedIn());
}

const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

function signInPanelHtml(opts = {}) {
  return `
    <img src="img/logo.svg" alt="">
    <h2>${opts.title || "Sign in to join the leaderboard"}</h2>
    <p>${opts.sub || "Your teams go on the leaderboard under your name, on any device you sign in on."}</p>
    <button class="big-btn signin-google" data-act="google">${GOOGLE_G}Continue with Google</button>
    <div class="signin-or">or email me a sign-in link</div>
    <form class="signin-email" data-act="email">
      <input type="email" required placeholder="you@example.com" autocomplete="email">
      <button class="nav-btn sel" type="submit">Send link</button>
    </form>
    <div class="signin-msg"></div>
    ${opts.practice ? `<button class="text-btn signin-skip" data-act="practice">Just practise for now</button>` : ""}`;
}

function wireSignInPanel(el, opts = {}) {
  const msg = el.querySelector(".signin-msg");
  el.querySelector('[data-act="google"]').addEventListener("click", async () => {
    msg.textContent = "";
    msg.className = "signin-msg";
    try { await A.mod.signInGoogle(); }
    catch (e) {
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        msg.className = "signin-msg err";
        msg.textContent = "Google sign-in didn't work. Try the email link instead.";
        console.warn("google sign-in failed", e);
      }
    }
  });
  el.querySelector('[data-act="email"]').addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = el.querySelector('input[type="email"]').value.trim();
    if (!email) return;
    msg.className = "signin-msg";
    msg.textContent = "Sending…";
    try {
      await A.mod.sendEmailLink(email);
      msg.className = "signin-msg ok";
      msg.innerHTML = `Check <b>${escapeHtml(email)}</b> and open the link on this device to sign in.`;
    } catch (e) {
      console.warn("email link failed", e);
      msg.className = "signin-msg err";
      msg.textContent = "Couldn't send the email. Check the address and try again.";
    }
  });
  el.querySelector('[data-act="practice"]')?.addEventListener("click", opts.onPractice);
}

async function openSignIn() {
  await A.ready;
  const box = $("auth-modal");
  if (A.failed || !A.mod) {
    box.innerHTML = `<h2>Sign-in is unavailable</h2><p>Couldn't reach the sign-in service. Check your connection and reload the page.</p>`;
  } else if (signedIn()) {
    box.innerHTML = `
      <img src="img/logo.svg" alt="">
      <h2>${escapeHtml(A.profile.name)}</h2>
      <p>Signed in as ${escapeHtml(A.user.email || "your Google account")}.
        You can change your leaderboard name on the Leaderboard tab.</p>
      <button class="nav-btn" id="auth-signout">Sign out</button>`;
    $("auth-signout").addEventListener("click", async () => {
      await A.mod.signOut();
      closeSignIn();
    });
  } else {
    box.innerHTML = signInPanelHtml();
    wireSignInPanel(box);
  }
  $("auth-backdrop").classList.remove("hidden");
}
function closeSignIn() { $("auth-backdrop").classList.add("hidden"); }

function playerName() {
  if (AUTH_ON) return A.profile?.name || "";
  return localStorage.getItem(NAME_KEY) || "";
}
function playerSlug(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}
function storedPlayerSlug() {
  return localStorage.getItem(NAME_SLUG_KEY) || playerSlug(playerName());
}
function ensurePlayerSlug(name) {
  let slug = playerSlug(name);
  if (!slug) slug = storedPlayerSlug();
  if (!slug) slug = "player" + Math.random().toString(36).slice(2, 10);
  localStorage.setItem(NAME_SLUG_KEY, slug);
  return slug;
}
function lbEntryKey(entry) {
  return entry.id || `${entry.comp}|${entry.gw}|${entry.ts || ""}|${(entry.picks || []).join(",")}|${entry.captain || ""}`;
}
function normaliseEntry(entry) {
  return {
    id: entry.id,
    comp: entry.comp,
    label: entry.label,
    gw: entry.gw,
    formation: entry.formation,
    picks: entry.picks,
    captain: entry.captain,
    ts: entry.ts,
    ...(entry.respinOf ? { respinOf: entry.respinOf, respinSlot: entry.respinSlot } : {}),
  };
}
function entryTimeLabel(ts) {
  return ts
    ? new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}
function getPendingSubmits() {
  try { return JSON.parse(localStorage.getItem(PENDING_SUBMITS_KEY)) || []; }
  catch { return []; }
}
function savePendingSubmits(list) {
  localStorage.setItem(PENDING_SUBMITS_KEY, JSON.stringify(list));
}
function queuePendingSubmit(entry) {
  const pending = getPendingSubmits();
  const key = lbEntryKey(entry);
  if (!pending.some((e) => lbEntryKey(e) === key)) {
    pending.push(normaliseEntry(entry));
    savePendingSubmits(pending);
  }
}
function removePendingSubmit(entry) {
  const key = lbEntryKey(entry);
  savePendingSubmits(getPendingSubmits().filter((e) => lbEntryKey(e) !== key));
}
function playerRecord(raw, name = "") {
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : { name, entries: [] };
  record.name = record.name || name;
  record.entries = Array.isArray(record.entries) ? record.entries.filter(Boolean) : [];
  return record;
}
function mergeEntries(entries) {
  const byKey = {};
  for (const entry of entries.filter(Boolean)) byKey[lbEntryKey(entry)] = normaliseEntry(entry);
  return Object.values(byKey).sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

async function lbRead(key) {
  try {
    const r = await fetch(`${LB.read}${LB.board}_${key}`, { cache: "no-store" });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!txt || !/^\s*[\[{]/.test(txt)) return null;
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}

async function lbWrite(key, obj) {
  const body = new URLSearchParams();
  body.set("key", `${LB.board}_${key}`);
  body.set("value", JSON.stringify(obj));
  const r = await fetch(LB.write, { method: "POST", body });
  if (!r.ok) throw new Error(`Leaderboard write failed (${r.status})`);
  const txt = await r.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!data || data.status !== 1) throw new Error("Leaderboard write rejected");
}

// submit this team entry; repeat entries are allowed, exact resubmits are replaced
async function lbSubmit(entry) {
  if (AUTH_ON) {
    if (!signedIn()) return false;
    try {
      await A.mod.submitEntry(normaliseEntry(entry));
      if (!A.profile.entries.some((e) => e.id === entry.id)) A.profile.entries.push(normaliseEntry(entry));
      removePendingSubmit(entry);
      return true;
    } catch (e) {
      console.warn("leaderboard submit failed", e);
      return false;
    }
  }
  const name = playerName();
  if (!name) return false;
  const slug = ensurePlayerSlug(name);
  try {
    const mine = playerRecord(await lbRead(`p_${slug}`), name);
    const entryKey = lbEntryKey(entry);
    mine.name = name;
    mine.entries = mine.entries.filter((e) => lbEntryKey(e) !== entryKey);
    mine.entries.push(normaliseEntry(entry));
    await lbWrite(`p_${slug}`, mine);
    await lbUpdateMembers({ add: slug });
    removePendingSubmit(entry);
    return true;
  } catch (e) {
    console.warn("leaderboard submit failed", e);
    return false;
  }
}

async function lbUpdateMembers({ add, remove } = {}) {
  const membersRaw = await lbRead("members");
  const members = Array.isArray(membersRaw) ? membersRaw.filter(Boolean) : [];
  const next = members.filter((slug, index) => members.indexOf(slug) === index && slug !== remove);
  if (add && !next.includes(add)) next.push(add);
  await lbWrite("members", next);
}

async function lbSavePlayerName(name) {
  if (AUTH_ON) {
    if (!signedIn()) return false;
    await A.mod.saveName(name);
    A.profile.name = name;
    renderAccount();
    return true;
  }
  const previousName = playerName();
  const previousSlug = storedPlayerSlug();
  const nextSlug = ensurePlayerSlug(name);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(NAME_SLUG_KEY, nextSlug);

  if (previousSlug && previousSlug !== nextSlug) {
    await lbMigrateLocalEntries(previousSlug, nextSlug, name, previousName);
  }
  return true;
}

async function lbMigrateLocalEntries(previousSlug, nextSlug, nextName, previousName) {
  try {
    const localKeys = new Set(getHistory().filter(entryInSeason).map(lbEntryKey));
    for (const entry of getPendingSubmits()) localKeys.add(lbEntryKey(entry));
    if (!localKeys.size) {
      await lbUpdateMembers({ add: nextSlug, remove: previousSlug });
      return;
    }

    const previous = playerRecord(await lbRead(`p_${previousSlug}`), previousName);
    const next = playerRecord(await lbRead(`p_${nextSlug}`), nextName);
    const moving = previous.entries.filter((entry) => localKeys.has(lbEntryKey(entry)));
    const remaining = previous.entries.filter((entry) => !localKeys.has(lbEntryKey(entry)));

    next.name = nextName;
    next.entries = mergeEntries([...next.entries, ...moving]);
    await lbWrite(`p_${nextSlug}`, next);

    previous.entries = remaining;
    await lbWrite(`p_${previousSlug}`, previous);
    await lbUpdateMembers({ add: nextSlug, remove: remaining.length ? null : previousSlug });
  } catch (e) {
    console.warn("leaderboard name migration failed", e);
  }
}

async function retryPendingSubmits() {
  if (AUTH_ON) {
    // the server stamps each team with its own clock, so a team that missed
    // its deadline while waiting would only count as late: drop it
    for (const entry of getPendingSubmits()) {
      if (entryInSeason(entry) && !entriesOpen(entry.gw)) removePendingSubmit(entry);
    }
    if (!signedIn()) return true;
  }
  if (!playerName()) return true;
  let allOk = true;
  for (const entry of getPendingSubmits()) {
    const ok = await lbSubmit(entry);
    allOk = allOk && ok;
  }
  return allOk;
}

// score an entry with the viewer's current data (captain doubled, pending-aware)
function computeEntryScore(entry, stats) {
  let total = 0, pending = false;
  const slots = FORMATIONS[entry.formation] || [];
  (entry.picks || []).forEach((pid, i) => {
    const cat = slots[i] ? ROLES[slots[i][0]].cat : "MID";
    const p = S.playersById[pid];
    const pend = p ? teamFixtures(p.team, entry.gw).some((f) => f.hs === null || f.hs === undefined) : false;
    const res = scorePlayer(p ? stats[String(p.id)] : null, cat, pend);
    if (res.pending) pending = true;
    let pts = res.total;
    if (p && entry.captain === p.id && !res.pending) pts *= 2;
    total += pts;
  });
  return { total, pending };
}

// which board is showing: a gameweek number, or "season"
function boardView() {
  if (S.boardView === undefined) S.boardView = (currentRound() || liveRound())?.gw ?? "season";
  return S.boardView;
}

function renderBoardNav() {
  const view = boardView();
  const gws = S.core.events.map((e) => e.gw);
  const i = gws.indexOf(view);
  const nav = $("board-nav");
  nav.innerHTML = `
    <button class="nav-btn" id="board-prev" ${view === "season" || i <= 0 ? "disabled" : ""}>‹</button>
    <button class="nav-btn${view !== "season" ? " sel" : ""}" id="board-gw">${view === "season" ? "Gameweek" : gwLabel(view)}</button>
    <button class="nav-btn" id="board-next" ${view === "season" || i >= gws.length - 1 ? "disabled" : ""}>›</button>
    <button class="nav-btn${view === "season" ? " sel" : ""}" id="board-season">Season</button>`;
  const go = (v) => { S.boardView = v; renderBoard(); };
  $("board-prev").addEventListener("click", () => go(gws[i - 1]));
  $("board-next").addEventListener("click", () => go(gws[i + 1]));
  $("board-gw").addEventListener("click", () => {
    if (view === "season") go((currentRound() || liveRound())?.gw ?? gws[0]);
  });
  $("board-season").addEventListener("click", () => go("season"));
}

// everyone on the board: [{ owner, name, entries }]. `owner` identifies the
// player (account uid, or "L:<slug>" for a name-only textdb player)
async function lbLoadPlayers() {
  const members = (await lbRead("members")) || [];
  const legacy = await Promise.all(members.map(async (slug) => ({ slug, rec: await lbRead(`p_${slug}`) })));
  const players = legacy.filter((l) => l.rec).map(({ slug, rec }) => ({
    owner: "L:" + slug, name: rec.name || "Player", entries: rec.entries || [],
  }));
  if (!AUTH_ON) return players;
  if (!A.mod) throw new Error("sign-in unavailable");
  const { players: accounts, claims } = await A.mod.loadBoard();
  const names = Object.fromEntries(accounts.map((p) => [p.uid, p.name]));
  for (const p of players) {
    const uid = claims[p.owner.slice(2)];
    if (uid) { p.owner = uid; p.name = names[uid] || p.name; }
  }
  return players.concat(accounts.map((p) => ({ owner: p.uid, name: p.name, entries: p.entries })));
}
function myOwner() {
  if (AUTH_ON) return A.user?.uid || "";
  return playerName() ? "L:" + storedPlayerSlug() : "";
}

async function renderBoard() {
  await A.ready;
  await retryPendingSubmits();
  renderBoardName();
  renderBoardNav();
  const view = boardView();
  const body = $("board-body");
  body.innerHTML = `<div class="history-empty">Loading leaderboard…</div>`;
  let playersData;
  try { playersData = await lbLoadPlayers(); }
  catch (e) {
    console.warn("leaderboard load failed", e);
    body.innerHTML = `<div class="history-empty">Couldn't load the leaderboard. Check your connection and hit Refresh.</div>`;
    return;
  }
  if (S.boardView !== view) return;    // user switched view while loading
  if (playersData.length === 0) {
    body.innerHTML = `<div class="history-empty">Nobody on the board yet. Enter a team to join, even while scores are still 0.</div>`;
    return;
  }

  // each team once (the same team can sit under an old name too), then the
  // team that counts for each player in each gameweek
  const byKey = {};
  const me = myOwner();
  for (const pd of playersData) {
    for (const e of pd.entries || []) {
      if (!entryInSeason(e) || !entryOnTime(e) || (view !== "season" && e.gw !== view)) continue;
      const key = lbEntryKey(e);
      const prev = byKey[key];
      // the same player's copy (an old-board team moved into their account)
      // keeps the time it was first entered
      const earlier = (e.ts || 0) < (prev?.e.ts || 0);
      if (!prev || (pd.owner === me && prev.owner !== me) || (pd.owner === prev.owner ? earlier : !earlier)) {
        byKey[key] = { owner: pd.owner, name: pd.name || "Player", e };
      }
    }
  }
  const byOwner = {};
  for (const { owner, name, e } of Object.values(byKey)) {
    (byOwner[owner] ||= { name, entries: [] }).entries.push(e);
  }
  const rows = [];
  for (const [owner, p] of Object.entries(byOwner)) {
    for (const gw of new Set(p.entries.map((e) => e.gw))) {
      const c = countedEntry(p.entries, gw);
      if (!c) continue;
      const sc = computeEntryScore(c.entry, await loadGwStats(gw));
      rows.push({ owner, name: p.name, entry: c.entry, base: c.base, total: sc.total, pending: sc.pending });
    }
  }
  if (S.boardView !== view) return;
  if (!rows.length) {
    body.innerHTML = view === "season"
      ? `<div class="history-empty">No teams on the board this season yet.</div>`
      : `<div class="history-empty">No ${gwLabel(view)} teams on the board yet. Enter a team to join, even while scores are still 0.</div>`;
    return;
  }
  if (view === "season") renderSeasonBoard(body, rows, me);
  else renderGwBoard(body, rows, me);
}

function renderBoardName() {
  const out = AUTH_ON && !signedIn();
  $("board-name").classList.toggle("hidden", out);
  $("board-name-save").classList.toggle("hidden", out);
  $("board-signin").classList.toggle("hidden", !out);
  $("board-name").value = playerName();
}

function rankCell(i) {
  return `<div class="board-rank${i < 3 ? " r" + (i + 1) : ""}">${i + 1}</div>`;
}

function renderGwBoard(body, rows, me) {
  rows.sort((a, b) =>
    b.total - a.total
    || (a.pending === b.pending ? 0 : a.pending ? 1 : -1)
    || (a.base.ts || 0) - (b.base.ts || 0));
  body.innerHTML = "";
  const list = document.createElement("div");
  list.className = "board-list";
  body.appendChild(list);
  rows.forEach((r, i) => {
    const label = r.entry.label || "GW " + r.entry.gw;
    const time = entryTimeLabel(r.base.ts);
    const row = document.createElement("div");
    row.className = "board-row" + (r.owner === me ? " me" : "");
    row.title = "View team";
    row.innerHTML = `
      ${rankCell(i)}
      <div class="board-player">
        <div class="board-pname">${escapeHtml(r.name)}</div>
        <div class="board-chips">
          <span class="bchip">${escapeHtml(label)}</span>
          <span class="bchip">${escapeHtml(r.entry.formation || "Formation")}</span>
          ${time ? `<span class="bchip">${escapeHtml(time)}</span>` : ""}
          ${r.entry !== r.base ? `<span class="bchip">re-spun</span>` : ""}
        </div>
      </div>
      ${teamFaces(r.entry.picks, r.entry.captain, "board-faces")}
      <div class="board-total">${r.total}${r.pending ? '<span class="board-live">live</span>' : ""}</div>`;
    row.addEventListener("click", () => viewBoardEntry(r.entry, r.name));
    list.appendChild(row);
  });
}

// season table: each player's counted team in every gameweek adds up
function renderSeasonBoard(body, rows, me) {
  const byPlayer = {};
  for (const r of rows) {
    (byPlayer[r.owner] ||= { owner: r.owner, name: r.name, gwRows: [] }).gwRows.push(r);
  }
  const table = Object.values(byPlayer).map((p) => {
    const gwRows = p.gwRows.sort((a, b) => a.entry.gw - b.entry.gw);
    return {
      owner: p.owner,
      name: p.name,
      gwRows,
      total: gwRows.reduce((t, r) => t + r.total, 0),
      pending: gwRows.some((r) => r.pending),
    };
  });
  table.sort((a, b) => b.total - a.total || b.gwRows.length - a.gwRows.length);
  body.innerHTML = "";
  const list = document.createElement("div");
  list.className = "board-list";
  body.appendChild(list);
  table.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "board-row static" + (p.owner === me ? " me" : "");
    const chips = p.gwRows.map((r) =>
      `<span class="bchip${r.pending ? " pend" : ""}">${escapeHtml(r.entry.label || "GW " + r.entry.gw)}: ${r.total}${r.pending ? " live" : ""}</span>`).join("");
    row.innerHTML = `
      ${rankCell(i)}
      <div class="board-player">
        <div class="board-pname">${escapeHtml(p.name)}</div>
        <div class="board-chips">${chips}</div>
      </div>
      <div class="board-total">${p.total}${p.pending ? '<span class="board-live">live</span>' : ""}</div>`;
    list.appendChild(row);
  });
}

async function viewBoardEntry(entry, name) {
  if (entryComp(entry) !== S.comp) await loadComp(entryComp(entry));
  const stats = await loadGwStats(entry.gw);
  const formation = FORMATIONS[entry.formation] || FORMATIONS["4-3-3"];
  const slots = formation.map(([role, x, y], i) => ({
    role, x, y, player: S.playersById[entry.picks?.[i]] || null,
  }));
  renderResults(
    { gw: entry.gw, formation: entry.formation, slots, captain: entry.captain },
    stats,
    { readonly: true, ownerName: name },
  );
  show("screen-results");
}

function goBoard() { S.boardView = undefined; renderBoard(); show("screen-board"); }

/* ---------------- results ---------------- */

function renderResults(game, stats, opts = {}) {
  const rows = [];
  let total = 0, stillToPlay = 0;
  for (const slot of game.slots) {
    const p = slot.player;
    const cat = ROLES[slot.role].cat;
    const pending = p ? teamFixtures(p.team, game.gw).some((f) => f.hs === null || f.hs === undefined) : false;
    const res = scorePlayer(p ? stats[String(p.id)] : null, cat, pending);
    if (res.pending) stillToPlay++;
    const isCap = p && game.captain === p.id;
    if (isCap && !res.pending) {
      res.lines.push(["Captain ×2", res.total]);
      res.total *= 2;
    }
    total += res.total;
    rows.push({ slot, p, res, cat, isCap });
  }

  const cap = game.captain && S.playersById[game.captain];
  $("results-head").innerHTML = `
    <div>
      <div class="kicker">${gwLabel(game.gw)} &middot; <span class="formation-tag">${game.formation}</span></div>
      <div class="owner">${opts.ownerName ? `${escapeHtml(opts.ownerName)}'s team` : "Your team"}</div>
      <div class="sub">${cap ? `Captain <b>${escapeHtml(cap.name)}</b>` : ""}
        ${stillToPlay ? ` &middot; <span class="pending-note">${stillToPlay} player${stillToPlay > 1 ? "s" : ""} still to play</span>` : ""}</div>
    </div>
    <div class="total-box"><div class="total">${total}</div><div class="total-lbl">${stillToPlay ? "points so far" : "points"}</div></div>`;

  // the team on a pitch, in the formation it was entered in
  const pitch = $("results-pitch");
  pitch.innerHTML = `<div class="pen-box bottom"></div><div class="six-box bottom"></div>`;
  const place = layoutPitch(pitch, rows.map((r) => r.slot));
  rows.forEach(({ p, res, isCap }, i) => {
    const el = document.createElement("div");
    el.className = "slot" + (p ? " filled" : "");
    place(el, i);
    el.innerHTML = p
      ? `${isCap ? '<div class="cap-badge">C</div>' : ""}${availDot(p, game.gw)}
         <div class="disc">${playerPhoto(p)}${teamBadge(S.teamsById[p.team])}</div>
         <div class="nameplate">${escapeHtml(p.name)}</div>
         ${res.pending
           ? `<div class="ptsplate pend">${nextOpponent(p, game.gw)}</div>`
           : `<div class="ptsplate${isCap ? " cap" : ""}">${res.total}</div>`}`
      : `<div class="disc">${ROLES[slot.role].cat}</div>`;
    pitch.appendChild(el);
  });

  const list = $("results-list");
  list.innerHTML = "";
  for (const { slot, p, res, cat, isCap } of rows) {
    const row = document.createElement("div");
    row.className = "result-row";
    const chips = res.lines
      .map(([label, pts]) => {
        if (pts === undefined) return `<span class="bchip pend">${label}</span>`;
        const cls = pts > 0 ? "pos" : pts < 0 ? "neg" : "";
        const sign = pts > 0 ? "+" : "";
        return `<span class="bchip ${cls}">${label} ${pts !== 0 ? sign + pts : ""}</span>`;
      })
      .join("");
    const ptsCls = res.total > 0 ? "pos" : res.total < 0 ? "neg" : "zero";
    const team = p ? S.teamsById[p.team] : null;
    const av = p ? upcomingAvail(p, game.gw) : null;
    const flag = av ? `<span class="avail ${av.out ? "out" : "doubt"}">${av.label}</span>` : "";
    const news = av && av.news ? `<div class="player-news ${av.out ? "out" : "doubt"}">${escapeHtml(av.news)}</div>` : "";
    row.innerHTML = `
      ${p ? playerPhoto(p) : ""}
      <div class="result-main">
        <div class="result-name">${p ? escapeHtml(p.name) : "(empty)"}${team ? teamBadge(team) : ""}${isCap ? '<span class="cap-tag">C</span>' : ""}${flag}</div>
        <div class="result-role">${CAT_LABEL[cat]}${team ? " · " + team.name : ""}</div>
        ${news}
        <div class="break-chips">${chips}</div>
      </div>
      <div class="result-pts ${ptsCls}">${res.pending ? "–" : res.total}</div>`;
    list.appendChild(row);
  }
  return total;
}

async function finishGame() {
  const stats = await loadGwStats(S.game.gw);
  const total = renderResults(S.game, stats);
  const entryId = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const respin = S.game.respin;
  // a signed-in player's first team for the gameweek is the one that counts
  const practice = !respin && !!countedEntry(myEntries(), S.game.gw);

  const entry = {
    id: entryId,
    comp: S.comp,
    label: gwLabel(S.game.gw),
    gw: S.game.gw,
    formation: S.game.formation,
    picks: S.game.slots.map((s) => s.player.id),
    captain: S.game.captain,
    ts: Date.now(),
  };
  if (respin) {
    entry.respinOf = respin.base.id;
    entry.respinSlot = respin.slot;
  }
  const hist = getHistory();
  hist.push({
    id: entryId,
    ts: entry.ts,
    score: total,
    ...entry,
  });
  saveHistory(hist);
  S.game = null;
  show("screen-results");

  // share this team to the leaderboard
  await A.ready;
  const note = document.createElement("div");
  note.className = "submit-note";
  $("results-head").appendChild(note);
  if (!entriesOpen(entry.gw)) {
    note.innerHTML = "Entries had closed for this round, so this is saved as a practice team and isn't on the leaderboard.";
  } else if (practice) {
    note.innerHTML = `You'd already entered your ${escapeHtml(entry.label)} team, and the first one counts, so this is saved as a practice team.`;
  } else if (playerName()) {
    queuePendingSubmit(entry);
    note.textContent = "Submitting to leaderboard…";
    lbSubmit(entry).then((ok) => {
      if (ok) {
        if (respin) setRespinMemo(respin.base.id, null);
        note.innerHTML = respin
          ? `Re-spin used. Your new team is on the leaderboard as <b>${escapeHtml(playerName())}</b>`
          : `On the leaderboard as <b>${escapeHtml(playerName())}</b>`
            + (AUTH_ON && respinEarned(entry) ? `. You entered early, so you have one re-spin until kick-off.` : "");
        if (!$("screen-home").classList.contains("hidden")) renderHome();
      } else {
        renderSubmitRetry(note, entry);
      }
    });
  } else if (AUTH_ON) {
    queuePendingSubmit(entry);
    note.innerHTML = `<button class="nav-btn sel" id="join-board">Sign in to put this team on the leaderboard</button>`;
    $("join-board").addEventListener("click", openSignIn);
  } else {
    note.innerHTML = `<button class="nav-btn" id="join-board">Join the leaderboard</button>`;
    $("join-board").addEventListener("click", () => {
      S.pendingSubmit = entry;
      goBoard();
    });
  }
}

function renderSubmitRetry(note, entry) {
  S.pendingSubmit = entry;
  note.textContent = "Couldn't reach the leaderboard. Your team is saved on this device. ";
  const btn = document.createElement("button");
  btn.className = "nav-btn";
  btn.textContent = "Retry leaderboard submit";
  btn.addEventListener("click", async () => {
    note.textContent = "Submitting to leaderboard…";
    const ok = await lbSubmit(entry);
    if (ok) {
      S.pendingSubmit = null;
      note.innerHTML = `On the leaderboard as <b>${escapeHtml(playerName())}</b>`;
    } else {
      renderSubmitRetry(note, entry);
    }
  });
  note.appendChild(btn);
}

/* ---------------- wire-up ---------------- */

function goHome() {
  renderHome();
  show("screen-home");
  refreshHistoryScores().then((changed) => {
    if (changed && !$("screen-home").classList.contains("hidden")) renderHome();
  }).catch((e) => console.warn("score refresh failed", e));
}
async function goSetup(opts = {}) {
  await A.ready;
  renderSetup({ ...opts, lockedGw: opts.lockedGw || liveRound()?.gw });
  show("screen-setup");
}

async function init() {
  startAuth();
  await loadComp(S.comp);
  renderAccount();
  $("nav-account").addEventListener("click", openSignIn);
  $("board-signin").addEventListener("click", openSignIn);
  $("auth-backdrop").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSignIn();
  });
  $("brand-home").addEventListener("click", goHome);
  $("nav-home").addEventListener("click", goHome);
  $("nav-new").addEventListener("click", () => goSetup());
  $("nav-board").addEventListener("click", goBoard);
  $("nav-howto").addEventListener("click", () => show("screen-howto"));
  $("board-refresh").addEventListener("click", async () => {
    try { await reloadData(); } catch (e) { console.warn("data reload failed", e); }
    renderBoard();
  });
  $("board-name-save").addEventListener("click", async () => {
    const name = $("board-name").value.trim();
    if (!name) return;
    if (AUTH_ON) {
      try { await lbSavePlayerName(name.slice(0, 20)); }
      catch (e) { console.warn("name save failed", e); }
      renderBoard();
      return;
    }
    await lbSavePlayerName(name);
    if (S.pendingSubmit) {
      queuePendingSubmit(S.pendingSubmit);
      S.pendingSubmit = null;
    }
    // (re)submit all locally saved live-round teams under this name
    for (const h of getHistory().filter(entryInSeason)) {
      if (!h.picks) continue;
      queuePendingSubmit({
        id: h.id,
        comp: entryComp(h),
        label: h.label,
        gw: h.gw,
        formation: h.formation,
        picks: h.picks,
        captain: h.captain,
        ts: h.ts,
      });
    }
    await retryPendingSubmits();
    renderBoard();
  });
  $("setup-start").addEventListener("click", startGame);
  $("gate-continue").addEventListener("click", () => {
    const name = $("gate-name").value.trim();
    if (!name) { $("gate-name").focus(); return; }
    localStorage.setItem(NAME_KEY, name);
    renderSetup(S.setupOpts || {});
  });
  $("gate-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("gate-continue").click();
  });
  // keep the live-round countdown fresh while the home screen is visible
  setInterval(() => {
    if (S.core && !$("screen-home").classList.contains("hidden")) renderLiveCard();
  }, 30000);
  // pick up fresh scores (the data is republished every ~10 min during matches)
  setInterval(async () => {
    const onHome = !$("screen-home").classList.contains("hidden");
    const onBoard = !$("screen-board").classList.contains("hidden");
    if (!onHome && !onBoard) return;
    try {
      if (!(await reloadData())) return;
    } catch (e) { console.warn("data reload failed", e); return; }
    if (onHome && !$("screen-home").classList.contains("hidden")) {
      renderHome();                  // no show(): keep the reader's scroll position
      if (await refreshHistoryScores()) renderHome();
    }
    if (onBoard && !$("screen-board").classList.contains("hidden")) renderBoard();
  }, 5 * 60 * 1000);
  $("spin-btn").addEventListener("click", spinWheel);
  $("score-btn").addEventListener("click", finishGame);
  $("abandon-btn").addEventListener("click", () => {
    const msg = S.game?.respin
      ? "Go back? Your re-spin isn't used until you enter the team, and any club you've spun stays the same."
      : "Go back? The picks for this team will be lost.";
    if (confirm(msg)) { S.game = null; goHome(); }
  });
  $("results-again").addEventListener("click", () => goSetup());
  $("results-home").addEventListener("click", goHome);
  $("modal-backdrop").addEventListener("click", (e) => {
    // only allow dismissing by clicking outside when the player can come back
    if (e.target === e.currentTarget && S.game && S.game.currentClub) {
      // reopen automatically — you must pick from this club (or respin if empty)
      openPicker(S.game.currentClub);
    }
  });
  goHome();
}

init();
