"use strict";
// Vault. Format "VSENC3": 40-byte header + AES-256-GCM chunks of 1 MiB (streamed, so big files do not need memory).
// Key = Argon2id(password [+ SHA-256 of an optional key file]); PBKDF2 is only a fallback.
// Older "VSENC2" and "VSENC1" files can still be decrypted.
(function (g) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const M1 = enc.encode("VSENC1"), M2 = enc.encode("VSENC2"), M3 = enc.encode("VSENC3");
  const CHUNK = 1 << 20, TAG = 16;
  const ARGON_MEM = 65536, ARGON_ITER = 3, PBKDF2_ITER = 1000000;
  const F_KEY = 1, F_GZ = 2;
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const fail = (m) => { throw new Error(m); };
  const same = (a, m) => a.length >= m.length && m.every((x, i) => a[i] === x);
  const HAS_GZ = typeof CompressionStream === "function" && typeof DecompressionStream === "function";
  const NO_GZ = /\.(zip|rar|7z|gz|tgz|bz2|xz|zst|jpe?g|png|gif|webp|avif|heic|heif|mp3|m4a|aac|ogg|opus|flac|mp4|m4v|mov|mkv|webm|avi|docx|xlsx|pptx|odt|ods|odp|epub|apk|jar|pdf|enc)$/i;
  const shouldCompress = (name) => HAS_GZ && !NO_GZ.test(name);

  // ---- keys
  function secretOf(password, digest) {
    const pw = enc.encode(password);
    if (!digest) return pw;
    const o = new Uint8Array(pw.length + 33); o.set(pw); o.set(digest, pw.length + 1);   // 0x00 separator, then SHA-256 of the key file
    return o;
  }
  async function pbkdf2Key(secret, salt, iter) {
    const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, 256);
    return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function argonKey(secret, salt, mem, iter) {
    if (!g.hashwasm || !g.hashwasm.argon2id) fail("kdf");
    const raw = await g.hashwasm.argon2id({ password: secret, salt, parallelism: 1, iterations: iter, memorySize: mem, hashLength: 32, outputType: "binary" });
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  async function keyDigest(file) {
    if (file.size > 64 * 1024 * 1024) fail("format");
    return new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  }

  // ---- header
  function header3(flags, kdf, a, b, salt, prefix) {
    const h = new Uint8Array(40), v = new DataView(h.buffer);
    h.set(M3, 0); h[6] = flags; h[7] = kdf; v.setUint32(8, a); v.setUint32(12, b); h.set(salt, 16); h.set(prefix, 32);
    return h;
  }
  function parseHeader(h) {
    const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
    if (same(h, M3) && h.length >= 40) return { ver: 3, hlen: 40, flags: h[6], kdf: h[7], a: v.getUint32(8), b: v.getUint32(12), salt: h.slice(16, 32), prefix: h.slice(32, 40) };
    if (same(h, M2) && h.length >= 39) return { ver: 2, hlen: 39, flags: 0, kdf: h[6], a: v.getUint32(7), b: v.getUint32(11), salt: h.slice(15, 31), prefix: h.slice(31, 39) };
    return null;
  }
  const nonce = (prefix, i) => { const n = new Uint8Array(12); n.set(prefix, 0); new DataView(n.buffer).setUint32(8, i); return n; };
  const aad = (h, last) => { const a = new Uint8Array(h.length + 1); a.set(h, 0); a[h.length] = last ? 1 : 0; return a; };

  // ---- streams
  async function* chunks(stream, size) {       // re-chunk a byte stream; the last chunk is flagged
    const reader = stream.getReader();
    let cur = new Uint8Array(size), n = 0, prev = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (let off = 0; off < value.length;) {
        const take = Math.min(size - n, value.length - off);
        cur.set(value.subarray(off, off + take), n); n += take; off += take;
        if (n === size) { if (prev) yield { buf: prev, last: false }; prev = cur; cur = new Uint8Array(size); n = 0; }
      }
    }
    if (n > 0 || !prev) { if (prev) yield { buf: prev, last: false }; yield { buf: cur.subarray(0, n), last: true }; }
    else yield { buf: prev, last: true };
  }
  function joinStream(head, rest) {
    const r = rest.getReader(); let sent = false;
    return new ReadableStream({ async pull(c) {
      if (!sent) { sent = true; c.enqueue(head); return; }
      const { value, done } = await r.read();
      if (done) c.close(); else c.enqueue(value);
    } });
  }
  const counted = (stream, cb) => { let n = 0; return stream.pipeThrough(new TransformStream({ transform(ch, c) { n += ch.length; cb(n); c.enqueue(ch); } })); };
  const memSink = () => { const parts = []; return { write: async (u) => { parts.push(u); }, close: async () => {}, blob: () => new Blob(parts) }; };

  async function seal(containerStream, secret, flags, sink) {
    const salt = rand(16), prefix = rand(8);
    let kdf = 1, a = ARGON_MEM, b = ARGON_ITER, key;
    try { key = await argonKey(secret, salt, a, b); }
    catch { kdf = 2; a = PBKDF2_ITER; b = 0; key = await pbkdf2Key(secret, salt, a); }
    const h = header3(flags, kdf, a, b, salt, prefix);
    await sink.write(h);
    let i = 0;
    for await (const { buf, last } of chunks(containerStream, CHUNK)) {
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(prefix, i++), additionalData: aad(h, last) }, key, buf);
      await sink.write(new Uint8Array(ct));
    }
    await sink.close();
  }

  // plaintext container: [0][u16 nameLen][name][data, gzip if F_GZ]   or   [1][utf-8 text]
  async function encryptBlob(name, blob, pw, progress, o) {
    const nb = enc.encode(name).slice(0, 65535), head = new Uint8Array(3 + nb.length);
    head[1] = nb.length >> 8; head[2] = nb.length & 255; head.set(nb, 3);
    const gz = HAS_GZ && o.compress !== false && (o.forceCompress || shouldCompress(name));
    let data = counted(blob.stream(), (n) => progress && progress(Math.min(n / (blob.size || 1), 0.99)));
    if (gz) data = data.pipeThrough(new CompressionStream("gzip"));
    const sink = o.sink || memSink();
    try { await seal(joinStream(head, data), secretOf(pw, o.keyDigest), (o.keyDigest ? F_KEY : 0) | (gz ? F_GZ : 0), sink); }
    catch (e) { if (sink.abort) await sink.abort(); throw e; }
    if (progress) progress(1);
    return o.sink ? { saved: true, name: outerName(name, o) } : { blob: sink.blob(), name: outerName(name, o) };
  }

  async function decrypt(src, pw, progress, o = {}) {
    const head = new Uint8Array(await src.slice(0, 40).arrayBuffer());
    if (same(head, M1)) return decryptV1(src, pw);
    const p = parseHeader(head);
    if (!p || src.size < p.hlen + TAG) fail("format");
    if ((p.flags & F_KEY) && !o.keyDigest) fail("keyfile");
    let key;
    const secret = secretOf(pw, p.flags & F_KEY ? o.keyDigest : null);
    if (p.kdf === 1) { if (p.a < 8 || p.a > 262144 || p.b < 1 || p.b > 10) fail("format"); key = await argonKey(secret, p.salt, p.a, p.b); }
    else if (p.kdf === 2) { if (p.a < 1 || p.a > 5e6) fail("format"); key = await pbkdf2Key(secret, p.salt, p.a); }
    else fail("format");
    const h = head.subarray(0, p.hlen), total = src.size - p.hlen;
    let off = p.hlen, i = 0;
    async function* plain() {
      while (off < src.size) {
        const end = Math.min(off + CHUNK + TAG, src.size);
        let pt;
        try {
          pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce(p.prefix, i++), additionalData: aad(h, end === src.size) },
            key, await src.slice(off, end).arrayBuffer()));
        } catch { fail("bad"); }
        off = end; if (progress) progress((off - p.hlen) / total);
        yield pt;
      }
    }
    const gen = plain(), c0 = (await gen.next()).value;      // a wrong password fails here, before anything is written
    if (c0[0] === 1) {
      const parts = [c0.subarray(1)];
      for await (const c of gen) parts.push(c);
      return { text: dec.decode(await new Blob(parts).arrayBuffer()) };
    }
    const nl = (c0[1] << 8) | c0[2];
    if (c0.length < 3 + nl) fail("format");
    const name = dec.decode(c0.subarray(3, 3 + nl)) || "decrypted";
    const sink = (o.getSink && (await o.getSink({ name }))) || memSink();
    let data = new ReadableStream({
      start(c) { c.enqueue(c0.subarray(3 + nl)); },
      async pull(c) { const r = await gen.next(); if (r.done) c.close(); else c.enqueue(r.value); }
    });
    if (p.flags & F_GZ) data = data.pipeThrough(new DecompressionStream("gzip"));
    try {
      const reader = data.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; await sink.write(value); }
      await sink.close();
    } catch (e) { if (sink.abort) await sink.abort(); throw e; }
    return sink.blob ? { blob: sink.blob(), name } : { saved: true, name };
  }

  // ---- names
  function splitName(name) {
    const m = /^(.+?)((?:\.tar)?\.[^.\s]{1,10})$/i.exec(name);
    return m ? { base: m[1], ext: m[2] } : { base: name, ext: "" };
  }
  const randomName = () => Array.from(rand(10), (v) => "abcdefghijklmnopqrstuvwxyz234567"[v & 31]).join("");
  function outerName(name, o = {}) {
    const { base, ext } = splitName(name);
    return (o.hideName ? randomName() : base) + (o.hideExt ? "" : ext) + ".enc";
  }

  // ---- zip (stored, no compression) for several files or a folder; entries: [{file, path}]
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
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
  const cleanPath = (p) => p.split(/[\\/]+/).filter((s) => s && s !== "." && s !== "..").join("/") || "file";
  async function zip(entries) {
    if (entries.length > 65535) fail("toobig");
    const parts = [], cd = [], used = new Set();
    let off = 0;
    for (const { file: f, path } of entries) {
      let name = cleanPath(path || f.name), n = 1;
      while (used.has(name)) { const s = splitName(cleanPath(path || f.name)); name = s.base + " (" + (++n) + ")" + s.ext; }
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
      if (off > 0xFFFF0000) fail("toobig");
    }
    const size = cd.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
    e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)]);
  }

  // ---- strip hidden data from photos (lossless: only metadata blocks are removed)
  function exifOrientation(seg) {           // seg = whole APP1 segment incl. marker; returns 1..8 or 0
    if (seg.length < 22 || String.fromCharCode(...seg.subarray(4, 8)) !== "Exif") return 0;
    const le = seg[10] === 0x49, r16 = (o) => (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
    const r32 = (o) => (le ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0 : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0);
    const ifd = 10 + r32(14);
    if (ifd + 2 > seg.length) return 0;
    for (let k = 0, n = r16(ifd); k < n; k++) {
      const e = ifd + 2 + 12 * k;
      if (e + 12 > seg.length) return 0;
      if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  }
  const orientationSegment = (o) => new Uint8Array([0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 42, 0, 0, 0, 8,
    0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0]);
  function stripJpeg(u) {
    const parts = [u.subarray(0, 2)];
    let i = 2, removed = 0, kept = false;
    while (i + 4 <= u.length && u[i] === 0xFF) {
      const m = u[i + 1];
      if (m === 0xDA || m === 0xD9) break;
      if (m === 0xFF) { i++; continue; }
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { parts.push(u.subarray(i, i + 2)); i += 2; continue; }
      const len = (u[i + 2] << 8) | u[i + 3];
      if (len < 2 || i + 2 + len > u.length) break;
      const seg = u.subarray(i, i + 2 + len);
      const icc = String.fromCharCode(...seg.subarray(4, 15)) === "ICC_PROFILE";
      const drop = m === 0xE1 || m === 0xFE || (m === 0xE2 && !icc) || (m >= 0xE3 && m <= 0xED);   // keep JFIF (E0), ICC (E2), Adobe (EE)
      if (!drop) parts.push(seg);
      else {
        const o = m === 0xE1 && !kept ? exifOrientation(seg) : 0;     // keep only the rotation, or phone photos turn sideways
        if (o > 1) { const s = orientationSegment(o); parts.push(s); kept = true; removed += seg.length - s.length; }
        else removed += seg.length;
      }
      i += 2 + len;
    }
    parts.push(u.subarray(i));
    return { parts, removed };
  }
  function stripPng(u) {
    const parts = [u.subarray(0, 8)], drop = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
    let i = 8, removed = 0;
    while (i + 12 <= u.length) {
      const len = ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0, end = i + 12 + len;
      if (end > u.length) break;
      const type = String.fromCharCode(u[i + 4], u[i + 5], u[i + 6], u[i + 7]);
      if (drop.has(type)) removed += end - i; else parts.push(u.subarray(i, end));
      i = end;
      if (type === "IEND") break;
    }
    parts.push(u.subarray(i));
    return { parts, removed };
  }
  async function stripMeta(file) {            // -> { blob, removed } or null when there is nothing to strip
    if (file.size > 200 * 1024 * 1024) return null;
    const u = new Uint8Array(await file.arrayBuffer());
    let r = null;
    if (u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) r = stripJpeg(u);
    else if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47) r = stripPng(u);
    return r && r.removed > 0 ? { blob: new Blob(r.parts, { type: file.type }), removed: r.removed } : null;
  }

  // ---- legacy VSENC1 (read-only)
  async function decryptV1(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const salt = buf.slice(6, 22), iv = buf.slice(22, 34), ct = buf.slice(34);
    try {
      const key = await pbkdf2Key(enc.encode(password), salt, 600000);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: M1 }, key, ct));
      const n = new DataView(plain.buffer).getUint16(0);
      return { blob: new Blob([plain.slice(2 + n)]), name: dec.decode(plain.slice(2, 2 + n)) || "decrypted" };
    } catch { fail("bad"); }
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

  async function inspect(file) {
    const h = new Uint8Array(await file.slice(0, 40).arrayBuffer());
    if (same(h, M1)) return { ver: 1, keyfile: false };
    const p = parseHeader(h);
    return p ? { ver: p.ver, keyfile: !!(p.flags & F_KEY) } : { ver: 0, keyfile: false };
  }

  g.Vault = {
    inspect, detect: async (f) => (await inspect(f)).ver,
    keyDigest, splitName, outerName, stripMeta, shouldCompress,
    encryptFile: (f, pw, p, o = {}) => encryptBlob(f.name, f, pw, p, o),
    encryptFiles: async (entries, pw, p, o = {}) => encryptBlob((o.archiveName || "files") + ".zip", await zip(entries), pw, p, { ...o, forceCompress: true }),
    encryptText: async (text, pw) => {
      const sink = memSink();
      await seal(new Blob([new Uint8Array([1]), enc.encode(text)]).stream(), secretOf(pw), 0, sink);
      return { text: "VS3." + b64(new Uint8Array(await sink.blob().arrayBuffer())) };
    },
    decrypt,
    decryptText: async (str, pw, p) => {
      const s = str.trim();
      if (!/^VS[23]\./.test(s)) fail("format");
      let bytes; try { bytes = unb64(s.slice(4)); } catch { fail("format"); }
      return decrypt(new Blob([bytes]), pw, p, {});
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
