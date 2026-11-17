"use strict";
// The whole page in jsdom: drop a file, answer the hand, get a result. Reduced-motion is simulated so the animations are skipped.
const fs = require("fs"), path = require("path"), nodeCrypto = require("crypto").webcrypto;
const { JSDOM, VirtualConsole } = require("jsdom");
const { root, ok, section, sleep, bytes, buf, readZip, makeJpeg } = require("./helpers");

function makeDom({ stream = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x.app/", virtualConsole: new VirtualConsole() });
  const w = dom.window, errs = [], posts = [], blobs = [], picks = [], writes = [], st = { pick: "ok" };
  w.addEventListener("error", (e) => errs.push(e.message)); process.on("unhandledRejection", (e) => errs.push("rejection: " + e));
  w.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) });
  Object.defineProperty(w, "crypto", { value: nodeCrypto, configurable: true });
  for (const k of ["Blob", "File", "TextEncoder", "TextDecoder", "Uint8Array", "Uint16Array", "Uint32Array", "ArrayBuffer", "DataView", "ReadableStream", "TransformStream", "CompressionStream", "DecompressionStream"]) w[k] = globalThis[k];
  w.URL.createObjectURL = (b) => { blobs.push(b); return "blob:fake"; }; w.URL.revokeObjectURL = () => {};
  w.fetch = async (u, o) => { if (o && o.method === "POST") posts.push(o.body); return { ok: true, json: async () => (String(u).includes("challenge") ? { token: "tok" + posts.length } : { count: 7 }) }; };
  w.hashwasm = require(path.join(root, "argon2.js"));
  if (stream) {
    w.__STREAM_MIN = 1;
    w.showSaveFilePicker = async (o) => {
      picks.push(o.suggestedName);
      if (st.pick === "abort") throw Object.assign(new Error("x"), { name: "AbortError" });
      if (st.pick === "needs-click") { st.pick = "ok"; throw Object.assign(new Error("x"), { name: "SecurityError" }); }
      return { name: o.suggestedName, createWritable: async () => ({ write: async (u) => { writes.push(Buffer.from(u)); }, close: async () => {}, abort: async () => {} }) };
    };
  }
  for (const f of ["words.js", "crypto.js", "app.js"]) w.eval(fs.readFileSync(path.join(root, f), "utf8"));
  const $ = (id) => w.document.getElementById(id);
  const until = async (fn, m) => { for (let i = 0; i < 700; i++) { if (fn()) return; await sleep(25); } throw new Error("timeout: " + m); };
  const api = {
    w, $, errs, posts, blobs, picks, writes, st, until,
    drop: (files) => { const ev = new w.Event("drop", { bubbles: true, cancelable: true }); ev.dataTransfer = { files, types: ["Files"] }; w.dispatchEvent(ev); },
    paste: (text) => { const ev = new w.Event("paste", { bubbles: true, cancelable: true }); ev.clipboardData = { files: [], getData: () => text }; w.dispatchEvent(ev); },
    prompt: (label) => until(() => $("pw").classList.contains("on") && $("say").textContent === label, "prompt: " + label),
    submit: (v) => { if (v !== undefined) $("pw").value = v; $("pw").dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true })); },
    answer: async (label, yes) => { await until(() => $("say").textContent === label && !$("choice").hidden, "question: " + label); $(yes ? "yes" : "no").click(); },
    chooseKey: async (file) => { await until(() => !$("actrow").hidden, "key button"); Object.defineProperty($("keyfile"), "files", { value: [file], configurable: true }); $("keyfile").dispatchEvent(new w.Event("change")); },
    burn: async ({ name, ext }) => {
      await until(() => !$("plate").hidden && $("say").textContent === "burn what should be hidden.", "plate");
      if (name) { $("pname").click(); await until(() => $("pname").classList.contains("done"), "name burnt"); }
      if (ext && !$("pext").hidden) { $("pext").click(); await until(() => $("pext").hidden, "extension burnt"); }
      $("pdone").click(); await until(() => $("plate").hidden, "plate closed");
    },
    result: () => until(() => !$("out").hidden || !$("textout").hidden, "result"),
    idle: () => until(() => w.document.body.dataset.state === "idle" && !$("pw").classList.contains("on"), "idle"),
    say: () => $("say").textContent,
  };
  api.enc = async (files, pw, answers) => {        // answers: [name, ext, key] (null = not asked)
    api.drop(files); await api.prompt("what password?"); api.submit(pw); await api.prompt("again."); api.submit(pw);
    for (const a of answers) { if (Array.isArray(a)) await api.answer(a[0], a[1]); else await api.burn(a); }
  };
  return api;
}
const file = (data, name, type = "") => new File([data], name, { type });

