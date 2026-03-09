(() => {
  "use strict";

  const OPEN_EVENT = "ncz-json-media-downloader-open";
  const PANEL_ID = "ncz-json-media-downloader-panel";
  const LOADED_FLAG = "__ncz_json_media_downloader_loaded__";

  if (window[LOADED_FLAG]) return;
  window[LOADED_FLAG] = true;

  const PLAYLIST_API_BASE = "https://studio-api.prod.suno.com/api/playlist";

  function sanitizeFilename(name, fallback = "file") {
    return String(name || fallback)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || fallback;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getExtFromUrl(url, fallback = "") {
    try {
      const u = new URL(url, location.href);
      const pathname = u.pathname || "";
      const match = pathname.match(/\.([a-zA-Z0-9]{2,8})(?:$|\?)/);
      return match ? "." + match[1].toLowerCase() : fallback;
    } catch {
      return fallback;
    }
  }

  function extractPlaylistUuid(input) {
    const s = String(input || "").trim();
    if (!s) return "";
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : "";
  }

  function extractEntries(json) {
    let arr = null;

    if (json?.playlist_schema?.playlist_clips && Array.isArray(json.playlist_schema.playlist_clips)) {
      arr = json.playlist_schema.playlist_clips;
    } else if (Array.isArray(json?.playlist_clips)) {
      arr = json.playlist_clips;
    } else if (Array.isArray(json)) {
      arr = json;
    }

    if (!arr) {
      throw new Error("Could not find playlist_clips array in pasted JSON.");
    }

    return arr.map((entry, idx) => {
      const clip = entry?.clip ?? entry ?? {};
      return {
        index: idx + 1,
        title: clip?.title || entry?.title || `untitled_${idx + 1}`,
        video_cover_url: clip?.video_cover_url || entry?.video_cover_url || "",
        audio_url: clip?.audio_url || entry?.audio_url || "",
        video_url: clip?.video_url || entry?.video_url || "",
        clip_id: clip?.id || entry?.id || "",
        raw: entry
      };
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      headers: {
        "accept": "application/json, text/plain, */*"
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.json();
  }

  function makeEntryKey(entry, idx) {
    const clip = entry?.clip ?? entry ?? {};
    return (
      clip?.id ||
      entry?.id ||
      clip?.audio_url ||
      clip?.video_url ||
      `${clip?.title || entry?.title || "untitled"}__${idx}`
    );
  }

  async function fetchWholePlaylist(uuid, log) {
    const cleanUuid = extractPlaylistUuid(uuid);
    if (!cleanUuid) throw new Error("Invalid playlist UUID.");

    const merged = [];
    const seen = new Set();
    let firstPageJson = null;
    let page = 1;
    let emptyPagesInRow = 0;
    const maxPages = 1000;

    while (page <= maxPages) {
      const url = `${PLAYLIST_API_BASE}/${cleanUuid}/?page=${page}`;
      log(`Fetching playlist page ${page}...`);
      const data = await fetchJson(url);

      if (!firstPageJson) {
        firstPageJson = data;
      }

      const pageClips =
        data?.playlist_schema?.playlist_clips && Array.isArray(data.playlist_schema.playlist_clips)
          ? data.playlist_schema.playlist_clips
          : Array.isArray(data?.playlist_clips)
            ? data.playlist_clips
            : [];

      if (!pageClips.length) {
        emptyPagesInRow++;
        log(`Page ${page} returned 0 items.`);
        if (emptyPagesInRow >= 1) break;
      } else {
        emptyPagesInRow = 0;
        let addedThisPage = 0;

        pageClips.forEach((entry, idx) => {
          const key = makeEntryKey(entry, idx);
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(entry);
            addedThisPage++;
          }
        });

        log(`Page ${page} returned ${pageClips.length} items, added ${addedThisPage}, merged total ${merged.length}.`);
      }

      page++;
      await sleep(150);
    }

    if (!firstPageJson) {
      throw new Error("Could not fetch first playlist page.");
    }

    if (firstPageJson?.playlist_schema) {
      firstPageJson.playlist_schema.playlist_clips = merged;
    } else {
      firstPageJson.playlist_clips = merged;
    }

    firstPageJson._dump_meta = {
      playlist_uuid: cleanUuid,
      pages_fetched: page - 1,
      merged_items: merged.length,
      dumped_at: new Date().toISOString()
    };

    return firstPageJson;
  }

  async function fetchBlob(url) {
    const res = await fetch(url, {
      method: "GET",
      credentials: "omit"
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.blob();
  }

  function triggerBlobDownload(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
  }

  function triggerUrlDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener noreferrer";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function tryDownload(url, filename, log, current, total) {
    try {
      const blob = await fetchBlob(url);
      triggerBlobDownload(blob, filename);
      log(`[${current}/${total}] Downloaded: ${filename}`);
      return true;
    } catch (err) {
      log(`[${current}/${total}] Fetch failed for ${filename}, trying direct-link fallback... (${err.message})`);
      try {
        triggerUrlDownload(url, filename);
        log(`[${current}/${total}] Triggered direct-link fallback: ${filename}`);
        return true;
      } catch (err2) {
        log(`[${current}/${total}] FAILED: ${filename} :: ${err2.message}`);
        return false;
      }
    }
  }

  function makeReportText(modeLabel, skipped, failed) {
    const lines = [];
    lines.push(`Report for mode: ${modeLabel}`);
    lines.push("");

    lines.push(`Skipped entries: ${skipped.length}`);
    lines.push("");
    if (skipped.length) {
      skipped.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    } else {
      lines.push("None");
    }

    lines.push("");
    lines.push(`Failed entries: ${failed.length}`);
    lines.push("");
    if (failed.length) {
      failed.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
    } else {
      lines.push("None");
    }

    lines.push("");
    return lines.join("\n");
  }

  const DOWNLOAD_MODES = {
    both: {
      label: "both",
      required: ["video_cover_url", "audio_url"],
      files: [
        { key: "video_cover_url", fallbackExt: ".jpg" },
        { key: "audio_url", fallbackExt: ".mp3" }
      ]
    },
    mp3: {
      label: "mp3",
      required: ["audio_url"],
      files: [
        { key: "audio_url", fallbackExt: ".mp3" }
      ]
    },
    covers: {
      label: "covers",
      required: ["video_cover_url"],
      files: [
        { key: "video_cover_url", fallbackExt: ".jpg" }
      ]
    },
    genvideos: {
      label: "generated_videos",
      required: ["video_url"],
      files: [
        { key: "video_url", fallbackExt: ".mp4" }
      ]
    }
  };

  function openPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.style.display = "block";
      existing.querySelector(`#${PANEL_ID}-uuid`)?.focus();
      return;
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 560px;
      max-width: calc(100vw - 40px);
      background: #111;
      color: #eee;
      border: 1px solid #444;
      border-radius: 10px;
      padding: 12px;
      z-index: 2147483647;
      box-shadow: 0 10px 30px rgba(0,0,0,.45);
      font: 12px/1.4 monospace;
    `;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <strong style="font-size:14px;">JSON Media Downloader</strong>
        <button id="${PANEL_ID}-close" style="background:#600;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;">X</button>
      </div>

      <div style="margin-bottom:8px;">Playlist UUID or full playlist URL:</div>

      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
        <input
          id="${PANEL_ID}-uuid"
          type="text"
          placeholder="Paste playlist UUID or full Suno playlist URL here..."
          style="
            flex:1;
            background:#1a1a1a;
            color:#fff;
            border:1px solid #555;
            border-radius:8px;
            padding:8px;
            box-sizing:border-box;
          "
        />
        <button id="${PANEL_ID}-fetch" style="background:#265dbe;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Fetch Playlist</button>
      </div>

      <div style="margin-bottom:8px;">Paste your full JSON dump below, or fetch it above.</div>

      <textarea id="${PANEL_ID}-input" spellcheck="false" style="
        width:100%;
        height:220px;
        resize:vertical;
        background:#1a1a1a;
        color:#fff;
        border:1px solid #555;
        border-radius:8px;
        padding:8px;
        box-sizing:border-box;
      " placeholder="Paste full JSON here..."></textarea>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        <button id="${PANEL_ID}-both" style="background:#0a6;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Download Both</button>
        <button id="${PANEL_ID}-mp3" style="background:#4a7;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Download MP3s</button>
        <button id="${PANEL_ID}-covers" style="background:#875;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Download Covers</button>
        <button id="${PANEL_ID}-genvideos" style="background:#a63;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Download Generated Videos</button>
        <button id="${PANEL_ID}-clear" style="background:#555;color:#fff;border:none;border-radius:6px;padding:8px 12px;cursor:pointer;">Clear</button>
      </div>

      <div style="margin-top:10px;font-size:11px;opacity:.85;">
        <div><b>Download Both</b> requires both <code>video_cover_url</code> and <code>audio_url</code>.</div>
        <div><b>Download MP3s</b> uses <code>audio_url</code>.</div>
        <div><b>Download Covers</b> uses <code>video_cover_url</code>.</div>
        <div><b>Download Generated Videos</b> uses <code>video_url</code>.</div>
      </div>

      <pre id="${PANEL_ID}-log" style="
        margin-top:10px;
        white-space:pre-wrap;
        word-break:break-word;
        background:#0b0b0b;
        border:1px solid #333;
        border-radius:8px;
        padding:8px;
        height:220px;
        overflow:auto;
      "></pre>
    `;

    document.body.appendChild(panel);

    const $uuid = document.getElementById(`${PANEL_ID}-uuid`);
    const $input = document.getElementById(`${PANEL_ID}-input`);
    const $log = document.getElementById(`${PANEL_ID}-log`);
    const $fetch = document.getElementById(`${PANEL_ID}-fetch`);
    const $both = document.getElementById(`${PANEL_ID}-both`);
    const $mp3 = document.getElementById(`${PANEL_ID}-mp3`);
    const $covers = document.getElementById(`${PANEL_ID}-covers`);
    const $genvideos = document.getElementById(`${PANEL_ID}-genvideos`);
    const $clear = document.getElementById(`${PANEL_ID}-clear`);
    const $close = document.getElementById(`${PANEL_ID}-close`);

    function log(msg) {
      const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
      console.log(line);
      $log.textContent += line + "\n";
      $log.scrollTop = $log.scrollHeight;
    }

    function setButtonsDisabled(disabled) {
      [$fetch, $both, $mp3, $covers, $genvideos, $clear].forEach(btn => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? "0.65" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
      });
    }

    async function runDownloadMode(modeKey) {
      const mode = DOWNLOAD_MODES[modeKey];
      if (!mode) return;

      setButtonsDisabled(true);
      try {
        const raw = $input.value.trim();
        if (!raw) throw new Error("No JSON pasted or fetched.");

        log(`Parsing JSON for mode "${mode.label}"...`);
        const json = JSON.parse(raw);
        const entries = extractEntries(json);

        log(`Found ${entries.length} entries.`);

        const valid = [];
        const skipped = [];
        const failed = [];

        for (const item of entries) {
          const hasAllRequired = mode.required.every(key => !!item[key]);
          if (hasAllRequired) {
            valid.push(item);
          } else {
            skipped.push(item.title || `untitled_${item.index}`);
          }
        }

        log(`Mode "${mode.label}" will process ${valid.length} entries.`);
        log(`Mode "${mode.label}" skipped ${skipped.length} entries for missing required URL(s).`);

        let completed = 0;

        for (let i = 0; i < valid.length; i++) {
          const item = valid[i];
          const current = i + 1;
          const total = valid.length;
          const base = sanitizeFilename(item.title || `clip_${item.index}`, `clip_${item.index}`);

          log(`[${current}/${total}] Processing: ${item.title}`);

          let itemOk = true;

          for (const fileDef of mode.files) {
            const url = item[fileDef.key];
            const ext = getExtFromUrl(url, fileDef.fallbackExt);
            const filename = `${base}${ext}`;
            const ok = await tryDownload(url, filename, log, current, total);
            if (!ok) itemOk = false;
            await sleep(250);
          }

          if (!itemOk) {
            failed.push(item.title || `untitled_${item.index}`);
          } else {
            completed++;
          }

          await sleep(350);
        }

        const reportText = makeReportText(mode.label, skipped, failed);
        const reportBlob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
        triggerBlobDownload(reportBlob, `skipped_titles_${mode.label}.txt`);
        log(`Downloaded skipped_titles_${mode.label}.txt`);

        log(`Done for mode "${mode.label}". Completed ${completed}/${valid.length}. Skipped ${skipped.length}. Failed ${failed.length}.`);
      } catch (err) {
        console.error(err);
        log(`ERROR: ${err.message}`);
      } finally {
        setButtonsDisabled(false);
      }
    }

    $close.onclick = () => panel.remove();

    $clear.onclick = () => {
      $uuid.value = "";
      $input.value = "";
      $log.textContent = "";
    };

    $fetch.onclick = async () => {
      setButtonsDisabled(true);
      try {
        $log.textContent = "";
        const uuid = extractPlaylistUuid($uuid.value);
        if (!uuid) throw new Error("Paste a valid playlist UUID or full playlist URL.");

        log(`Starting playlist fetch for UUID: ${uuid}`);
        const merged = await fetchWholePlaylist(uuid, log);
        $input.value = JSON.stringify(merged, null, 2);
        log(`Playlist fetch complete. JSON dumped into textarea.`);
      } catch (err) {
        console.error(err);
        log(`ERROR: ${err.message}`);
      } finally {
        setButtonsDisabled(false);
      }
    };

    $both.onclick = () => runDownloadMode("both");
    $mp3.onclick = () => runDownloadMode("mp3");
    $covers.onclick = () => runDownloadMode("covers");
    $genvideos.onclick = () => runDownloadMode("genvideos");
  }

  window.addEventListener(OPEN_EVENT, openPanel);
  window.NCZOpenJsonMediaDownloader = openPanel;

  console.log("[NCZ JSON Downloader] ready");
})();
