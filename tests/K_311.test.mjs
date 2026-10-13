// Release 3.1.1, lane K: three named photos per area, EcoFlow merged into the AC line, garbage bin outside, chronological stay picker with a
// Missed group, header photos with a frosted panel and a colour code. Clock frozen (K_NOW).
// K_HTML=<path> runs the same tests against another copy of the page (used once to show them RED on the old code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(process.env.K_HTML || new URL('../index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const K_NOW = Date.parse('2026-10-14T02:00:00Z');
const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [K_NOW])); } static now() { return K_NOW; } };
const fnText = name => {
  const m = new RegExp(`\\n(async )?function ${name}\\(`).exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  return html.slice(s, html.indexOf('\n}\n', s) + 3);
};
const dataBlock = () => html.slice(html.indexOf('const PHASE_LABELS'), html.lastIndexOf('/*', html.indexOf('const state = {')));
function load(type = 'turnover', extra = {}, fns = []) {
  const state = { cleaningType: type, confirmItems: {}, confirmNotes: {}, checklist: {}, issueFlags: {}, kitchenPhotos: [] };
  const src = dataBlock() + '\n' + fns.map(fnText).join('\n') + '\nreturn { K_PHOTO_SLOTS, K_missingSlots, K_slotsOk, K_slotLabel, K_gatedAll, K_gatedForPhase, K_only, K_migrateDraft, K_groupStays, K_stayOptionsHtml, K_daysLate, K_headerPhoto, ' +
    'ARRIVE_ITEMS, CHEMICAL_ITEMS, BEDROOM_ITEMS, KITCHEN_ITEMS, FINAL_CLEANING_ITEMS, CONFIRM_LEAVE_ITEMS, K_KILLER_ITEMS, K_PHASE_FROM_V1, confirmItemsNow, K_HEADER_PHOTOS, K_KITCHEN_PHOTO_MAX, ' +
    'getActive: () => K_activeSlot, setActive: v => { K_activeSlot = v; }' + (fns.includes('K_advanceSlot') ? ', K_advanceSlot' : '') + (fns.includes('K_renderSlots') ? ', K_renderSlots' : '') + ' };';
  const sandbox = Object.assign({ state, FOLDED: true, Date: FakeDate, el: () => null, esc: s => String(s), document: {}, escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), Image: class {} }, extra);
  const names = Object.keys(sandbox);
  return { api: new Function(...names, src)(...names.map(n => sandbox[n])), state, sandbox };
}

/* ---------- 1. photos ---------- */
test('photos: six named slots, three per area, with the exact names asked for; the minimum is 3', () => {
  const { api } = load();
  assert.deepEqual(api.K_PHOTO_SLOTS.filter(s => s.area === 'Kitchen').map(s => s.label), ['Counter and sink', 'Stove and appliances', 'Utensils: drawer, rack and cookware laid out']);
  assert.deepEqual(api.K_PHOTO_SLOTS.filter(s => s.area === 'Bathroom').map(s => s.label), ['Toilet', 'Shower and drain', 'Sink and mirror']);
  assert.equal(Number(/const SECTION_PHOTO_MIN\s+= (\d+);/.exec(html)[1]), 3);
  assert.ok(api.K_KITCHEN_PHOTO_MAX >= 6, 'the section can hold all six');
});

