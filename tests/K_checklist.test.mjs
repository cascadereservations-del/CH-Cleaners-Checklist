// Session 82, lane K: the streamlined checklist. Mapping, draft migration, gating of killer items, block-filter mirror, progress probe,
// hand-back message, SSO refresh race, and structure guards. Every clock is frozen (K_NOW).
// K_HTML=<path> runs the same tests against another copy of the page (used once to show them RED on the old code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(process.env.K_HTML || new URL('../index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const K_NOW = Date.parse('2026-10-13T02:00:00Z');

/* The 37 ordinary ticks of the old checklist (v8.8), by id. The mapping must account for every one exactly once. */
const OLD_IDS = [
  'check_0_1', 'check_1_1', 'check_1_4', 'check_1_5', 'check_1_7', 'check_1_9', 'check_1_10', 'check_1_11', 'check_1_8', 'check_snake_room',
  'check_2_4', 'check_2_1', 'check_3_1', 'check_3_4',
  'check_4_1', 'check_4_5', 'check_5_2', 'check_5_6', 'check_5_9', 'check_5_8', 'check_5_10', 'check_5_7',
  'check_7_4', 'check_drain_screen', 'check_7_2', 'check_7_5', 'check_6_1', 'check_7_6', 'check_6_4', 'check_6_5', 'check_7_7',
  'check_8_1', 'check_balcony', 'check_9_1', 'check_vacuum_charge',
  'check_ecoflow_stowed', 'check_10_6',
];

/* Evaluate the real data + helper block of the page (PHASE_LABELS .. the weekly note) in a sandbox with stubs. */
function load(stateOverrides = {}, extra = {}) {
  const start = html.indexOf('const PHASE_LABELS');
  const end = html.indexOf('/* Deep maintenance is scheduled');
  assert.ok(start > 0 && end > start, 'data block not found');
  const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [K_NOW])); } static now() { return K_NOW; } };
  const state = { cleaningType: 'turnover', confirmItems: {}, confirmNotes: {}, checklist: {}, issueFlags: {}, startTimestamp: K_NOW - 3600e3, submissionId: 'sub-1', ...stateOverrides };
  const src = html.slice(start, end) + '\nreturn { PHASE_LABELS, PHASE_COUNT, K_PHASE_FROM_V1, ARRIVE_ITEMS, CHEMICAL_ITEMS, BEDROOM_ITEMS, KITCHEN_ITEMS, FINAL_CLEANING_ITEMS, POWER_CHECK_ITEMS, '
    + 'K_KILLER_ITEMS, CONFIRM_LEAVE_ITEMS, confirmItemsNow, K_gatedAll, K_gatedForPhase, K_gatedOk, K_migrateDraft, K_blockOffered, K_reportProgress, K_handBack, '
    + 'K_refreshConfirmCopy, K_GATE_HINT_ID, resetProgressOff: () => { K_progressOff = false; }, progressOff: () => K_progressOff };';
  const els = {};
  const el = id => (els[id] = els[id] || { textContent: '' });
  const sandbox = Object.assign({
    state, el, esc: s => String(s), FOLDED: true, document: {}, location: { origin: 'https://staff.example' }, SUPABASE_URL: 'https://x.supabase.co',
    staffSession: { user: { id: 'u1' } }, staffHeaders: async () => ({ apikey: 'k' }), navigator: { onLine: true }, Date: FakeDate,
    window: { parent: null }, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  }, extra);
  const names = Object.keys(sandbox);
  const api = new Function(...names, src)(...names.map(n => sandbox[n]));
  return { api, state, sandbox, els };
}

