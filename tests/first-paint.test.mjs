import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('no Google Fonts network dependency remains (WP4)', () => {
  // The outbound-email template's inline style (buildEmailHtml) still names
  // Raleway as a fallback label for email clients that don't load webfonts
  // at all — that's a separate, unrelated code path, not the app's own
  // first-paint story, so it's out of scope here.
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.doesNotMatch(html, /fonts\.gstatic\.com/);
  assert.doesNotMatch(html, /<link[^>]*fonts\./);
});

test('Cormorant Garamond is self-hosted with font-display: swap, exactly the two weights used (WP4)', () => {
  assert.match(html, /src: url\('fonts\/cormorant-garamond-600\.woff2'\) format\('woff2'\)/);
  assert.match(html, /src: url\('fonts\/cormorant-garamond-700\.woff2'\) format\('woff2'\)/);
  const faceBlocks = html.match(/@font-face \{[^}]*\}/g) || [];
  assert.equal(faceBlocks.length, 2, 'exactly two @font-face rules');
  faceBlocks.forEach(block => assert.match(block, /font-display: swap;/));
});

test('the two self-hosted woff2 files exist and are valid WOFF2 (WP4)', () => {
  const files = ['fonts/cormorant-garamond-600.woff2', 'fonts/cormorant-garamond-700.woff2'];
  files.forEach(rel => {
    const path = new URL(`../${rel}`, import.meta.url);
    assert.ok(existsSync(path), `${rel} must exist`);
    const buf = readFileSync(path);
    assert.equal(buf.subarray(0, 4).toString('ascii'), 'wOF2', `${rel} must be a WOFF2 file`);
  });
});

test('body text uses the system font stack, not a webfont (WP4)', () => {
  assert.match(html, /--font-body:\s*-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;/);
});

test('a device-wide reduced-motion preference mutes every animation and transition, not just one spinner (WP4)', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\*, \*::before, \*::after \{/);
  assert.match(html, /animation-duration: 0\.01ms !important;/);
  assert.match(html, /transition-duration: 0\.01ms !important;/);
});

test('the service worker precaches the self-hosted fonts cache-first, not network-first (WP4 fixup)', () => {
  // Regression this guards against: same-origin fonts that only match the
  // generic "everything else" branch get a network round trip on every
  // online visit before falling back to cache — exactly the slow-3G cost
  // self-hosting was meant to remove.
  assert.match(sw, /'\.\/fonts\/cormorant-garamond-600\.woff2'/);
  assert.match(sw, /'\.\/fonts\/cormorant-garamond-700\.woff2'/);
  assert.match(sw, /STATIC_ASSET_PATHS/);
  assert.doesNotMatch(sw, /ch-shell-v3-auth/);
});
