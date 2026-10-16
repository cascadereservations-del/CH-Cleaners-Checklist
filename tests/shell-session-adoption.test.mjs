import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function grab(name) {
  const start = html.indexOf('function ' + name + '(');
  const end = html.indexOf('\n}', start);
  const m = start < 0 || end < 0 ? null : [html.slice(start, end + 2)];
  assert.ok(m, name + ' missing');
  return m[0];
}
const { adoptShellSession, mergeShellTokens } = new Function(
  [grab('deriveDisplayName'), grab('adoptShellSession'), grab('mergeShellTokens'),
   'return { adoptShellSession, mergeShellTokens };'].join('\n'))();

const NOW = 1_800_000_000;
const shell = JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_at: NOW + 3000, expires_in: 3000, token_type: 'bearer',
  user: { id: 'u1', email: 'marifel@staff.cascade.invalid', user_metadata: { display_name: 'Marifel' } } });

test('shell session maps to the checklist session shape', () => {
  assert.deepEqual(adoptShellSession(shell, NOW), { access_token: 'a1', refresh_token: 'r1', expires_at: NOW + 3000,
    user: { id: 'u1', email: 'marifel@staff.cascade.invalid', display_name: 'Marifel' } });
});
test('junk or tokenless shell sessions are not adopted', () => {
  for (const bad of [null, '', 'not json', '{}', JSON.stringify({ access_token: 'x' })]) assert.equal(adoptShellSession(bad, NOW), null);
});
test('an expired token with no refresh token is not adopted', () => {
  const s = JSON.stringify({ access_token: 'a', expires_at: NOW - 5, user: { id: 'u' } });
  assert.equal(adoptShellSession(s, NOW), null);
});
test('rotated tokens are written back into the supabase-js shape, other fields kept', () => {
  const out = JSON.parse(mergeShellTokens(shell, { access_token: 'a2', refresh_token: 'r2', expires_at: NOW + 3600 }, NOW));
  assert.equal(out.access_token, 'a2'); assert.equal(out.refresh_token, 'r2');
  assert.equal(out.expires_at, NOW + 3600); assert.equal(out.expires_in, 3600);
  assert.equal(out.token_type, 'bearer'); assert.equal(out.user.id, 'u1');
});
test('folded mode never persists an adopted session into the checklist key', () => {
  assert.match(html, /if \(shellSrc\) \{[^}]*\n[^\n]*\n\s*return;/);
});

test('another user in the checklist never overwrites the shell key', () => {
  assert.equal(mergeShellTokens(shell, { access_token: 'x', refresh_token: 'y', expires_at: NOW, user: { id: 'other' } }, NOW), null);
  assert.ok(mergeShellTokens(shell, { access_token: 'x', refresh_token: 'y', expires_at: NOW, user: { id: 'u1' } }, NOW));
});
test('folded: the shell session is adopted before the standalone key is read, and the PIN lock is skipped when adopted', () => {
  const i = html.indexOf('readShellSession(), a = sh');
  const j = html.indexOf("localStorage.getItem(AUTH_SESSION_KEY) || 'null'", i);
  assert.ok(i > 0 && j > i);
  assert.match(html, /if \(shellSrc\) \{ gate\.hidden = true; return true; \}/);
  assert.match(html, /if \(shellSrc\) \{ shellSrc = null; return; \}/);
});
test('folded flag and manifest removal key on the pathname only', () => {
  assert.doesNotMatch(html, /shell=1/);
});
test('the folded service worker uses its own cache prefix; standalone name is unchanged', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v10-networkfirst';/);
  assert.match(sw, /'chf-shell' : 'ch-shell'/);
  assert.match(sw, /k\.indexOf\(CACHE_PREFIX \+ '-'\) === 0/);
});
