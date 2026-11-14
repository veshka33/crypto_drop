"use strict";
const crypto = require("crypto");

// Vercel injects one of these pairs when a Redis (Upstash) database is connected.
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = "files_encrypted";
const LIMIT = 20;      // counted encryptions per IP...
const WINDOW = 3600;   // ...per hour (seconds)

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  if (!r.ok) throw new Error("redis " + r.status);
  return (await r.json()).result;
}

module.exports = async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "storage not connected" });
  try {
    if (req.method === "GET") {
      const count = Number(await redis("GET", KEY)) || 0;
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      return res.status(200).json({ count });
    }
    if (req.method === "POST") {
      res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "forbidden" });
      const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "unknown";
      const rk = "rl:" + crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16); // IP is stored hashed
      await redis("SET", rk, "0", "EX", String(WINDOW), "NX");
      const hits = Number(await redis("INCR", rk));
      if (hits > LIMIT) {
        res.setHeader("Retry-After", String(WINDOW));
        return res.status(429).json({ error: "too many requests" });
      }
      const count = Number(await redis("INCR", KEY));
      return res.status(200).json({ count });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method not allowed" });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