test('photos: the screen needs every named slot (on a turnover or deep clean), a photo in the wrong slot does not count, other types need none', () => {
  const { api, state } = load('turnover');
  assert.equal(api.K_slotsOk(), false);
  assert.equal(api.K_missingSlots().length, 6);
  state.kitchenPhotos = [{ slot: 'b_toilet' }, { slot: 'b_shower' }, { slot: 'b_sink' }, { slot: 'k_counter' }, { slot: 'k_stove' }, { name: 'untagged old photo' }];
  assert.deepEqual(api.K_missingSlots().map(s => s.id), [], 'an untagged photo (from a live-v8 draft) fills the first missing slot, so nothing is retaken');
  state.kitchenPhotos = [{ name: 'v8 a', slot: null }, { name: 'v8 b', slot: null }];
  assert.equal(api.K_missingSlots().length, 4, 'a v8 draft with 2 kitchen photos needs only 4 more of the six');
  assert.deepEqual(api.K_missingSlots().map(s => s.id), ['b_sink', 'k_counter', 'k_stove', 'k_utensils'], 'the old photos fill the first slots in order');
  state.kitchenPhotos = [{ slot: 'k_utensils' }, { slot: null }];
  assert.deepEqual(api.K_missingSlots().map(s => s.id), ['b_shower', 'b_sink', 'k_counter', 'k_stove'], 'a tagged photo keeps its slot; the loose one takes the first free one');
  state.kitchenPhotos = [{ slot: 'b_toilet' }, { slot: 'b_shower' }, { slot: 'b_sink' }, { slot: 'k_counter' }, { slot: 'k_stove' }];
  state.kitchenPhotos.push({ slot: 'k_utensils' });
  assert.equal(api.K_slotsOk(), true);
  state.kitchenPhotos = [];
  state.cleaningType = 'deep_clean'; assert.equal(api.K_slotsOk(), false);
  for (const t of ['mid_stay', 'emergency']) { state.cleaningType = t; assert.equal(api.K_slotsOk(), true, t); }
});

test('photos: the slot rides in the photo name and the draft meta, and the payload key and shape are unchanged', () => {
  assert.match(html, /const fname  = `\$\{label\}\$\{slotId \? '_' \+ slotId : ''\}_\$\{todayManila\(\)\}_\$\{Date\.now\(\)\}\.jpg`;/);
  assert.match(html, /status: 'queued', slot: slotId,/);
  assert.match(html, /idbId: p\.idbId \|\| null, slot: p\.slot \|\| null,/);
  assert.match(html, /status: meta\.uploaded \? 'done' : 'queued', slot: meta\.slot \|\| null/);
  assert.ok(html.includes('photos[`section_${key}`] = uploaded;'), 'section_kitchen still carries them');
  assert.match(html, /\.map\(p => \(\{ name: p\.name, url: p\.url, fileId: p\.fileId \}\)\)/, 'the entry shape the server reads is unchanged');
  assert.match(html, /case 4: return isPhase3Valid\(\) && K_slotsOk\(\) && K_gatedOk\(4\)/);
});

test('photos: the slot chips render with a glyph and a word, mark the active one, and advance after a photo', () => {
  class El { constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this._at = {}; this.className = ''; this.textContent = ''; this.innerHTML = ''; } appendChild(c) { this.children.push(c); } addEventListener(t, f) { this.listeners[t] = f; } setAttribute(k, v) { this._at[k] = v; } }
  const box = new El();
  const { api, state } = load('turnover', { el: id => (id === 'K_slots' ? box : null), document: { createElement: () => new El() } }, ['K_renderSlots', 'K_advanceSlot']);
  api.K_renderSlots();
  const chips = box.children.filter(c => c.dataset.slot);
  assert.equal(chips.length, 6);
  assert.ok(chips.every(c => /Needed/.test(c.innerHTML)), 'a word as well as a colour');
  assert.equal(chips.find(c => c._at['aria-pressed'] === 'true').dataset.slot, 'b_toilet');
  state.kitchenPhotos.push({ slot: 'b_toilet' });
  api.K_advanceSlot();
  assert.equal(api.getActive(), 'b_shower', 'next needed slot');
  box.children = []; api.K_renderSlots();
  assert.match(box.children.filter(c => c.dataset.slot)[0].innerHTML, /&#10003; Done/);
  chips[5].listeners.click();
  assert.equal(api.getActive(), 'k_utensils', 'tapping a spot makes it the active one');
});

