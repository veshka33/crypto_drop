"use strict";
// Vault: file format "VSENC2" = header + AES-256-GCM chunks (1 MiB), key from Argon2id (PBKDF2 fallback).
// Legacy "VSENC1" files (PBKDF2, single block) can still be decrypted.
(function (g) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const M1 = enc.encode("VSENC1"), M2 = enc.encode("VSENC2");
  const CHUNK = 1 << 20, TAG = 16, HLEN = 39;
  const ARGON_MEM = 65536, ARGON_ITER = 3, PBKDF2_ITER = 1000000;
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const fail = (m) => { throw new Error(m); };
  const same = (a, m) => m.every((x, i) => a[i] === x);

  async function pbkdf2Key(password, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, 256);
    return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function argonKey(password, salt, mem, iter) {
    if (!g.hashwasm || !g.hashwasm.argon2id) fail("kdf");
    const raw = await g.hashwasm.argon2id({ password, salt, parallelism: 1, iterations: iter, memorySize: mem, hashLength: 32, outputType: "binary" });
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  function header(kdf, a, b, salt, prefix) {
    const h = new Uint8Array(HLEN), v = new DataView(h.buffer);
    h.set(M2, 0); h[6] = kdf; v.setUint32(7, a); v.setUint32(11, b); h.set(salt, 15); h.set(prefix, 31);
    return h;
  }
  function nonce(prefix, i) {
    const n = new Uint8Array(12); n.set(prefix, 0); new DataView(n.buffer).setUint32(8, i); return n;
  }
  function aad(h, last) { const a = new Uint8Array(HLEN + 1); a.set(h, 0); a[HLEN] = last ? 1 : 0; return a; }

  async function seal(plain, password, progress) {
    const salt = rand(16), prefix = rand(8);
    let kdf = 1, a = ARGON_MEM, b = ARGON_ITER, key;
    try { key = await argonKey(password, salt, a, b); }
    catch { kdf = 2; a = PBKDF2_ITER; b = 0; key = await pbkdf2Key(password, salt, a); }
    const h = header(kdf, a, b, salt, prefix), parts = [h], total = plain.size;
    let off = 0, i = 0;
    do {
      const end = Math.min(off + CHUNK, total);
      const buf = await plain.slice(off, end).arrayBuffer();
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i++), additionalData: aad(h, end === total) }, key, buf);
      parts.push(new Uint8Array(ct)); off = end;
      if (progress) progress(total ? off / total : 1);
      await tick();
    } while (off < total);
    return new Blob(parts);
  }

  async function open(src, password, progress) {
    if (src.size < HLEN + TAG) fail("format");
    const h = new Uint8Array(await src.slice(0, HLEN).arrayBuffer()), v = new DataView(h.buffer);
    if (!same(h, M2)) fail("format");
    const kdf = h[6], a = v.getUint32(7), b = v.getUint32(11), salt = h.slice(15, 31), prefix = h.slice(31, 39);
    let key;
    if (kdf === 1) { if (a < 8 || a > 262144 || b < 1 || b > 10) fail("format"); key = await argonKey(password, salt, a, b); }
    else if (kdf === 2) { if (a < 1 || a > 5e6) fail("format"); key = await pbkdf2Key(password, salt, a); }
    else fail("format");
    const parts = [], total = src.size - HLEN;
    let off = HLEN, i = 0;
    while (off < src.size) {
      const end = Math.min(off + CHUNK + TAG, src.size);
      let pt;
      try {
        pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(prefix, i++), additionalData: aad(h, end === src.size) },
          key, await src.slice(off, end).arrayBuffer());
      } catch { fail("bad"); }
      parts.push(new Uint8Array(pt)); off = end;
      if (progress) progress((off - HLEN) / total);
      await tick();
    }
    return new Blob(parts);
  }

  // plaintext container: [kind 0][u16 nameLen][name][data]  or  [kind 1][utf-8 text]
  function wrapFile(name, blob) {
    const nb = enc.encode(name).slice(0, 65535), h = new Uint8Array(3 + nb.length);
    h[1] = nb.length >> 8; h[2] = nb.length & 255; h.set(nb, 3);
    return new Blob([h, blob]);
  }
  async function unwrap(pl) {
    const k = new Uint8Array(await pl.slice(0, 3).arrayBuffer());
    if (k[0] === 1) return { text: dec.decode(await pl.slice(1).arrayBuffer()) };
    const n = (k[1] << 8) | k[2];
    const name = dec.decode(await pl.slice(3, 3 + n).arrayBuffer()) || "decrypted";
    return { blob: pl.slice(3 + n), name };
  }

  const b64 = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const unb64 = (s) => {
    s = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  };

  // minimal ZIP writer (stored, no compression) for several files at once
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  async function crc32(f) {
    let c = 0xFFFFFFFF;
    for (let o = 0; o < f.size; o += 4 << 20) {
      const b = new Uint8Array(await f.slice(o, o + (4 << 20)).arrayBuffer());
      for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const dos = (ms) => {
    const d = new Date(ms || Date.now()), y = Math.max(1980, d.getFullYear());
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  };
  async function zip(files) {
    const parts = [], cd = [], used = new Set();
    let off = 0;
    for (const f of files) {
      let name = f.name, n = 1;
      while (used.has(name)) name = ++n + "_" + f.name;
      used.add(name);
      const nb = enc.encode(name), crc = await crc32(f), { time, date } = dos(f.lastModified);
      const l = new DataView(new ArrayBuffer(30));
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true);
      l.setUint16(10, time, true); l.setUint16(12, date, true); l.setUint32(14, crc, true);
      l.setUint32(18, f.size, true); l.setUint32(22, f.size, true); l.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(l.buffer), nb, f);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.size, true); c.setUint32(24, f.size, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + f.size;
    }
    const size = cd.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)]);
  }

  // legacy VSENC1 (read-only)
  async function decryptV1(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const salt = buf.slice(6, 22), iv = buf.slice(22, 34), ct = buf.slice(34);
    try {
      const key = await pbkdf2Key(password, salt, 600000);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: M1 }, key, ct));
      const n = new DataView(plain.buffer).getUint16(0);
      return { blob: new Blob([plain.slice(2 + n)]), name: dec.decode(plain.slice(2, 2 + n)) || "decrypted" };
    } catch { fail("bad"); }
  }

  async function detect(file) {
    const h = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    return same(h, M2) ? 2 : same(h, M1) ? 1 : 0;
  }

  g.Vault = {
    detect,
    encryptFile: async (f, pw, p) => ({ blob: await seal(wrapFile(f.name, f), pw, p), name: f.name + ".enc" }),
    encryptFiles: async (fs, pw, p) => ({ blob: await seal(wrapFile("files.zip", await zip(fs)), pw, p), name: "files.zip.enc" }),
    encryptText: async (text, pw, p) => {
      const sealed = await seal(new Blob([new Uint8Array([1]), enc.encode(text)]), pw, p);
      return { text: "VS2." + b64(new Uint8Array(await sealed.arrayBuffer())) };
    },
    decrypt: async (src, pw, p) => {
      const d = await detect(src);
      if (d === 1) return decryptV1(src, pw);
      if (d !== 2) fail("format");
      return unwrap(await open(src, pw, p));
    },
    decryptText: async (str, pw, p) => {
      const s = str.trim();
      if (!s.startsWith("VS2.")) fail("format");
      let bytes; try { bytes = unb64(s.slice(4)); } catch { fail("format"); }
      return unwrap(await open(new Blob([bytes]), pw, p));
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
