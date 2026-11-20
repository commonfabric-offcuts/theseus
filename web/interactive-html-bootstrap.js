// Served inline only by /interactive-html with its own response policy.
// This trusted outer document has no application data or same-origin rights.
(() => {
  'use strict';
  const protocol = 'theseus-html-1', maxBytes = 131072;
  let nonce = null, frame = null;
  const parentOrigin = new URL(location.href).origin;
  const send = value => parent.postMessage({ protocol, nonce, ...value }, parentOrigin);
  addEventListener('message', async event => {
    const value = event.data;
    if (!value || value.protocol !== protocol) return;
    if (event.source === parent && event.origin === parentOrigin && nonce === null && value.kind === 'init' &&
        typeof value.nonce === 'string' && /^[a-f0-9]{48}$/.test(value.nonce) && typeof value.html === 'string' &&
        new TextEncoder().encode(value.html).length <= maxBytes) {
      nonce = value.nonce;
      // No fence markup is parsed until the browser itself has demonstrated
      // enforcement. A missing report is failure, even if the network is down.
      if (!await isolated()) { send({ kind: 'refused' }); return; }
      frame = document.createElement('iframe');
      frame.title = 'Interactive content'; frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
      // The trusted bridge runs before source scripts. Its nonce grants no data
      // access; the parent independently checks activation and address bounds.
      const bridge = `(${inside.toString()})(${JSON.stringify(nonce)});`;
      const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
      frame.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy +
        '"><meta name="referrer" content="no-referrer"><script>' + bridge + '<\/script>' + value.html;
      document.body.append(frame);
      return;
    }
    if (!frame || event.source !== frame.contentWindow || event.origin !== 'null' || value.nonce !== nonce) return;
    if (value.kind === 'height' && Number.isFinite(value.height)) send({ kind: 'height', height: Math.max(48, Math.min(4096, value.height)) });
    if (value.kind === 'link' && typeof value.href === 'string' && value.href.length <= 4096) send({ kind: 'link', href: value.href });
  });

  function isolated() {
    return new Promise(resolve => {
      let observer, peer, image, timer, settled = false, enforced = false, fetchFailed = false, imageFailed = false;
      const controller = new AbortController();
      const finish = ok => {
        if (settled) return;
        settled = true; clearTimeout(timer); observer?.disconnect(); peer?.close(); controller.abort();
        if (image) { image.onload = image.onerror = null; image.removeAttribute('src'); }
        resolve(ok);
      };
      const check = () => { if (enforced && fetchFailed && imageFailed) finish(true); };
      timer = setTimeout(() => finish(false), 5000);
      try {
        observer = new ReportingObserver(reports => {
          for (const report of reports) {
            const body = report.body;
            if (report.type === 'connection-allowlist' && report.url === location.href && body?.url === location.href &&
                body.connection === 'webrtc' && body.disposition === 'enforce' && Array.isArray(body.allowlist) && !body.allowlist.length)
              enforced = true;
          }
          check();
        }, { types: ['connection-allowlist'] });
        observer.observe();
        const target = new URL('/interactive-html', location.href).href;
        fetch(target, { credentials: 'omit', mode: 'no-cors', redirect: 'error', signal: controller.signal })
          .then(() => finish(false), () => { if (!settled) { fetchFailed = true; check(); } });
        image = new Image(); image.onload = () => finish(false);
        image.onerror = () => { imageFailed = true; check(); }; image.src = target;
        try {
          peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:192.0.2.1:9' }] });
          peer.onicecandidate = event => { if (event.candidate) finish(false); };
          peer.onconnectionstatechange = () => { if (peer.connectionState === 'connected') finish(false); };
          peer.createDataChannel('isolation');
          peer.createOffer().then(offer => peer.setLocalDescription(offer)).catch(() => {});
        } catch { /* A constructor refusal alone is not enforcement evidence. */ }
      } catch { finish(false); }
    });
  }

  function inside(nonce) {
    const send = value => parent.postMessage({ protocol: 'theseus-html-1', nonce, ...value }, '*');
    addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link) return;
      event.preventDefault();
      if (event.isTrusted) send({ kind: 'link', href: link.getAttribute('href') });
    }, true);
    addEventListener('DOMContentLoaded', () => {
      const size = () => send({ kind: 'height', height: Math.max(document.body?.scrollHeight || 0, document.documentElement.scrollHeight) });
      new ResizeObserver(size).observe(document.documentElement);
      size();
    }, { once: true });
  }
})();
