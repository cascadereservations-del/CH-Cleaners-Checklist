import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw   = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

/* SPEC-02 (2026-09-18). Two things a turnover cannot be submitted without:
   the kitchen utensil set confirmed against the catalogue, and the
   "Waiting for Check In" automation confirmed after lock-up. Both are
   judgements in Confirm & Leave, not tick boxes, and both are skipped on a
   mid-stay or an emergency visit. */

test('the SmartLife automation is a Confirm & Leave judgement, not a tick box', () => {
  const occurrences = html.match(/id: 'check_smartlife_waiting'/g) || [];
  assert.equal(occurrences.length, 1, 'check_smartlife_waiting must be declared exactly once');

  const confirmBlock = html.match(/const CONFIRM_LEAVE_ITEMS = \[[\s\S]*?\n\];/)[0];
  const powerBlock   = html.match(/const POWER_CHECK_ITEMS = \[[\s\S]*?\n\];/)[0];
  assert.ok(confirmBlock.includes("id: 'check_smartlife_waiting'"), 'it belongs in CONFIRM_LEAVE_ITEMS');
  assert.ok(!powerBlock.includes('check_smartlife_waiting'), 'it must not remain in POWER_CHECK_ITEMS');
});

test('the utensil confirmation exists and names the catalogue set', () => {
  const confirmBlock = html.match(/const CONFIRM_LEAVE_ITEMS = \[[\s\S]*?\n\];/)[0];
  assert.ok(confirmBlock.includes("id: 'check_utensils_complete'"));
  // The counts come from the live Kitchen & Dining catalogue (D-145). If the
  // catalogue changes, this list and this assertion move together.
  assert.match(confirmBlock, /6 spoons/);
  assert.match(confirmBlock, /4 plates/);
  assert.match(confirmBlock, /1 frying pan/);
});

/* Extract-and-eval, the style the other tests use: run the real list and the
   real filter rather than grepping for the word "turnover". */
function loadConfirmList() {
  const src = [
    html.match(/const CONFIRM_LEAVE_ITEMS = \[[\s\S]*?\n\];/)[0],
    html.match(/const confirmItemsNow = [^\n]+\n/)[0],
    html.match(/const kitchenPhotosRequired = [^\n]+\n/)[0],
    'return { confirmItemsNow, kitchenPhotosRequired, setType: t => { state.cleaningType = t; } };',
  ].join('\n');
  return new Function('state', src)({ cleaningType: 'turnover' });
}

test('both new confirmations are asked for on a handover and skipped otherwise', () => {
  const { confirmItemsNow, setType } = loadConfirmList();
  const ids = () => confirmItemsNow().map(i => i.id);

  for (const type of ['turnover', 'deep_clean']) {
    setType(type);
    assert.ok(ids().includes('check_utensils_complete'), `${type} must ask for the utensil count`);
    assert.ok(ids().includes('check_smartlife_waiting'), `${type} must ask for the automation`);
    assert.equal(ids().at(-1), 'check_smartlife_waiting', 'the automation is asked for last');
  }

  for (const type of ['mid_stay', 'emergency']) {
    setType(type);
    assert.ok(!ids().includes('check_utensils_complete'), `${type} must not ask for the utensil count`);
    assert.ok(!ids().includes('check_smartlife_waiting'), `${type} must not arm the arrival automation`);
    assert.equal(ids().length, 4, `${type} keeps the original four items`);
  }
});

test('kitchen photos gate Step 3 on a handover only', () => {
  const { kitchenPhotosRequired, setType } = loadConfirmList();
  for (const type of ['turnover', 'deep_clean']) {
    setType(type);
    assert.equal(kitchenPhotosRequired(), true, type);
  }
  for (const type of ['mid_stay', 'emergency']) {
    setType(type);
    assert.equal(kitchenPhotosRequired(), false, type);
  }

  const phase3 = html.match(/function isPhase3Valid\(\)[\s\S]*?\n\}/)[0];
  assert.match(phase3, /kitchenPhotosRequired\(\) && state\.kitchenPhotos\.length < SECTION_PHOTO_MIN/);
  assert.ok(!/bedroomPhotos/.test(phase3), 'bedroom photos stay optional');
});

/* The two gates, run rather than grepped. The browser check covers the
   rendering; photos cannot be uploaded from it, so the counting happens here. */
