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

test('s94: S94_unmet runs and names what is missing in plain words', () => {
  const src = html.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const s = src.indexOf('function S94_unmet('), e = src.indexOf('\n}\n', s) + 3;
  const make = (vals, state) => new Function('el', 'state', 'K_gatedForPhase', 'K_answered', 'K_missingSlots', 'kitchenPhotosRequired', 'K_KITCHEN_PHOTO_MIN', 'PRECLEAN_PHOTO_MIN', 'MIDSTAY_PHOTO_MIN', 'AFTERCLEAN_PHOTO_MIN',
    src.slice(s, e) + '; return S94_unmet;')(id => ({ value: vals[id] || '' }), state, () => [], () => true, () => [], () => false, 2, 5, 4, 5);
  const base = { cleaningType: 'turnover', precleanPhotos: [1, 2], aftercleanPhotos: [], kitchenPhotos: [], meterPhotos: [null, { x: 1 }], supplyLogSaved: false };
  const p0 = make({ cleanerName: 'Honey' }, base)(0).map(x => x.t);
  assert.deepEqual(p0, ['cleaning date', 'last guest name']);
  const p1 = make({ electricMeterReading: '12' }, base)(1);
  assert.deepEqual(p1.map(x => x.t), ['water meter reading', 'electric meter photo', '3 more pre-clean photos']);
  assert.equal(p1[2].id, 'preclean-photo-card');
  assert.deepEqual(make({}, base)(4).map(x => x.t), ['log supply usage']);
});