test('mapping: every one of the 37 old ids survives as a line or sits in exactly one covers list', () => {
  const { api } = load();
  const lines = [...api.ARRIVE_ITEMS, ...api.CHEMICAL_ITEMS, ...api.BEDROOM_ITEMS, ...api.KITCHEN_ITEMS, ...api.FINAL_CLEANING_ITEMS];
  const gated = [...api.K_KILLER_ITEMS, ...api.CONFIRM_LEAVE_ITEMS];
  const all = [...lines, ...gated];
  const count = new Map(OLD_IDS.map(id => [id, 0]));
  for (const l of all) {
    if (count.has(l.id)) count.set(l.id, count.get(l.id) + 1);
    for (const c of l.covers || []) { if (c === 'check_ecoflow_charge') continue; /* a former gated line, merged into check_9_4 in 3.1.1 */ assert.ok(count.has(c), `${l.id} covers an id that was never an old line: ${c}`); count.set(c, count.get(c) + 1); }
  }
  for (const [id, n] of count) assert.equal(n, 1, `${id} must appear exactly once (kept or covered), found ${n}`);
  assert.equal(lines.length, 21, 'ordinary lines (19, the disinfect line split back out of check_4_1, and the new garbage-bin line)');
  assert.deepEqual(api.K_KILLER_ITEMS.map(i => i.id), ['check_2_4', 'check_7_5', 'check_10_6']);
  const ids = all.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length, 'no id is declared twice');
});

test('mapping: a merged line has one surviving id plus covers, and the phases hold the planned lines', () => {
  const { api } = load();
  assert.deepEqual([...api.ARRIVE_ITEMS, ...api.CHEMICAL_ITEMS].map(i => i.id), ['check_0_1', 'check_1_4', 'check_1_5', 'check_1_9', 'check_2_1', 'check_3_1']);
  assert.deepEqual(api.BEDROOM_ITEMS.map(i => i.id), ['check_4_1', 'check_4_5', 'check_5_2', 'check_5_9', 'check_5_10', 'check_1_8']);
  assert.deepEqual(api.KITCHEN_ITEMS.map(i => i.id), ['check_7_4', 'check_drain_screen', 'check_6_1', 'check_7_6', 'check_7_7']);
  assert.deepEqual(api.FINAL_CLEANING_ITEMS.map(i => i.id), ['check_8_1', 'check_9_1', 'check_vacuum_charge', 'check_bin_outside']);
  assert.equal(api.POWER_CHECK_ITEMS.length, 0);
  assert.ok(api.KITCHEN_ITEMS.find(i => i.id === 'check_7_7').triggersInventory, 'triggersInventory stays on the refill line');
  assert.ok(api.ARRIVE_ITEMS.find(i => i.id === 'check_1_9').flag && api.KITCHEN_ITEMS.find(i => i.id === 'check_drain_screen').flag, 'flags survive');
  assert.deepEqual([...api.PHASE_LABELS], ['Setup', 'Document', 'Arrive & Prep', 'Bedroom & Living', 'Bathroom & Kitchen', 'Finish', 'Lock up']);
  assert.equal(api.PHASE_COUNT, 7);
  for (const i of [...api.ARRIVE_ITEMS, ...api.CHEMICAL_ITEMS, ...api.BEDROOM_ITEMS, ...api.KITCHEN_ITEMS, ...api.FINAL_CLEANING_ITEMS]) {
    assert.match(i.text, /^[A-Z]/, `${i.id} starts with a capital`);
    assert.ok(i.text.split(/[ ,;:]/)[0].length > 2, `${i.id} starts with a word`);
  }
});

test('draft migration: a merged line is ticked only if ALL the old ids it covers were ticked', () => {
  const { api } = load();
  const lines = [...api.ARRIVE_ITEMS, ...api.CHEMICAL_ITEMS, ...api.BEDROOM_ITEMS, ...api.KITCHEN_ITEMS, ...api.FINAL_CLEANING_ITEMS];
  const d = { _v: 5, phase: 4, checklist: { check_0_1: true, check_1_1: true, check_5_2: true, check_5_6: false, check_4_1: true, check_4_5: true, check_5_8: true, check_1_5: true }, confirmItems: {}, confirmNotes: {}, issueFlags: {} };
  const m = api.K_migrateDraft(d, lines, api.K_KILLER_ITEMS, api.K_PHASE_FROM_V1);
  assert.equal(m.checklist.check_0_1, true, 'both old ids ticked');
  assert.equal(m.checklist.check_5_2, false, 'pillows were not ticked');
  assert.equal(m.checklist.check_4_1, true, 'all three old ids ticked');
  assert.equal(m.checklist.check_1_5, false, 'check_1_7 was never ticked');
  assert.equal(m._k, 2);
  assert.equal(d._k, undefined, 'the old object is not mutated');
});

