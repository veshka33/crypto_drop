"use strict";
const MAGIC = new TextEncoder().encode("VSENC1");
const SALT_LEN = 16, IV_LEN = 12, ITER = 600000, MAX = 500 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const drop = $("drop"), input = $("file"), panel = $("panel"), status = $("status");
const pw = $("pw"), pw2 = $("pw2"), go = $("go"), confirmBox = $("confirmBox");
let file = null, mode = "encrypt";

const fmt = (n) => n < 1024 ? n + " Б" : n < 1048576 ? (n / 1024).toFixed(1) + " КБ" : (n / 1048576).toFixed(1) + " МБ";
const say = (t, cls = "") => { status.textContent = t; status.className = cls; };

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encrypt(f, password) {
  const nameBytes = new TextEncoder().encode(f.name).slice(0, 65535);
  const data = new Uint8Array(await f.arrayBuffer());
  const payload = new Uint8Array(2 + nameBytes.length + data.length);
  new DataView(payload.buffer).setUint16(0, nameBytes.length);
  payload.set(nameBytes, 2);
  payload.set(data, 2 + nameBytes.length);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, payload));
  const out = new Uint8Array(MAGIC.length + SALT_LEN + IV_LEN + ct.length);
  out.set(MAGIC, 0); out.set(salt, MAGIC.length); out.set(iv, MAGIC.length + SALT_LEN);
  out.set(ct, MAGIC.length + SALT_LEN + IV_LEN);
  return { blob: new Blob([out]), name: f.name + ".enc" };
}

async function decrypt(f, password) {
  const buf = new Uint8Array(await f.arrayBuffer());
  const salt = buf.slice(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = buf.slice(MAGIC.length + SALT_LEN, MAGIC.length + SALT_LEN + IV_LEN);
  const ct = buf.slice(MAGIC.length + SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: MAGIC }, key, ct));
  const nameLen = new DataView(plain.buffer).getUint16(0);
  const name = new TextDecoder().decode(plain.slice(2, 2 + nameLen)) || "decrypted";
  return { blob: new Blob([plain.slice(2 + nameLen)]), name };
}

function save({ blob, name }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function pick(f) {
  say("");
  if (!f) return;
  if (f.size > MAX) { say("Файл больше 500 МБ. Выберите файл поменьше.", "err"); return; }
  const head = new Uint8Array(await f.slice(0, MAGIC.length).arrayBuffer());
  const encrypted = head.length === MAGIC.length && head.every((b, i) => b === MAGIC[i]);
  file = f; mode = encrypted ? "decrypt" : "encrypt";
  $("dropTitle").textContent = f.name;
  $("dropSub").textContent = fmt(f.size) + (encrypted ? ". Файл будет расшифрован" : ". Файл будет зашифрован");
  $("shackle").setAttribute("d", encrypted ? "M16 22v-6a8 8 0 0 1 15-4" : "M16 22v-6a8 8 0 0 1 16 0v6");
  go.textContent = encrypted ? "Расшифровать" : "Зашифровать";
  confirmBox.hidden = encrypted;
  pw.value = pw2.value = "";
  panel.hidden = false;
  pw.focus();
}

drop.addEventListener("click", () => input.click());
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
input.addEventListener("change", () => { pick(input.files[0]); input.value = ""; });
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => pick(e.dataTransfer.files[0]));
["dragover", "drop"].forEach((t) => window.addEventListener(t, (e) => e.preventDefault()));

$("toggle").addEventListener("click", (e) => {
  const show = pw.type === "password";
  pw.type = pw2.type = show ? "text" : "password";
  e.target.textContent = show ? "Скрыть" : "Показать";
});

$("reset").addEventListener("click", () => {
  file = null; panel.hidden = true; say("");
  $("dropTitle").textContent = "Перетащите файл сюда";
  $("dropSub").textContent = "или нажмите, чтобы выбрать";
  $("shackle").setAttribute("d", "M16 22v-6a8 8 0 0 1 16 0v6");
});

panel.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!file) return;
  if (mode === "encrypt") {
    if (pw.value.length < 8) { say("Пароль должен быть не короче 8 символов.", "err"); return; }
    if (pw.value !== pw2.value) { say("Пароли не совпадают.", "err"); return; }
  }
  go.disabled = true; say("Обработка…");
  await new Promise((r) => setTimeout(r, 30));
  try {
    save(await (mode === "encrypt" ? encrypt : decrypt)(file, pw.value));
    say(mode === "encrypt" ? "Готово: файл зашифрован и скачан." : "Готово: файл расшифрован и скачан.", "ok");
  } catch {
    say(mode === "decrypt" ? "Неверный пароль или файл повреждён." : "Не удалось обработать файл.", "err");
  } finally { go.disabled = false; }
});
