// ==UserScript==
// @name         Suno Chat Mirror (movable + resizable + rooms + blocklist + send)
// @namespace    ncz-mequavis
// @version      1.3.4
// @description  Draggable/resizable overlay that live-mirrors Suno chat with filters, room selector, blocklist UI, and a mirrored send box.
// @match        https://suno.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

//updated to work again on 2/25/2026 they duplicated the chat layers which broke the old plugin.

(() => {
  "use strict";

  const LOG = "[NCZ ChatMirror]";
  const START_DELAY_MS = 1500; // shorter; Suno UI is SPA and chat mounts late anyway
  const LAUNCHER_ID = "ncz-chat-mirror-launcher";

  // Prevent double-scheduling (SPA + TM quirks)
  // BUT: don't brick recovery if flag got set and UI never created.
  if (window.__ncz_chatMirror_scheduled && document.getElementById("ncz-chat-mirror-host")) return;
  window.__ncz_chatMirror_scheduled = true;

  // (2) Only show on /live-radio (and subpaths) by default
  // BUT: also treat "live radio context" as true if chat input exists (Suno sometimes changes routes).
  const LIVE_RADIO_RE = /^\/live-radio(?:\/.*)?$/i;

  function isLiveRadioUrl(href = location.href) {
    try {
      const u = new URL(href, location.origin);
      return LIVE_RADIO_RE.test(u.pathname || "");
    } catch {
      return LIVE_RADIO_RE.test(location.pathname || "");
    }
  }

  function hasAnyChatInput() {
    return !!document.querySelector("input.live-radio-chat-input");
  }

  function isLiveRadioContext() {
    return isLiveRadioUrl() || hasAnyChatInput();
  }

  const LS_KEY = "ncz_chatMirror_state_v2";

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const norm = (s) => String(s || "").trim().toLowerCase();

  function loadState() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveState(patch) {
    const cur = loadState();
    const next = { ...cur, ...patch };
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return next;
  }

  function getBlockedList(state) {
    const arr = Array.isArray(state.blocked) ? state.blocked : [];
    const seen = new Set();
    const out = [];
    for (const u of arr) {
      const k = norm(u);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(String(u).trim());
    }
    out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return out;
  }
  function setBlockedList(list) { saveState({ blocked: list }); }
  function addBlocked(user) {
    const st = loadState();
    const list = getBlockedList(st);
    const k = norm(user);
    if (!k) return;
    if (list.some((u) => norm(u) === k)) return;
    list.push(String(user).trim());
    list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    setBlockedList(list);
  }
  function removeBlocked(user) {
    const st = loadState();
    const list = getBlockedList(st);
    const k = norm(user);
    setBlockedList(list.filter((u) => norm(u) !== k));
  }

  // ✅ FIX: ancestor-aware visibility (Suno now uses stacked opacity layers)
  function isVisible(el) {
    if (!el) return false;

    if (el.closest('[hidden], [aria-hidden="true"]')) return false;

    const r = el.getBoundingClientRect?.();
    if (!r || r.width < 2 || r.height < 2) return false;

    let cur = el;
    for (let i = 0; i < 50 && cur && cur.nodeType === 1; i++) {
      const cs = getComputedStyle(cur);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      if (Number(cs.opacity) === 0) return false;
      cur = cur.parentElement;
    }
    return true;
  }

  function scoreList(el) {
    if (!el) return 0;
    const reply = el.querySelectorAll('button[aria-label^="Reply to"]').length;
    const handles = el.querySelectorAll('a[href^="/@"]').length;
    const groups = el.querySelectorAll("div.group").length;
    const kids = el.children ? el.children.length : 0;
    return reply * 10 + handles * 4 + groups * 2 + kids;
  }

  // ✅ Prefer the VISIBLE chat input (Suno sometimes leaves a hidden copy in DOM)
  function findMainChatInput() {
    const all = Array.from(document.querySelectorAll("input.live-radio-chat-input"));
    const vis = all.filter(isVisible);
    return vis.length ? vis[vis.length - 1] : (all[0] || null);
  }

  function findMainSendButton(nearInput) {
    const tryFind = (scope) =>
      scope ? scope.querySelector('button[aria-label="Send message"]') : null;

    if (nearInput) {
      let p = nearInput.parentElement;
      for (let i = 0; i < 22 && p; i++) {
        const b = tryFind(p);
        if (b && isVisible(b)) return b;
        p = p.parentElement;
      }
    }

    const all = Array.from(document.querySelectorAll('button[aria-label="Send message"]'));
    const vis = all.filter(isVisible);
    return vis.length ? vis[vis.length - 1] : (all[0] || null);
  }

  // ✅ Find the messages list near the VISIBLE input first
  function findMessagesList() {
    const input = findMainChatInput();

    const scopes = [];
    if (input) {
      let p = input.parentElement;
      for (let i = 0; i < 28 && p; i++) {
        scopes.push(p);
        p = p.parentElement;
      }
    }
    scopes.push(document);

    const selector =
      [
        "div.overflow-y-auto",
        "div[class*='overflow-y-auto']",
        "div[style*='overflow-y']",
        "div[style*='scrollbar-width']",
        "div[style*='scrollbar-color']",
      ].join(",");

    let best = null;
    let bestScore = 0;

    for (const scope of scopes) {
      const candidates = Array.from(scope.querySelectorAll(selector));
      for (const el of candidates) {
        if (!isVisible(el)) continue;

        const hasChatMarkers =
          el.querySelector('button[aria-label^="Reply to"]') ||
          el.querySelector('a[href^="/@"]') ||
          el.querySelector("span.font-medium") ||
          el.querySelector("div.group");

        if (!hasChatMarkers) continue;

        const s = scoreList(el);
        if (s > bestScore) {
          best = el;
          bestScore = s;
        }
      }
      if (best) return best;
    }

    return best;
  }

  function extractUsername(msgEl) {
    if (!msgEl) return "";
    const a = msgEl.querySelector('a[href^="/@"]');
    if (a?.textContent) return a.textContent.trim();
    const s = msgEl.querySelector("span.font-medium");
    if (s?.textContent) return s.textContent.trim();
    return "";
  }

  // Safe extraction (no invalid selectors for text-white/60)
  function extractContent(msgEl, username) {
    if (!msgEl) return "";

    const bw = msgEl.querySelector("span.break-words");
    if (bw?.textContent) return bw.textContent.trim();

    let t = null;
    for (const span of msgEl.querySelectorAll("span")) {
      if (span.classList && span.classList.contains("text-white/60")) {
        t = span;
        break;
      }
    }
    if (t?.textContent) return t.textContent.replace(/\s+/g, " ").trim();

    for (const span of msgEl.querySelectorAll("span")) {
      const cls = typeof span.className === "string" ? span.className : "";
      if (cls.includes("text-white/") && !cls.includes("font-medium")) {
        const txt = (span.textContent || "").replace(/\s+/g, " ").trim();
        if (txt) return txt;
      }
    }

    const full = (msgEl.innerText || msgEl.textContent || "").replace(/\u200B/g, "").trim();
    if (username && full.toLowerCase().startsWith(username.toLowerCase())) {
      return full.slice(username.length).trimStart();
    }
    return full;
  }

  function getMessageNodesFromList(listEl) {
    if (!listEl) return [];

    const btns = Array.from(listEl.querySelectorAll('button[aria-label^="Reply to"]'));
    if (btns.length) {
      const seen = new WeakSet();
      const out = [];
      for (const b of btns) {
        const item =
          b.closest("div.group.relative") ||
          b.closest("div.group") ||
          b.closest("div[class*='group']") ||
          b.parentElement;
        if (item && !seen.has(item)) {
          seen.add(item);
          out.push(item);
        }
      }
      if (out.length >= 3) return out;
    }

    const kids = Array.from(listEl.children || []);
    if (kids.length) return kids;

    return Array.from(listEl.querySelectorAll("div.group")).slice(0, 200);
  }

  function stripRoomPrefix(text, prefix) {
    const t = String(text || "").trimStart();
    if (!prefix) return t.trim();
    if (t.startsWith(prefix)) return t.slice(prefix.length).trimStart();
    return t.trim();
  }

  function applyDisplayContentToClone(cloneEl, newText, prefix) {
    if (!cloneEl) return;

    const bw = cloneEl.querySelector("span.break-words");
    if (bw) {
      bw.textContent = newText;
      return;
    }

    let t = null;
    for (const span of cloneEl.querySelectorAll("span")) {
      if (span.classList && span.classList.contains("text-white/60")) { t = span; break; }
    }
    if (t) {
      t.textContent = newText;
      return;
    }

    if (prefix) {
      const it = document.createNodeIterator(cloneEl, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = it.nextNode())) {
        const s = node.nodeValue || "";
        const idx = s.indexOf(prefix);
        if (idx !== -1) {
          node.nodeValue = (s.slice(0, idx) + s.slice(idx + prefix.length)).replace(/^\s+/, "");
          return;
        }
      }
    }
  }

  function getCloneContentEl(cloneEl) {
    if (!cloneEl) return null;
    return (
      cloneEl.querySelector("span.break-words") ||
      cloneEl.querySelector("span.text-white\\/60") ||
      (() => {
        for (const span of cloneEl.querySelectorAll("span")) {
          if (span.classList && span.classList.contains("text-white/60")) return span;
        }
        for (const span of cloneEl.querySelectorAll("span")) {
          const cls = typeof span.className === "string" ? span.className : "";
          if (cls.includes("text-white/") && !cls.includes("font-medium")) return span;
        }
        return null;
      })()
    );
  }

  // React-safe input setter
  function setNativeValue(el, value) {
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const setter = desc && desc.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Insert Word Joiner (U+2060) before ".com" to break auto-linking
  const WORD_JOINER = "\u2060";
  function obfuscateDotCom(text) {
    return String(text || "").replace(
      /([A-Za-z0-9])\.(com)\b/gi,
      (_m, pre, tld) => `${pre}${WORD_JOINER}.${tld}`
    );
  }

  // --- Linkify ONLY suno.com links inside the mirror, opening in a new tab ---
  const SUNO_RE = /(?:https?:\/\/)?(?:www\.)?suno\u2060?\.com(?:\/[^\s<>"'`]+)?/gi;

  function stripTrailingPunct(url) {
    let u = String(url || "");
    let trail = "";
    while (u && /[)\],.!?:;'"”’}]/.test(u.slice(-1))) {
      trail = u.slice(-1) + trail;
      u = u.slice(0, -1);
    }
    return { url: u, trailing: trail };
  }

  function toHref(raw) {
    let clean = String(raw || "").replaceAll(WORD_JOINER, "");
    if (!/^https?:\/\//i.test(clean)) clean = "https://" + clean;
    return clean;
  }

  function linkifySunoInElement(el) {
    if (!el) return;

    const text = el.textContent || "";
    if (!text || !/suno/i.test(text)) return;

    let m;
    let last = 0;
    let found = false;

    const frag = document.createDocumentFragment();

    while ((m = SUNO_RE.exec(text)) !== null) {
      found = true;
      const start = m.index;
      const end = SUNO_RE.lastIndex;

      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

      const rawFull = m[0];
      const { url: raw, trailing } = stripTrailingPunct(rawFull);

      const a = document.createElement("a");
      a.className = "ncz-sunoLink";
      a.href = toHref(raw);
      a.textContent = raw;
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      frag.appendChild(a);
      if (trailing) frag.appendChild(document.createTextNode(trailing));

      last = end;
    }

    if (!found) return;
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    el.replaceChildren(frag);
  }

  function linkifySunoLinksInClone(cloneEl) {
    const contentEl = getCloneContentEl(cloneEl);
    if (contentEl) linkifySunoInElement(contentEl);
  }

  // ---------------------------------------------------------------------
  // ROOM ENCRYPTION / DECRYPTION
  // ---------------------------------------------------------------------
  const CRYPTO_LS_KEY = "ncz_chatMirror_roomCrypto_v1";
  const CRYPTO_MARKER = "NCZ1";
  const ENC_OPEN = "⟦";
  const ENC_CLOSE = "⟧";
  const DEFAULT_MASTER_SECRET = "CHANGE_ME_TO_A_LONG_RANDOM_SHARED_SECRET";

  function loadCryptoState() {
    try { return JSON.parse(localStorage.getItem(CRYPTO_LS_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveCryptoState(patch) {
    const cur = loadCryptoState();
    const next = { ...cur, ...patch };
    localStorage.setItem(CRYPTO_LS_KEY, JSON.stringify(next));
    return next;
  }

  window.nczSetRoomSecret = (secret) => {
    saveCryptoState({ masterSecret: String(secret || "") });
    console.log(LOG, "Room secret saved. Reload Suno.");
  };

  function getMasterSecret() {
    const st = loadCryptoState();
    const s = String(st.masterSecret || "").trim();
    return s || DEFAULT_MASTER_SECRET;
  }

  const te = new TextEncoder();
  const td = new TextDecoder();

  function b64urlFromBytes(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }
  function bytesFromB64url(s) {
    let str = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const keyCache = new Map(); // roomNumber -> Promise<CryptoKey>
  async function getRoomKey(roomNumber) {
    const rn = Number(roomNumber) || 0;
    if (keyCache.has(rn)) return keyCache.get(rn);

    const p = (async () => {
      const master = getMasterSecret();
      const material = te.encode(`${master}|ROOM|${rn}`);
      if (!crypto?.subtle?.digest) throw new Error("WebCrypto not available");
      const hash = await crypto.subtle.digest("SHA-256", material);
      return crypto.subtle.importKey(
        "raw",
        hash,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    })();

    keyCache.set(rn, p);
    return p;
  }

  function looksEncryptedPayload(s) {
    const t = String(s || "").trim();
    return t.startsWith(CRYPTO_MARKER + ".");
  }
  function looksMixedEncrypted(s) {
    const t = String(s || "");
    return t.includes(ENC_OPEN + CRYPTO_MARKER + ".") || t.includes(ENC_OPEN + "NCZ0.");
  }

  async function encryptRoomText(roomNumber, plainText) {
    const rn = Number(roomNumber) || 0;

    if (!crypto?.subtle?.encrypt) {
      const raw = te.encode(String(plainText || ""));
      return `NCZ0.${b64urlFromBytes(raw)}`;
    }

    const key = await getRoomKey(rn);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const pt = te.encode(String(plainText || ""));
    const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
    const ct = new Uint8Array(ctBuf);

    return `${CRYPTO_MARKER}.${b64urlFromBytes(iv)}.${b64urlFromBytes(ct)}`;
  }

  async function decryptRoomText(roomNumber, payload) {
    const rn = Number(roomNumber) || 0;
    const t = String(payload || "").trim();

    if (t.startsWith("NCZ0.")) {
      try {
        const b = t.slice("NCZ0.".length);
        return td.decode(bytesFromB64url(b));
      } catch {
        return null;
      }
    }

    if (!t.startsWith(CRYPTO_MARKER + ".")) return null;
    const parts = t.split(".");
    if (parts.length < 3) return null;

    const ivB64 = parts[1] || "";
    const ctB64 = parts.slice(2).join(".");
    try {
      if (!crypto?.subtle?.decrypt) return null;
      const key = await getRoomKey(rn);
      const iv = bytesFromB64url(ivB64);
      const ct = bytesFromB64url(ctB64);
      const ptBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
      return td.decode(new Uint8Array(ptBuf));
    } catch {
      return null;
    }
  }

  const decryptCache = new Map(); // `${room}|${payload}` -> string|null|"PENDING"
  function getDecryptedOrKick(roomNumber, payload, scheduleRender) {
    const rn = Number(roomNumber) || 0;
    const key = `${rn}|${payload}`;
    const hit = decryptCache.get(key);
    if (hit && hit !== "PENDING") return { ready: true, text: hit };

    if (hit !== "PENDING") {
      decryptCache.set(key, "PENDING");
      decryptRoomText(rn, payload).then((res) => {
        decryptCache.set(key, res);
        scheduleRender();
      }).catch(() => {
        decryptCache.set(key, null);
        scheduleRender();
      });
    }
    return { ready: false, text: "🔒 decrypting…" };
  }

  function splitMentions(text) {
    const s = String(text || "");
    const re = /@[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}/g;

    const out = [];
    let last = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const i = m.index;
      const j = i + m[0].length;

      if (i > last) out.push({ type: "text", value: s.slice(last, i) });
      out.push({ type: "mention", value: m[0] });
      last = j;
    }
    if (last < s.length) out.push({ type: "text", value: s.slice(last) });
    if (!out.length) out.push({ type: "text", value: s });
    return out;
  }

  async function encryptRoomTextKeepMentions(roomNumber, plainText) {
    const safe = obfuscateDotCom(plainText);
    const parts = splitMentions(safe);

    const hasMention = parts.some(p => p.type === "mention");
    if (!hasMention) return await encryptRoomText(roomNumber, safe);

    const out = [];
    for (const p of parts) {
      if (!p.value) continue;
      if (p.type === "mention") out.push(p.value);
      else out.push(`${ENC_OPEN}${await encryptRoomText(roomNumber, p.value)}${ENC_CLOSE}`);
    }
    return out.join("");
  }

  async function decryptMixedRoomText(roomNumber, mixedText) {
    const s = String(mixedText || "");
    let out = "";
    let i = 0;

    while (i < s.length) {
      const a = s.indexOf(ENC_OPEN, i);
      if (a === -1) { out += s.slice(i); break; }

      out += s.slice(i, a);

      const b = s.indexOf(ENC_CLOSE, a + ENC_OPEN.length);
      if (b === -1) { out += s.slice(a); break; }

      const payload = s.slice(a + ENC_OPEN.length, b).trim();
      const dec = await decryptRoomText(roomNumber, payload);
      out += (dec == null) ? `🔒 (can't decrypt) ${payload}` : dec;

      i = b + ENC_CLOSE.length;
    }

    return out;
  }

  const mixedDecryptCache = new Map(); // `${room}|${text}` -> string|null|"PENDING"
  function getDecryptedMixedOrKick(roomNumber, mixedText, scheduleRender) {
    const rn = Number(roomNumber) || 0;
    const key = `${rn}|${mixedText}`;
    const hit = mixedDecryptCache.get(key);
    if (hit && hit !== "PENDING") return { ready: true, text: hit };

    if (hit !== "PENDING") {
      mixedDecryptCache.set(key, "PENDING");
      decryptMixedRoomText(rn, mixedText).then((res) => {
        mixedDecryptCache.set(key, res);
        scheduleRender();
      }).catch(() => {
        mixedDecryptCache.set(key, null);
        scheduleRender();
      });
    }
    return { ready: false, text: "🔒 decrypting…" };
  }

  // ---------------------------------------------------------------------
  // MAIN BOOT (wrapped so errors don't silently kill the overlay)
  // ---------------------------------------------------------------------
  setTimeout(() => {
    try {
      boot();
    } catch (e) {
      console.error(LOG, "BOOT FAILED:", e);
      // Always show launcher so you can retry
      try { ensureLauncher(() => { try { boot(true); } catch (err) { console.error(LOG, "REBOOT FAILED:", err); } }); } catch {}
    }
  }, START_DELAY_MS);

  function ensureLauncher(onClick) {
    if (document.getElementById(LAUNCHER_ID)) return;

    const btn = document.createElement("button");
    btn.id = LAUNCHER_ID;
    btn.type = "button";
    btn.textContent = "💬";
    btn.title = "NCZ Chat Mirror";
    btn.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "width:44px",
      "height:44px",
      "border-radius:999px",
      "border:1px solid rgba(255,255,255,0.18)",
      "background:rgba(0,0,0,0.55)",
      "backdrop-filter:blur(10px)",
      "-webkit-backdrop-filter:blur(10px)",
      "color:#fff",
      "cursor:pointer",
      "font-size:18px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "box-shadow:0 8px 20px rgba(0,0,0,0.35)",
    ].join(";");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick && onClick();
    }, true);

    document.documentElement.appendChild(btn);
  }

  function boot(force = false) {
    // Always add launcher now (so you can pop it even if route detection fails)
    ensureLauncher(() => {
      const host = document.getElementById("ncz-chat-mirror-host");
      if (host) {
        host.style.display = (host.style.display === "none") ? "flex" : "none";
      } else {
        boot(true);
      }
    });

    // If already created, just ensure visibility rules apply
    if (document.getElementById("ncz-chat-mirror-host")) return;

    const st0raw = loadState();

    let paused = !!st0raw.paused;
    let autoscroll = st0raw.autoscroll !== false;
    let hideVotes = !!st0raw.hideVotes;
    let room = Number.isFinite(st0raw.room) ? st0raw.room : 0;
    let encryptSend = !!st0raw.encryptSend;
    let hidden = false;

    // Route state
    let routeActive = false;
    let bootTimer = null;

    // ✅ clamp persisted geometry so the window can't spawn off-screen
    const DEFAULT_W = 520, DEFAULT_H = 380;
    let initW = Number.isFinite(st0raw.width) ? st0raw.width : DEFAULT_W;
    let initH = Number.isFinite(st0raw.height) ? st0raw.height : DEFAULT_H;

    initW = Math.max(320, initW);
    initH = Math.max(260, initH);

    let initLeft = Number.isFinite(st0raw.left) ? st0raw.left : 20;
    let initTop  = Number.isFinite(st0raw.top) ? st0raw.top : 120;

    initLeft = clamp(initLeft, 0, Math.max(0, window.innerWidth  - initW));
    initTop  = clamp(initTop,  0, Math.max(0, window.innerHeight - initH));

    saveState({ left: initLeft, top: initTop, width: initW, height: initH });

    // UI styles
    const style = document.createElement("style");
    style.textContent = `
#ncz-chat-mirror-host .ncz-replyBtn{
  appearance:none;
  border:1px solid rgba(255,255,255,0.16);
  background: rgba(0, 160, 255, 0.12);
  color:#fff;
  width:18px; height:18px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  cursor:pointer;
  font-size:12px;
  line-height:12px;
  opacity:.9;
  position:absolute !important;
  right:10px !important;
  top:50% !important;
  transform:translateY(-50%) !important;
  z-index:5 !important;
}
#ncz-chat-mirror-host .ncz-replyBtn:hover{
  opacity:1;
  background: rgba(0, 160, 255, 0.18);
}
#ncz-chat-mirror-host a.ncz-sunoLink{ text-decoration: underline; cursor: pointer; }
#ncz-chat-mirror-host a.ncz-sunoLink:hover{ text-decoration: none; opacity: .9; }

#ncz-chat-mirror-host * { box-sizing: border-box; }
#ncz-chat-mirror-host select,
#ncz-chat-mirror-host input[type="checkbox"]{ accent-color: rgba(255,255,255,0.85); }

#ncz-chat-mirror-host .ncz-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
#ncz-chat-mirror-host .ncz-ctrl {
  display:flex; align-items:center; gap:6px;
  padding:2px 6px; border-radius:999px;
  border:1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.20);
  font-size:12px; line-height:16px; white-space:nowrap;
}
#ncz-chat-mirror-host .ncz-ctrl label { cursor:pointer; user-select:none; opacity:.95; }
#ncz-chat-mirror-host .ncz-ctrl input { cursor:pointer; }

#ncz-chat-mirror-host .ncz-select {
  padding:4px 8px; border-radius:999px;
  border:1px solid rgba(255,255,255,0.14);
  background: rgba(0,0,0,0.20);
  color:#fff; font-size:12px;
  outline:none;
}
#ncz-chat-mirror-host .ncz-miniBtn {
  appearance:none;
  border:1px solid rgba(255,255,255,0.16);
  background:rgba(0,0,0,0.25);
  color:#fff;
  padding:4px 8px;
  border-radius:999px;
  font-size:12px;
  cursor:pointer;
  line-height:16px;
}
#ncz-chat-mirror-host .ncz-miniBtn:hover { background:rgba(255,255,255,0.10); }

#ncz-chat-mirror-host .ncz-blockBtn {
  appearance:none;
  border:1px solid rgba(255,255,255,0.16);
  background: rgba(255, 0, 0, 0.12);
  color:#fff;
  width:18px; height:18px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  margin-right:6px;
  cursor:pointer;
  font-size:12px;
  line-height:12px;
  vertical-align:middle;
  opacity: .9;
}
#ncz-chat-mirror-host .ncz-blockBtn:hover { opacity: 1; background: rgba(255, 0, 0, 0.18); }

#ncz-chat-mirror-host .ncz-hint { opacity:.72; font-size:12px; padding:6px 2px; }

#ncz-chat-mirror-host .ncz-footer {
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px;
  border-top:1px solid rgba(255,255,255,0.10);
  background:rgba(255,255,255,0.05);
}
#ncz-chat-mirror-host .ncz-roomTag {
  font-size:12px;
  opacity:.85;
  white-space:nowrap;
  padding:3px 8px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,0.14);
  background:rgba(0,0,0,0.22);
}
#ncz-chat-mirror-host .ncz-sendInput {
  flex:1;
  min-width:140px;
  padding:8px 10px;
  border-radius:10px;
  border:1px solid rgba(255,255,255,0.14);
  background:rgba(0,0,0,0.28);
  color:#fff;
  outline:none;
  font-size:13px;
}
#ncz-chat-mirror-host .ncz-sendInput::placeholder { color: rgba(255,255,255,0.45); }
#ncz-chat-mirror-host .ncz-sendBtn {
  padding:8px 12px;
  border-radius:10px;
  border:1px solid rgba(255,255,255,0.16);
  background:rgba(255,255,255,0.10);
  color:#fff;
  font-size:13px;
  cursor:pointer;
  white-space:nowrap;
}
#ncz-chat-mirror-host .ncz-sendBtn:hover { background:rgba(255,255,255,0.16); }

#ncz-chat-mirror-host a[href^="/@"],
#ncz-chat-mirror-host span.font-medium{
  margin-right: 6px !important;
  display: inline-block;
}
`;
    document.documentElement.appendChild(style);

    // Host
    const host = document.createElement("div");
    host.id = "ncz-chat-mirror-host";
    host.style.cssText = [
      "position:fixed",
      `left:${initLeft}px`,
      `top:${initTop}px`,
      `width:${initW}px`,
      `height:${initH}px`,
      "z-index:2147483647",
      "background:rgba(0,0,0,0.72)",
      "border:1px solid rgba(255,255,255,0.18)",
      "border-radius:14px",
      "box-shadow:0 10px 30px rgba(0,0,0,0.45)",
      "backdrop-filter:blur(10px)",
      "-webkit-backdrop-filter:blur(10px)",
      "color:#fff",
      "font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial",
      "display:flex",
      "flex-direction:column",
      "overflow:hidden",
      "resize:both",
      "min-width:320px",
      "min-height:260px",
    ].join(";");

    // Header (draggable)
    const header = document.createElement("div");
    header.style.cssText = [
      "padding:10px 10px 8px 12px",
      "user-select:none",
      "border-bottom:1px solid rgba(255,255,255,0.10)",
      "background:rgba(255,255,255,0.06)",
    ].join(";");

    const topRow = document.createElement("div");
    topRow.className = "ncz-row";
    topRow.style.cssText = "justify-content:space-between; gap:10px;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:800;font-size:13px;letter-spacing:.2px;opacity:.95;";

    function roomLabel() {
      return room === 0 ? "Base chat" : `Chat ${room} (ROOM${room}:)`;
    }
    title.textContent = `Chat Mirror — ${roomLabel()}`;

    const rightBtns = document.createElement("div");
    rightBtns.className = "ncz-row";
    rightBtns.style.cssText = "gap:8px;";

    const btnRescan = document.createElement("button");
    btnRescan.className = "ncz-miniBtn";
    btnRescan.textContent = "Rescan";
    btnRescan.title = "Force re-detect chat container";

    const btnClose = document.createElement("button");
    btnClose.className = "ncz-miniBtn";
    btnClose.textContent = "✕";
    btnClose.setAttribute("aria-label", "Close mirror");

    rightBtns.append(btnRescan, btnClose);
    topRow.append(title, rightBtns);

    const ctrlRow = document.createElement("div");
    ctrlRow.className = "ncz-row";
    ctrlRow.style.cssText = "margin-top:8px;";

    const ctrlPause = document.createElement("div");
    ctrlPause.className = "ncz-ctrl";
    const cbPause = document.createElement("input");
    cbPause.type = "checkbox";
    cbPause.checked = paused;
    const lbPause = document.createElement("label");
    lbPause.textContent = "Pause";
    lbPause.addEventListener("click", () => cbPause.click());
    ctrlPause.append(cbPause, lbPause);

    const ctrlAuto = document.createElement("div");
    ctrlAuto.className = "ncz-ctrl";
    const cbAuto = document.createElement("input");
    cbAuto.type = "checkbox";
    cbAuto.checked = autoscroll;
    const lbAuto = document.createElement("label");
    lbAuto.textContent = "Auto-scroll";
    lbAuto.addEventListener("click", () => cbAuto.click());
    ctrlAuto.append(cbAuto, lbAuto);

    const ctrlVotes = document.createElement("div");
    ctrlVotes.className = "ncz-ctrl";
    const cbVotes = document.createElement("input");
    cbVotes.type = "checkbox";
    cbVotes.checked = hideVotes;
    const lbVotes = document.createElement("label");
    lbVotes.textContent = 'Hide "voted for"';
    lbVotes.addEventListener("click", () => cbVotes.click());
    ctrlVotes.append(cbVotes, lbVotes);

    const ctrlEnc = document.createElement("div");
    ctrlEnc.className = "ncz-ctrl";
    const cbEnc = document.createElement("input");
    cbEnc.type = "checkbox";
    cbEnc.checked = encryptSend;
    const lbEnc = document.createElement("label");
    lbEnc.textContent = "Encrypt send";
    lbEnc.title = "If enabled, ROOM messages are encrypted (mentions stay plaintext).";
    lbEnc.addEventListener("click", () => cbEnc.click());
    ctrlEnc.append(cbEnc, lbEnc);

    const roomSelect = document.createElement("select");
    roomSelect.className = "ncz-select";
    {
      const optBase = document.createElement("option");
      optBase.value = "0";
      optBase.textContent = "Base chat";
      roomSelect.appendChild(optBase);
      for (let i = 1; i <= 99; i++) {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `Chat ${i}`;
        roomSelect.appendChild(o);
      }
      roomSelect.value = String(room);
    }

    const unblockSelect = document.createElement("select");
    unblockSelect.className = "ncz-select";
    function rebuildUnblockSelect() {
      const st = loadState();
      const list = getBlockedList(st);

      unblockSelect.innerHTML = "";
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = list.length ? `Blocked: ${list.length} (pick to unblock)` : "Blocked: (none)";
      unblockSelect.appendChild(ph);

      for (const u of list) {
        const o = document.createElement("option");
        o.value = u;
        o.textContent = u;
        unblockSelect.appendChild(o);
      }
      unblockSelect.value = "";
    }
    rebuildUnblockSelect();

    ctrlRow.append(ctrlPause, ctrlAuto, ctrlVotes, ctrlEnc, roomSelect, unblockSelect);
    header.append(topRow, ctrlRow);
    host.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.style.cssText = "flex:1;overflow:auto;padding:10px;font-size:12px;";
    const hint = document.createElement("div");
    hint.className = "ncz-hint";
    hint.textContent = "Waiting for chat container…";
    body.appendChild(hint);
    host.appendChild(body);

    // Footer (mirrored send)
    const footer = document.createElement("div");
    footer.className = "ncz-footer";

    const roomTag = document.createElement("div");
    roomTag.className = "ncz-roomTag";

    function updateRoomTag() {
      if (room === 0) roomTag.textContent = "Send: Base chat";
      else roomTag.textContent = encryptSend ? `Send: ROOM${room}: (encrypted)` : `Send: ROOM${room}: (plain)`;
    }
    updateRoomTag();

    const mirrorInput = document.createElement("input");
    mirrorInput.className = "ncz-sendInput";
    mirrorInput.type = "text";
    mirrorInput.placeholder = "Type here to send via main chat…";

    const mirrorSendBtn = document.createElement("button");
    mirrorSendBtn.className = "ncz-sendBtn";
    mirrorSendBtn.type = "button";
    mirrorSendBtn.textContent = "Send";

    footer.append(roomTag, mirrorInput, mirrorSendBtn);
    host.appendChild(footer);

    document.documentElement.appendChild(host);

    // Drag
    let dragging = false;
    let dragStartX = 0, dragStartY = 0;
    let startLeft = 0, startTop = 0;

    function isControlTarget(t) {
      if (!t) return false;
      return !!(t.closest("button") || t.closest("select") || t.closest("input") || t.closest("label"));
    }

    function onDragMove(e) {
      if (!dragging) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = host.getBoundingClientRect();
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      const left = clamp(startLeft + dx, 0, vw - rect.width);
      const top = clamp(startTop + dy, 0, vh - rect.height);
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      saveState({ left, top });
    }

    function endDrag() {
      dragging = false;
      window.removeEventListener("pointermove", onDragMove, true);
      window.removeEventListener("pointerup", endDrag, true);
      window.removeEventListener("pointercancel", endDrag, true);
      window.removeEventListener("blur", endDrag, true);
    }

    header.addEventListener("pointerdown", (e) => {
      if (isControlTarget(e.target)) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      const rect = host.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      window.addEventListener("pointermove", onDragMove, true);
      window.addEventListener("pointerup", endDrag, true);
      window.addEventListener("pointercancel", endDrag, true);
      window.addEventListener("blur", endDrag, true);

      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Resize persist
    const resizeObserver = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      saveState({ width: Math.round(rect.width), height: Math.round(rect.height) });
    });
    resizeObserver.observe(host);

    // Controls
    cbPause.addEventListener("change", () => {
      paused = cbPause.checked;
      saveState({ paused });
      if (!paused) renderNow();
    });

    cbAuto.addEventListener("change", () => {
      autoscroll = cbAuto.checked;
      saveState({ autoscroll });
    });

    cbVotes.addEventListener("change", () => {
      hideVotes = cbVotes.checked;
      saveState({ hideVotes });
      renderNow();
    });

    cbEnc.addEventListener("change", () => {
      encryptSend = cbEnc.checked;
      saveState({ encryptSend });
      updateRoomTag();
    });

    roomSelect.addEventListener("change", () => {
      room = parseInt(roomSelect.value, 10) || 0;
      saveState({ room });
      title.textContent = `Chat Mirror — ${roomLabel()}`;
      updateRoomTag();
      renderNow();
    });

    unblockSelect.addEventListener("change", () => {
      const val = unblockSelect.value;
      if (!val) return;
      removeBlocked(val);
      rebuildUnblockSelect();
      renderNow();
    });

    btnClose.addEventListener("click", () => {
      hidden = true;
      host.style.display = "none";
    });

    // Toggle show/hide (Ctrl+Shift+M) + emergency reset (Ctrl+Shift+Backspace)
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
        hidden = !hidden;
        applyVisibility();
        if (!hidden && !paused) renderNow();
      }
      if (e.ctrlKey && e.shiftKey && e.key === "Backspace") {
        hidden = false;
        const left = 20, top = 120, width = 520, height = 380;
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
        saveState({ left, top, width, height, paused: false });
        paused = false;
        cbPause.checked = false;
        applyVisibility();
        renderNow();
      }
    });

    // Mirrored send logic
    async function sendFromMirror() {
      if (!routeActive) return;

      const st = loadState();
      const activeRoom = Number.isFinite(st.room) ? st.room : room;
      const prefix = activeRoom > 0 ? `ROOM${activeRoom}:` : "";

      const raw = String(mirrorInput.value || "");
      const text = raw.trim();
      if (!text) return;

      const mainInput = findMainChatInput();
      if (!mainInput) return;

      let msgToSend = "";

      if (activeRoom > 0) {
        if (encryptSend) {
          const encrypted = await encryptRoomTextKeepMentions(activeRoom, text);
          msgToSend = `${prefix} ${encrypted}`;
        } else {
          msgToSend = `${prefix} ${obfuscateDotCom(text)}`;
        }
      } else {
        msgToSend = obfuscateDotCom(text);
      }

      mainInput.focus();
      setNativeValue(mainInput, msgToSend);

      const sendBtn = findMainSendButton(mainInput);

      setTimeout(() => {
        if (sendBtn) sendBtn.click();
      }, 0);

      mirrorInput.value = "";
      mirrorInput.focus();
    }

    mirrorSendBtn.addEventListener("click", () => {
      sendFromMirror().catch((e) => console.error(LOG, "sendFromMirror failed:", e));
    });
    mirrorInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendFromMirror().catch((err) => console.error(LOG, "sendFromMirror failed:", err));
      }
    });

    // Mirroring
    let sourceEl = null;
    let sourceObserver = null;
    let rafPending = false;

    function scheduleRender() {
      if (!routeActive || paused || hidden) return;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        renderNow();
      });
    }

    function cleanupSourceObserver() {
      if (sourceObserver) {
        try { sourceObserver.disconnect(); } catch {}
        sourceObserver = null;
      }
    }

    function attachToSource(el) {
      if (!routeActive) return;

      if (!el) {
        cleanupSourceObserver();
        sourceEl = null;
        body.replaceChildren(hint);
        hint.textContent = "Waiting for chat container…";
        return;
      }
      if (sourceEl === el && sourceObserver) return;

      sourceEl = el;
      cleanupSourceObserver();

      sourceObserver = new MutationObserver(scheduleRender);
      sourceObserver.observe(sourceEl, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      renderNow();
    }

    function mentionFor(username) {
      const clean = String(username || "").trim().replace(/^@+/, "");
      return clean ? `@${clean} ` : "";
    }

    function insertAtCursor(input, text) {
      if (!input) return;
      const v = String(input.value || "");
      const start = Number.isFinite(input.selectionStart) ? input.selectionStart : v.length;
      const end = Number.isFinite(input.selectionEnd) ? input.selectionEnd : v.length;
      input.value = v.slice(0, start) + text + v.slice(end);
      const pos = start + text.length;
      try { input.setSelectionRange(pos, pos); } catch {}
    }

    function renderNow() {
      if (!routeActive) return;

      const el = sourceEl || findMessagesList();
      if (!el) {
        body.replaceChildren(hint);
        hint.textContent = "Waiting for chat container…";
        return;
      }
      if (el !== sourceEl) attachToSource(el);

      const st = loadState();
      const blocked = getBlockedList(st);
      const blockedSet = new Set(blocked.map(norm));
      const activeRoom = Number.isFinite(st.room) ? st.room : room;
      const roomPrefix = activeRoom > 0 ? `ROOM${activeRoom}:` : "";

      const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 12;

      const mirrorWrap = document.createElement("div");
      mirrorWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";

      const msgNodes = getMessageNodesFromList(el);

      let kept = 0;
      for (const msg of msgNodes) {
        const username = extractUsername(msg);
        const uKey = norm(username);

        if (uKey && blockedSet.has(uKey)) continue;

        const fullText = (msg.innerText || msg.textContent || "").replace(/\u200B/g, "").trim();
        const rawContent = extractContent(msg, username);

        if (hideVotes) {
          const ft = fullText.toLowerCase();
          if (ft.includes("voted for") || ft.includes("switched from")) continue;
        }

        if (activeRoom > 0) {
          const c0 = String(rawContent || "").trimStart();
          if (!c0.startsWith(roomPrefix)) continue;
        }

        const c = msg.cloneNode(true);
        c.querySelectorAll('button[aria-label^="Reply"], button[aria-label*="Reply"]').forEach((b) => b.remove());

        if (activeRoom > 0) {
          const stripped = stripRoomPrefix(rawContent, roomPrefix);
          const candidate = String(stripped || "").trim();

          let displayText = stripped;

          if (looksMixedEncrypted(stripped)) {
            const dec = getDecryptedMixedOrKick(activeRoom, stripped, scheduleRender);
            displayText = dec.ready
              ? ((dec.text == null) ? `🔒 (can't decrypt) ${stripped}` : dec.text)
              : dec.text;
          } else if (looksEncryptedPayload(candidate) || candidate.startsWith("NCZ0.")) {
            const dec = getDecryptedOrKick(activeRoom, candidate, scheduleRender);
            displayText = dec.ready
              ? ((dec.text == null) ? `🔒 (can't decrypt) ${candidate}` : dec.text)
              : dec.text;
          }

          applyDisplayContentToClone(c, displayText, roomPrefix);
        }

        linkifySunoLinksInClone(c);

        const nameEl =
          c.querySelector('a[href^="/@"]') ||
          c.querySelector("span.font-medium");

        if (nameEl && username) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ncz-blockBtn";
          btn.textContent = "⛔";
          btn.title = `Block ${username}`;
          btn.setAttribute("aria-label", `Block ${username}`);
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            addBlocked(username);
            rebuildUnblockSelect();
            renderNow();
          });
          nameEl.parentNode.insertBefore(btn, nameEl);

          const rbtn = document.createElement("button");
          rbtn.type = "button";
          rbtn.className = "ncz-replyBtn";
          rbtn.textContent = "↩";
          rbtn.title = `Reply to ${username}`;
          rbtn.setAttribute("aria-label", `Reply to ${username}`);
          rbtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            const m = mentionFor(username);
            if (!m) return;

            mirrorInput.focus();

            const cur = String(mirrorInput.value || "");
            if (cur.trimStart().toLowerCase().startsWith(m.trim().toLowerCase())) return;

            if (!cur) mirrorInput.value = m;
            else insertAtCursor(mirrorInput, m);

            mirrorInput.focus();
          });

          c.style.position = "relative";
          c.style.overflow = "visible";
          c.style.paddingRight = "34px";

          c.appendChild(rbtn);
        }

        mirrorWrap.appendChild(c);
        kept++;
      }

      if (!kept) {
        const none = document.createElement("div");
        none.className = "ncz-hint";
        none.textContent =
          activeRoom > 0
            ? `No messages matched ${roomPrefix} (or they're blocked).`
            : "No messages (or they're blocked).";
        mirrorWrap.appendChild(none);
      }

      body.replaceChildren(mirrorWrap);

      if (autoscroll && nearBottom) {
        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
      }
    }

    // Global observer (only active on live-radio context)
    const globalObserver = new MutationObserver(() => {
      if (!routeActive) return;
      const el = findMessagesList();
      if (el && el !== sourceEl) attachToSource(el);
    });

    function startMirroring() {
      try { globalObserver.observe(document.documentElement, { subtree: true, childList: true }); } catch {}
      bootTry();
      if (!paused) renderNow();
    }

    function stopMirroring() {
      try { globalObserver.disconnect(); } catch {}
      cleanupSourceObserver();
      sourceEl = null;

      if (bootTimer) {
        clearTimeout(bootTimer);
        bootTimer = null;
      }
    }

    function applyVisibility() {
      host.style.display = (routeActive && !hidden) ? "flex" : "none";
    }

    btnRescan.addEventListener("click", () => {
      if (!routeActive) return;
      sourceEl = null;
      attachToSource(findMessagesList());
    });

    function bootTry() {
      if (!routeActive) return;

      const el = findMessagesList();
      if (el) attachToSource(el);
      else bootTimer = setTimeout(bootTry, 700);
    }

    // SPA navigation detection: history hooks + popstate + fallback poll
    function emitLocationChange() {
      window.dispatchEvent(new Event("ncz-locationchange"));
    }

    const _pushState = history.pushState;
    const _replaceState = history.replaceState;

    history.pushState = function (...args) {
      const ret = _pushState.apply(this, args);
      emitLocationChange();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = _replaceState.apply(this, args);
      emitLocationChange();
      return ret;
    };

    window.addEventListener("popstate", emitLocationChange);
    window.addEventListener("hashchange", emitLocationChange);

    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        emitLocationChange();
      }
    }, 500);

    function onRouteMaybeChanged(force = false) {
      const now = isLiveRadioContext();
      if (!force && now === routeActive) return;

      if (!routeActive && now) {
        routeActive = true;
        hidden = false;
        applyVisibility();
        startMirroring();
      } else if (routeActive && !now) {
        routeActive = false;
        applyVisibility();
        stopMirroring();
      } else {
        routeActive = now;
        applyVisibility();
      }
    }

    window.addEventListener("ncz-locationchange", () => onRouteMaybeChanged(true));

    // Initial route state
    routeActive = force ? true : isLiveRadioContext();
    applyVisibility();
    if (routeActive) startMirroring();

    // If we weren't in live-radio context, leave it hidden but launcher still works.
    // (Click the 💬 launcher to force-open + boot.)
    if (!routeActive) {
      host.style.display = "none";
    }

    // quick global helpers
    window.nczChatMirrorReset = () => {
      const left = 20, top = 120, width = 520, height = 380;
      saveState({ left, top, width, height, paused: false });
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
      hidden = false;
      paused = false;
      cbPause.checked = false;
      routeActive = true;
      applyVisibility();
      startMirroring();
    };

    console.log(LOG, "boot ok", { routeActive, url: location.pathname, hasChatInput: hasAnyChatInput() });
  }
})();
