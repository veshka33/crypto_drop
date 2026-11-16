"use strict";
const $ = (id) => document.getElementById(id);
const body = document.body, say = $("say"), sr = $("sr"), pw = $("pw"), chip = $("chip"), out = $("out"),
  fileInput = $("file"), dirInput = $("dir"), keyInput = $("keyfile"), hand = $("hand"), eyes = $("eyes"), eyesIn = $("eyesIn"),
  counter = $("count"), suggest = $("suggest"), phrase = $("phrase"), bar = $("bar"), textout = $("textout"),
  extras = $("extras"), shareBtn = $("share"), qrBtn = $("qrbtn"), qrBox = $("qr");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, RM ? Math.min(ms, 80) : ms));
const MIN = 12, MAX_MEM = 500 * 1024 * 1024, MAX_STREAM = 4e9, MAX_FILES = 10000;
const CAN_GEN = Array.isArray(window.WORDS) && window.WORDS.length === 2048;
const CAN_FS = typeof window.showSaveFilePicker === "function";          // Chromium: big files are streamed straight to disk
const streamMin = () => (window.__STREAM_MIN || 128 * 1024 * 1024);
const RE_TEXT = /^VS[23]\./;

const T = {
  en: { hint: "drop files or a folder on the hand, or tap it. text can be pasted.", letgo: "let go.", pass: "what password?",
    short: "too short. twelve characters, at least.", again: "again.", mismatch: "no. from the start.",
    wrong: "wrong.", wrong2: "that is not it.", wrong3: "i can wait.", wrong5: "you do not know it, do you?", wrong7: "stop.",
    here: "here.", hereText: "here. tap to copy.", saved: "here. it is on your disk.", never: "never mind.",
    broke: "something broke. try again.", heavy: "too heavy. 500 MB, at most.", heavy4: "too heavy. 4 GB, at most.",
    many: "too many files.", empty: "there is nothing in there.",
    keep: "keep it. it cannot be recovered. tap to copy.",
    hideName: "hide the name?", hideExt: "hide the extension?", clean: "strip the hidden data from the photo?",
    askKey: "add a key file?", pickKey: "choose it.", needKey: "this one needs a key file.", chooseFile: "choose file", skip: "skip",
    saveWhere: "where should i put it?", chooseSpot: "choose a place",
    yes: "yes", no: "no", suggest: "suggest one", taken: "files taken: ", filesw: "files", textw: "text", share: "share", qr: "qr",
    note: "Your files never leave your browser.", pick: "Choose files to encrypt or decrypt", title: "Drop a file", pwlabel: "Password",
    choose: "Choose a passphrase", sound: "sound", code: "code", info: "info", fld: "folder" },
  uk: { hint: "кидай файли чи теку на руку або торкнись її. текст можна вставити.", letgo: "відпускай.", pass: "який пароль?",
    short: "закороткий. щонайменше дванадцять символів.", again: "ще раз.", mismatch: "ні. спочатку.",
    wrong: "не той.", wrong2: "це не воно.", wrong3: "я почекаю.", wrong5: "ти ж його не знаєш, так?", wrong7: "годі.",
    here: "тримай.", hereText: "тримай. торкнись, щоб скопіювати.", saved: "тримай. воно на диску.", never: "байдуже.",
    broke: "щось зламалось. спробуй ще.", heavy: "надто важкий. не більше 500 МБ.", heavy4: "надто важкий. не більше 4 ГБ.",
    many: "забагато файлів.", empty: "там порожньо.",
    keep: "запам’ятай. відновити не вийде. торкнись, щоб скопіювати.",
    hideName: "сховати ім’я?", hideExt: "сховати розширення?", clean: "прибрати з фото приховані дані?",
    askKey: "додати файл-ключ?", pickKey: "обери його.", needKey: "цьому потрібен файл-ключ.", chooseFile: "обрати файл", skip: "пропустити",
    saveWhere: "куди це покласти?", chooseSpot: "обрати місце",
    yes: "так", no: "ні", suggest: "запропонувати", taken: "файлів забрано: ", filesw: "файлів", textw: "текст", share: "поділитись", qr: "qr",
    note: "Твої файли не залишають браузер.", pick: "Обрати файли для шифрування або розшифрування", title: "Кинь файл", pwlabel: "Пароль",
    choose: "Обери парольну фразу", sound: "звук", code: "код", info: "інфо", fld: "тека" },
  ru: { hint: "бросай файлы или папку на руку или нажми на неё. текст можно вставить.", letgo: "отпускай.", pass: "какой пароль?",
    short: "слишком короткий. минимум двенадцать символов.", again: "ещё раз.", mismatch: "нет. сначала.",
    wrong: "не тот.", wrong2: "это не то.", wrong3: "я подожду.", wrong5: "ты ведь его не знаешь?", wrong7: "хватит.",
    here: "держи.", hereText: "держи. нажми, чтобы скопировать.", saved: "держи. оно на диске.", never: "неважно.",
    broke: "что-то сломалось. попробуй ещё.", heavy: "слишком тяжёлый. не больше 500 МБ.", heavy4: "слишком тяжёлый. не больше 4 ГБ.",
    many: "слишком много файлов.", empty: "там пусто.",
    keep: "запомни. восстановить нельзя. нажми, чтобы скопировать.",
    hideName: "скрыть имя?", hideExt: "скрыть расширение?", clean: "убрать из фото скрытые данные?",
    askKey: "добавить файл-ключ?", pickKey: "выбери его.", needKey: "этому нужен файл-ключ.", chooseFile: "выбрать файл", skip: "пропустить",
    saveWhere: "куда это положить?", chooseSpot: "выбрать место",
    yes: "да", no: "нет", suggest: "предложить", taken: "файлов забрано: ", filesw: "файлов", textw: "текст", share: "поделиться", qr: "qr",
    note: "Твои файлы не покидают браузер.", pick: "Выбрать файлы для шифрования или расшифровки", title: "Брось файл", pwlabel: "Пароль",
    choose: "Выбери парольную фразу", sound: "звук", code: "код", info: "инфо", fld: "папка" }
};
let lang = (() => {
  try { const s = localStorage.getItem("lang"); if (T[s]) return s; } catch {}
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return T[n] ? n : "en";
})();
const t = (k) => T[lang][k];
let busy = false, token = 0, lastUrl = null, depth = 0, shown = null, lastCount = null, idleT = 0, generated = "";
let soundPref = false, shareData = null, qrText = "";
try { soundPref = localStorage.getItem("sound") === "1"; } catch {}

