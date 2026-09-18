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
  assert.match(html, /rows\.filter\(r => !r\.already_reported\)/);
});

/* The clock filter, exercised for real rather than grepped. Lloyd's report of
   2026-09-13 05:29 +08:00: the picker offered a checkout that had not happened
   yet (noon that day), a guest arriving that afternoon, and a blocked test
   window — when the only honest answer was Aya Falgui's 2026-09-07 checkout. */
function loadStayClockHelpers() {
  const grab = (name) => {
    const m = html.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n\\}'));
    assert.ok(m, 'could not find ' + name + ' in index.html');
    return m[0];
  };
  const src = [
    html.match(/const CHECKOUT_HOUR_PH = '[^']+';/)[0],
    html.match(/const CHECKIN_HOUR_PH\s+= '[^']+';/)[0],
    grab('phInstant'),
    grab('stayReportableFrom'),
    grab('stayOrderKey'),
    'return { stayReportableFrom, stayOrderKey };',
  ].join('\n');
  return new Function(src)();
}

test('a checkout that has not happened yet is not offered', () => {
  const { stayReportableFrom } = loadStayClockHelpers();
  const earlyMorning = Date.parse('2026-09-13T05:29:00+08:00');
  const afterNoon    = Date.parse('2026-09-13T12:30:00+08:00');
  const row = { kind: 'checkout', checkout_date: '2026-09-13', checkin_date: '2026-09-12' };
  assert.ok(stayReportableFrom(row) > earlyMorning, 'noon checkout is still ahead at 05:29');
  assert.ok(stayReportableFrom(row) <= afterNoon,   'and behind us at 12:30');
});

test('a guest who has not arrived is never offered', () => {
  const { stayReportableFrom } = loadStayClockHelpers();
  assert.equal(stayReportableFrom({ kind: 'checkin', checkin_date: '2026-09-13' }), null);
});

test('the picker offers only the finished stays, earliest first', () => {
  const { stayReportableFrom, stayOrderKey } = loadStayClockHelpers();
  const now = Date.parse('2026-09-13T05:29:00+08:00');
  const rows = [
    { guest_name: 'Dale Anwen De La Cerna', kind: 'checkout', checkout_date: '2026-09-13', checkin_date: '2026-09-12' },
    { guest_name: null,                     kind: 'checkout', checkout_date: '2026-09-09', checkin_date: '2026-09-08' },
    { guest_name: 'Aya Falgui',             kind: 'checkout', checkout_date: '2026-09-07', checkin_date: '2026-09-06' },
    { guest_name: 'James Rebaya',           kind: 'checkin',  checkin_date:  '2026-09-13', checkout_date: '2026-09-14' },
  ];
  const offered = rows
    .filter(b => { const f = stayReportableFrom(b); return f !== null && now >= f; })
    .sort((a, b) => stayOrderKey(a) - stayOrderKey(b));

  // Dale's noon checkout and James's arrival are both still ahead.
  assert.deepEqual(offered.map(b => b.checkout_date), ['2026-09-07', '2026-09-09']);
  assert.equal(offered[0].guest_name, 'Aya Falgui', 'earliest finished stay is first');
});

test('a mid-stay refresh waits for the guest to actually arrive', () => {
  const { stayReportableFrom } = loadStayClockHelpers();
  const row = { kind: 'mid_stay', checkin_date: '2026-09-13', checkout_date: '2026-09-16' };
  assert.ok(stayReportableFrom(row) > Date.parse('2026-09-13T05:29:00+08:00'));
  assert.ok(stayReportableFrom(row) <= Date.parse('2026-09-13T14:00:00+08:00'));
});

test('the clock filter does not depend on the device timezone', () => {
  const { stayReportableFrom } = loadStayClockHelpers();
  // An explicit +08:00 offset, not a local-time string, is what makes this true.
  assert.match(html, /\+08:00/);
  assert.equal(stayReportableFrom({ kind: 'checkout', checkout_date: '2026-09-07' }),
               Date.parse('2026-09-07T12:00:00+08:00'));
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

test('a reading identical to the previous one is caught', () => {
  // The ceiling check only looked upward, so copying last time's number —
  // the cheapest way to file without visiting the meter — sailed through.
  // It is already in the data: 2026-09-10 recorded 3832.00 kWh and 72.1530 m3,
  // digit for digit the 2026-09-06 figures, four days apart.
  assert.match(html, /if \(val === m\.prev\) \{/);
  assert.match(html, /exactly the same number as last time/);
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
  // It belongs to the final phase's list, not an earlier one. SPEC-02 promoted
  // it from a POWER_CHECK_ITEMS tick box to a required Confirm & Leave
  // judgement; both lists live in phase 4, so the intent is unchanged.
  const confirmBlock = html.slice(html.indexOf('const CONFIRM_LEAVE_ITEMS'),
                                  html.indexOf('const confirmItemsNow'));
  assert.ok(confirmBlock.includes('check_smartlife_waiting'));
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
