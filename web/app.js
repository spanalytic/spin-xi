/* ================================================================
   Spin XI — Premier League wheel game (2025/26 season)
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

// no longer selectable, kept so saved teams from history still render
const RETIRED_FORMATIONS = new Set(["4-2-3-1"]);

const CAT_LABEL = { GK: "Goalkeeper", DEF: "Defender", MID: "Midfielder", FWD: "Forward" };
const GOAL_PTS = { GK: 10, DEF: 6, MID: 5, FWD: 4 };
const CS_PTS = { GK: 4, DEF: 4, MID: 1, FWD: 0 };

const COMP_IDS = ["epl", "wc2026"];
const COMP_LABELS = { epl: "Premier League", wc2026: "World Cup 2026" };

const HISTORY_KEY = "spinxi_history_v1";

/* ---------------- state ---------------- */

const S = {
  comp: localStorage.getItem("spinxi_comp") || "epl",
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

/* ---------------- data loading ---------------- */

async function loadComp(comp) {
  if (!S.cores[comp]) {
    const res = await fetch(`data/${comp}/core.json`);
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

function renderCompSwitch() {
  const el = $("comp-switch");
  el.innerHTML = "";
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
    const res = await fetch(`data/${S.comp}/gw${gw}.json`);
    S.gwStatsCache[key] = await res.json();
  }
  return S.gwStatsCache[key];
}

function gwStatsSync(gw) {
  return S.gwStatsCache[`${S.comp}:${gw}`];
}

/* ---------------- scoring engine ---------------- */

// rows: per-fixture stat objects {mp,gs,a,cs,gc,og,ps,pm,yc,rc,sv}; cat: GK/DEF/MID/FWD
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

  add(`Played ${mins} min`, minutesPts);
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
  if (bonus) add(`Bonus points (match top 3)`, bonus);

  return { total, lines };
}

/* ---------------- screens ---------------- */

const SCREENS = ["screen-home", "screen-setup", "screen-game", "screen-results", "screen-board"];
function show(screen) {
  for (const id of SCREENS) $(id).classList.toggle("hidden", id !== screen);
  window.scrollTo(0, 0);
}

/* ---------------- home / history ---------------- */

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}
function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); }

function entryComp(h) { return h.comp || "epl"; }

function liveRound() {
  return S.core.events.find((e) => !e.finished) || null;
}

