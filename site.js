"use strict";
// static checks of the site files: manifest, offline list and every local image or script the pages refer to
const fs = require("fs"), path = require("path");
const { root, ok, section } = require("./helpers");

module.exports = async function () {
  section("site files");
  const read = (f) => fs.readFileSync(path.join(root, f), "utf8"), has = (f) => fs.existsSync(path.join(root, f));
  const m = JSON.parse(read("manifest.webmanifest"));
  ok(m.start_url === "/" && m.display === "standalone" && m.icons.length >= 3, "manifest: installable as a standalone app");
  ok(m.icons.every((i) => has(i.src)), "manifest: all icons exist");
  const fh = m.file_handlers && m.file_handlers[0];
  ok(fh && fh.action.startsWith("/") && Object.values(fh.accept).flat().includes(".enc") && fh.icons.every((i) => has(i.src)), "manifest: .enc is registered as a file type of the app");
  const st = m.share_target, acc = st && st.params.files && st.params.files[0] ? st.params.files[0].accept : [];
  ok(st && st.method === "POST" && st.enctype === "multipart/form-data" && st.action.startsWith("/") && !has(st.action.slice(1)), "manifest: share target takes POST form data at an address only the service worker answers");
  ok(["image/*", "video/*", "audio/*", "text/*", "application/*"].every((t) => acc.includes(t)) && st.params.files[0].name, "manifest: share target accepts photos, video, audio, text and documents");
  ok(read("sw.js").includes('"/share-target"') && read("app.js").includes("takeShared"), "the service worker and the page both handle shared files");
  const assets = [...read("sw.js").split("const ASSETS = [")[1].split("];")[0].matchAll(/"(\/[^"]*)"/g)].map((x) => x[1]);
  const missing = assets.filter((a) => a !== "/" && !has(a.slice(1)));
  ok(missing.length === 0, `offline list: all ${assets.length} files exist${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`);
  for (const page of ["index.html", "how.html"]) {
    const refs = [...read(page).matchAll(/(?:src|href)="([^"#:]+)"/g)].map((x) => x[1]).filter((r) => !/^(https?|mailto)/.test(r) && r !== "./");
    const bad = refs.filter((r) => !has(r));
    ok(bad.length === 0, `${page}: all ${refs.length} local references exist${bad.length ? " (missing: " + bad.join(", ") + ")" : ""}`);
  }
  const notCached = ["app.js", "crypto.js", "sound.js", "qr.js", "argon2.js", "words.js", "style.css"].filter((f) => !assets.includes("/" + f));
  ok(notCached.length === 0, "offline list covers every script and stylesheet of the main page");
};
