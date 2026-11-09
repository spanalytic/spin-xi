// Service worker so Spin XI can be installed as an app (and wrapped for the Play Store).
// It caches nothing, so scores are never stale: pages come straight from the network,
// and a short "you're offline" page is shown when there's no connection.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spin XI</title><body style="margin:0;background:#0b1320;color:#fff;font-family:Inter,Arial,sans-serif;text-align:center;padding:64px 24px">
<h2>You're offline</h2><p style="color:#c9d4df">Spin XI needs a connection for live scores.</p>
<button onclick="location.reload()" style="margin-top:12px;padding:12px 24px;border:0;border-radius:10px;background:#c6f432;font-weight:700;font-size:16px">Try again</button>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() =>
    new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
