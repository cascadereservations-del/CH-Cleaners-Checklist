import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('inline application scripts remain syntactically valid', () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  for (const [, source] of scripts) assert.doesNotThrow(() => new Function(source));
});

test('application is gated by a named staff session', () => {
  assert.match(html, /id="auth-form"/);
  assert.match(html, /grant_type=\$\{grantType\}/);
  assert.match(html, /await initStaffAuth\(\)/);
  assert.match(html, /AUTH_SESSION_KEY\s*=\s*'ch_staff_session_v1'/);
  assert.doesNotMatch(html, /password[^\n]+localStorage\.setItem/i);
});

test('private operational calls use the staff access token', () => {
  assert.match(html, /last-readings\?property_id=/);
  assert.match(html, /headers: await staffHeaders\(true\)/);
  assert.match(html, /submitted_by_user_id: staffSession\.user\.id/);
  assert.doesNotMatch(html, /Authorization': `Bearer \$\{SUPABASE_ANON\}`/);
});

test('photo upload is property and submission scoped', () => {
  assert.match(html, /propertyId:\s+PROPERTY_ID/);
  assert.match(html, /submissionId: state\.submissionId/);
  assert.match(html, /data\.signedUrl/);
  assert.doesNotMatch(html, /data\.publicUrl/);
});

test('service worker cache is bumped for authentication cutover', () => {
  assert.match(sw, /ch-shell-v3-auth/);
});
