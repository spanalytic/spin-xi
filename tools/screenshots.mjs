// Screenshots of the site with sample teams, for reviewing design changes.
// Usage: node tools/screenshots.mjs <base-url> <out-dir>
// The leaderboard service is mocked with sample players so nothing is written to it.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://localhost:8317/";
const out = process.argv[3] || "preview";
fs.mkdirSync(out, { recursive: true });

const core = JSON.parse(fs.readFileSync("web/data/epl2627/core.json", "utf8"));
const app = fs.readFileSync("web/app.js", "utf8");
const FORMATIONS = eval("(" + app.match(/const FORMATIONS = (\{[\s\S]*?\n\});/)[1] + ")");
const ROLE_CAT = { GK: 1, LB: 2, RB: 2, CB: 2 };
const catOf = (role) => ROLE_CAT[role] || (["LW", "RW", "ST"].includes(role) ? 4 : 3);

const finished = core.events.filter((e) => e.finished);
const gw = finished[finished.length - 1].gw;
const deadline = new Date(core.events.find((e) => e.gw === gw).deadline).getTime();
const stats = JSON.parse(fs.readFileSync(`web/data/epl2627/gw${gw}.json`, "utf8"));
const byType = {};
for (const p of core.players) if (stats[p.id]) (byType[p.type] ||= []).push(p);
for (const l of Object.values(byType)) l.sort((a, b) => b.pts - a.pts);

function team(formation, seed) {
  const used = new Set();
  let k = seed;
  const picks = FORMATIONS[formation].map(([role]) => {
    const pool = byType[catOf(role)].filter((p) => !used.has(p.id));
    const p = pool[(k = (k * 7 + 3) % Math.min(pool.length, 25))];
    used.add(p.id);
    return p.id;
  });
  return picks;
}
function entry(formation, seed, mins) {
  const picks = team(formation, seed);
  return { id: `sample-${seed}`, comp: "epl2627", label: `GW ${gw}`, gw, formation,
           picks, captain: picks[picks.length - 1], ts: deadline - mins * 60000 };
}
const sample = {
  thomas: { name: "Thomas", entries: [entry("4-3-3", 1, 90)] },
  alex: { name: "Alex", entries: [entry("3-5-2", 2, 300)] },
  sam: { name: "Sam", entries: [entry("4-4-2", 3, 200)] },
  jordan: { name: "Jordan", entries: [entry("5-3-2", 4, 120)] },
};
const history = [
  { ...sample.thomas.entries[0], score: 0 },
  { ...entry("3-4-3", 5, 60), id: "sample-5", score: 0 },
];

async function shoot(browser, name, viewport, steps) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.route("https://textdb.online/**", (route) => {
    const url = route.request().url();
    if (url.includes("/update")) return route.fulfill({ body: '{"status":1}' });
    const key = url.split("_").slice(2).join("_");
    if (key === "members") return route.fulfill({ body: JSON.stringify(Object.keys(sample)) });
    const rec = sample[key.replace(/^p_/, "")];
    return route.fulfill({ body: rec ? JSON.stringify(rec) : "" });
  });
  await ctx.addInitScript(([hist]) => {
    localStorage.setItem("spinxi_player_name", "Thomas");
    localStorage.setItem("spinxi_player_slug", "thomas");
    localStorage.setItem("spinxi_history_v1", hist);
  }, [JSON.stringify(history)]);
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await steps(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  console.log("saved", name);
  await ctx.close();
}

const desktop = { width: 1280, height: 860 };
const phone = { width: 390, height: 844 };
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
await shoot(browser, "1-home", desktop, async () => {});
await shoot(browser, "2-team-view", desktop, async (p) => { await p.click(".history-row"); });
await shoot(browser, "3-leaderboard", desktop, async (p) => {
  await p.click("#nav-board"); await p.waitForSelector(".board-row", { timeout: 15000 });
});
await shoot(browser, "4-setup", desktop, async (p) => {
  await p.click("#nav-new"); await p.click(".form-card");
});
await shoot(browser, "5-picking", desktop, async (p) => {
  await p.click("#nav-new"); await p.click(".form-card"); await p.click("#setup-start");
  for (let i = 0; i < 6; i++) {
    await p.click("#spin-btn");
    await p.waitForSelector("#modal-backdrop:not(.hidden)", { timeout: 10000 });
    const pick = await p.$(".player-row.pickable");
    if (pick && i < 5) await pick.click();
    else if (!pick) await p.click("#respin-btn").catch(() => {});
  }
});
await shoot(browser, "6-phone-team-view", phone, async (p) => { await p.click(".history-row"); });
await shoot(browser, "7-phone-home", phone, async () => {});
await browser.close();
