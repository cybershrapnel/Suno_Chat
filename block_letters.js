// ==UserScript==
// @name         Full Emoji + Boxed Letter Converter
// @namespace    ncz-mequavis
// @version      5.0
// @description  Convert selected text to 🅰️🅱️🅾️🅿️ or 🄰🄱🄲🄳 / 🅐🅑🅒🅓 with emoji for punctuation
// @match        *://*/*
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  // Emoji letter tiles
  const emojiTiles = { A: "🅰️", B: "🅱️", O: "🅾️", P: "🅿️" };

  // White boxed letters 🄰–🅉  (U+1F130–U+1F149)
  const whiteBox = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].reduce((a, c, i) => {
    a[c] = String.fromCodePoint(0x1F130 + i);
    return a;
  }, {});

  // Black boxed letters 🅐–🅩  (U+1F170–U+1F189)
  const blackBox = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].reduce((a, c, i) => {
    a[c] = String.fromCodePoint(0x1F170 + i);
    return a;
  }, {});

  // Symbol equivalents
  const symbols = {
    "?": "❓",
    "!": "❗",
    "#": "#️⃣",
    "*": "*️⃣",
    "+": "➕",
    "-": "➖",
    "0": "0️⃣",
    "1": "1️⃣",
    "2": "2️⃣",
    "3": "3️⃣",
    "4": "4️⃣",
    "5": "5️⃣",
    "6": "6️⃣",
    "7": "7️⃣",
    "8": "8️⃣",
    "9": "9️⃣",
  };

  function convert(text) {
    const upper = text.toUpperCase();
    let res = "";

    for (const ch of upper) {
      if (emojiTiles[ch]) {
        // randomly use emoji or one of the box styles
        const opts = [emojiTiles[ch], whiteBox[ch], blackBox[ch]].filter(Boolean);
        res += opts[Math.floor(Math.random() * opts.length)];
      } else if (/[A-Z]/.test(ch)) {
        // randomly choose white or black box
        const opts = [whiteBox[ch], blackBox[ch]];
        res += opts[Math.floor(Math.random() * opts.length)];
      } else if (symbols[ch]) {
        res += symbols[ch];
      } else {
        res += ch; // fallback: keep character
      }
    }
    return res;
  }

  function replaceSelection(el, newText) {
    if (el.value !== undefined) {
      const s = el.selectionStart, e = el.selectionEnd;
      el.value = el.value.slice(0, s) + newText + el.value.slice(e);
      el.setSelectionRange(s, s + newText.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      r.deleteContents();
      r.insertNode(document.createTextNode(newText));
      sel.removeAllRanges();
    }
  }

  document.addEventListener("keydown", e => {
    if (e.key !== "`" && e.key !== "~") return;
    const el = document.activeElement;
    if (!el || (!el.isContentEditable && el.value === undefined)) return;

    e.preventDefault();

    let txt = "";
    if (el.value !== undefined) {
      txt = el.value.substring(el.selectionStart, el.selectionEnd);
    } else {
      const sel = window.getSelection();
      if (sel.rangeCount) txt = sel.toString();
    }

    if (!txt.trim()) return;
    const out = convert(txt);
    if (out) replaceSelection(el, out);
  });
})();