test('draft migration: old phase indexes map to the new ones; killers ticked become Confirmed; flag notes move, nothing is lost', () => {
  const { api } = load();
  const lines = [...api.ARRIVE_ITEMS, ...api.CHEMICAL_ITEMS, ...api.BEDROOM_ITEMS, ...api.KITCHEN_ITEMS, ...api.FINAL_CLEANING_ITEMS];
  const mig = d => api.K_migrateDraft(d, lines, api.K_KILLER_ITEMS, api.K_PHASE_FROM_V1);
  assert.deepEqual([0, 1, 2, 3, 4].map(p => mig({ phase: p, checklist: {} }).phase), [0, 1, 2, 3, 5]);
  const m = mig({ phase: 4, checklist: { check_2_4: true, check_10_6: true, check_7_5: false }, confirmItems: { check_9_4: 'confirmed' }, confirmNotes: {},
    issueFlags: { check_1_11: { note: 'filter light red' }, check_7_5: { note: 'drain smells' } } });
  assert.equal(m.confirmItems.check_2_4, 'confirmed');
  assert.equal(m.confirmItems.check_10_6, 'confirmed');
  assert.equal(m.confirmItems.check_9_4, undefined, 'check_9_4 was confirmed but the EcoFlow half was never answered: the merged line asks again');
  assert.equal(m.confirmItems.check_7_5, 'issue', 'a flagged note becomes an Issue Found');
  assert.equal(m.confirmNotes.check_7_5, 'drain smells');
  assert.equal(m.issueFlags.check_1_4.note, 'filter light red', 'a covered id flag note moves to the line that absorbed it');
  assert.ok(m.issueFlags.check_1_11, 'and the original is kept');
  const again = mig(m);
  assert.equal(again, m, 'an already migrated draft is returned as it is');
});

test('gating: each killer item gates only its own screen, and Issue Found counts as an answer', () => {
  const { api, state } = load();
  assert.deepEqual(api.K_gatedForPhase(2).map(i => i.id), ['check_2_4']);
  assert.deepEqual(api.K_gatedForPhase(4).map(i => i.id), ['check_7_5', 'check_utensils_complete'], 'the smell check, then the utensil count beside the kitchen photos');
  assert.deepEqual(api.K_gatedForPhase(3).map(i => i.id), []);
  assert.equal(api.K_gatedOk(2), false); assert.equal(api.K_gatedOk(4), false);
  state.confirmItems.check_2_4 = 'confirmed';
  assert.equal(api.K_gatedOk(2), true); assert.equal(api.K_gatedOk(4), false, 'answering the linen check does not open the smell check');
  state.confirmItems.check_7_5 = 'issue';
  assert.equal(api.K_gatedOk(4), false, 'the utensil count is still open');
  state.confirmItems.check_utensils_complete = 'confirmed';
  assert.equal(api.K_gatedOk(4), true);
  assert.equal(api.K_gatedOk(3), true, 'Bedroom & Living gates nothing');
});

