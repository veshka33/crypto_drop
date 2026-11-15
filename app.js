"use strict";
const $ = (id) => document.getElementById(id);
const body = document.body, say = $("say"), sr = $("sr"), pw = $("pw"), chip = $("chip"), out = $("out"),
  fileInput = $("file"), hand = $("hand"), eyes = $("eyes"), eyesIn = $("eyesIn"), counter = $("count"),
  suggest = $("suggest"), phrase = $("phrase"), bar = $("bar"), textout = $("textout");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, RM ? Math.min(ms, 80) : ms));
const MAX = 500 * 1024 * 1024, MIN = 12;
const CAN_GEN = Array.isArray(window.WORDS) && window.WORDS.length === 2048;

const T = {
  en: { hint: "drop files on the hand, or tap it. text can be pasted.", letgo: "let go.", pass: "what password?",
    short: "too short. twelve characters, at least.", again: "again.", mismatch: "no. from the start.",
    wrong: "wrong.", here: "here.", hereText: "here. tap to copy.", broke: "something broke. try again.",
    heavy: "too heavy. 500 MB, at most.", keep: "keep it. it cannot be recovered. tap to copy.",
    suggest: "suggest one", taken: "files taken: ", filesw: "files", textw: "text",
    note: "Your files never leave your browser.", pick: "Choose files to encrypt or decrypt", title: "Drop a file", pwlabel: "Password", choose: "Choose a passphrase" },
  uk: { hint: "кидай файли на руку або торкнись її. текст можна вставити.", letgo: "відпускай.", pass: "який пароль?",
    short: "закороткий. щонайменше дванадцять символів.", again: "ще раз.", mismatch: "ні. спочатку.",
    wrong: "не той.", here: "тримай.", hereText: "тримай. торкнись, щоб скопіювати.", broke: "щось зламалось. спробуй ще.",
    heavy: "надто важкий. не більше 500 МБ.", keep: "запам’ятай. відновити не вийде. торкнись, щоб скопіювати.",
    suggest: "запропонувати", taken: "файлів забрано: ", filesw: "файлів", textw: "текст",
    note: "Твої файли не залишають браузер.", pick: "Обрати файли для шифрування або розшифрування", title: "Кинь файл", pwlabel: "Пароль", choose: "Обери парольну фразу" },
  ru: { hint: "бросай файлы на руку или нажми на неё. текст можно вставить.", letgo: "отпускай.", pass: "какой пароль?",
    short: "слишком короткий. минимум двенадцать символов.", again: "ещё раз.", mismatch: "нет. сначала.",
    wrong: "не тот.", here: "держи.", hereText: "держи. нажми, чтобы скопировать.", broke: "что-то сломалось. попробуй ещё.",
    heavy: "слишком тяжёлый. не больше 500 МБ.", keep: "запомни. восстановить нельзя. нажми, чтобы скопировать.",
    suggest: "предложить", taken: "файлов забрано: ", filesw: "файлов", textw: "текст",
    note: "Твои файлы не покидают браузер.", pick: "Выбрать файлы для шифрования или расшифровки", title: "Брось файл", pwlabel: "Пароль", choose: "Выбери парольную фразу" }
};
let lang = (() => {
  try { const s = localStorage.getItem("lang"); if (T[s]) return s; } catch {}
  const n = (navigator.language || "en").slice(0, 2).toLowerCase();
  return T[n] ? n : "en";
})();
const t = (k) => T[lang][k];
let busy = false, token = 0, lastUrl = null, depth = 0, shown = null, lastCount = null, idleT = 0, generated = "";

const setState = (s) => { body.dataset.state = s; };
const setMood = (m) => { eyesIn.dataset.mood = m; };
const fmt = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

function showCount(n) {
  if (typeof n !== "number") return;
  lastCount = n;
  counter.textContent = t("taken") + n.toLocaleString(lang === "en" ? "en-US" : lang);
  counter.hidden = false;
}
const countCall = (opts) => Promise.resolve().then(() => fetch("/api/count", opts))
  .then((r) => (r.ok ? r.json() : null)).then((d) => d && showCount(d.count)).catch(() => {});

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("title");
  $("note").textContent = t("note");
  hand.setAttribute("aria-label", t("pick"));
  pw.setAttribute("aria-label", t("pwlabel"));
  suggest.textContent = t("suggest");
  $("hands").setAttribute("aria-label", t("choose"));
  document.querySelectorAll(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.l === lang)));
  if (lastCount !== null) showCount(lastCount);
  if (!busy && shown) { say.textContent = t(shown); sr.textContent = t(shown); }
}