const sfx = (n, ...a) => { try { if (window.Sfx && Sfx[n]) Sfx[n](...a); } catch {} };
const buzz = (p) => { try { if (soundPref && navigator.vibrate) navigator.vibrate(p); } catch {} };   // haptics follow the "sound" switch
const SOUND_AT = { reach: "reach", grab: "grab", gone: "gone", back: "back", throw: "throwIt" };
const setState = (s) => {
  if (body.dataset.state === s) return;
  body.dataset.state = s;
  if (SOUND_AT[s]) sfx(SOUND_AT[s]);
  if (s === "grab") buzz(45); else if (s === "throw") buzz(25);
};
const setMood = (m) => { eyesIn.dataset.mood = m; };
const blink = () => { if (RM || eyesIn.dataset.mood) return; setMood("blink"); setTimeout(() => { if (eyesIn.dataset.mood === "blink") setMood(""); }, 140); };
const lookAt = (cx, cy) => {
  if (RM) return;
  eyes.style.transform = `translate(calc(-50% + ${(cx / innerWidth - 0.5) * 26}px), calc(-50% + ${(cy / innerHeight - 0.5) * 16}px))`;
};
const fmt = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : n < 1073741824 ? (n / 1048576).toFixed(1) + " MB" : (n / 1073741824).toFixed(2) + " GB";

