/* Handle Chrome's install prompt; iOS requires manual A2HS */
(function () {
  const installBtn = document.getElementById('installBtn');
  const iosTip = document.getElementById('install-tip');
  let deferredPrompt = null;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isInStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isIOS && !isInStandalone && iosTip) {
    iosTip.classList.remove('hidden');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
  });

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installBtn.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      deferredPrompt = null;
      installBtn.classList.add('hidden');
      installBtn.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    installBtn?.classList.add('hidden');
    iosTip?.classList.add('hidden');
  });
})();