test('gating: Lock up is the door-side pause point; AC, fridge and EcoFlow moved to Finish, utensils to the kitchen', () => {
  const { api, state } = load();
  assert.deepEqual(api.K_gatedForPhase(6).map(i => i.id), ['check_key_card', 'check_guest_code', 'check_10_6', 'check_smartlife_waiting']);
  assert.deepEqual(api.K_gatedForPhase(5).map(i => i.id), ['check_9_4']);
  assert.equal(api.confirmItemsNow().length, 5, 'confirmItemsNow(): 6 minus the EcoFlow line merged into check_9_4 (3.1.1)');
  state.cleaningType = 'mid_stay';
  assert.deepEqual(api.K_gatedForPhase(6).map(i => i.id), ['check_key_card', 'check_guest_code', 'check_10_6']);
  assert.deepEqual(api.K_gatedForPhase(2).map(i => i.id), ['check_2_4'], 'a mid-stay still inspects the linen');
  state.cleaningType = 'emergency';
  assert.deepEqual(api.K_gatedAll().map(i => i.id), ['check_9_4', 'check_key_card', 'check_guest_code', 'check_10_6'], 'an emergency visit is not a clean: no linen or smell gate, power and safety still asked');
});

test('gating: isPhaseValid enforces the killers; the real phase gate function is wired to them', () => {
  const m = html.match(/function isPhaseValid\(phase\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'isPhaseValid');
  assert.match(m[0], /case 2: return K_gatedOk\(2\)/);
  assert.match(m[0], /case 4: return isPhase3Valid\(\) && K_slotsOk\(\) && K_gatedOk\(4\)/);
  assert.match(m[0], /case 6: return isPhase4Valid\(\) && K_gatedOk\(6\)/);
  assert.match(html, /btnSubmit\.disabled = !isPhaseValid\(PHASE_COUNT - 1\)/, 'Submit is gated by the last phase');
  // run it for real
  const { api, state } = load({ kitchenPhotos: ['k_utensils', 'k_cookware'].map(s => ({ slot: s })), supplyLogSaved: true, aftercleanPhotos: ['1', '2', '3', '4', '5'], bedroomPhotos: [], meterPhotos: [null, null] });
  const src = [m[0], html.match(/function isPhase3Valid\(\)[\s\S]*?\n\}/)[0], html.match(/function isPhase4Valid\(\)[\s\S]*?\n\}/)[0], html.match(/function K_afterPhotosOk\(\)[\s\S]*?\n\}/)[0],
    'const SECTION_PHOTO_MIN = 3, K_KITCHEN_PHOTO_MIN = 2, MIDSTAY_PHOTO_MIN = 4, AFTERCLEAN_PHOTO_MIN = 5;', 'const isPhase0Valid = () => true, isPhase1Valid = () => true;',
    'return isPhaseValid;'].join('\n');
  const isPhaseValid = new Function('state', 'K_gatedOk', 'K_slotsOk', 'confirmItemsNow', 'kitchenPhotosRequired', src)(state, api.K_gatedOk, () => state.kitchenPhotos.length >= 2, api.confirmItemsNow, () => true);
  assert.equal(isPhaseValid(2), false, 'linen unanswered');
  state.confirmItems.check_2_4 = 'confirmed';
  assert.equal(isPhaseValid(2), true);
  assert.equal(isPhaseValid(4), false, 'smell unanswered');
  state.confirmItems.check_7_5 = 'issue';
  state.confirmItems.check_utensils_complete = 'confirmed';
  assert.equal(isPhaseValid(4), true);
  assert.equal(isPhaseValid(5), false, 'Finish also asks for the AC, fridge and EcoFlow line');
  state.confirmItems.check_9_4 = 'confirmed';
  assert.equal(isPhaseValid(5), true);
  for (const i of api.confirmItemsNow()) state.confirmItems[i.id] = 'confirmed';
  assert.equal(isPhaseValid(6), false, 'every Confirm & Leave item answered but the final power and safety check is not');
  state.confirmItems.check_10_6 = 'confirmed';
  assert.equal(isPhaseValid(6), true);
  state.aftercleanPhotos = [];
  assert.equal(isPhaseValid(5), false, 'Finish asks for the after-clean photos');
});

