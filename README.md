
# Suno Chat Mirror (Live Radio Overlay)

Install the extension from the releases page here: https://github.com/cybershrapnel/Suno_Chat/releases/tag/suno

A lightweight **userscript** that adds a **movable + resizable chat mirror window** for **Suno Live Radio chat**. It mirrors the live chat feed, lets you filter/route messages by “ROOMx:” prefixes, block users, and send messages via the real Suno input — all from a separate overlay.

> Runs on `https://suno.com/*` but **only shows the UI on** `https://suno.com/live-radio` (SPA/AJAX navigation supported).

---

<img src="https://github.com/cybershrapnel/Suno_Chat/blob/main/G90OTxWWsAAObCW.jpg?raw=true">

## Features

### Chat mirror overlay
- Mirrors the Live Radio chat feed into a separate window
- **Draggable + resizable**
- Remembers position/size + settings via `localStorage`

### Filters & controls
- **Pause** mirroring
- **Auto-scroll** toggle
- Hide system spam:
  - hides messages containing **“voted for”**
  - also hides messages containing **“switched from”** (same checkbox)
- **Room selector**:
  - Base chat (no prefix)
  - Room mode: shows only messages whose content starts with `ROOMX:`
  - In room mode, the mirror display strips the `ROOMX:` prefix for readability

### Blocklist UI
- One-click **block** button next to usernames in the mirror
- Dropdown to **unblock** users
- Stored persistently (per-browser)

### Reply helper
- A **reply button** on each mirrored message inserts `@username ` into the mirror input

### Mirrored send box
- Type in the overlay → it writes into the **real** Suno chat input and clicks Send
- If a room is selected, it prefixes outgoing messages with `ROOMX:`

### URL “.com” obfuscation
- Outgoing messages automatically insert a **Word Joiner** (U+2060) before `.com`
  - Example: `suno.com` → `suno⁠.com`
- This helps break auto-linking behavior while still looking normal.

### Live Radio only (SPA-friendly)
- Script is loaded on all Suno pages (so it survives SPA/AJAX navigation)
- Overlay **auto-hides** on non-radio pages
- Overlay **auto-shows when you enter** `/live-radio`
  - Even if you previously closed it with ✕

### Startup delay
- Waits **5 seconds** after page load before initializing (helps avoid early DOM timing issues)

---

## Install

### Option A — Tampermonkey (recommended)
1. Install **Tampermonkey** (Chrome/Edge/Firefox) or **Violentmonkey** or paste directly into console and run
2. Create a new script
3. Paste the contents of `Suno_Chat.js`
4. Save
5. Visit: `https://suno.com/live-radio`

### Option B — “Userscript extension wrapper”
Install the developer chrome extension from the releases page here. I am trying to get it listed on the chrome web store.

---

## Usage

1. Navigate to **Live Radio**:
   - `https://suno.com/live-radio`
2. The mirror window appears after the startup delay.
3. Drag the header to move it.
4. Resize from the bottom-right corner.
5. Use the bottom input to send messages.

### Keyboard shortcut
- **Ctrl + Shift + M** → toggle mirror visibility  
  (Note: the script still enforces Live Radio only — it won’t show on other pages.)

### Close behavior
- Clicking **✕** hides the window
- **Entering `/live-radio` automatically re-opens it** (even if it was previously closed)

---

## UI Controls

- **Rescan**: forces re-detection of the live chat container
- **Pause**: stops mirroring updates
- **Auto-scroll**: keeps view pinned to the bottom
- **Hide "voted for"**: hides “voted for” + “switched from”
- **Room select**:
  - Base chat = no prefix filtering
  - Chat X = filters messages that start with `ROOMX:`

---

## Privacy / Security

- No external network calls
- No analytics
- No data is sent anywhere
- Stores settings locally via `localStorage`:
  - Key: `ncz_chatMirror_state_v2`

---

## Troubleshooting

### “Waiting for chat container…”
- You may not be on `/live-radio`, or the chat DOM hasn’t mounted yet.
- Click **Rescan**.
- If Suno changed their UI structure, selectors may need updates.

### Mirror doesn’t send messages
- Suno may have changed the input/button selectors
- Ensure you’re on `/live-radio` and logged in
- Try focusing the real chat input once, then use the mirror again

### Overlay not visible
- Make sure you’re on `https://suno.com/live-radio`
- If you toggled it off via hotkey, use **Ctrl+Shift+M**
- Navigating away from `/live-radio` will hide it automatically

---

## Development Notes

This script supports SPA navigation by:
- Hooking `history.pushState` / `history.replaceState`
- Listening to `popstate` / `hashchange`
- A lightweight `setInterval` fallback to detect URL changes

The mirror relies on DOM heuristics to find the live chat container and messages. Suno UI updates may require selector tweaks.
