// Session 82, lane K fix round: DOM-path tests. The real renderConfirmItems / applyStayPick / runCalendarValidation / buildPayload /
// requireStaffSession text from index.html runs against a small fake DOM. Clock frozen (K_NOW).
// K_HTML=<path> runs the same tests against another copy of the page (used once to show them RED on the old code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(process.env.K_HTML || new URL('../index.html', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
const K_NOW = Date.parse('2026-10-13T02:00:00Z');
const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [K_NOW])); } static now() { return K_NOW; } };

/* every top-level function named here, by source text */
const fnText = name => {
  const re = new RegExp(`\\n(async )?function ${name}\\(`);
  const m = re.exec(html);
  assert.ok(m, `${name} not found`);
  const s = m.index + 1;
  const e = html.indexOf('\n}\n', s);
  return html.slice(s, e + 3);
};
const dataBlock = () => html.slice(html.indexOf('const PHASE_LABELS'), html.lastIndexOf('/*', html.indexOf('const state = {')));

/* ---- a fake DOM just big enough for the confirm controls ---- */
class FakeEl {
  constructor(id = '') {
    this.id = id; this.children = []; this._html = ''; this.className = ''; this.value = ''; this.textContent = ''; this.dataset = {}; this.listeners = {}; this._cl = new Set(); this._kids = {};
    this.classList = { add: (...c) => c.forEach(x => this._cl.add(x)), remove: (...c) => c.forEach(x => this._cl.delete(x)), contains: c => this._cl.has(c), toggle: c => (this._cl.has(c) ? this._cl.delete(c) : this._cl.add(c)) };
  }
  set innerHTML(h) { this._html = h; this._kids = {}; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { this.listeners[t] = f; }
  setAttribute() {}
  getAttribute() { return null; }
  _kid(key, make) { return this._kids[key] || (this._kids[key] = make()); }
  querySelectorAll(sel) {
    if (sel !== '.confirm-btn') return [];
    return [...this._html.matchAll(/<button class="confirm-btn" id="([^"]+)"[^>]*?data-item="([^"]+)"\s+data-state="([^"]+)"/g)]
      .map(m => this._kid(m[1], () => { const b = new FakeEl(m[1]); b.dataset = { item: m[2], state: m[3] }; return b; }));
  }
  querySelector(sel) {
    let m;
    if ((m = /^#conf-note-(.+)$/.exec(sel))) return this._html.includes(`id="conf-note-${m[1]}"`) ? this._kid(sel, () => new FakeEl(sel)) : null;
    if ((m = /^\.issue-photo-input-(.+)$/.exec(sel))) return this._html.includes(`issue-photo-input-${m[1]}`) ? this._kid(sel, () => new FakeEl(sel)) : null;
    if ((m = /^\.confirm-btn\[data-state="(\w+)"\]$/.exec(sel))) return this.querySelectorAll('.confirm-btn').find(b => b.dataset.state === m[1]) || null;
    return null;
  }
}

/* run the real confirm controls for a cleaning type */
function loadConfirm(type = 'turnover') {
  const state = { cleaningType: type, confirmItems: {}, confirmNotes: {}, checklist: {}, issueFlags: {}, startTimestamp: K_NOW };
  const els = {};
  const el = id => (els[id] = els[id] || new FakeEl(id));
  const photoCalls = [];
  const src = dataBlock() + '\n' + [fnText('renderConfirmItems'), fnText('restoreConfirmItem'), fnText('K_syncFlag')].join('\n')
    + '\nreturn { renderConfirmItems, K_gatedOk, K_gatedForPhase, K_gatedAll, K_isUrgentIssue, K_syncFlag, confirmItemsNow, PHASE_COUNT };';
  const api = new Function('state', 'el', 'esc', 'document', 'updateBottomBar', 'updateProgress', 'saveDraft', 'handleIssuePhoto', 'FOLDED', 'Date',
    src)(state, el, s => String(s), { createElement: () => new FakeEl() }, () => {}, () => {}, () => {}, (id) => photoCalls.push(id), true, FakeDate);
  api.renderConfirmItems();
  const wrap = id => {
    const c = Object.values(els).filter(e => e.children.length).flatMap(e => e.children).find(ch => ch._html.includes(`id="conf-ok-${id}"`));
    assert.ok(c, `${id} is rendered`);
    return c;
  };
  const tap = (id, which) => wrap(id).querySelectorAll('.confirm-btn').find(b => b.dataset.state === which).listeners.click();
  return { api, state, els, photoCalls, wrap, tap };
}

test('DOM: tapping Issue Found on the linen killer lets Arrive & Prep advance, with a photo input and a normal (not urgent) flagged note', () => {
  const { api, state, wrap, tap, photoCalls } = loadConfirm('turnover');
  assert.equal(api.K_gatedOk(2), false, 'the step is closed until the killer is answered');
  tap('check_2_4', 'issue');
  assert.equal(state.confirmItems.check_2_4, 'issue');
  assert.equal(api.K_gatedOk(2), true, 'Issue Found is an answer: the step advances');
  const w = wrap('check_2_4');
  const note = w.querySelector('#conf-note-check_2_4');
  assert.ok(note, 'the note area exists');
  assert.ok(w._html.includes('issue-photo-input-check_2_4') && w._html.includes('id="issue-preview-check_2_4"'), 'the issue photo input and preview are inside the note area');
  const photo = w.querySelector('.issue-photo-input-check_2_4');
  photo.listeners.change();
  assert.deepEqual(photoCalls, ['check_2_4'], 'the same handleIssuePhoto handler (key issue_check_2_4)');
  note.value = 'red wine on the pillowcase';
  note.listeners.input();
  assert.equal(state.confirmNotes.check_2_4, 'red wine on the pillowcase');
  assert.equal(state.issueFlags.check_2_4.note, 'red wine on the pillowcase', 'travels as an ordinary flagged note, like the old flag button');
  assert.equal(api.K_isUrgentIssue(api.K_gatedAll().find(i => i.id === 'check_2_4')), false);
  tap('check_2_4', 'confirmed');
  assert.equal(state.issueFlags.check_2_4, undefined, 'Confirmed removes the flag');
});

test('DOM: the final power and safety check stays urgent; the smell check is a normal flagged note; both carry the photo input', () => {
  const { api, state, wrap, tap } = loadConfirm('turnover');
  const by = id => api.K_gatedAll().find(i => i.id === id);
  assert.equal(api.K_isUrgentIssue(by('check_10_6')), true);
  assert.equal(api.K_isUrgentIssue(by('check_9_4')), true, 'the old Confirm & Leave items stay urgent');
  assert.equal(api.K_isUrgentIssue(by('check_7_5')), false);
  tap('check_10_6', 'issue');
  assert.equal(state.issueFlags.check_10_6, undefined, 'no flagged-note copy: it rides as [URGENT] under Confirm & Leave');
  tap('check_7_5', 'issue');
  assert.ok(state.issueFlags.check_7_5);
  for (const id of ['check_10_6', 'check_7_5', 'check_2_4']) assert.ok(wrap(id)._html.includes(`issue-photo-input-${id}`), id);
  assert.ok(!wrap('check_key_card')._html.includes('issue-photo-input'), 'ordinary Confirm & Leave items keep the note only');
});

test('DOM: the gated items render on the screens where the work happens', () => {
  const { els } = loadConfirm('turnover');
  const ids = c => c.children.map(ch => /id="conf-ok-([^"]+)"/.exec(ch._html)[1]);
  assert.deepEqual(ids(els['confirm-items-p2']), ['check_2_4']);
  assert.deepEqual(ids(els['confirm-items-p4']), ['check_7_5', 'check_utensils_complete']);
  assert.deepEqual(ids(els['confirm-items-p5']), ['check_9_4', 'check_ecoflow_charge']);
  assert.deepEqual(ids(els['confirm-leave-items']), ['check_key_card', 'check_guest_code', 'check_10_6', 'check_smartlife_waiting']);
});

/* ---- the full payload for a turnover ---- */
test('DOM: the full turnover payload keeps the six section titles, the issue_check_2_4 photo key and [URGENT] only on final power and safety', () => {
  const state = { cleaningType: 'turnover', confirmItems: {}, confirmNotes: {}, checklist: {}, issueFlags: {}, startTimestamp: K_NOW - 7200e3, numberOfNights: 2,
    meterPhotos: [null, null], precleanPhotos: [], aftercleanPhotos: [], bedroomPhotos: [], kitchenPhotos: [], sessionFolderId: null, sessionFolderUrl: null,
    submissionId: 'sub-1', isWeeklyIncluded: true, conditionStatus: null, uploadRetryCount: 0, prevElectricReading: 0, prevWaterReading: 0 };
  const fields = { cleanerName: 'Kay', cleaningDate: '2026-10-13', lastGuestName: 'Zz Guest', checkInDate: '2026-10-11', checkOutDate: '2026-10-13', startTime: '10:00',
    electricMeterReading: '100', waterMeterReading: '10' };
  const el = id => ({ value: fields[id] || '', checked: false, textContent: '' });
  const names = ['esc', 'weekOfMonth', 'weeklyItemsForSession', 'calcCompletionRate', 'getAllChecklistItems', 'collectExtraExpenses', 'buildEmailHtml', 'buildPayload', 'K_phaseProgress'];
  let src = dataBlock() + '\n';
  for (const n of names) { if (!html.includes(`function ${n}(`)) continue; src += fnText(n) + '\n'; }
  src += 'return buildPayload;';
  const stubs = { state, el, document: { querySelectorAll: () => [] }, Date: FakeDate, FOLDED: true, UNIT_NAME: 'Cascade Hideaway', navigator: { userAgent: 'test' }, fmtElapsedVerbose: () => '2h', todayManila: () => '2026-10-13',
    uuid: () => 'u-1', isDateWeekend: () => false, meterFindings: () => [], updateProgress() {}, saveDraft() {}, PROPERTY_ID: 'p1', LIQUID_ML_PER_UNIT: 1,
    Intl, JSON, Object, Array, Math, String, Number, parseFloat, isNaN };
  const run = answers => {
    state.confirmItems = answers.items; state.confirmNotes = answers.notes; state.issueFlags = answers.flags;
    const keys = Object.keys(stubs);
    // unknown ALL_CAPS constants (CALENDAR_ID and friends) are page configuration the payload only copies: stub them
    const caps = new Proxy({}, { has: (t0, k) => typeof k === 'string' && /^[A-Z][A-Z0-9_]+$/.test(k) && !keys.includes(k) && !src.includes('const ' + k) && !src.includes('let ' + k), get: (t0, k) => (k === Symbol.unscopables ? undefined : 'x') });
    const buildPayload = new Function('__caps', ...keys, 'with (__caps) {' + src.replace('return buildPayload;', '') + String.fromCharCode(10) + 'return buildPayload; }')(caps, ...keys.map(k => stubs[k]));
    return buildPayload();
  };
  let payload;
  try {
    payload = run({ items: { check_2_4: 'issue', check_10_6: 'issue', check_9_4: 'confirmed' }, notes: { check_2_4: 'wine stain', check_10_6: 'window will not latch' },
      flags: { check_2_4: { note: 'wine stain', photoUrl: 'https://drive/x', photoFileId: 'F1' } } });
  } catch (e) { assert.fail(`buildPayload threw in the sandbox: ${e.message}`); }
  const titles = payload.checklistDetails.map(s => s.title);
  assert.equal(titles.length, 6, 'six sections with the weekly tasks');
  assert.deepEqual([titles[0], titles[1], titles[2], titles[3], titles[5]], ['Arrive & Prep', 'Bedroom & Living Room', 'Kitchen & Bathroom', 'Final Cleaning', 'Confirm & Leave'], 'the section titles the dashboard and the e-mail read');
  assert.match(titles[4], /^Weekly Deep Maintenance/);
  for (const s of payload.checklistDetails) { assert.ok(s.icon); for (const i of s.items) assert.deepEqual(Object.keys(i).sort(), ['checked', 'critical', 'text'], 'item shape'); }
  const confirm = payload.checklistDetails.find(s => s.title === 'Confirm & Leave').items;
  const linen = confirm.find(i => i.text.startsWith('Strip bed'));
  assert.ok(linen && !linen.text.includes('[URGENT]') && linen.text.includes('wine stain') && linen.critical === true && linen.checked === false);
  const power = confirm.find(i => i.text.includes('Final check'));
  assert.ok(power.text.startsWith('[URGENT] '), 'final power and safety stays urgent');
  assert.deepEqual(payload.photos.issue_check_2_4, [{ name: 'issue_check_2_4.jpg', url: 'https://drive/x', fileId: 'F1' }], 'the stain photo key');
  const urgent = (payload.notes || payload.allNotes || []).filter(n => n.isUrgent).map(n => n.text);
  const flat = JSON.stringify(payload);
  assert.ok(flat.includes('window will not latch'));
  assert.ok(!urgent.some(t => t.includes('wine stain')), 'a linen stain is not an urgent note');
});

/* ---- a picked block ---- */
test('DOM: picking a block stay option makes the date valid (no confirm dialog) and sets the cleaning type to deep_clean', () => {
  const state = { cleaningType: 'turnover', cleaningDateStatus: 'unknown', checklist: {}, confirmItems: {}, issueFlags: {} };
  const dialogs = [];
  const fields = { stayPick: { value: '0', classList: { add() {}, remove() {} } }, 'stay-pick-hint': { textContent: '', className: '' }, lastGuestName: { value: '' }, 'cleaning-date-hint': { textContent: '', className: '' } };
  const el = id => fields[id] || null;
  const block = { event_id: 'e1', kind: 'block', checkin_date: '2026-10-13', checkout_date: '2026-10-15', nights: 2, guest_name: null };
  const src = dataBlock() + '\n' + ['applyStayPick', 'runCalendarValidation'].map(fnText).join('\n') + '\nreturn { applyStayPick, runCalendarValidation, setOptions: o => { _stayOptions = o; } };';
  const api = new Function('state', 'el', 'setCleaningType', 'applyBookingAutofill', 'updateBottomBar', 'updateProgress', 'saveDraft', 'maybeAutoMidStay', 'showDateConfirmDialog', 'Date', 'let _stayOptions = [];' + src.replace('return { applyStayPick', 'return { applyStayPick'))(
    state, el, (t) => { state.cleaningType = t; }, () => {}, () => {}, () => {}, () => {}, () => {}, (...a) => dialogs.push(a), FakeDate);
  const stay = { status: 'confirmed', checkin_date: '2026-10-20', checkout_date: '2026-10-22', nights: 2 };
  api.runCalendarValidation('2026-10-14', [stay], null);
  assert.equal(state.cleaningDateStatus, 'warn', 'before the pick the date is ambiguous');
  assert.equal(dialogs.length, 1);
  api.setOptions([block]);
  api.applyStayPick();
  assert.equal(state.cleaningType, 'deep_clean', 'a maintenance visit is not a turnover');
  assert.equal(state.cleaningDateStatus, 'valid');
  dialogs.length = 0;
  api.runCalendarValidation('2026-10-14', [stay], null);
  assert.equal(state.cleaningDateStatus, 'valid', 'a date inside the picked block is valid');
  assert.equal(dialogs.length, 0, 'no date-confirm dialog');
  api.runCalendarValidation('2026-10-16', [stay], null);
  assert.equal(dialogs.length, 1, 'a date outside the picked block still asks');
});

/* ---- expired shell session ---- */
function ssoSandbox(shellStored, authRequest) {
  const src = ['deriveDisplayName', 'adoptShellSession', 'mergeShellTokens', 'readShellSession', 'saveStaffSession', 'clearStaffSession', 'requireStaffSession'].map(fnText).join('\n')
    + '\nreturn { requireStaffSession, get s() { return staffSession; }, get src() { return shellSrc; } };';
  const store = { sb: JSON.stringify(shellStored) };
  const win = { sessionStorage: { getItem: () => store.sb, setItem: (k, v) => { store.sb = v; } }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  class AuthRejectedError extends Error {}
  const body = 'let staffSession = null, shellSrc = null, refreshInFlight = null; const AUTH_SESSION_KEY = "k", SHELL_KEY = "sb"; const FOLDED = true;\n' + src;
  const mod = new Function('window', 'authRequest', 'AuthRejectedError', 'localStorage', 'Date', 'clearPinRecord', body)(win, authRequest(store, AuthRejectedError), AuthRejectedError, win.localStorage, FakeDate, () => {});
  return { mod, store, AuthRejectedError };
}
const nowSec = Math.floor(K_NOW / 1000);
const shellSession = (access, refresh, exp) => ({ access_token: access, refresh_token: refresh, expires_at: exp, user: { id: 'u1', email: 'a@b.c', user_metadata: { display_name: 'Kay' } } });

test('SSO: a newer shell session whose access token has lapsed is refreshed with the shell token first, once, never handed back expired', async () => {
  const calls = [];
  const { mod } = ssoSandbox(shellSession('old', 'r1', nowSec - 100), (store, Rejected) => async (grant, body) => {
    calls.push(body.refresh_token);
    if (body.refresh_token === 'r1') { store.sb = JSON.stringify(shellSession('lapsed', 'r2', nowSec - 10)); throw new Rejected('Invalid Refresh Token: Already Used'); }
    return { access_token: 'fresh', refresh_token: 'r3', expires_at: nowSec + 3600, user: { id: 'u1' } };
  });
  const s = await mod.requireStaffSession();
  assert.ok(s, 'still signed in, no PIN');
  assert.equal(s.access_token, 'fresh', 'not the lapsed token');
  assert.deepEqual(calls, ['r1', 'r2'], 'the old token first, then the shell token, exactly once each');
});

test('SSO: if the shell token is rejected too, the session ends (the PIN fallback) and nothing loops', async () => {
  const calls = [];
  const { mod } = ssoSandbox(shellSession('old', 'r1', nowSec - 100), (store, Rejected) => async (grant, body) => {
    calls.push(body.refresh_token);
    if (body.refresh_token === 'r1') store.sb = JSON.stringify(shellSession('lapsed', 'r2', nowSec - 10));
    throw new Rejected('rejected');
  });
  assert.equal(await mod.requireStaffSession(), null);
  assert.deepEqual(calls, ['r1', 'r2']);
});

test('SSO: a newer shell session that is still valid is used as it is, without another refresh', async () => {
  const calls = [];
  const { mod } = ssoSandbox(shellSession('old', 'r1', nowSec - 100), (store, Rejected) => async (grant, body) => {
    calls.push(body.refresh_token);
    store.sb = JSON.stringify(shellSession('good', 'r2', nowSec + 3000));
    throw new Rejected('already used');
  });
  const s = await mod.requireStaffSession();
  assert.equal(s.access_token, 'good');
  assert.deepEqual(calls, ['r1']);
});

test('structure: plants and hangers are turnover and deep clean only, and the bedroom list is re-rendered when the type changes', () => {
  const m = dataBlock();
  assert.match(m, /id: 'check_5_9',[^\n]*only: \['turnover', 'deep_clean'\]/);
  assert.match(m, /id: 'check_1_8',[^\n]*only: \['turnover', 'deep_clean'\]/);
  assert.match(html, /if \(typeof K_renderBedroom === 'function'\) K_renderBedroom\(\);/);
  assert.match(html, /renderItems\(K_only\(BEDROOM_ITEMS\), 'bedroom-items'\)/);
});

test('copy: the content changes of the fix round are in the lines', () => {
  const m = dataBlock();
  assert.match(m, /id: 'check_0_1',\s+text: 'Gather your tools and supplies',/);
  assert.match(m, /id: 'check_4_5',\s+text: 'Disinfect switches, handles and both remotes'/);
  assert.match(m, /shower drain and floor hair-free/);
  assert.match(m, /pillows plumped in a row, no hair on the sheets/);
  assert.match(m, /Flush and smell-check the toilet; sniff the AC, bin and fridge\. Nothing smells/);
  assert.match(m, /the full set for the next guest\\'s party/);
  assert.match(html, /Open the windows, lights on, check the unit/);
});