test('header: the Confirm & Leave count is the real count, not a hard-coded 4', () => {
  assert.doesNotMatch(html, /All 4 required/);
  const { api, state, els } = load();
  api.K_refreshConfirmCopy();
  assert.equal(els.K_req_tag.textContent, 'All 4 required', 'turnover: key card, guest code, final check, SmartLife');
  assert.match(els.K_confirm_intro.textContent, /each of the 4 items/);
  state.cleaningType = 'mid_stay';
  api.K_refreshConfirmCopy();
  assert.equal(els.K_req_tag.textContent, 'All 3 required');
});

test('block filter mirror: a stay is always offered, a block only when staff scheduled maintenance for a date it covers', () => {
  const { api } = load();
  const b = o => ({ status: 'blocked', checkin_date: '2026-10-13', checkout_date: '2026-10-14', block_reason: 'maintenance', block_reason_source: 'staff', ...o });
  assert.equal(api.K_blockOffered({ status: 'confirmed', checkin_date: '2026-10-01', checkout_date: '2026-10-05' }, '2026-10-13'), true, 'a stay is unchanged');
  assert.equal(api.K_blockOffered(b(), '2026-10-13'), true, 'staff-scheduled maintenance covering today');
  assert.equal(api.K_blockOffered(b({ block_reason_source: 'assumed' }), '2026-10-13'), false, 'maintenance the sync only assumed');
  assert.equal(api.K_blockOffered(b({ block_reason: 'brownout', block_reason_source: 'auto' }), '2026-10-13'), false);
  assert.equal(api.K_blockOffered(b({ checkin_date: '2026-10-08', checkout_date: '2026-10-10' }), '2026-10-13'), false, 'a past block gets no look-back');
  assert.equal(api.K_blockOffered(b({ checkout_date: '2026-10-13' }), '2026-10-13'), false, 'a block that ends today does not cover today');
  assert.equal(api.K_blockOffered(b(), '2026-10-12'), false, 'a future block is not offered before its date');
});

test('block filter: the client no longer treats a block as a checkout, a check-in or the next booking', () => {
  assert.match(html, /const isCheckout = events\.some\(ev => ev\.checkout_date === dateStr && ev\.status !== 'cancelled' && ev\.status !== 'blocked'\)/);
  assert.match(html, /const isCheckin  = events\.some\(ev => ev\.checkin_date  === dateStr && ev\.status !== 'cancelled' && ev\.status !== 'blocked'\)/);
  assert.match(html, /ev\.status === 'blocked' && K_blockOffered\(ev, dateStr\)/);
  assert.match(html, /ev\.status !== 'cancelled' && ev\.status !== 'blocked' && new Date\(ev\.checkin_date/);
  assert.match(html, /select=checkin_date,checkout_date,nights,status,block_reason,block_reason_source/);
  assert.match(html, /if \(b\.kind === 'block'\)\s+return 0;/, 'the picker accepts the new kind block');
});

test('progress: cleaning_progress_set_v1 is called with step, of and label; a 404 stops it for the session', async () => {
  const calls = [];
  let status = 200;
  const { api } = load({}, { fetch: async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body) }); return { ok: status === 200, status, json: async () => ({}) }; } });
  await api.K_reportProgress(2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/cleaning_progress_set_v1');
  assert.deepEqual(calls[0].body, { p_step: 3, p_of: 7, p_label: 'Arrive & Prep' }, 'exact argument keys');
  status = 404;
  await api.K_reportProgress(3);
  assert.equal(api.progressOff(), true);
  const n = calls.length;
  await api.K_reportProgress(4);
  assert.equal(calls.length, n, 'no more calls after a 404');
});