async function speak(key, dim = false) {
  const my = ++token, text = t(key);
  shown = key; sr.textContent = text;
  say.className = dim ? "dim" : ""; say.textContent = "";
  if (RM || dim) { say.textContent = text; return; }
  say.classList.add("typing");
  for (const ch of text) {
    if (my !== token) return;
    say.textContent += ch;
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
  handsEl.classList.add("shown"); body.classList.add("suggesting"); handsOpen = true;
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
    const pick = (words) => { generated = words.join("-"); pw.type = "text"; pw.classList.add("plain"); pw.value = generated; closeHands(); pw.focus(); };
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
    await speak("mismatch"); await sleep(900);
  }
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
const work = (job, pass, dec) => {
  if (job.type === "text") return dec ? Vault.decryptText(job.text, pass, setP) : Vault.encryptText(job.text, pass, setP);
  const f = job.files;
  if (dec) return Vault.decrypt(f[0], pass, setP);
  return f.length === 1 ? Vault.encryptFile(f[0], pass, setP) : Vault.encryptFiles(f, pass, setP);
};

async function run(job) {
  if (busy) return;
  const isText = job.type === "text", files = job.files || [];
  const size = isText ? job.text.length : files.reduce((n, f) => n + f.size, 0);
  if (size > (isText ? 1e6 : MAX) || files.length > 1000) {
    setState("idle"); setMood("narrow"); await speak("heavy");
    await sleep(2500); setMood(""); speak("hint", true); return;
  }
  busy = true;
  out.hidden = true; phrase.hidden = true; textout.hidden = true;
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  let decrypting = false;
  try { decrypting = isText ? job.text.trim().startsWith("VS2.") : files.length === 1 && (await Vault.detect(files[0])) > 0; } catch {}
  const encrypting = !decrypting;
  token++; shown = null; say.textContent = ""; say.className = ""; sr.textContent = "";

  chip.textContent = isText ? t("textw") + "  " + job.text.length
    : files.length === 1 ? files[0].name + "  " + fmt(size) : files.length + " " + t("filesw") + "  " + fmt(size);
  chip.className = "chip show";
  setMood("wide"); setState("reach"); await sleep(450);
  setState("grab"); chip.classList.add("eaten"); await sleep(550);
  setState("gone"); setMood(""); await sleep(1500);

  let result = null;
  for (;;) {
    const password = await getPassword(encrypting);
    token++; shown = null; say.className = ""; say.textContent = "...";
    bar.style.setProperty("--p", "0"); bar.hidden = false;
    try { result = await work(job, password, decrypting); break; }
    catch (e) {
      bar.hidden = true;
      if (!(decrypting && e && e.message === "bad")) break;
      setMood("narrow"); await speak("wrong"); await sleep(900); setMood("");
    }
  }
  bar.hidden = true; chip.className = "chip";

  if (!result) {
    setState("idle"); await speak("broke");
    busy = false; return;
  }
  setState("back"); await sleep(1300);
  setState("throw"); setMood("wide"); await sleep(120);
  if (encrypting) countCall({ method: "POST" });
  if (result.text !== undefined) {
    textout.textContent = result.text; textout.hidden = false;
    flyIn(textout); speak("hereText");
  } else {
    lastUrl = URL.createObjectURL(result.blob);
    out.href = lastUrl; out.download = result.name;
    out.textContent = result.name + "  " + fmt(result.blob.size);
    out.hidden = false;
    flyIn(out); download(lastUrl, result.name); speak("here");
  }
  await sleep(500);
  setState("idle");
  busy = false;
  setTimeout(() => setMood(""), 1200);
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
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  depth = Math.max(0, depth - 1);
  if (!busy && depth === 0) { setState("idle"); setMood(""); speak("hint", true); }
});
addEventListener("drop", (e) => {
  e.preventDefault(); depth = 0;
  if (busy) return;
  const fs = e.dataTransfer ? [...e.dataTransfer.files] : [];
  if (fs.length) run({ type: "files", files: fs }); else { setState("idle"); setMood(""); speak("hint", true); }
});

hand.addEventListener("click", () => { if (!busy) fileInput.click(); });
fileInput.addEventListener("change", () => { const fs = [...fileInput.files]; fileInput.value = ""; if (fs.length) run({ type: "files", files: fs }); });
addEventListener("paste", (e) => {
  if (busy || e.target === pw || !e.clipboardData) return;
  const fs = [...(e.clipboardData.files || [])];
  if (fs.length) { e.preventDefault(); run({ type: "files", files: fs }); return; }
  const text = e.clipboardData.getData("text");
  if (text && text.trim()) { e.preventDefault(); run({ type: "text", text }); }
});
const copyOf = (el) => () => { try { navigator.clipboard.writeText(el.textContent); } catch {} };
phrase.addEventListener("click", copyOf(phrase));
textout.addEventListener("click", copyOf(textout));
document.querySelector(".lang").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || !T[b.dataset.l]) return;
  lang = b.dataset.l;
  try { localStorage.setItem("lang", lang); } catch {}
  applyLang();
});

addEventListener("pointermove", (e) => {
  wake();
  if (RM) return;
  const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
  eyes.style.transform = `translate(calc(-50% + ${x * 26}px), calc(-50% + ${y * 16}px))`;
});
addEventListener("keydown", (e) => { if (e.key === "Escape") closeHands(); wake(); });
pw.addEventListener("input", closeHands);
addEventListener("pointerdown", wake);

applyLang();
speak("hint", true);
countCall();
wake();