function loadGates() {
  const src = [
    html.match(/const SECTION_PHOTO_MIN\s+= \d+;/)[0],
    html.match(/const MIDSTAY_PHOTO_MIN\s+= \d+;/)[0],
    html.match(/const AFTERCLEAN_PHOTO_MIN\s+= \d+;/)[0],
    html.match(/const CONFIRM_LEAVE_ITEMS = \[[\s\S]*?\n\];/)[0],
    html.match(/const confirmItemsNow = [^\n]+\n/)[0],
    html.match(/const kitchenPhotosRequired = [^\n]+\n/)[0],
    html.match(/function isPhase3Valid\(\)[\s\S]*?\n\}/)[0],
    html.match(/function isPhase4Valid\(\)[\s\S]*?\n\}/)[0],
    'return { isPhase3Valid, isPhase4Valid };',
  ].join('\n');
  const state = {
    cleaningType: 'turnover', kitchenPhotos: [], bedroomPhotos: [],
    aftercleanPhotos: [], supplyLogSaved: true, confirmItems: {},
  };
  return { state, ...new Function('state', src)(state) };
}

test('Step 3 will not advance on a turnover until the kitchen set is photographed', () => {
  const { state, isPhase3Valid } = loadGates();
  assert.equal(isPhase3Valid(), false, 'no kitchen photos');
  state.kitchenPhotos = ['a'];
  assert.equal(isPhase3Valid(), false, 'one is not the minimum of two');
  state.kitchenPhotos = ['a', 'b'];
  assert.equal(isPhase3Valid(), true, 'two passes');

  // A mid-stay guest is still in the unit: nothing to hand over, nothing to count.
  state.cleaningType = 'mid_stay';
  state.kitchenPhotos = [];
  assert.equal(isPhase3Valid(), true);
});

test('Step 4 will not finish until both new confirmations are answered', () => {
  const { state, isPhase4Valid } = loadGates();
  state.aftercleanPhotos = ['a', 'b', 'c', 'd', 'e'];
  const answerAllBut = (skip) => {
    state.confirmItems = {};
    for (const id of ['check_9_4', 'check_utensils_complete', 'check_ecoflow_charge',
                      'check_key_card', 'check_guest_code', 'check_smartlife_waiting']) {
      if (id !== skip) state.confirmItems[id] = 'confirmed';
    }
  };

  answerAllBut('check_utensils_complete');
  assert.equal(isPhase4Valid(), false, 'the utensil count is not optional');
  answerAllBut('check_smartlife_waiting');
  assert.equal(isPhase4Valid(), false, 'the arrival automation is not optional');
  answerAllBut(null);
  assert.equal(isPhase4Valid(), true);

  // "Issue Found" is a valid answer — a missing utensil must not trap the cleaner.
  state.confirmItems.check_utensils_complete = 'issue';
  assert.equal(isPhase4Valid(), true);

  // Mid-stay never asks for either, so the four original answers are enough.
  state.cleaningType = 'mid_stay';
  state.aftercleanPhotos = ['a', 'b', 'c', 'd'];   // MIDSTAY_PHOTO_MIN
  state.confirmItems = { check_9_4: 'confirmed', check_ecoflow_charge: 'confirmed',
                         check_key_card: 'confirmed', check_guest_code: 'confirmed' };
  assert.equal(isPhase4Valid(), true);
});

test('nothing still iterates the raw list where the per-type list is meant', () => {
  // The declaration is the only place the whole array may be named, plus the
  // filter that derives the per-type list from it.
  const raw = html.match(/CONFIRM_LEAVE_ITEMS/g) || [];
  assert.equal(raw.length, 2, 'expected the declaration and confirmItemsNow only');
});

test('Confirm & Leave reaches the database, not just the e-mail', () => {
  // B68 shape: [{icon, title, items:[{text, checked, critical}]}]
  assert.match(html, /checklistDetails\.push\(\{\s*\r?\n\s*title: 'Confirm & Leave',/);
  assert.match(html, /checked:\s+state\.confirmItems\[item\.id\] === 'confirmed'/);
});

test('the shell cache is bumped so the phone does not keep the old checklist', () => {
  assert.ok(!sw.includes('ch-shell-v5-networkfirst'), 'v5 would serve the pre-v8.7 shell');
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v6-networkfirst';/);
});

test('the highlighted confirmation renders its spine and badge', () => {
  const renderer = html.match(/function renderConfirmItems\(\)[\s\S]*?\n\}\r?\n/)[0];
  assert.match(renderer, /item\.highlight \? 'confirm-item highlight' : 'confirm-item'/);
  assert.match(renderer, /item\.badge \? .*item-badge/);
  assert.match(html, /\.confirm-item\.highlight \{/);
});