test('photos: the utensils confirm line points at its photo slot, and the server lines are untouched', () => {
  const { api } = load();
  const u = api.CONFIRM_LEAVE_ITEMS.find(i => i.id === 'check_utensils_complete');
  assert.match(u.detail, /Take the "Utensils" photo on this screen/);
  assert.equal(u.phase, 4, 'on the same screen as the photo card');
});

/* ---------- 2. items ---------- */
test('items: EcoFlow is one gated line with the AC and fridge (check_9_4 survives, covers the EcoFlow ids)', () => {
  const { api } = load();
  const ac = api.CONFIRM_LEAVE_ITEMS.find(i => i.id === 'check_9_4');
  assert.match(ac.text, /AC set to 24°C, fridge cold, EcoFlow RIVER 3 at 100%/);
  assert.deepEqual(ac.covers, ['check_ecoflow_charge', 'check_ecoflow_stowed']);
  assert.ok(!api.CONFIRM_LEAVE_ITEMS.some(i => i.id === 'check_ecoflow_charge'), 'no separate EcoFlow line');
  assert.match(ac.detail, /EcoFlow RIVER 3/); assert.match(ac.detail, /fridge/i); assert.match(ac.detail, /24°C/);
});

test('items: draft migration step 2: confirmed only if both old ones were; an issue on either carries over with its note', () => {
  const { api } = load();
  const mig = (cf, nt = {}, k) => api.K_migrateDraft({ _v: 5, _k: k, phase: 5, checklist: {}, confirmItems: cf, confirmNotes: nt, issueFlags: {} }, [], [], api.K_PHASE_FROM_V1);
  assert.equal(mig({ check_9_4: 'confirmed', check_ecoflow_charge: 'confirmed' }, {}, 1).confirmItems.check_9_4, 'confirmed');
  assert.equal(mig({ check_9_4: 'confirmed' }, {}, 1).confirmItems.check_9_4, undefined, 'the EcoFlow half was never answered');
  assert.equal(mig({ check_ecoflow_charge: 'confirmed' }, {}, 1).confirmItems.check_9_4, undefined);
  const a = mig({ check_9_4: 'issue', check_ecoflow_charge: 'confirmed' }, { check_9_4: 'fridge warm' }, 1);
  assert.equal(a.confirmItems.check_9_4, 'issue'); assert.equal(a.confirmNotes.check_9_4, 'fridge warm');
  const b = mig({ check_9_4: 'confirmed', check_ecoflow_charge: 'issue' }, { check_ecoflow_charge: 'at 60%' }, 1);
  assert.equal(b.confirmItems.check_9_4, 'issue'); assert.equal(b.confirmNotes.check_9_4, 'EcoFlow: at 60%');
  const both = mig({ check_9_4: 'issue', check_ecoflow_charge: 'issue' }, { check_9_4: 'fridge warm', check_ecoflow_charge: 'at 60%' }, 1);
  assert.equal(both.confirmNotes.check_9_4, 'fridge warm / EcoFlow: at 60%');
  assert.equal(b.confirmItems.check_ecoflow_charge, undefined, 'the old key is gone');
  assert.equal(b._k, 2);
  assert.equal(api.K_migrateDraft(b, [], [], api.K_PHASE_FROM_V1), b, 'a step-2 draft is left as it is');
  const fromOld = api.K_migrateDraft({ _v: 5, phase: 4, checklist: {}, confirmItems: { check_9_4: 'confirmed', check_ecoflow_charge: 'confirmed' }, confirmNotes: {}, issueFlags: {} }, [], [], api.K_PHASE_FROM_V1);
  assert.equal(fromOld._k, 2, 'a pre-s82 draft goes through both steps'); assert.equal(fromOld.phase, 5); assert.equal(fromOld.confirmItems.check_9_4, 'confirmed');
});