function showCount(n) {
  if (typeof n !== "number") return;
  lastCount = n;
  counter.textContent = t("taken") + n.toLocaleString(lang === "en" ? "en-US" : lang);
  counter.hidden = false;
}
const countCall = (opts) => Promise.resolve().then(() => fetch("/api/count", opts))
  .then((r) => (r.ok ? r.json() : null)).then((d) => d && showCount(d.count)).catch(() => {});
// a signed one-time ticket is requested when a file is dropped and sent back after a real encryption
let ticketP = null;
const getTicket = () => Promise.resolve().then(() => fetch("/api/count?challenge=1", { cache: "no-store" }))
  .then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.token) || null).catch(() => null);
const countUp = async () => {
  const tk = await ticketP; ticketP = null;
  if (tk) countCall({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: tk }) });
};

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("title");
  $("note").textContent = t("note");
  hand.setAttribute("aria-label", t("pick"));
  pw.setAttribute("aria-label", t("pwlabel"));
  suggest.textContent = t("suggest");
  $("hands").setAttribute("aria-label", t("choose"));
  $("yes").textContent = t("yes"); $("no").textContent = t("no"); $("skip").textContent = t("skip");
  $("snd").textContent = t("sound"); $("src").textContent = t("code"); $("info").textContent = t("info"); $("fld").textContent = t("fld");
  shareBtn.textContent = t("share"); qrBtn.textContent = t("qr");
  document.querySelectorAll(".lang button[data-l]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.l === lang)));
  if (lastCount !== null) showCount(lastCount);
  if (!busy && shown) { say.textContent = t(shown); sr.textContent = t(shown); }
}

async function speak(key, dim = false) {
  const my = ++token, text = t(key);
  shown = key; sr.textContent = text;
  if (!dim) sfx("whisper", text.length * 0.1);
  say.className = dim ? "dim" : ""; say.textContent = "";
  if (RM || dim) { say.textContent = text; return; }
  say.classList.add("typing");
  let i = 0;
  for (const ch of text) {
    if (my !== token) return;
    say.textContent += ch;
    if (i++ % 9 === 4) blink();                      // the eyes blink in the rhythm of the typing
    await sleep(70 + Math.random() * 60);
  }
  if (my === token) say.classList.remove("typing");
}

function makeWords() {
  const buf = new Uint16Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (v) => window.WORDS[v & 2047]);   // 2048 = 2^11, so no bias; 6 words = 66 bits
}

// puppeteer hands: [fingertip x, fingertip y, tag top y] in the 1136x639 hands image
const HANDS_ANCHORS = [[96, 374, 690], [316, 559, 700], [646, 234, 680], [846, 571, 705], [1101, 402, 685]];
const handsEl = $("hands");
let handsOpen = false, onPick = null;
const threads = HANDS_ANCHORS.map(([x, y, end], i) => {
  const el = document.createElement("div"), string = document.createElement("i"), tag = document.createElement("button");
  el.className = "thread" + (i === 4 ? " more" : "");
  el.style.left = (x / 1136 * 100) + "%";
  el.style.top = ((y - 10) / 639 * 100) + "%";
  el.style.setProperty("--len", "calc(var(--hw) * " + ((end - y + 10) / 1136).toFixed(4) + ")");
  el.style.setProperty("--d", (-i * 0.9) + "s");
  string.className = "string"; tag.className = "tag"; tag.type = "button";
  el.append(string, tag); handsEl.append(el);
  const th = { tag, words: [] };
  tag.addEventListener("click", () => { if (onPick) onPick(th.words); });
  return th;
});
function openHands(cb) {
  onPick = cb;
  for (const th of threads) {
    th.words = makeWords();
    th.tag.textContent = th.words.join("\n");
    th.tag.setAttribute("aria-label", th.words.join(" "));
  }
  handsEl.classList.add("shown"); body.classList.add("suggesting"); handsOpen = true; sfx("creak");
}
function closeHands() {
  if (!handsOpen) return;
  handsEl.classList.remove("shown"); body.classList.remove("suggesting"); handsOpen = false;
}

