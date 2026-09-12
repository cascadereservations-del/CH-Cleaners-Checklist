import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gs   = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

/* ── Stay picker (JOB 2a) ────────────────────────────────────────────── */

test('the cleaner picks the stay instead of typing the guest name', () => {
  assert.match(html, /id="stayPick"/);
  assert.match(html, /Which stay is this report for\?/);
  assert.match(html, /rpc\/get_cleanable_bookings/);
  assert.match(html, /el\('stayPick'\)\?\.addEventListener\('change', applyStayPick\)/);
});

test('a stay that already has a report is not offered again', () => {
  assert.match(html, /_stayOptions = rows\.filter\(r => !r\.already_reported\)/);
});

test('a missing RPC hides the picker rather than breaking Phase 0', () => {
  // The function is deployed separately from the page, so the page has to
  // survive being ahead of the database.
  assert.match(html, /if \(resp\.status === 404\) \{ _stayRpcMissing = true;/);
});

test('picking a stay whose guest is still in residence switches to mid-stay', () => {
  assert.match(html, /if \(b\.kind === 'mid_stay' && state\.cleaningType !== 'mid_stay'\)/);
});

/* ── Tenured fast path (JOB 2c) ──────────────────────────────────────── */

test('the fast path is offered only after three months, and only for tasks', () => {
  assert.match(html, /const TENURE_MONTHS_FOR_FAST_PATH = 3;/);
  assert.match(html, /STAFF_HIRE_DATES = \{ 'Honey': '2026-05-07' \}/);
  // Confirm & Leave is answered one at a time — never bulk-ticked.
  assert.doesNotMatch(html, /PHASE_TASK_CONTAINERS[\s\S]{0,400}confirm-leave-items/);
});

test('ticking everything still leaves the photo requirements asked for', () => {
  assert.match(html, /Photos and meter readings are still asked for separately\./);
});

/* ── Meter cross-check (JOB 2d-2) ────────────────────────────────────── */

test('meter ceilings are the calibrated ones, not the first guess', () => {
  assert.match(html, /const ELEC_KWH_PER_DAY_MAX  = 35;/);
  assert.match(html, /const WATER_M3_PER_DAY_MAX  = 1\.2;/);
});

test('a previous reading of zero never produces a rate — that bug is in the data', () => {
  assert.match(html, /if \(gap && m\.prev > 0\) \{/);
});

test('the nudge never blocks the report', () => {
  assert.match(html, /this never blocks your report/);
  // No disabling, no gate: the only thing it does is show a list.
  assert.doesNotMatch(html, /meter-nudge[\s\S]{0,200}disabled = true/);
});

test('photo freshness uses the file time, not the burned-in stamp', () => {
  assert.match(html, /state\.meterPhotos\[i\]\.takenAt = file\.lastModified \|\| null;/);
  assert.match(html, /const PHOTO_STALE_HOURS     = 12;/);
});

test('the same photo in both meter slots is caught', () => {
  assert.match(html, /Both meter slots hold the same photo/);
});

/* ── Drive schema + FD-003 (JOB 2d-1, 2b) ───────────────────────────── */

test('one report means one Drive folder, under year/month', () => {
  assert.match(gs, /function _reportFolder\(cleaningDate, unitName, cleanerName\)/);
  assert.match(gs, /const year  = dateStr\.slice\(0, 4\);/);
  assert.match(gs, /const month = dateStr\.slice\(0, 7\);/);
});

test('submit reuses the folder init created instead of making a second one', () => {
  assert.match(gs, /if \(sessionFolderId\) \{/);
  assert.match(gs, /reportFolder = DriveApp\.getFolderById\(sessionFolderId\)/);
  assert.doesNotMatch(gs, /driveRoot\.createFolder\(\s*dateStamp/);
});

test('a meter photo is named for the reading it proves', () => {
  assert.match(gs, /function _photoFileName\(sectionId, index, reading\)/);
  assert.match(gs, /which \+ '_' \+ value \+ '\.jpg'/);
});

/* ── SmartLife task (JOB 2d-5) ───────────────────────────────────────── */

test('the last phase asks for the SmartLife automation to be switched on', () => {
  assert.match(html, /id: 'check_smartlife_waiting'/);
  assert.match(html, /Smart at the bottom, then Automations/);
  // It belongs to the final phase's list, not an earlier one.
  const powerBlock = html.slice(html.indexOf('const POWER_CHECK_ITEMS'),
                                html.indexOf('const WEEKLY_ITEMS'));
  assert.ok(powerBlock.includes('check_smartlife_waiting'));
});

test('the picker loads for a date that was already on the field (no change event)', () => {
  // The regression this guards: loadCleanableBookings was wired only to the
  // cleaning-date change event, but the date arrives pre-filled from a draft
  // or as today, and assigning .value fires nothing. The picker therefore
  // never appeared on the path every cleaner actually takes.
  assert.match(html, /dateStr = dateStr \|\| el\('cleaningDate'\)\?\.value \|\| '';/);
  // Called at init for whatever date is already there...
  assert.match(html, /fetchPrevReadings\(\);[\s\S]{0,400}loadCleanableBookings\(\);/);
  // ...and again when a restored draft rewrites it.
  assert.match(html, /if \(draft\.cleaningDate\) setTimeout\(\(\) => loadCleanableBookings\(draft\.cleaningDate\), 0\);/);
});
