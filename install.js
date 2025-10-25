(function () {
  const btn = document.getElementById('installBtn');
  const tip = document.getElementById('installTip');

  let deferredPrompt = null;
  const ua = navigator.userAgent || '';
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isChromiumLike = /\b(Chrome|Edg|Brave|SamsungBrowser)\b/i.test(ua) && !/OPR|Opera/i.test(ua);

  // Remove any legacy big tip if left in DOM
  const legacyTip = document.getElementById('install-tip'); legacyTip && (legacyTip.style.display = 'none');

  // SW controllerchange → ensure control without manual refresh
  let swReloaded = sessionStorage.getItem('sw-reloaded');
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!swReloaded) { sessionStorage.setItem('sw-reloaded', '1'); location.reload(); }
  });

  // Initial visibility
  if (isStandalone) {
    btn?.classList.add('a2hs-hide'); tip?.classList.add('a2hs-hide');
  } else if (isIOS) {
    tip?.classList.remove('a2hs-hide'); btn?.classList.add('a2hs-hide');
  } else if (isAndroid && isChromiumLike) {
    btn?.classList.remove('a2hs-hide'); btn.disabled = true; // enable after event
  }

  // Installability event
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn && (btn.classList.remove('a2hs-hide'), btn.disabled = false);
  });

  // Fallback: if BIP hasn't fired in ~8s on Android, show menu hint
  if (isAndroid) {
    setTimeout(() => {
      if (!deferredPrompt && tip) {
        tip.textContent = 'In Chrome: tap ⋮ menu → Install app';
        tip.classList.remove('a2hs-hide');
      }
    }, 8000);
  }

  btn?.addEventListener('click', async () => {
    if (!deferredPrompt) {
      // Fallback hint
      if (isAndroid && tip) {
        tip.textContent = 'In Chrome: tap ⋮ menu → Install app';
        tip.classList.remove('a2hs-hide');
      }
      return;
    }
    btn.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice; // accepted|dismissed
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
  });
})();