function ask(canSuggest) {
  return new Promise((resolve) => {
    pw.value = ""; pw.type = "password"; pw.classList.remove("plain");
    pw.tabIndex = 0; pw.classList.add("on"); pw.focus();
    suggest.hidden = !(canSuggest && CAN_GEN);
    const done = () => {
      closeHands();
      pw.removeEventListener("keydown", onKey); suggest.removeEventListener("click", onSuggest);
      const v = pw.value;
      pw.value = ""; pw.type = "password"; pw.classList.remove("on", "plain"); pw.tabIndex = -1; pw.blur();
      suggest.hidden = true;
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Enter" && pw.value) { e.preventDefault(); done(); } };
    const pick = (words) => { sfx("pluck"); generated = words.join("-"); pw.type = "text"; pw.classList.add("plain"); pw.value = generated; closeHands(); pw.focus(); };
    const onSuggest = () => openHands(pick);
    pw.addEventListener("keydown", onKey); suggest.addEventListener("click", onSuggest);
  });
}

async function getPassword(encrypting) {
  generated = "";
  for (;;) {
    await speak("pass");
    const a = await ask(encrypting);
    if (!encrypting) return a;
    if (a.length < MIN) { await speak("short"); await sleep(900); continue; }
    if (a === generated) {
      phrase.textContent = a; phrase.hidden = false;
      await speak("keep"); await sleep(1500);
      return a;
    }
    await speak("again");
    if (a === await ask(false)) return a;
    sfx("wrong"); await speak("mismatch"); await sleep(900);
  }
}

// ---- questions asked by the hand
async function askYesNo(key) {
  await speak(key);
  const choice = $("choice"), yes = $("yes"), no = $("no");
  choice.hidden = false; yes.focus();
  return new Promise((res) => {
    const done = (v) => { choice.hidden = true; yes.onclick = no.onclick = null; sfx("pluck"); res(v); };
    yes.onclick = () => done(true); no.onclick = () => done(false);
  });
}
// a key file: opened straight from the "yes" click (optional) or from a button (required when decrypting)
function askKeyFile(required) {
  keyInput.value = "";
  speak(required ? "needKey" : "pickKey");
  const row = $("actrow"), act = $("act");
  act.textContent = t("chooseFile"); row.hidden = false; act.focus();
  return new Promise((res) => {
    const end = (f) => { keyInput.removeEventListener("change", onChange); row.hidden = true; act.onclick = $("skip").onclick = null; res(f); };
    const onChange = () => end(keyInput.files[0] || null);
    keyInput.addEventListener("change", onChange);
    act.onclick = () => keyInput.click(); $("skip").onclick = () => end(null);
    if (!required) keyInput.click();
  });
}
async function askOptions(job) {
  const o = { hideName: false, hideExt: false, keyDigest: null, file: null };
  const single = !job.isArchive, first = job.entries[0].file;
  if (single) {
    const r = await Vault.stripMeta(first).catch(() => null);
    if (r && await askYesNo("clean")) o.file = r.blob;
  }
  const probe = single ? first.name : job.archiveName + ".zip";
  o.hideName = await askYesNo("hideName");
  if (Vault.splitName(probe).ext) o.hideExt = await askYesNo("hideExt");
  if (await askYesNo("askKey")) {
    const f = await askKeyFile(false);
    if (f) o.keyDigest = await Vault.keyDigest(f);      // throws if the file is unusable: better to stop than to encrypt without it
  }
  return { ...o, probe };
}
// big files: ask where to put them, then stream there (the picker needs a click, so fall back to a button)
async function pickSink(suggestedName) {
  speak("saveWhere");
  let handle;
  for (;;) {
    try { handle = await window.showSaveFilePicker({ suggestedName }); break; }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      await new Promise((res) => {
        const row = $("actrow"), act = $("act");
        act.textContent = t("chooseSpot"); $("skip").hidden = true; row.hidden = false; act.focus();
        act.onclick = () => { row.hidden = true; $("skip").hidden = false; act.onclick = null; res(); };
      });
    }
  }
  const w = await handle.createWritable();
  return { write: (u) => w.write(u), close: () => w.close(), abort: () => w.abort().catch(() => {}) };
}

