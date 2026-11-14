"use strict";
(function (g) {
  const MAGIC = new TextEncoder().encode("VSENC1"), SALT = 16, IV = 12, ITER = 600000;
  const AAD = { additionalData: MAGIC };

  async function key(password, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function isEncrypted(file) {
    const head = new Uint8Array(await file.slice(0, MAGIC.length).arrayBuffer());
    return head.length === MAGIC.length && head.every((b, i) => b === MAGIC[i]);
  }

  async function encrypt(file, password) {
    const name = new TextEncoder().encode(file.name).slice(0, 65535);
    const data = new Uint8Array(await file.arrayBuffer());
    const payload = new Uint8Array(2 + name.length + data.length);
    new DataView(payload.buffer).setUint16(0, name.length);
    payload.set(name, 2);
    payload.set(data, 2 + name.length);
    const salt = crypto.getRandomValues(new Uint8Array(SALT));
    const iv = crypto.getRandomValues(new Uint8Array(IV));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, ...AAD }, await key(password, salt), payload));
    const out = new Uint8Array(MAGIC.length + SALT + IV + ct.length);
    out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + SALT);
    out.set(ct, MAGIC.length + SALT + IV);
    return { blob: new Blob([out]), name: file.name + ".enc" };
  }

  async function decrypt(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const salt = buf.slice(MAGIC.length, MAGIC.length + SALT);
    const iv = buf.slice(MAGIC.length + SALT, MAGIC.length + SALT + IV);
    const ct = buf.slice(MAGIC.length + SALT + IV);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, ...AAD }, await key(password, salt), ct));
    const n = new DataView(plain.buffer).getUint16(0);
    const name = new TextDecoder().decode(plain.slice(2, 2 + n)) || "decrypted";
    return { blob: new Blob([plain.slice(2 + n)]), name };
  }

  g.Vault = { isEncrypted, encrypt, decrypt };
})(typeof window !== "undefined" ? window : globalThis);