module.exports = async function () {
  // ===== normal mode: results are downloaded
  section("page: files, folders, key file, photos, text");
  const A = makeDom(), { $, w } = A; let encryptions = 0;
  await sleep(150);
  ok($("count").textContent === "files taken: 7" && w.document.documentElement.lang === "en", "counter and language at start");

  const data = Buffer.from("привіт, це тестовий файл");
  await A.enc([file(data, "нотатка.txt")], "correct-horse-battery", [{ name: true, ext: false }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle();
  ok(/^[a-z2-7]{10}\.txt\.enc$/.test($("out").download) && $("out").hasAttribute("href"), "encrypted, name burnt: " + $("out").download);
  ok($("pname").textContent === $("out").download.replace(".txt.enc", "") && $("pname").classList.contains("done"), "the random name shown on the burnt plate is the real file name");
  const enc1 = file(A.blobs.at(-1), $("out").download);

  A.drop([enc1]); await A.prompt("what password?");
  const wrongs = [];
  for (let i = 0; i < 7; i++) {
    A.submit("not-the-password-" + i); await A.until(() => /wrong|that is not it|i can wait|you do not know it|stop/.test($("say").textContent), "wrong reaction " + (i + 1));
    wrongs.push($("say").textContent); await A.prompt("what password?");
  }
  ok(JSON.stringify(wrongs) === JSON.stringify(["wrong.", "that is not it.", "i can wait.", "i can wait.", "you do not know it, do you?", "you do not know it, do you?", "stop."]), "the hand gets less patient: " + wrongs.join(" | "));
  A.submit("correct-horse-battery"); await A.until(() => !$("out").hidden && $("out").download === "нотатка.txt", "decrypted"); await A.idle();
  ok(Buffer.from(await A.blobs.at(-1).arrayBuffer()).equals(data), "decrypted, original name restored");

  await A.enc([file("e", "plan.pdf")], "extension-pass-1234", [{ name: false, ext: true }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle();
  ok($("out").download === "plan.enc" && $("pext").hidden, "extension burnt: plan.pdf -> plan.enc");
  await A.enc([file("n", "keep.pdf")], "nothing-pass-12345", [{ name: false, ext: false }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle();
  ok($("out").download === "keep.pdf.enc", "nothing burnt: keep.pdf -> keep.pdf.enc");

  // several files with a suggested passphrase
  A.drop([file("a", "a.txt"), file("b", "b.txt")]); await A.prompt("what password?");
  $("suggest").click(); const hd = $("hands");
  ok(hd.classList.contains("shown") && w.document.querySelectorAll(".tag").length === 5 && [...w.document.querySelectorAll(".tag")].every((t) => t.textContent.split("\n").length === 6), "hands show 5 hanging passphrases of 6 words");
  w.document.querySelectorAll(".tag")[3].click(); const gen = $("pw").value; ok(!hd.classList.contains("shown") && gen.split("-").length === 6, "picking one fills the field: " + gen);
  A.submit(); await A.burn({ name: false, ext: true }); await A.answer("add a key file?", false); encryptions++;
  await A.result(); await A.idle();
  ok($("out").download === "files.enc" && !$("phrase").hidden && $("phrase").textContent === gen, "several files -> files.enc, passphrase stays on screen");

  // a folder (webkitRelativePath, as a folder picker gives it)
  const mk = (rel, d) => { const f = file(d, rel.split("/").pop()); Object.defineProperty(f, "webkitRelativePath", { value: rel }); return f; };
  await A.enc([mk("docs/a.txt", "A"), mk("docs/sub/b.txt", "BB")], "folder-pass-12345", [{ name: false, ext: false }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle();
  ok($("out").download === "docs.zip.enc", "folder -> docs.zip.enc");
  A.drop([file(A.blobs.at(-1), "docs.zip.enc")]); await A.prompt("what password?"); A.submit("folder-pass-12345");
  await A.until(() => $("out").download === "docs.zip", "zip back"); await A.idle();
  const zf = readZip(Buffer.from(await A.blobs.at(-1).arrayBuffer()));
  ok(zf["docs/a.txt"] + "" === "A" && zf["docs/sub/b.txt"] + "" === "BB", "folder structure is inside the zip");

  // key file
  const key = file(bytes(3000), "key.png"), wrongKey = file(bytes(3000), "other.png");
  A.drop([file("top secret", "k.txt")]); await A.prompt("what password?"); A.submit("keyfile-pass-12345"); await A.prompt("again."); A.submit("keyfile-pass-12345");
  await A.burn({ name: false, ext: false }); await A.answer("add a key file?", true); encryptions++;
  await A.chooseKey(key); await A.result(); await A.idle();
  ok($("out").download === "k.txt.enc", "encrypted with a key file");
  const encK = file(A.blobs.at(-1), "k.txt.enc");
  A.drop([encK]); await A.until(() => $("say").textContent === "this one needs a key file." && !$("actrow").hidden, "asks for the key file"); await A.chooseKey(wrongKey);
  await A.prompt("what password?"); A.submit("keyfile-pass-12345"); await A.until(() => $("say").textContent === "wrong.", "wrong key file refused");
  await A.until(() => $("say").textContent === "this one needs a key file." && !$("actrow").hidden, "asks for the key file again"); await A.chooseKey(key);
  await A.prompt("what password?"); A.submit("keyfile-pass-12345"); await A.until(() => !$("out").hidden && $("out").download === "k.txt", "decrypted with key file"); await A.idle();
  ok(Buffer.from(await A.blobs.at(-1).arrayBuffer()).toString() === "top secret", "password + key file opens the file");

  // photo with hidden data
  await A.enc([file(makeJpeg(), "pic.jpg", "image/jpeg")], "photo-pass-123456", [["strip the hidden data from the photo?", true], { name: false, ext: false }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle();
  A.drop([file(A.blobs.at(-1), "pic.jpg.enc")]); await A.prompt("what password?"); A.submit("photo-pass-123456");
  await A.until(() => !$("out").hidden && $("out").download === "pic.jpg", "photo decrypted"); await A.idle();
  const pj = Buffer.from(await A.blobs.at(-1).arrayBuffer()).toString("latin1");
  ok(!/GPS-SECRET|IPTC-SECRET|private comment/.test(pj) && pj.includes("JFIF"), "the photo came back without gps, iptc and comment");

  // text
  A.paste("секретний текст 🔒"); await A.prompt("what password?"); A.submit("text-pass-phrase-1"); await A.prompt("again."); A.submit("text-pass-phrase-1"); encryptions++;
  await A.until(() => !$("textout").hidden, "text encrypted"); await A.idle();
  const cipher = $("textout").textContent; ok(/^VS3\./.test(cipher), "text -> VS3. string");
  A.paste(cipher); await A.prompt("what password?"); A.submit("text-pass-phrase-1"); await A.until(() => $("textout").textContent === "секретний текст 🔒", "text decrypted"); await A.idle();
  ok(true, "pasted ciphertext decrypts to the original text");

  // share button: text, files, and failures that must not be silent
  const shares = []; let shareMode = "ok";
  Object.defineProperty(w.navigator, "share", { value: async (d) => { shares.push(d); if (shareMode === "denied") throw Object.assign(new Error("x"), { name: "NotAllowedError" }); if (shareMode === "closed") throw Object.assign(new Error("x"), { name: "AbortError" }); }, configurable: true });
  Object.defineProperty(w.navigator, "canShare", { value: (d) => d.files.every((f) => /^(text|image|audio|video)\//.test(f.type) || f.type === "application/pdf"), configurable: true });   // like Chromium: .enc is not shareable as it is
  A.paste("share me"); await A.prompt("what password?"); A.submit("share-pass-1234567"); await A.prompt("again."); A.submit("share-pass-1234567"); encryptions++;
  await A.until(() => !$("textout").hidden && !$("share").hidden, "share offered for text"); await A.idle();
  const shareText = $("textout").textContent;
  $("share").click(); await sleep(50); ok(shares.at(-1) && shares.at(-1).text === shareText, "share: the encrypted text is handed to the system share sheet");
  shareMode = "denied"; $("share").click(); await A.until(() => /sharing failed/.test($("say").textContent), "message after a refused share");
  ok(/tap the text to copy it/.test($("say").textContent), "share refused: the person is told what to do (no silent failure)");
  shareMode = "closed"; const before = $("say").textContent; $("share").click(); await sleep(80); ok($("say").textContent === before, "closing the share sheet is not treated as an error");
  shareMode = "ok"; shares.length = 0;
  await A.enc([file("data for sharing", "note.txt")], "share-pass-1234567", [{ name: false, ext: false }, ["add a key file?", false]]); encryptions++;
  await A.result(); await A.idle(); await A.until(() => !$("share").hidden, "share offered for a file");
  $("share").click(); await sleep(50);
  ok(shares.length === 1 && shares[0].files[0].name === "note.txt.enc.txt" && shares[0].files[0].type === "text/plain", "file share: .enc is not shareable, so it is offered as note.txt.enc.txt (the site still opens it)");
  shareMode = "denied"; $("share").click(); await A.until(() => /cannot share it/.test($("say").textContent), "file share refused message"); ok(true, "file share refused: told to use the file link");

  w.document.querySelector('[data-l="ru"]').click(); ok($("fld").textContent === "папка" && $("say").textContent === "этот браузер не может этим поделиться. используй ссылку на файл.", "language switch updates buttons and the current line");
  ok(A.posts.length === encryptions && A.posts.every((p) => /"token":"tok\d+"/.test(p)), `counter: ${encryptions} encryptions -> ${A.posts.length} tickets sent (decryptions send none)`);
  ok(A.errs.length === 0, "no script errors" + (A.errs.length ? ": " + A.errs[0] : ""));
  w.close();

  // ===== big-file mode: results are streamed to a file chosen with the save dialog
  section("page: big files go straight to disk");
  const B = makeDom({ stream: true }); await sleep(100);
  const big = bytes(5000);
  await B.enc([file(big, "big.bin")], "stream-pass-12345", [{ name: false, ext: false }, ["add a key file?", false]]);
  await B.until(() => !B.$("out").hidden, "saved"); await B.idle();
  ok(B.picks[0] === "big.bin.enc" && !B.$("out").hasAttribute("href") && B.$("out").textContent === "big.bin.enc" && B.$("say").textContent === "here. it is on your disk.", "save dialog asked for big.bin.enc; nothing offered as a download");
  const diskFile = file(Buffer.concat(B.writes), "whatever.enc"); B.writes.length = 0;
  B.drop([diskFile]); await B.prompt("what password?"); B.submit("wrong-password-1");
  await B.until(() => B.$("say").textContent === "wrong.", "wrong"); ok(B.picks.length === 1, "wrong password: no save dialog was opened");
  await B.prompt("what password?"); B.submit("stream-pass-12345"); await B.until(() => B.picks.length === 2 && B.$("say").textContent === "here. it is on your disk.", "decrypted to disk"); await B.idle();
  ok(B.picks[1] === "big.bin" && Buffer.concat(B.writes).equals(Buffer.from(big)), "decrypt: dialog suggested big.bin, the bytes written are identical");
  B.st.pick = "abort";
  await B.enc([file("x", "c.bin")], "stream-pass-12345", [{ name: false, ext: false }, ["add a key file?", false]]);
  await B.until(() => B.$("say").textContent === "never mind.", "cancelled"); await B.idle();
  ok(B.$("say").textContent === "never mind.", "closing the save dialog cancels politely");
  B.st.pick = "needs-click";
  await B.enc([file("y", "d.bin")], "stream-pass-12345", [{ name: false, ext: false }, ["add a key file?", false]]);
  await B.until(() => !B.$("actrow").hidden && B.$("act").textContent === "choose a place", "button appears when the browser wants a click");
  B.$("act").click(); await B.until(() => !B.$("out").hidden && B.$("say").textContent === "here. it is on your disk.", "saved after the click"); await B.idle();
  ok(B.picks.at(-1) === "d.bin.enc", "retry after the click saved d.bin.enc");
  ok(B.errs.length === 0, "no script errors" + (B.errs.length ? ": " + B.errs[0] : ""));
  B.w.close();
};