function flyIn(el) {
  if (RM || !el.animate) return;
  const r = el.getBoundingClientRect(), h = hand.getBoundingClientRect();
  const dx = h.left + h.width / 2 - (r.left + r.width / 2);
  const dy = h.top + h.height * 0.35 - (r.top + r.height / 2);
  el.animate([
    { transform: `translate(${dx}px,${dy}px) scale(.15) rotate(-18deg)`, opacity: 0 },
    { opacity: 1, offset: 0.25 },
    { transform: "none", opacity: 1 }
  ], { duration: 750, easing: "cubic-bezier(.2,.8,.2,1)" });
}
function download(url, name) {
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

const setP = (p) => { bar.style.setProperty("--p", String(p)); if (p > 0) say.textContent = Math.round(p * 100) + "%"; };
function work(job, pass, decrypting, o) {
  if (job.type === "text") return decrypting ? Vault.decryptText(job.text, pass, setP) : Vault.encryptText(job.text, pass, setP);
  const f0 = job.entries[0].file;
  if (decrypting) return Vault.decrypt(f0, pass, setP, { keyDigest: o.keyDigest, getSink: o.getSink });
  const common = { hideName: o.hideName, hideExt: o.hideExt, keyDigest: o.keyDigest, sink: o.sink };
  if (job.isArchive) return Vault.encryptFiles(job.entries, pass, setP, { ...common, archiveName: job.archiveName });
  return Vault.encryptFile(o.file ? new File([o.file], f0.name, { type: f0.type }) : f0, pass, setP, common);
}
function showExtras(result, encrypted) {
  shareData = null; qrText = ""; shareBtn.hidden = qrBtn.hidden = true; qrBox.hidden = true;
  if (encrypted && navigator.share) {
    if (result.text !== undefined) { shareData = { text: result.text }; }
    else if (result.blob && navigator.canShare) { try { const f = new File([result.blob], result.name); if (navigator.canShare({ files: [f] })) shareData = { files: [f] }; } catch {} }
    shareBtn.hidden = !shareData;
  }
  if (encrypted && result.text !== undefined && result.text.length <= 700 && window.qrcode) { qrText = result.text; qrBtn.hidden = false; }
  extras.hidden = shareBtn.hidden && qrBtn.hidden;
}
function resetOutputs() {
  out.hidden = true; phrase.hidden = true; textout.hidden = true; extras.hidden = true; qrBox.hidden = true;
  $("choice").hidden = true; $("actrow").hidden = true;
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
}

async function run(job) {
  if (busy) return;
  const isText = job.type === "text", entries = job.entries || [];
  if (!isText && !entries.length) { await speak("empty"); await sleep(2000); speak("hint", true); return; }
  const size = isText ? job.text.length : entries.reduce((n, e) => n + e.file.size, 0);
  const limit = isText ? 1e6 : CAN_FS ? MAX_STREAM : MAX_MEM;
  if (size > limit || entries.length > MAX_FILES) {
    setState("idle"); setMood("narrow"); await speak(entries.length > MAX_FILES ? "many" : CAN_FS ? "heavy4" : "heavy");
    await sleep(2500); setMood(""); speak("hint", true); return;
  }
  busy = true; resetOutputs();
  let info = { ver: 0, keyfile: false };
  if (!isText && !job.isArchive && entries.length === 1) { try { info = await Vault.inspect(entries[0].file); } catch {} }
  const decrypting = isText ? RE_TEXT.test(job.text.trim()) : info.ver > 0, encrypting = !decrypting;
  ticketP = encrypting ? getTicket() : null;
  token++; shown = null; say.textContent = ""; say.className = ""; sr.textContent = "";

  chip.textContent = isText ? t("textw") + "  " + job.text.length
    : !job.isArchive ? entries[0].file.name + "  " + fmt(size) : entries.length + " " + t("filesw") + "  " + fmt(size);
  chip.className = "chip show";
  setMood("wide"); setState("reach"); await sleep(450);
  setState("grab"); chip.classList.add("eaten"); await sleep(550);
  setState("gone"); setMood(""); await sleep(1500);

  const useFs = !isText && CAN_FS && size >= streamMin();
  const o = { keyDigest: null };
  let result = null, wrongs = 0, asked = false;
  try {
    for (;;) {
      if (decrypting && info.keyfile && !o.keyDigest) {
        const kf = await askKeyFile(true);
        if (!kf) throw new Error("cancel");
        o.keyDigest = await Vault.keyDigest(kf);
      }
      const password = await getPassword(encrypting);
      if (encrypting && !isText && !asked) {
        Object.assign(o, await askOptions(job)); asked = true;
        if (useFs) o.sink = await pickSink(Vault.outerName(o.probe, o));
      }
      if (decrypting && useFs) o.getSink = (meta) => pickSink(meta.name);
      token++; shown = null; say.className = ""; say.textContent = "...";
      bar.style.setProperty("--p", "0"); bar.hidden = false;
      try { result = await work(job, password, decrypting, o); break; }
      catch (e) {
        bar.hidden = true;
        if (!(decrypting && e && e.message === "bad")) throw e;
        wrongs++;                                              // wrong password: the hand gets less patient
        const k = ["wrong", "wrong2", "wrong3", "wrong3", "wrong5", "wrong5", "wrong7"][Math.min(wrongs, 7) - 1];
        setMood(wrongs >= 7 ? "shake" : wrongs >= 5 ? "wide" : "narrow"); sfx("wrong"); if (wrongs >= 5) sfx("grab");
        buzz(wrongs >= 7 ? [120, 60, 120, 60, 220] : [70, 50, 70]);
        await speak(k); await sleep(900); setMood("");
        if (info.keyfile) o.keyDigest = null;
      }
    }
  } catch (e) {
    bar.hidden = true; chip.className = "chip"; $("actrow").hidden = true; $("choice").hidden = true;
    setState("idle");
    await speak(e && (e.name === "AbortError" || e.message === "cancel") ? "never" : "broke");
    busy = false; return;
  }
  bar.hidden = true; chip.className = "chip";

  setState("back"); await sleep(1300);
  setState("throw"); setMood("wide"); await sleep(120);
  if (encrypting) countUp();
  if (result.text !== undefined) {
    textout.textContent = result.text; textout.hidden = false;
    flyIn(textout); speak("hereText");
  } else if (result.saved) {
    out.removeAttribute("href"); out.removeAttribute("download"); out.textContent = result.name; out.hidden = false;
    flyIn(out); speak("saved");
  } else {
    lastUrl = URL.createObjectURL(result.blob);
    out.href = lastUrl; out.download = result.name;
    out.textContent = result.name + "  " + fmt(result.blob.size);
    out.hidden = false;
    flyIn(out); download(lastUrl, result.name); speak("here");
  }
  showExtras(result, encrypting);
  await sleep(500);
  setState("idle");
  busy = false;
  setTimeout(() => setMood(""), 1200);
}

// ---- turning drops, folders and pickers into jobs
function jobFromFiles(fs) {
  const entries = fs.map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
  const dir = entries.some((e) => e.path.includes("/")), tops = new Set(entries.map((e) => e.path.split("/")[0]));
  return { type: "files", entries, isArchive: fs.length > 1 || dir, archiveName: dir && tops.size === 1 ? [...tops][0] : "files" };
}
const readAll = (reader) => new Promise((res, rej) => {
  const all = [];
  const next = () => reader.readEntries((b) => { if (!b.length) res(all); else { all.push(...b); next(); } }, rej);
  next();
});
async function walk(entry, outList) {
  if (outList.length > MAX_FILES) return;
  if (entry.isFile) outList.push({ file: await new Promise((res, rej) => entry.file(res, rej)), path: entry.fullPath.replace(/^\//, "") });
  else if (entry.isDirectory) for (const c of await readAll(entry.createReader())) await walk(c, outList);
}
async function jobFromEntries(list) {
  const entries = [];
  for (const en of list) if (en) await walk(en, entries);
  const tops = list.filter(Boolean);
  return { type: "files", entries, isArchive: true, archiveName: tops.length === 1 && tops[0].isDirectory ? tops[0].name : "files" };
}

function wake() {
  clearTimeout(idleT);
  if (eyesIn.dataset.mood === "sleep") setMood("");
  idleT = setTimeout(() => { if (!busy && !eyesIn.dataset.mood) setMood("sleep"); }, 45000);
}

const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth++; wake();
  if (!busy && depth === 1) { setState("reach"); setMood("wide"); speak("letgo", true); }
});
addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); lookAt(e.clientX, e.clientY); } });   // the eyes follow the file
addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  depth = Math.max(0, depth - 1);
  if (!busy && depth === 0) { setState("idle"); setMood(""); speak("hint", true); }
});
addEventListener("drop", (e) => {
  e.preventDefault(); depth = 0;
  if (busy) return;
  const dt = e.dataTransfer;
  if (!dt) return;
  // entries must be read synchronously, the browser clears the drop data afterwards
  const items = dt.items ? [...dt.items].filter((i) => i.kind === "file").map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)) : [];
  if (items.some((en) => en && en.isDirectory)) { jobFromEntries(items).then((j) => run(j)).catch(() => speak("broke")); return; }
  const fs = [...dt.files];
  if (fs.length) run(jobFromFiles(fs)); else { setState("idle"); setMood(""); speak("hint", true); }
});

