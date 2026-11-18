"use strict";
// Network first (so a new deploy shows up right away), cache as the offline fallback.
// Also receives files shared from other apps (Android "Share" -> crypto_drop): they wait in a private cache
// only until the page picks them up (and anything older than an hour is thrown away).
const CACHE = "crypto-drop-v5", SHARE = "crypto-drop-share";
const ASSETS = ["/", "/index.html", "/style.css", "/app.js", "/crypto.js", "/argon2.js", "/words.js", "/sound.js", "/qr.js", "/how.html", "/how.css", "/how.js",
  "/manifest.webmanifest", "/assets/eyes.jpg", "/assets/hand.jpg", "/assets/fist.jpg", "/assets/hands.png", "/assets/lighter.png",
  "/assets/icon-192.png", "/assets/icon-512.png", "/assets/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(Promise.all([
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k)))),
    sweepShared()
  ]).then(() => self.clients.claim()));
});

async function sweepShared() {
  const cache = await caches.open(SHARE);
  for (const req of await cache.keys()) {
    const m = /\/shared\/(\d+)-/.exec(req.url);
    if (!m || Date.now() - Number(m[1]) > 3600 * 1000) await cache.delete(req);
  }
}
async function receiveShare(request) {
  try {
    const fd = await request.formData();
    await sweepShared();
    const cache = await caches.open(SHARE), stamp = Date.now();
    let i = 0;
    for (const f of fd.getAll("files")) {
      if (typeof f === "string") continue;
      await cache.put(new Request("/shared/" + stamp + "-" + i++), new Response(f, {
        headers: { "Content-Type": f.type || "application/octet-stream", "X-Kind": "file", "X-Name": encodeURIComponent(f.name || "shared") }
      }));
    }
    // on Android the link usually arrives in "text" (sometimes in "title"), "url" is mostly empty
    const text = ["text", "url", "title"].map((k) => fd.get(k)).find((v) => typeof v === "string" && v.trim());
    if (text) await cache.put(new Request("/shared/" + stamp + "-text"), new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Kind": "text" } }));
    return Response.redirect("/?shared=" + stamp, 303);
  } catch {
    return Response.redirect("/", 303);
  }
}

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === "POST" && u.origin === location.origin && u.pathname === "/share-target") { e.respondWith(receiveShare(e.request)); return; }
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});
