//run this after running the main script and it will add a reverse text button that flips your text with rel after reversing it.

// ==UserScript==
// @name         NCZ Chat Mirror - Reverse+RLO Button Addon
// @namespace    ncz-mequavis
// @version      1.0.0
// @description  Adds a "Reverse" button next to "Rescan" that reverses the mirror input text and wraps it in RLO so it *renders* non-reversed.
// @match        https://suno.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  // RLO trick:
  // - Reverse the string
  // - Wrap with RLO (U+202E) + PDF (U+202C) so it displays “normal” even though it’s reversed
  const RLO = "\u202E"; // Right-to-Left Override
  const PDF = "\u202C"; // Pop Directional Formatting

  // Reverse by code points (handles emoji/surrogates better than split(""))
  const reverseText = (s) => Array.from(String(s || "")).reverse().join("");

  function findRescanBtn(host) {
    const btns = Array.from(host.querySelectorAll("button.ncz-miniBtn"));
    return btns.find((b) => (b.textContent || "").trim().toLowerCase() === "rescan");
  }

  function findMirrorInput(host) {
    return host.querySelector("input.ncz-sendInput");
  }

  function install() {
    const host = document.getElementById("ncz-chat-mirror-host");
    if (!host) return false;

    const rescan = findRescanBtn(host);
    if (!rescan) return false;

    // prevent double-add
    if (host.querySelector("button[data-ncz-reverse-btn='1']")) return true;

    const btn = document.createElement("button");
    btn.className = "ncz-miniBtn";
    btn.textContent = "Reverse";
    btn.title = "Reverse the mirror input, then wrap in RLO (U+202E) so it renders non-reversed.";
    btn.type = "button";
    btn.dataset.nczReverseBtn = "1";

    btn.addEventListener("click", () => {
      const input = findMirrorInput(host);
      if (!input) return;

      const raw = String(input.value || "");
      if (!raw.trim()) return;

      const reversed = reverseText(raw);
      input.value = `${RLO}${reversed}${PDF}`;
      input.focus();

      // put cursor at end
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch {}
    });

    // insert right next to Rescan (after it)
    rescan.insertAdjacentElement("afterend", btn);
    return true;
  }

  // Wait for the mirror to exist (SPA/async creation)
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    if (install() || tries > 80) clearInterval(t); // ~40s max
  }, 500);
})();
