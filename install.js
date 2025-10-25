(function () {
  const btn = document.getElementById('installBtn');
  const tip = document.getElementById('installTip');
  const dbg = document.getElementById('pwaDebug');
  const dbgToggle = document.getElementById('pwaDebugToggle');

  const dbgEl = (id) => document.getElementById(id);
  const set = (id, v) => { const el = dbgEl(id); if (el) el.textContent = String(v); };

  let deferredPrompt = null;

  const ua = navigator.userAgent || '';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isChromiumLike = /\b(Chrome|Edg|Brave|SamsungBrowser)\b/i.test(ua) && !/OPR|Opera/i.test(ua);

  // Debug toggle
  const params = new URLSearchParams(location.search);
  const debugOn = params.get('debug') === '1';
  if (dbgToggle) {
    dbgToggle.addEventListener('click', () => {
      dbg?.classList.toggle('a2hs-hide');
    });
    if (debugOn) dbg?.classList.remove('a2hs-hide');
  }

  // Initial visibility
  if (isStandalone) {
    btn?.classList.add('a2hs-hide');
    tip?.classList.add('a2hs-hide');
  } else if (isIOS) {
    tip?.classList.remove('a2hs-hide');
    btn?.classList.add('a2hs-hide');
  } else if (isAndroid && isChromiumLike) {
    btn?.classList.remove('a2hs-hide');
    btn.disabled = true; // enable after event
  }

  // Debug baseline values
  set('dbgHttps', location.protocol === 'https:' ? 'OK' : 'Not HTTPS');
  set('dbgDisplayMode', isStandalone ? 'standalone' : 'browser');
  set('dbgPlatform', (isIOS && 'iOS') || (isAndroid && 'Android') || 'Other');
  set('dbgBIP', 'waiting…');

  // Manifest checks
  try {
    const link = document.querySelector('link[rel="manifest"]');
    set('dbgManifestLink', link ? 'found' : 'missing');
    if (link) {
      const res = fetch(link.href, { credentials: 'omit' }).then(r => {
        set('dbgManifestFetch', r.ok ? 'OK' : ('HTTP ' + r.status));
      }).catch(err => set('dbgManifestFetch', 'fetch error'));
    }
  } catch (e) { set('dbgManifestFetch', 'error'); }

  // Service Worker check
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      set('dbgSW', regs.length ? 'registered' : 'not registered');
      set('dbgSWCtrl', navigator.serviceWorker.controller ? 'controlled' : 'not controlling');
    });
  } else {
    set('dbgSW', 'unsupported');
    set('dbgSWCtrl', '—');
  }

  // Installability event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // control the prompt timing
    deferredPrompt = e;
    set('dbgBIP', 'fired');
    if (btn) { btn.classList.remove('a2hs-hide'); btn.disabled = false; }
  });

  btn?.addEventListener('click', async () => {
    if (!deferredPrompt) {
      if (isAndroid) {
        // Fallback hint for Android when event hasn't fired
        if (tip) {
          tip.textContent = 'In Chrome: tap ⋮ menu → Install app';
          tip.classList.remove('a2hs-hide');
        }
      }
      return;
    }
    btn.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      set('dbgBIP', 'prompted');
    } finally {
      deferredPrompt = null;
      btn.classList.add('a2hs-hide');
      tip?.classList.add('a2hs-hide');
      btn.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    btn?.classList.add('a2hs-hide');
    tip?.classList.add('a2hs-hide');
    set('dbgDisplayMode', 'standalone');
  });
})();