test('progress: PGRST202 also stops it, and a network error never throws or blocks', async () => {
  const { api } = load({}, { fetch: async () => ({ ok: false, status: 400, json: async () => ({ code: 'PGRST202' }) }) });
  await api.K_reportProgress(1);
  assert.equal(api.progressOff(), true);
  const t = load({}, { fetch: async () => { throw new TypeError('network'); } });
  await assert.doesNotReject(() => t.api.K_reportProgress(1));
  assert.equal(t.api.progressOff(), false, 'a network error is not a reason to stop');
  const off = load({}, { navigator: { onLine: false }, fetch: async () => { throw new Error('must not be called offline'); } });
  await off.api.K_reportProgress(1);
  assert.match(html, /K_reportProgress\(newPhase\);\s+\/\/ shell hand-off; never awaited/, 'goToPhase calls it without awaiting');
});

test('hand-back: cs-clean-done is posted to the framing window, same origin only, and only when framed', () => {
  const posts = [];
  const framed = load({}, { window: { parent: { postMessage: (m, o) => posts.push({ m, o }) } } });
  assert.equal(framed.api.K_handBack({ sessionId: 'sess-9' }, 2, 14), true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].o, 'https://staff.example');
  assert.deepEqual(posts[0].m, { type: 'cs-clean-done', session_id: 'sess-9', started_at: '2026-10-13T01:00:00.000Z', finished_at: '2026-10-13T02:00:00.000Z', issues: 2, photos: 14 });
  assert.equal(framed.api.K_handBack({}, 0, 0), true);
  assert.equal(posts[1].m.session_id, 'sub-1', 'falls back to the submission id when the server named no session');
  // not framed: the page IS its own parent
  const self = { postMessage: () => { throw new Error('must not post'); } };
  const alone = load({}, { window: self });
  alone.sandbox.window.parent = self;
  assert.equal(alone.api.K_handBack({}, 0, 0), false);
  assert.match(html, /showSuccessScreen\(\);\s+\/\/ K_: tell the Cascade Staff shell/, 'sent after a successful submit only');
});

test('single sign-on: a refresh token the shell already used is not a sign-out when the shell holds a newer session', async () => {
  const grab = n => { const s = html.indexOf(n); const e = html.indexOf('\n}\n', s); assert.ok(s > 0 && e > 0, n); return html.slice(s, e + 3); };
  const nowSec = Math.floor(K_NOW / 1000);
  const shellOld = { access_token: 'old', refresh_token: 'r1', expires_at: nowSec - 100, user: { id: 'u1', email: 'a@b.c', user_metadata: { display_name: 'Kay' } } };
  const shellNew = { access_token: 'new', refresh_token: 'r2', expires_at: nowSec + 3000, user: { id: 'u1', email: 'a@b.c', user_metadata: { display_name: 'Kay' } } };
  const store = { sb: JSON.stringify(shellOld) };
  const storages = { sessionStorage: { getItem: () => store.sb, setItem: (k, v) => { store.sb = v; } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  class AuthRejectedError extends Error {}
  let calls = 0;
  const src = [grab('function deriveDisplayName('), grab('function adoptShellSession('), grab('function mergeShellTokens('), grab('function readShellSession('), grab('function saveStaffSession('),
    grab('function clearStaffSession('), grab('async function requireStaffSession(')].join('\n') + '\nreturn { requireStaffSession, get s() { return staffSession; }, get src() { return shellSrc; } };';
  const authRequest = async () => { calls++; store.sb = JSON.stringify(shellNew); throw new AuthRejectedError('Invalid Refresh Token: Already Used'); };
  // the real function text, with its free variables declared here
  const body = 'let staffSession = null, shellSrc = null, refreshInFlight = null; const AUTH_SESSION_KEY = "k", SHELL_KEY = "sb"; const FOLDED = true;\n' + src;
  const fake = { sessionStorage: storages.sessionStorage, localStorage: storages.localStorage };
  const mod = new Function('window', 'authRequest', 'AuthRejectedError', 'localStorage', 'Date', 'clearPinRecord', body)(fake, authRequest, AuthRejectedError, storages.localStorage,
    class extends Date { static now() { return K_NOW; } }, () => {});
  const s = await mod.requireStaffSession();
  assert.ok(s, 'still signed in');
  assert.equal(s.access_token, 'new', 'took the shell session that already refreshed');
  assert.equal(calls, 1);
  assert.match(html, /K_: a refresh token works once/, 'the fix is in the page');
});

test('structure: no duplicate element ids, the six-plus-one phases exist, and every script parses', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]).filter(id => !id.includes('${'));
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dup)], [], 'duplicate ids');
  for (let i = 0; i < 7; i++) assert.ok(html.includes(`id="phase-${i}"`), `phase-${i}`);
  assert.ok(!html.includes('id="phase-7"'));
  assert.ok(html.includes('id="dot-6"'));
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]));
});

