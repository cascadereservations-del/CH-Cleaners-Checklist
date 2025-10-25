# CH Cleaners Checklist – PWA Pack

This pack contains icons and files to make your GitHub Pages site installable as a Progressive Web App (PWA).

## Files
- `manifest.webmanifest`
- `sw.js`
- `install.js`
- `icons/` (192, 512, maskable 512, Apple 180)
- `pwa-snippet.html` (copy-paste into your existing `index.html`)

## How to integrate (GitHub Pages subpath: /CH-Cleaners-Checklist/)
1. Copy everything in this folder to your repo root (`/CH-Cleaners-Checklist/`).
2. In `index.html`:
   - Add the **HEAD** lines from `pwa-snippet.html` (manifest + Apple tags).
   - Add the **BODY** button/tip + scripts from `pwa-snippet.html` where you want the Install button to appear.
3. Commit & push. Visit `https://cascadereservations-del.github.io/CH-Cleaners-Checklist/` on Android Chrome to see the install prompt/button. On iOS Safari: Share → Add to Home Screen.
4. For updates to caching, bump `CACHE_NAME` in `sw.js` (e.g., `ch-checklist-v2`).

> Note: If your app references assets with absolute paths, ensure they include the `/CH-Cleaners-Checklist/` prefix, or use relative `./` paths to avoid 404s under GitHub Pages.
