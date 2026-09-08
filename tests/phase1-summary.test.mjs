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

test('the decorative stepper is aria-hidden rather than announced as unlabelled generic nodes (WP5 fixup)', () => {
  // Regression this guards against: a role-less <span aria-label="..."> is
  // not exposed as an accessible name at all — ATs would have announced
  // five nameless "generic" nodes inside a landmark. #phase-label-bar in
  // the bottom nav already announces the current phase name accessibly.
  assert.match(html, /<nav id="phase-stepper" aria-hidden="true">/);
  assert.doesNotMatch(html, /id="dot-0" aria-label=/);
});

test('summary chips carry a real accessible name kept in sync with the visible count (WP5 fixup)', () => {
  assert.match(html, /aria-label="Pre-cleaning photos, 0 of 5\. Jump to section\."/);
  assert.match(html, /el\('p1-jump-preclean'\)\?\.setAttribute\('aria-label', `Pre-cleaning photos, \$\{precl\} of \$\{PRECLEAN_PHOTO_MIN\}\. Jump to section\.`\);/);
  assert.match(html, /el\('p1-jump-meters'\)\?\.setAttribute\('aria-label', `Meter photos, \$\{meters\} of 2\. Jump to section\.`\);/);
  assert.match(html, /el\('p1-jump-condition'\)\?\.setAttribute\('aria-label',/);
});

test('scroll-margin-top actually clears the sticky bar at every breakpoint, not a guessed 52px (WP5 fixup)', () => {
  // Opus review measured the real shortfall in Chromium: 52px left the
  // preclean/meters targets 65-95px under the bar depending on breakpoint
  // (the condition chip only looked correct because it hits scroll max).
  assert.match(html, /#preclean-photo-card, #meter-readings-card, #condition-card \{[\s\S]{0,500}scroll-margin-top: 118px;/);
  assert.match(html, /scroll-margin-top: 135px;/);
  assert.match(html, /scroll-margin-top: 148px;/);
  assert.doesNotMatch(html, /scroll-margin-top: 52px/);
});