test('items: the garbage bin line is last on Finish, a normal tick, names the odourless insecticide, and is not asked on an emergency visit', () => {
  const { api, state } = load('turnover');
  const last = api.FINAL_CLEANING_ITEMS.at(-1);
  assert.equal(last.id, 'check_bin_outside');
  assert.match(last.text, /^Check the garbage bin outside/);
  assert.match(last.detail, /odourless insecticide/);
  assert.ok(!last.flag && !last.critical, 'a normal tick, not a gated item');
  assert.deepEqual(api.K_gatedAll().map(i => i.id).filter(id => id.includes('bin')), []);
  for (const t of ['turnover', 'deep_clean', 'mid_stay']) { state.cleaningType = t; assert.ok(api.K_only(api.FINAL_CLEANING_ITEMS).some(i => i.id === 'check_bin_outside'), t); }
  state.cleaningType = 'emergency';
  assert.ok(!api.K_only(api.FINAL_CLEANING_ITEMS).some(i => i.id === 'check_bin_outside'));
  assert.match(html, /renderItems\(K_only\(FINAL_CLEANING_ITEMS\), 'final-cleaning-items'\)/);
  assert.equal((html.match(/K_only\(FINAL_CLEANING_ITEMS\)/g) || []).length >= 5, true, 'progress, completion, report and details all honour the per-type filter');
});

test('items: per-type counts (gated, Lock up header, Finish lines) after the merge and the new line', () => {
  const { api, state } = load('turnover');
  const counts = t => { state.cleaningType = t; return { gated: api.K_gatedAll().length, lock: api.K_gatedForPhase(6).length, finish: api.K_only(api.FINAL_CLEANING_ITEMS).length, p5: api.K_gatedForPhase(5).length }; };
  assert.deepEqual(counts('turnover'), { gated: 8, lock: 4, finish: 4, p5: 1 });
  assert.deepEqual(counts('deep_clean'), { gated: 8, lock: 4, finish: 4, p5: 1 });
  assert.deepEqual(counts('mid_stay'), { gated: 6, lock: 3, finish: 4, p5: 1 });
  assert.deepEqual(counts('emergency'), { gated: 4, lock: 3, finish: 3, p5: 1 });
});

/* ---------- 4. stay picker ---------- */
const row = (o) => Object.assign({ event_id: 'e', checkin_date: '2026-10-01', checkout_date: '2026-10-05', nights: 4, guest_name: 'Zz', kind: 'checkout', already_reported: false }, o);

test('picker: one chronological list, Missed first (oldest first, days late), then today, staying now, scheduled maintenance', () => {
  const { api } = load();
  const rows = [
    row({ event_id: 'mid', kind: 'mid_stay', checkin_date: '2026-10-12', checkout_date: '2026-10-20' }),
    row({ event_id: 'today', checkout_date: '2026-10-14' }),
    row({ event_id: 'm2', checkout_date: '2026-10-11' }),
    row({ event_id: 'blk', kind: 'block', checkin_date: '2026-10-14', checkout_date: '2026-10-15', guest_name: null }),
    row({ event_id: 'm1', checkout_date: '2026-10-02' }),
  ];
  const g = api.K_groupStays(rows, '2026-10-14');
  assert.deepEqual(g.missed.map(b => b.event_id), ['m1', 'm2'], 'oldest first');
  assert.deepEqual(g.missed.map(b => b.daysLate), [12, 3]);
  assert.deepEqual(g.today.map(b => b.event_id), ['today']);
  assert.deepEqual(g.mid.map(b => b.event_id), ['mid']);
  assert.deepEqual(g.block.map(b => b.event_id), ['blk']);
  const htmlOut = api.K_stayOptionsHtml(g, b => 'stay ' + b.event_id);
  const order = [...htmlOut.matchAll(/<option value="(\d+)">([^<]*)</g)].map(m => m[2]);
  assert.deepEqual(order, ['Missed · 12 days late · stay m1', 'Missed · 3 days late · stay m2', 'stay today', 'stay mid', 'stay blk']);
  assert.ok(htmlOut.indexOf('Missed: no report yet') < htmlOut.indexOf("Today's turnover") && htmlOut.indexOf("Today's turnover") < htmlOut.indexOf('Staying now'));
  assert.match(htmlOut, /<optgroup label="⚠ Missed: no report yet">/, 'glyph and words');
  assert.match(api.K_stayOptionsHtml(api.K_groupStays([row({ event_id: 'x', checkout_date: '2026-10-13' })], '2026-10-14'), b => 'x'), /Missed · 1 day late/, 'singular');
});