hand.addEventListener("click", () => { if (!busy) fileInput.click(); });
fileInput.addEventListener("change", () => { const fs = [...fileInput.files]; fileInput.value = ""; if (fs.length) run(jobFromFiles(fs)); });
dirInput.addEventListener("change", () => { const fs = [...dirInput.files]; dirInput.value = ""; if (fs.length) run(jobFromFiles(fs)); });
addEventListener("paste", (e) => {
  if (busy || e.target === pw || !e.clipboardData) return;
  const fs = [...(e.clipboardData.files || [])];
  if (fs.length) { e.preventDefault(); run(jobFromFiles(fs)); return; }
  const text = e.clipboardData.getData("text");
  if (text && text.trim()) { e.preventDefault(); run({ type: "text", text }); }
});
const copyOf = (el) => () => { try { navigator.clipboard.writeText(el.textContent); } catch {} };
phrase.addEventListener("click", copyOf(phrase));
textout.addEventListener("click", copyOf(textout));
shareBtn.addEventListener("click", () => { if (shareData) navigator.share(shareData).catch(() => {}); });
qrBtn.addEventListener("click", () => {
  if (!qrBox.hidden) { qrBox.hidden = true; return; }
  try {
    const q = qrcode(0, "L"); q.addData(qrText); q.make();
    qrBox.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); qrBox.hidden = false;
  } catch { qrBtn.hidden = true; }
});
document.querySelector(".lang").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.id === "fld") { if (!busy) dirInput.click(); return; }
  if (!T[b.dataset.l]) return;
  lang = b.dataset.l;
  try { localStorage.setItem("lang", lang); } catch {}
  applyLang();
});

addEventListener("pointermove", (e) => { wake(); lookAt(e.clientX, e.clientY); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeHands(); wake(); });
pw.addEventListener("input", closeHands);
addEventListener("pointerdown", wake);

const snd = $("snd");
snd.setAttribute("aria-pressed", String(soundPref));
snd.addEventListener("click", () => {
  soundPref = !soundPref;
  try { localStorage.setItem("sound", soundPref ? "1" : "0"); } catch {}
  snd.setAttribute("aria-pressed", String(soundPref)); sfx("enable", soundPref);
});
const unlock = () => { if (soundPref && window.Sfx && !Sfx.enabled) sfx("enable", true); };
addEventListener("pointerdown", unlock); addEventListener("keydown", unlock);
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

applyLang();
speak("hint", true);
countCall();
wake();
