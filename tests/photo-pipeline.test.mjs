import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('photo processing runs off the main thread, with a same-shape fallback (WP2)', () => {
  assert.match(html, /SUPPORTS_OFFTHREAD_PHOTOS =\s*\n\s*typeof Worker === 'function'/);
  assert.match(html, /createImageBitmap/);
  assert.match(html, /new OffscreenCanvas/);
  // The fallback path still exists and returns the same {blob, blurry, tooSmall} shape.
  assert.match(html, /const dataUrl = await compressImage\(file\);\s*\n\s*const quality = await checkPhotoQuality\(dataUrl\);/);
});

test('captured photo bytes live in IndexedDB, never as base64 in the draft (WP2 / F3)', () => {
  assert.match(html, /const PHOTO_DB_NAME\s*=\s*'ch_photos_v1'/);
  assert.match(html, /async function idbPutPhoto/);
  assert.match(html, /async function idbGetPhoto/);
  assert.match(html, /async function idbDeletePhoto/);
  // photoMeta() is what actually lands in the draft — it must not carry the blob/base64.
  const photoMetaBody = html.match(/function photoMeta\(p\) \{([\s\S]{0,300}?)\n\}/)[1];
  assert.doesNotMatch(photoMetaBody, /\bdata\b/);
  assert.doesNotMatch(photoMetaBody, /objectUrl/);
});

test('capture-time uploads share a concurrency-2 queue, not unbounded fire-and-forget (WP2 / F4)', () => {
  assert.match(html, /const PHOTO_UPLOAD_CONCURRENCY = 2/);
  assert.match(html, /function enqueuePhotoUpload/);
});

test('each photo shows a visible upload status, and a per-section retry-all exists (WP2 / F5)', () => {
  assert.match(html, /function photoStatusLabel/);
  assert.match(html, /status-failed/);
  assert.match(html, /function retrySectionPhoto/);
  assert.match(html, /section-retry-link/);
});

test('a pending upload is detected by data OR an IndexedDB id, not data alone (WP2 pre-submit flush)', () => {
  // Bug class this guards against: after WP2, a photo whose bytes moved to
  // IndexedDB has p.data === null, so checking `p.data` alone would make the
  // pre-submit flush think it has nothing left to retry.
  assert.match(html, /!p\.uploaded && \(p\.data \|\| p\.idbId\)/);
});

test('a killed app with pending photos resumes automatically when back online (WP2 / checklist #6)', () => {
  assert.match(html, /window\.addEventListener\('online', \(\) => \{/);
  assert.match(html, /async function restorePhotoFromMeta/);
});

test('bedroom and kitchen photos get the same draft persistence as preclean/afterclean (WP2)', () => {
  assert.match(html, /bedroomPhotoMeta:\s*state\.bedroomPhotos\.map\(photoMeta\)/);
  assert.match(html, /kitchenPhotoMeta:\s*state\.kitchenPhotos\.map\(photoMeta\)/);
});

test('the photo path contract is unchanged: same upload-photo endpoint and slot-keyed names', () => {
  assert.match(html, /EDGE_BASE\}\/upload-photo/);
  assert.match(html, /uploadPhotoDrive\(slotKey, dataUrl, photo\.name\)/);
});

test('the retry-all link respects its hidden attribute (regression: author CSS beat [hidden])', () => {
  assert.match(html, /\.section-retry-link\[hidden\] \{ display: none; \}/);
});

test('a photo record is identified by object identity, not a numeric index that goes stale after a splice (WP2 fixup)', () => {
  assert.doesNotMatch(html, /function renderSectionThumb\(idx\)/);
  assert.match(html, /function retrySectionPhoto\(photo\)/);
  assert.match(html, /const liveIdx = photos\.indexOf\(photo\);/);
});

test('IndexedDB write failures fall back to an in-memory blob, not a permanently unrecoverable photo (WP2 fixup)', () => {
  assert.match(html, /if \(photo\._blob\) return blobToDataURL\(photo\._blob\);/);
  assert.match(html, /idbId: stored \? id : null/);
});

test('a meter retake releases the previous photo\'s storage instead of leaking it (WP2 fixup)', () => {
  assert.match(html, /const previous = state\.meterPhotos\[i\];/);
  assert.match(html, /if \(previous\?\.idbId\) idbDeletePhoto\(previous\.idbId\);/);
});

test('discarding a draft sweeps any still-pending photo blobs out of IndexedDB (WP2 fixup)', () => {
  assert.match(html, /function clearDraft\(\) \{[\s\S]{0,700}idbDeletePhoto\(meta\.idbId\)/);
});
