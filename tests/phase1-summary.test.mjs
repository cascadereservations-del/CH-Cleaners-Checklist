import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Phase 1 has a sticky jump summary showing all three section counts (WP5)', () => {
  assert.match(html, /id="p1-sticky-summary"/);
  assert.match(html, /id="p1-summary-preclean"/);
  assert.match(html, /id="p1-summary-meters"/);
  assert.match(html, /id="p1-summary-condition"/);
  assert.match(html, /\.p1-sticky-summary \{[\s\S]{0,60}position: sticky;/);
});

test('each summary chip jumps to its section, kept live from the same updates that already run (WP5)', () => {
  assert.match(html, /jump\('p1-jump-preclean', 'preclean-photo-card'\);/);
  assert.match(html, /jump\('p1-jump-meters', 'meter-readings-card'\);/);
  assert.match(html, /jump\('p1-jump-condition', 'condition-card'\);/);
  assert.match(html, /if \(key === 'preclean'\) updateP1StickySummary\(\);/);
  assert.match(html, /updateP1StickySummary\(\);\s*\n\s*saveDraft\(\);\s*\n\s*\}\s*\n\s*\n\s*clearBtn/);
});

test('the header stepper is demoted to a thin segmented line, not 5 numbered dots (WP5)', () => {
  assert.doesNotMatch(html, /class="stepper-dot/);
  assert.match(html, /class="stepper-seg active" id="dot-0"/);
  assert.match(html, /\.stepper-seg \{[\s\S]{0,40}height: 4px;/);
});
