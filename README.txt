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

## Named cleaner authentication cutover

This branch requires an owner-provisioned Supabase Auth account. Public sign-up is not available. The PWA stores only the returned access/refresh session, refreshes expired access tokens, attaches the named user token to every private operational call, and provides sign-out.

Deploy only as one coordinated release with the matching backend migration and JWT-enabled `last-readings`, `upload-photo`, and `submit-cleaning` functions. Deploying either side alone blocks cleaners. Before production, prove owner MFA, create the real cleaner account, assign its role and property, and run a full photo/report/inventory smoke test.