function fmtDur(ms) {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

function renderLiveCard() {
  const lc = $("live-card");
  const ev = liveRound();
  if (!ev) {
    lc.innerHTML = `
      <div class="live-tag done">SEASON COMPLETE</div>
      <h1>${S.core.season}</h1>
      <p class="live-sub">Every round is in the books — replay any gameweek in practice mode.</p>
      <button class="big-btn" id="live-play">▶ Practice a Gameweek</button>`;
    $("live-play").addEventListener("click", () => goSetup());
    return;
  }
  const dl = new Date(ev.deadline);
  const fmt = dl.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const diff = dl - Date.now();
  const cd = diff > 0 ? `kicks off in ${fmtDur(diff)}` : "round in progress — picks still open";
  const fx = S.core.fixtures.filter((f) => f.gw === ev.gw);
  const fxHtml = fx.map((f) => {
    const h = S.teamsById[f.h], a = S.teamsById[f.a];
    const ko = new Date(f.ko).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const mid = f.hs !== null && f.hs !== undefined ? `<b>${f.hs}–${f["as"]}</b>` : ko;
    return `<div class="lf-row"><span class="lf-team">${h ? h.name : "TBC"}</span><span class="lf-mid">${mid}</span><span class="lf-team away">${a ? a.name : "TBC"}</span></div>`;
  }).join("");
  lc.innerHTML = `
    <div class="live-tag">● LIVE ROUND</div>
    <h1>${ev.name}</h1>
    <div class="deadline">⏰ First kick-off ${fmt} <span class="cd">· ${cd}</span></div>
    <button class="big-btn" id="live-play">▶ PLAY ${(ev.short || "GW " + ev.gw).toUpperCase()}</button>
    <div class="live-fixtures">${fxHtml}</div>`;
  $("live-play").addEventListener("click", () => goSetup({ lockedGw: ev.gw }));
}

function renderHome() {
  renderLiveCard();
  const all = getHistory().slice().sort((x, y) => y.ts - x.ts);
  const hist = all.filter((h) => entryComp(h) === S.comp);

  // total = most recent team per gameweek (current competition only)
  const latestPerGw = {};
  for (const h of hist) {
    if (!latestPerGw[h.gw] || h.ts > latestPerGw[h.gw].ts) latestPerGw[h.gw] = h;
  }
  const gwsPlayed = Object.keys(latestPerGw).length;
  const seasonTotal = Object.values(latestPerGw).reduce((s, h) => s + h.score, 0);
  const best = hist.reduce((m, h) => Math.max(m, h.score), 0);

  $("season-summary").innerHTML = gwsPlayed === 0 ? "" : `
    <div class="stat-card"><div class="num">${seasonTotal}</div><div class="lbl">Total points</div></div>
    <div class="stat-card"><div class="num">${gwsPlayed}</div><div class="lbl">Rounds played</div></div>
    <div class="stat-card"><div class="num">${best}</div><div class="lbl">Best round</div></div>`;

  const list = $("history-list");
  if (all.length === 0) {
    list.innerHTML = `<div class="history-empty">No teams yet — spin up your first XI!</div>`;
    return;
  }
  list.innerHTML = "";
  for (const h of all) {
    const row = document.createElement("div");
    row.className = "history-row" + (entryComp(h) === S.comp ? "" : " othercomp");
    const date = new Date(h.ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    row.innerHTML = `
      <div class="history-gw">${h.label || "GW " + h.gw}</div>
      <div class="history-meta">${COMP_LABELS[entryComp(h)]} &middot; ${h.formation} &middot; picked ${date}</div>
      <div class="history-score">${h.score} pts</div>
      <button class="history-del" title="Delete">✕</button>`;
    row.addEventListener("click", () => viewHistoryEntry(h));
    row.querySelector(".history-del").addEventListener("click", (e) => {
      e.stopPropagation();
      saveHistory(getHistory().filter((x) => x.id !== h.id));
      renderHome();
    });
    list.appendChild(row);
  }
}

async function viewHistoryEntry(h) {
  if (entryComp(h) !== S.comp) await loadComp(entryComp(h));
  const stats = await loadGwStats(h.gw);
  const slots = FORMATIONS[h.formation].map(([role, x, y], i) => ({
    role, x, y, player: S.playersById[h.picks[i]] || null,
  }));
  const total = renderResults({ gw: h.gw, formation: h.formation, slots, captain: h.captain }, stats, { readonly: true });
  // fixtures may have finished since this team was saved — refresh the score
  if (total !== h.score) {
    saveHistory(getHistory().map((x) => (x.id === h.id ? { ...x, score: total } : x)));
  }
  show("screen-results");
}

/* ---------------- setup ---------------- */

function renderSetup(opts = {}) {
  const locked = !!opts.lockedGw;
  S.setup = { gw: opts.lockedGw || null, formation: null };
  $("setup-step-gw").classList.toggle("hidden", locked);
  $("gw-grid").classList.toggle("hidden", locked);
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

async function startGame() {
  const { gw, formation } = S.setup;
  await loadGwStats(gw);
  // the wheel only offers teams that have a fixture in this round
  const inRound = new Set();
  for (const f of S.core.fixtures) {
    if (f.gw === gw && f.h && f.a) { inRound.add(f.h); inRound.add(f.a); }
  }
  let wheelTeams = S.core.teams.filter((t) => inRound.has(t.id));
  if (wheelTeams.length < 2) wheelTeams = S.core.teams;
  S.game = {
    gw, formation,
    slots: FORMATIONS[formation].map(([role, x, y]) => ({ role, x, y, player: null })),
    wheelTeams,
    captain: null,
    currentClub: null,
  };
  S.placing = null;
  $("wheel-result").innerHTML = "Spin to get your first club!";
  $("score-btn").classList.add("hidden");
  $("spin-btn").disabled = false;
  renderPitch();
  renderGameStatus();
  resetSpinner();
  show("screen-game");
}

function pickedIds() {
  return new Set(S.game.slots.filter((s) => s.player).map((s) => s.player.id));
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
    <span class="status-count">${n} / 11 picked</span>`;
  if (n === 11) {
    $("spin-btn").disabled = true;
    if (!S.game.captain) {
      $("score-btn").classList.add("hidden");
      $("wheel-result").innerHTML = `<b>Team complete!</b> Tap a player on the pitch to hand them the captain's armband — their points count double.`;
    } else {
      $("score-btn").classList.remove("hidden");
      $("wheel-result").innerHTML = `<b>${S.playersById[S.game.captain].name}</b> wears the armband. Ready for the final whistle!`;
    }
  }
}

function faceImg(player, cls) {
  const initials = `<div class="face-fallback">${player.name.slice(0, 2).toUpperCase()}</div>`;
  if (!player.img) return initials;
  return `<img class="${cls}" src="${player.img}"
    onerror="this.outerHTML='${initials.replace(/"/g, "&quot;")}'">`;
}

function renderPitch() {
  const pitch = $("pitch");
  pitch.innerHTML = `
    <div class="pen-box bottom"></div><div class="six-box bottom"></div>`;
  for (const slot of S.game.slots) {
    const el = document.createElement("div");
    el.className = "slot" + (slot.player ? " filled" : "");
    el.style.left = slot.x + "%";
    el.style.top = slot.y + "%";
    if (slot.player) {
      const isCap = S.game.captain === slot.player.id;
      el.innerHTML = `
        ${isCap ? '<div class="cap-badge">C</div>' : ""}
        <div class="disc">${faceImg(slot.player, "")}</div>
        <div class="nameplate">${slot.player.name}</div>
        <div class="roleplate">${ROLES[slot.role].cat}</div>`;
      // captain is picked once the XI is complete, then locked in
      if (filledCount() === 11 && !S.game.captain) {
        el.classList.add("cap-select");
        el.addEventListener("click", () => {
          S.game.captain = slot.player.id;
          renderPitch();
          renderGameStatus();
        });
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
  }
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
  box.style.setProperty("--team-color", "#00e5ff");
  const strip = $("reel-strip");
  strip.style.transform = "translateY(0)";
  strip.innerHTML = `<div class="reel-row"></div><div class="reel-row muted">Ready to spin…</div>`;
}

function spinWheel() {
  if (S.wheel.spinning || !S.game || filledCount() === 11) return;
  S.wheel.spinning = true;
  $("spin-btn").disabled = true;
  $("wheel-result").innerHTML = "";

  const teams = wheelTeams();
  const target = teams[Math.floor(Math.random() * teams.length)];
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
    .map((t) => `<div class="reel-row"><span class="dot" style="background:${t.color || "#556"}"></span>${t.name}</div>`)
    .join("");
  strip.style.transform = "translateY(0)";
  box.classList.remove("landed");
  box.classList.add("spinning", "blur");
  box.style.setProperty("--team-color", "#00e5ff");

  // scroll so the winner ends up in the centre band (row 2 of 3 visible)
  const yFinal = (targetIdx - 1) * REEL_ROW_H;
  const dur = 3000;
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
    box.style.setProperty("--team-color", target.color || "#00e5ff");
    const rowEl = strip.children[targetIdx];
    rowEl.innerHTML = `<img class="reel-badge" src="${target.badge || ""}"
      onerror="this.style.display='none'"><b>${target.name}</b>`;
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

function badgeImg(team) {
  const url = team.badge || `https://resources.premierleague.com/premierleague/badges/70/t${team.code}.png`;
  return `<img class="badge" src="${url}" onerror="this.style.display='none'">`;
}

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
    return `<span class="fixt warn">⚠ No fixture in ${gwLabel(gw)} — these players can't score!</span>`;
  }
  const parts = fx.map((f) => {
    const home = f.h === team.id;
    const opp = S.teamsById[home ? f.a : f.h];
    return `${opp ? opp.name : "TBC"} <b>(${home ? "H" : "A"})</b>`;
  });
  const pending = fx.some((f) => f.hs === null || f.hs === undefined);
  return `<span class="fixt">${gwLabel(gw)}: vs ${parts.join(" &amp; vs ")}${pending ? " · ⏳ not played yet" : ""}</span>`;
}

function playsThisGw(p) {
  const stats = S.game ? gwStatsSync(S.game.gw) : null;
  return !!(stats && stats[String(p.id)]);
}

function openPicker(team) {
  const picked = pickedIds();
  const roster = (S.playersByTeam[team.id] || []).filter((p) => !picked.has(p.id));
  // if the fixture hasn't been played yet, we can't know who features
  const pending = teamFixtures(team.id, S.game.gw).some((f) => f.hs === null || f.hs === undefined);
  // players who actually play this gameweek first, then best points-per-game
  const ppgOf = (p) => (p.gp ? p.pts / p.gp : -1);
  const byBest = (a, b) =>
    (pending ? 0 : playsThisGw(b) - playsThisGw(a)) || ppgOf(b) - ppgOf(a);
  const pickable = roster.filter((p) => fittingVacantSlots(p).length > 0).sort(byBest);
  const rest = roster.filter((p) => fittingVacantSlots(p).length === 0).sort(byBest);

  const vacantByCat = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const s of vacantSlots()) vacantByCat[ROLES[s.role].cat]++;
  const needs = Object.entries(vacantByCat)
    .filter(([, n]) => n > 0)
    .map(([cat, n]) => `${n} ${CAT_LABEL[cat].toLowerCase()}${n > 1 ? "s" : ""}`)
    .join(" · ");
  const head = $("picker-head");
  head.innerHTML = `${badgeImg(team)}
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
        <div>😬 <b>${team.name}</b> have no players that fit your remaining positions.</div>
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
  $("modal-backdrop").classList.remove("hidden");
}

function playerRow(p, team, pickable, pending) {
  const fits = fittingVacantSlots(p);
  const row = document.createElement("div");
  row.className = "player-row" + (pickable ? " pickable" : " dim");
  const chips = `<span class="chip${pickable ? " fit" : ""}">${TYPE_CAT[p.type]}</span>`;
  const ppg = p.gp ? (p.pts / p.gp).toFixed(1) : "–";
  const dnp = (pending || playsThisGw(p)) ? "" : `<span class="dnp">Does not play this GW · </span>`;
  row.innerHTML = `
    ${faceImg(p, "face")}
    <div class="player-main">
      <div class="player-name">${p.name}</div>
      <div class="player-sub">${dnp}${p.full !== p.name ? p.full + " · " : ""}${p.mins} mins · ${p.g}G ${p.a}A this season</div>
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

function playerName() { return localStorage.getItem(NAME_KEY) || ""; }
function playerSlug(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}

async function lbRead(key) {
  try {
    const r = await fetch(`${LB.read}${LB.board}_${key}?t=${Date.now()}`, { cache: "no-store" });
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}

async function lbWrite(key, obj) {
  const body = new URLSearchParams();
  body.set("key", `${LB.board}_${key}`);
  body.set("value", JSON.stringify(obj));
  await fetch(LB.write, { method: "POST", body });
}

// submit/replace this player's entry for a round (fire-and-forget safe)
async function lbSubmit(entry) {
  const name = playerName();
  if (!name) return false;
  const slug = playerSlug(name);
  try {
    const mine = (await lbRead(`p_${slug}`)) || { name, entries: [] };
    mine.name = name;
    mine.entries = mine.entries.filter((e) => !(e.comp === entry.comp && e.gw === entry.gw));
    mine.entries.push(entry);
    await lbWrite(`p_${slug}`, mine);
    const members = (await lbRead("members")) || [];
    if (!members.includes(slug)) {
      members.push(slug);
      await lbWrite("members", members);
    }
    return true;
  } catch (e) {
    console.warn("leaderboard submit failed", e);
    return false;
  }
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

async function renderBoard() {
  $("board-name").value = playerName();
  const body = $("board-body");
  body.innerHTML = `<div class="history-empty">Loading leaderboard…</div>`;
  const members = (await lbRead("members")) || [];
  if (members.length === 0) {
    body.innerHTML = `<div class="history-empty">Nobody on the board yet — finish a team to join!</div>`;
    return;
  }
  const playersData = (await Promise.all(members.map((m) => lbRead(`p_${m}`)))).filter(Boolean);

  const rows = [];
  for (const pd of playersData) {
    const entries = (pd.entries || []).filter((e) => e.comp === S.comp);
    if (!entries.length) continue;
    const perGw = [];
    let total = 0, anyPending = false;
    for (const e of entries.sort((a, b) => a.gw - b.gw)) {
      const stats = await loadGwStats(e.gw);
      const sc = computeEntryScore(e, stats);
      perGw.push({ label: e.label || "GW " + e.gw, pts: sc.total, pending: sc.pending });
      total += sc.total;
      anyPending = anyPending || sc.pending;
    }
    rows.push({ name: pd.name, total, perGw, anyPending });
  }
  if (!rows.length) {
    body.innerHTML = `<div class="history-empty">No ${COMP_LABELS[S.comp]} teams on the board yet.</div>`;
    return;
  }
  rows.sort((a, b) => b.total - a.total);
  const me = playerName();
  body.innerHTML = rows.map((r, i) => `
    <div class="board-row${r.name === me ? " me" : ""}">
      <div class="board-rank">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</div>
      <div class="board-player">
        <div class="board-pname">${r.name}</div>
        <div class="board-chips">${r.perGw.map((g) =>
          `<span class="bchip${g.pending ? " pend" : ""}">${g.label}: ${g.pts}${g.pending ? " ⏳" : ""}</span>`).join("")}</div>
      </div>
      <div class="board-total">${r.total}${r.anyPending ? '<span class="board-live">live</span>' : ""}</div>
    </div>`).join("");
}

function goBoard() { renderBoard(); show("screen-board"); }

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

  $("results-head").innerHTML = `
    <div class="total">${total} pts</div>
    <div class="sub">${gwLabel(game.gw)} &middot; <span class="formation-tag">${game.formation}</span>
      ${opts.readonly ? "&middot; saved team" : ""}
      ${stillToPlay ? `&middot; <span class="pending-note">⏳ ${stillToPlay} player${stillToPlay > 1 ? "s" : ""} still to play — score will update</span>` : ""}</div>`;

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
    row.innerHTML = `
      ${p ? faceImg(p, "face") : '<div class="face-fallback">?</div>'}
      <div class="result-main">
        <div class="result-name">${p ? p.name : "(empty)"}${isCap ? ' <span class="cap-tag">C</span>' : ""}</div>
        <div class="result-role">${cat}${p ? " · " + (S.teamsById[p.team]?.short || "") : ""}</div>
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

  const entry = {
    comp: S.comp,
    label: gwLabel(S.game.gw),
    gw: S.game.gw,
    formation: S.game.formation,
    picks: S.game.slots.map((s) => s.player.id),
    captain: S.game.captain,
    ts: Date.now(),
  };
  const hist = getHistory();
  hist.push({
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    ts: entry.ts,
    score: total,
    ...entry,
  });
  saveHistory(hist);
  S.game = null;
  show("screen-results");

  // share to the leaderboard (latest team per round counts)
  const note = document.createElement("div");
  note.className = "submit-note";
  $("results-head").appendChild(note);
  if (playerName()) {
    note.textContent = "Submitting to leaderboard…";
    lbSubmit(entry).then((ok) => {
      note.innerHTML = ok
        ? `✔ On the leaderboard as <b>${playerName()}</b>`
        : "⚠ Leaderboard submit failed — open the leaderboard and try Refresh later";
    });
  } else {
    note.innerHTML = `<button class="nav-btn" id="join-board">🏆 Join the leaderboard</button>`;
    $("join-board").addEventListener("click", () => {
      S.pendingSubmit = entry;
      goBoard();
    });
  }
}

/* ---------------- wire-up ---------------- */

function goHome() { renderHome(); show("screen-home"); }
function goSetup(opts) { renderSetup(opts); show("screen-setup"); }

async function init() {
  await loadComp(S.comp);
  $("brand-home").addEventListener("click", goHome);
  $("nav-home").addEventListener("click", goHome);
  $("nav-new").addEventListener("click", () => goSetup());
  $("nav-board").addEventListener("click", goBoard);
  $("board-refresh").addEventListener("click", renderBoard);
  $("board-name-save").addEventListener("click", async () => {
    const name = $("board-name").value.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    if (S.pendingSubmit) {
      await lbSubmit(S.pendingSubmit);
      S.pendingSubmit = null;
    } else {
      // (re)submit all locally saved teams under this name
      const latest = {};
      for (const h of getHistory()) {
        const k = `${entryComp(h)}|${h.gw}`;
        if (!latest[k] || h.ts > latest[k].ts) latest[k] = h;
      }
      for (const h of Object.values(latest)) {
        if (!h.picks) continue;
        await lbSubmit({ comp: entryComp(h), label: h.label, gw: h.gw, formation: h.formation, picks: h.picks, captain: h.captain, ts: h.ts });
      }
    }
    renderBoard();
  });
  $("setup-start").addEventListener("click", startGame);
  // keep the live-round countdown fresh while the home screen is visible
  setInterval(() => {
    if (S.core && !$("screen-home").classList.contains("hidden")) renderLiveCard();
  }, 30000);
  $("spin-btn").addEventListener("click", spinWheel);
  $("score-btn").addEventListener("click", finishGame);
  $("abandon-btn").addEventListener("click", () => {
    if (confirm("Abandon this team? Your picks will be lost.")) { S.game = null; goHome(); }
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
