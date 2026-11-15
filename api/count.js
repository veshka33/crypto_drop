"use strict";
const crypto = require("crypto");

// Vercel injects one of these pairs when a Redis (Upstash) database is connected.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = "files_encrypted";

// How the counter is protected (the server cannot see that a file was really encrypted,
// so the goal is to make faking it slow and bounded):
//  1. the page asks for a signed one-time ticket when a file is dropped (GET ?challenge=1)
//  2. after encrypting it sends the ticket back (POST); the ticket must be at least MIN_AGE seconds old
//     (a real drop-password-encrypt takes longer), at most MAX_AGE old, signed by us and never used before
//  3. per-IP and global limits cap how fast the number can grow
const MIN_AGE = 4, MAX_AGE = 1800;
const LIMITS = { ticketsHour: 60, ipHour: 10, ipDay: 30, allMinute: 40, allHour: 600 };

const sign = (s) => crypto.createHmac("sha256", "counter-v1:" + TOKEN).update(s).digest("hex").slice(0, 32);

async function pipe(cmds) {
  const r = await fetch(URL_.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).map((x) => x.result);
}
const redis = async (...cmd) => (await pipe([cmd]))[0];
const bump = (key, ttl) => [["SET", key, "0", "EX", String(ttl), "NX"], ["INCR", key]];   // -> [_, count]

module.exports = async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    const now = Math.floor(Date.now() / 1000);
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
    const ipId = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);   // IPs are stored hashed

    if (req.method === "GET") {
      if (new URL(req.url || "/", "http://x").searchParams.has("challenge")) {
        res.setHeader("Cache-Control", "no-store");
        const n = (await pipe(bump("rt:" + ipId, 3600)))[1];
        if (n > LIMITS.ticketsHour) return res.status(429).json({ error: "too many requests" });
        const body = now + "." + crypto.randomBytes(8).toString("hex");
        return res.status(200).json({ token: body + "." + sign(body) });
      }
      const count = Number(await redis("GET", KEY)) || 0;
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      return res.status(200).json({ count });
    }

    if (req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" });
      let b = req.body;
      if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
      const [ts, id, sig] = String((b && b.token) || "").split(".");
      if (!/^\d{9,11}$/.test(ts || "") || !/^[0-9a-f]{16}$/.test(id || "") || !/^[0-9a-f]{32}$/.test(sig || "")) return res.status(400).json({ error: "bad ticket" });
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(ts + "." + id)))) return res.status(400).json({ error: "bad ticket" });
      const age = now - Number(ts);
      if (age < MIN_AGE) return res.status(400).json({ error: "too fast" });
      if (age > MAX_AGE) return res.status(400).json({ error: "expired" });
      if ((await redis("SET", "used:" + id, "1", "EX", String(MAX_AGE + 60), "NX")) !== "OK") return res.status(409).json({ error: "already used" });
      const r = await pipe([...bump("rh:" + ipId, 3600), ...bump("rd:" + ipId, 86400),
        ...bump("gm:" + Math.floor(now / 60), 120), ...bump("gh:" + Math.floor(now / 3600), 7200)]);
      if (r[1] > LIMITS.ipHour || r[3] > LIMITS.ipDay || r[5] > LIMITS.allMinute || r[7] > LIMITS.allHour) {
        res.setHeader("Retry-After", "3600");
        return res.status(429).json({ error: "too many requests" });
      }
      return res.status(200).json({ count: Number(await redis("INCR", KEY)) });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