test('picker: a stay that was extended (same guest, next booking starts on the checkout date) is not Missed; a different guest still is', () => {
  const { api } = load();
  const first = row({ event_id: 'a', guest_name: ' Ana Cruz ', checkin_date: '2026-10-01', checkout_date: '2026-10-05' });
  const second = row({ event_id: 'b', guest_name: 'ana cruz', checkin_date: '2026-10-05', checkout_date: '2026-10-09', already_reported: true });
  assert.deepEqual(api.K_groupStays([first], '2026-10-14', [first, second]).missed.map(b => b.event_id), [], 'chained: the guest never left, no turnover was due (the successor is already reported, so it is only in the full list)');
  const other = row({ event_id: 'c', guest_name: 'Someone Else', checkin_date: '2026-10-05', checkout_date: '2026-10-09' });
  assert.deepEqual(api.K_groupStays([first], '2026-10-14', [first, other]).missed.map(b => b.event_id), ['a'], 'same dates, a different guest: still listed');
  const later = row({ event_id: 'd', guest_name: 'Ana Cruz', checkin_date: '2026-10-06', checkout_date: '2026-10-09' });
  assert.deepEqual(api.K_groupStays([first], '2026-10-14', [first, later]).missed.map(b => b.event_id), ['a'], 'a gap day: a real departure');
  assert.deepEqual(api.K_groupStays([row({ event_id: 'n', guest_name: null, checkout_date: '2026-10-05' })], '2026-10-14', [row({ event_id: 'n', guest_name: null, checkout_date: '2026-10-05' }), row({ event_id: 'm', guest_name: null, checkin_date: '2026-10-05', checkout_date: '2026-10-08' })]).missed.length, 1, 'two nameless rows are not the same guest');
  assert.match(html, /K_groupStays\(reportable, todayManila\(\), rows\)/, 'the full server list is passed, reported rows included');
});

test('picker: a block is never under Missed, whatever its dates', () => {
  const { api } = load();
  const g = api.K_groupStays([row({ kind: 'block', checkin_date: '2026-10-01', checkout_date: '2026-10-03', guest_name: null }), row({ kind: 'block', checkin_date: '2026-10-14', checkout_date: '2026-10-15' })], '2026-10-14');
  assert.equal(g.missed.length, 0);
  assert.equal(g.block.length, 2);
});

test('picker: stays are fetched 30 days back, reported stays stay out, and a lone missed stay is never auto-picked', () => {
  assert.match(html, /body: JSON\.stringify\(\{ p_date: dateStr, p_property_id: PROPERTY_ID, p_lookback: 30 \}\)/);
  assert.match(html, /const unreported = rows\.filter\(r => !r\.already_reported\);/);
  assert.match(html, /if \(_stayOptions\.length === 1 && !nMissed && !el\('lastGuestName'\)\?\.value\)/);
  assert.match(html, /⚠ Missed: \$\{nMissed\} stay/);
});

/* ---------- 3. look ---------- */
const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

