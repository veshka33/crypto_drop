"use strict";
const $ = (id) => document.getElementById(id);
const body = document.body, say = $("say"), sr = $("sr"), pw = $("pw"), chip = $("chip"),
  out = $("out"), fileInput = $("file"), hand = $("hand"), eyes = $("eyes");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, RM ? Math.min(ms, 80) : ms));
const MAX = 300 * 1024 * 1024;
const HINT = "drop a file on the hand, or tap it";
let busy = false, token = 0, lastUrl = null, depth = 0;

const setState = (s) => { body.dataset.state = s; };
const fmt = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

async function speak(text, dim = false) {
  const my = ++token;
  sr.textContent = text;
  say.className = dim ? "dim" : "";
  say.textContent = "";
  if (RM || dim) { say.textContent = text; return; }
  say.classList.add("typing");
  for (const ch of text) {
    if (my !== token) return;
    say.textContent += ch;
    await sleep(70 + Math.random() * 60);
  }
  if (my === token) say.classList.remove("typing");
}

function ask() {
  return new Promise((resolve) => {
    pw.value = ""; pw.tabIndex = 0; pw.classList.add("on"); pw.focus();
    const onKey = (e) => {
      if (e.key !== "Enter" || !pw.value) return;
      pw.removeEventListener("keydown", onKey);
      pw.classList.remove("on"); pw.tabIndex = -1; pw.blur();
      resolve(pw.value);
    };
    pw.addEventListener("keydown", onKey);
  });
}

async function getPassword(encrypting) {
  for (;;) {
    await speak("what password?");
    const a = await ask();
    if (!encrypting) return a;
    if (a.length < 8) { await speak("too short. eight characters, at least."); await sleep(900); continue; }
    await speak("again.");
    if (a === await ask()) return a;
    await speak("no. from the start."); await sleep(900);
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

async function run(f) {
  if (busy) return;
  if (f.size > MAX) {
    setState("idle"); await speak("too heavy. 300 MB, at most.");
    await sleep(2500); speak(HINT, true); return;
  }
  busy = true;
  out.hidden = true;
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  const encrypting = !(await Vault.isEncrypted(f));
  token++; say.textContent = ""; say.className = ""; sr.textContent = "";

  chip.textContent = f.name + "  " + fmt(f.size);
  chip.className = "chip show";
  setState("reach"); await sleep(450);
  setState("grab"); chip.classList.add("eaten"); await sleep(550);
  setState("gone"); await sleep(1500);

  let result = null;
  for (;;) {
    const password = await getPassword(encrypting);
    token++; say.className = ""; say.textContent = "...";
    try { result = await (encrypting ? Vault.encrypt : Vault.decrypt)(f, password); break; }
    catch {
      if (encrypting) break;
      await speak("wrong."); await sleep(900);
    }
  }
  chip.className = "chip";

  if (!result) {
    setState("idle"); await speak("something broke. try again.");
    busy = false; return;
  }
  setState("back"); await sleep(1300);
  setState("throw"); await sleep(120);
  lastUrl = URL.createObjectURL(result.blob);
  out.href = lastUrl; out.download = result.name;
  out.textContent = result.name + "  " + fmt(result.blob.size);
  out.hidden = false;
  flyIn(out);
  download(lastUrl, result.name);
  speak("here.");
  await sleep(500);
  setState("idle");
  busy = false;
}

const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); depth++;
  if (!busy && depth === 1) { setState("reach"); speak("let go.", true); }
});
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("dragleave", (e) => {
  if (!hasFiles(e)) return;
  depth = Math.max(0, depth - 1);
  if (!busy && depth === 0) { setState("idle"); speak(HINT, true); }
});
addEventListener("drop", (e) => {
  e.preventDefault(); depth = 0;
  if (busy) return;
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) run(f); else { setState("idle"); speak(HINT, true); }
});

hand.addEventListener("click", () => { if (!busy) fileInput.click(); });
fileInput.addEventListener("change", () => { const f = fileInput.files[0]; fileInput.value = ""; if (f) run(f); });

if (!RM) addEventListener("pointermove", (e) => {
  const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
  eyes.style.transform = `translate(calc(-50% + ${x * 26}px), calc(-50% + ${y * 16}px))`;
});

speak(HINT, true);
