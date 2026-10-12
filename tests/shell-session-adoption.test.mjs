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
