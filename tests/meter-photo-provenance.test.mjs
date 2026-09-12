import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* Lloyd, 2026-09-13: "is there a validator for the photos uploaded ... because
   now I can just upload screenshot or fraudulent photos and it still accepts
   it". photoProvenance() is that tripwire. It reads the ORIGINAL file, before
   processPhoto() re-encodes to JPEG and throws the Exif away.

   It is pulled out of index.html and run for real here, because a grep would
   pass just as happily against a function that returns nothing useful. */
function loadProvenance() {
  const m = html.match(/async function photoProvenance\(file\)[\s\S]*?\n\}/);
  assert.ok(m, 'photoProvenance not found in index.html');
  return new Function(m[0] + '\nreturn photoProvenance;')();
}

// Minimal fixtures. Only the header bytes matter to the reader.
function pngFile() {
  const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...new Array(64).fill(0)]);
  return new File([bytes], 'Screenshot_20260913.png', { type: 'image/png' });
}

// A JPEG whose APP1 segment carries "Exif\0\0" and an IFD0 Model tag (0x0110).
function jpegWithExif() {
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4D, 0x4D, 0x00, 0x2A,
                   0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x10, 0x00, 0x02,
                   ...new Array(24).fill(0)];
  const len = payload.length + 2;
  const bytes = new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xE1, (len >> 8) & 0xFF, len & 0xFF, ...payload,
    0xFF, 0xDA, 0x00, 0x02,
  ]);
  return new File([bytes], 'IMG_4821.jpg', { type: 'image/jpeg' });
}

// A JPEG with a comment segment but no Exif — what a chat app or an editor
// hands back after it has stripped the metadata.
function jpegNoExif() {
  const bytes = new Uint8Array([
    0xFF, 0xD8,
    0xFF, 0xFE, 0x00, 0x06, 0x41, 0x42, 0x43, 0x44,
    0xFF, 0xDA, 0x00, 0x02,
  ]);
  return new File([bytes], 'image.jpg', { type: 'image/jpeg' });
}

test('a PNG is flagged — phone cameras do not save PNGs', async () => {
  const photoProvenance = loadProvenance();
  const prov = await photoProvenance(pngFile());
  assert.equal(prov.isPng, true);
  assert.equal(prov.hasExif, false);
});

test('a camera JPEG carries Exif and a camera tag, and is not flagged', async () => {
  const photoProvenance = loadProvenance();
  const prov = await photoProvenance(jpegWithExif());
  assert.equal(prov.isPng, false);
  assert.equal(prov.hasExif, true);
  assert.equal(prov.hasCameraTag, true);
});

test('a JPEG stripped of its metadata is caught as having no camera info', async () => {
  const photoProvenance = loadProvenance();
  const prov = await photoProvenance(jpegNoExif());
  assert.equal(prov.isPng, false);
  assert.equal(prov.hasExif, false);
});

test('an unreadable file yields flags rather than throwing', async () => {
  const photoProvenance = loadProvenance();
  const broken = { type: 'image/jpeg', slice: () => { throw new Error('nope'); } };
  const prov = await photoProvenance(broken);
  assert.equal(prov.hasExif, false);
  assert.equal(prov.isPng, false);
});

test('the findings are worded for a cleaner and never block the report', () => {
  assert.match(html, /that is a screenshot, not a photo of the meter/);
  assert.match(html, /carries no camera information/);
  assert.match(html, /this never blocks your report/);
});

test('the findings travel with the report, not just to the screen', () => {
  // A nudge a cleaner can dismiss is not evidence. The same findings and the
  // raw provenance flags go into the payload so Lloyd sees them.
  assert.match(html, /meterChecks: \{/);
  assert.match(html, /provenance: \[0, 1\]\.map/);
});

test('provenance is read before the re-encode that would destroy it', () => {
  const encodeAt = html.indexOf('const { blob } = await processPhoto(file);');
  const provAt   = html.indexOf('photoProvenance(file).then(prov =>');
  assert.ok(encodeAt > -1 && provAt > -1);
  // It must read `file`, the original — not the processed blob.
  assert.match(html, /photoProvenance\(file\)/);
  assert.doesNotMatch(html, /photoProvenance\(blob\)/);
});
