// The page's boot, ahead of its modules (docs/rails.md, "One build per document").
// aim_next/web_build.py writes this file into index.html as an inline script
// before the entry, and the page's policy allows it by its hash: it needs no
// request of its own, so it is there however the server is.
//
// Every module of a document comes from the build its index.html named
// (/b/<build>/). A deploy between the index.html and its modules, or a phone
// loading them slowly while the server restarts, leaves the server refusing
// that build's addresses, or not answering. The module graph then fails as a
// whole: none of it runs, so the page assembles nothing from two builds, and
// the browser says so only by an error on the entry's script element. Nothing
// has run, so the document holds no writing; what this device kept of earlier
// writing stays in its stores, for the next load to offer as any load does.
//
// When the server serves another build, the page loads afresh on it. A load
// gets the build the server serves as it answers, so another one comes only
// from a deploy after it, never in a loop. Otherwise (its own build, or the
// server unread) the page says so in plain words, with Reload.
let bootNoticeClosed = false;
addEventListener('error', event => {
  const script = event.target;
  const own = script instanceof HTMLScriptElement && script.type === 'module' && script.src
    ? /^\/b\/([^/]+)\//.exec(new URL(script.src).pathname)?.[1] : null;
  if (!own) return;
  const say = () => {
    const status = document.getElementById('app-status');
    if (bootNoticeClosed) { status.hidden = true; return; }
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'updated-reload'; again.title = 'Reload Theseus'; again.textContent = 'Reload';
    again.onclick = () => location.reload();
    // No module ran, so this fallback cannot import the page's notice helper.
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'page-notice-close'; close.textContent = '×';
    close.title = 'Close notice'; close.setAttribute('aria-label', 'Close notice');
    close.onclick = () => {
      bootNoticeClosed = true; status.hidden = true;
      if (document.activeElement === close) document.getElementById('main')?.focus({ preventScroll: true });
    };
    status.replaceChildren('Theseus could not open this page.', again, close);
    status.hidden = false;
  };
  fetch('/api/build', { cache: 'no-store', credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : null)
    .then(served => { if (typeof served?.build === 'string' && served.build && served.build !== own) location.reload(); else say(); })
    .catch(say);
}, true);
