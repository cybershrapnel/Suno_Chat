// ==UserScript==
// @name         Suno .m4a UUID Watcher + Plain Text Joiner Link
// @description  Logs UUID + normal and plain joiner versions of Suno song links
// @match        *://*/*
// @run-at       document-end
// ==/UserScript==

(function() {
  const WORD_JOINER = '\u2060'; // U+2060 invisible word joiner

  function extractAndLog(src) {
    const match = src.match(/([0-9a-fA-F-]{36})(?=\.m4a$)/);
    if (!match) return;
    const uuid = match[1];

    const normal = `https://suno.com/song/${uuid}`;
    const plain = `suno${WORD_JOINER}.com/song/${uuid}`;

    console.log(uuid);
    console.log(normal);
    console.log(plain);
  }

  function observeAudio(el) {
    if (!el.src.endsWith('.m4a')) return;
    extractAndLog(el.src);

    const observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes' && m.attributeName === 'src' && el.src.endsWith('.m4a')) {
          extractAndLog(el.src);
        }
      }
    });
    observer.observe(el, { attributes: true });
  }

  document.querySelectorAll('audio[src$=".m4a"]').forEach(observeAudio);

  const bodyObserver = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.tagName === 'AUDIO') observeAudio(node);
        else if (node.querySelectorAll) {
          node.querySelectorAll('audio[src$=".m4a"]').forEach(observeAudio);
        }
      }
    }
  });

  bodyObserver.observe(document.body, { childList: true, subtree: true });

  console.log('🎧 Suno .m4a watcher active — normal + plain joiner links will be logged');
})();