test('structure: new top-level names carry the K_ prefix and are declared once', () => {
  for (const n of ['K_migrateDraft', 'K_blockOffered', 'K_reportProgress', 'K_handBack', 'K_phaseDone', 'K_initStepHeaders', 'K_bindStandard', 'K_openStandard', 'K_gatedAll', 'K_refreshConfirmCopy', 'K_afterPhotosOk']) {
    const decl = html.match(new RegExp(`(function ${n}\\(|const ${n}\\b|let ${n}\\b)`, 'g')) || [];
    assert.equal(decl.length, 1, `${n} declared once`);
  }
});

test('the standard photo shows only when folded and the image loaded (never a broken image)', () => {
  const fn = html.match(/function K_bindStandard\(wrap, item\) \{[\s\S]*?\n\}/)[0];
  assert.match(fn, /if \(!item\.standard \|\| !FOLDED\) return;/);
  assert.match(fn, /img\.onload = \(\) => \{[\s\S]*\(wrap\.querySelector\('details\.K_covers'\) \|\| wrap\)\.appendChild\(b\);/, 'the button is added in onload only, inside the collapsed details so nothing shifts');
  assert.doesNotMatch(fn, /onerror/);
  assert.match(html, /const K_STD_BASE = '\.\.\/guide\/img\/standard\/';/);
});

test('motion and targets: the completion tick respects prefers-reduced-motion; flag buttons are 44 px', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{\s*\.K_done \{ animation: none; \}\s*\.K_tick circle, \.K_tick path \{ animation: none; stroke-dashoffset: 0; \}/);
  assert.match(html, /\.flag-btn \{\s*width: 44px;\s*height: 44px;/);
  assert.match(html, /\.K_covers summary \{ min-height: 44px;/);
});

test('the shell cache is bumped for the new checklist', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v9-networkfirst';/);
});

test('kept contracts: photo section keys, [URGENT], flags, per-type only logic, details shape', () => {
  assert.ok(html.includes("photos['section_meter']"), 'section_meter');
  assert.ok(html.includes('photos[`section_${key}`]'), 'section_preclean / section_afterclean are built from the key');
  assert.match(html, /\['preclean', 'bedroom', 'kitchen', 'afterclean'\]/);
  assert.ok(html.includes("K_isUrgentIssue(item) ? '[URGENT] ' : ''"), '[URGENT] marker is kept for the urgent items');
  assert.match(html, /const confirmItemsNow = \(\) => CONFIRM_LEAVE_ITEMS\.filter\(i => !i\.only \|\| i\.only\.includes\(state\.cleaningType\)\);/);
  assert.match(html, /issue_\$\{id\}/);
  assert.match(html, /critical: !!item\.critical,/, 'killers keep the Critical Items Summary');
  const details = html.match(/const checklistDetails = \[[\s\S]*?\]\.map\(sec => \(\{[\s\S]*?\}\)\);/)[0];
  assert.match(details, /title: sec\.title,\s+icon:  sec\.icon,\s+items: sec\.items\.map\(item => \(\{\s+text:    item\.text,\s+checked: state\.checklist\[item\.id\] \|\| false,/);
});
