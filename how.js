"use strict";
const LANGS = ["en", "uk", "ru"], TITLES = { en: "How it works", uk: "Як це працює", ru: "Как это работает" };
let lang = null;
try { lang = localStorage.getItem("lang"); } catch {}
if (!LANGS.includes(lang)) { lang = (navigator.language || "en").slice(0, 2).toLowerCase(); if (!LANGS.includes(lang)) lang = "en"; }
function show(l) {
  lang = l;
  document.documentElement.lang = l; document.title = TITLES[l];
  document.querySelectorAll("article[data-lang]").forEach((a) => { a.hidden = a.dataset.lang !== l; });
  document.querySelectorAll(".bar button[data-l]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.l === l)));
  try { localStorage.setItem("lang", l); } catch {}
}
document.querySelector(".bar").addEventListener("click", (e) => { const b = e.target.closest("button[data-l]"); if (b) show(b.dataset.l); });
show(lang);