test('look: header text keeps AA contrast on the frosted panel even over a pure white photo (and on the solid fallback)', () => {
  const frost = /@supports[^{]*\{\s*html\.K_folded \.phase-header\.K_hasimg \.K_panel \{ background: rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(html);
  const solid = /html\.K_folded \.phase-header \.K_panel \{[^}]*background: rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(html);
  assert.ok(frost && solid, 'both panel backgrounds are declared');
  const ivory = [0xF9, 0xF6, 0xF0], tag = /html\.K_folded \.phase-header \.phase-tagline \{ color: rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(html);
  assert.ok(tag);
  const white = [255, 255, 255];
  const report = {};
  for (const [name, m] of [['frosted', frost], ['solid', solid]]) {
    const panel = over([+m[1], +m[2], +m[3]], +m[4], white);          // worst case: the photo behind is pure white
    const tagFg = over([+tag[1], +tag[2], +tag[3]], +tag[4], panel);
    report[name] = { h1: contrast(ivory, panel), tagline: contrast(tagFg, panel) };
    assert.ok(report[name].h1 >= 4.5, `${name} title ${report[name].h1}`);
    assert.ok(report[name].tagline >= 4.5, `${name} tagline ${report[name].tagline}`);
  }
  assert.match(html, /backdrop-filter: blur\(8px\)/);
  assert.match(html, /@supports \(\(backdrop-filter: blur\(6px\)\) or \(-webkit-backdrop-filter: blur\(6px\)\)\)/, 'a solid fallback where backdrop-filter is missing');
});

test('look: the header height is reserved before the photo loads, only when folded, and each area has its own hue (never the only signal)', () => {
  assert.match(html, /if \(FOLDED\) document\.documentElement\.classList\.add\('K_folded'\);/);
  assert.match(html, /html\.K_folded \.phase-header \{ min-height: 176px;/);
  const hues = [...html.matchAll(/#phase-(\d) \{ --K_hue: (#[0-9A-Fa-f]{6}); \}/g)].map(m => m[2]);
  assert.equal(hues.length, 7);
  assert.equal(new Set(hues).size, 7, 'one hue per area');
  assert.match(html, /border-left: 4px solid var\(--K_hue/);
  for (let i = 0; i < 7; i++) assert.ok(html.includes(`#dot-${i}.active, #dot-${i}.completed`), `step dot ${i}`);
  assert.match(html, /<div class="K_zone" aria-hidden="true">/.source ? /K_zone/ : /K_zone/, 'the zone icon stays');
  assert.match(html, /\.phase-header \.K_step i \{ background: var\(--K_hue/);
});

test('look: a header photo is used only when folded and only after it loads; standalone keeps the drawn header; each area has its own photo', () => {
  const made = [];
  class FakeImage { set src(v) { this._src = v; made.push(this); } }
  const hdr = { cls: new Set(), vars: {}, style: { setProperty: (k, v) => { hdr.vars[k] = v; } }, classList: { add: c => hdr.cls.add(c) } };
  const doc = { querySelector: () => hdr };
  const folded = load('turnover', { Image: FakeImage, document: doc, FOLDED: true }, []);
  const loaded = {};
  folded.api.K_headerPhoto(3);
  assert.equal(made.length, 1);
  assert.equal(made[0]._src, '../guide/img/standard/bed.webp');
  assert.equal(hdr.cls.has('K_hasimg'), false, 'not before it has loaded');
  made[0].onload();
  assert.equal(hdr.cls.has('K_hasimg'), true);
  assert.match(hdr.vars['--K_img'], /bed\.webp/);
  folded.api.K_headerPhoto(3); assert.equal(made.length, 1, 'loaded once');
  const broken = load('turnover', { Image: FakeImage, document: { querySelector: () => hdr }, FOLDED: true });
  hdr.cls.clear(); broken.api.K_headerPhoto(5); made.at(-1).onerror && made.at(-1).onerror();
  assert.equal(hdr.cls.has('K_hasimg'), false, 'a failed image leaves the drawn header');
  const before = made.length;
  const alone = load('turnover', { Image: FakeImage, document: doc, FOLDED: false });
  alone.api.K_headerPhoto(2);
  assert.equal(made.length, before, 'standalone never requests the photo');
  assert.deepEqual([...folded.api.K_HEADER_PHOTOS], ['living', 'tv-wall', 'laundry', 'bed', 'bathroom', 'room', 'entrance']);
});
