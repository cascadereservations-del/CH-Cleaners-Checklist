import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('s94: meter photos are prechecked after upload, advisory only, 20 s limit', () => {
  assert.match(html, /verify-meter-photo/);
  assert.match(html, /mode: 'precheck', path: photo\.fileId, meter, typed/);
  assert.match(html, /S94_PRECHECK_MS = 20000/);
  assert.equal((html.match(/updatePhotoCounter\(\); S94_precheck\(i\)/g) || []).length, 2, 'both upload callbacks run the precheck');
  assert.match(html, /id="meter-precheck-0"[^>]*aria-live="polite"/);
  assert.match(html, /id="meter-precheck-1"[^>]*aria-live="polite"/);
  assert.match(html, /el\('meter-photo-' \+ i \+ '-cap'\)\?\.click\(\)/, 'retake reopens the camera');
});

test('s94: the cue line sits under the nav, is polite, and is wired into updateBottomBar', () => {
  assert.match(html, /id="nav-cue" role="status" aria-live="polite"/);
  assert.match(html, /S94_renderCue\(\);\n?\r?\n?\}/);
  assert.match(html, /'To continue: '/);
  assert.match(html, /#btn-next:disabled, #btn-submit:disabled \{ pointer-events: none; \}/);
  assert.match(html, /S94_initCue\(\);/);
});
