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

test('service worker cache name is versioned', () => {
  assert.match(sw, /const CACHE_NAME = 'ch-shell-v\d+/);
});

test('identity comes from the staff session, not a typed combobox (WP1)', () => {
  assert.doesNotMatch(html, /combobox-option/);
  assert.doesNotMatch(html, /selectCleaner\(/);
  assert.match(html, /identity-chip/);
  assert.match(html, /display_name: deriveDisplayName\(data\.user\)/);
  assert.match(html, /state\.cleanerName = name;/);
});

test('the gate shows device-remembered names, never a public staff list (WP1)', () => {
  assert.match(html, /KNOWN_LOGINS_KEY\s*=\s*'ch_known_logins'/);
  assert.match(html, /id="known-logins"/);
  assert.doesNotMatch(html, /staff-users\?[^"'`]*list/i);
});

test('sign-out only happens from Not-you or the success screen, never idle (WP1)', () => {
  assert.match(html, /id="switch-account-link"/);
  assert.match(html, /id="success-sign-out-link"/);
  assert.match(html, /SESSION_STALE_DAYS_GUARD = 0/);
  assert.doesNotMatch(html, /id="staff-logout"/);
  assert.doesNotMatch(html, /#staff-logout/);
});

test('a session stored before WP1 gets display_name backfilled, not "Staff" (WP1 fixup)', () => {
  assert.match(html, /staffSession\.user\.display_name = deriveDisplayName\(staffSession\.user\)/);
});

test('PIN is local-only PBKDF2, never the Supabase password (WP1b)', () => {
  assert.match(html, /PIN_KEY\s*=\s*'ch_pin_v1'/);
  assert.match(html, /'PBKDF2'/);
  assert.match(html, /iterations:\s*PIN_ITERATIONS/);
  assert.match(html, /hash:\s*'SHA-256'/);
  assert.match(html, /PIN_MAX_FAILS\s*=\s*5/);
  assert.doesNotMatch(html, /password:\s*pin/i);
});

test('five wrong PINs clear the PIN record and fall back to the password gate (WP1b)', () => {
  assert.match(html, /if \(record\.fails >= PIN_MAX_FAILS\) \{[\s\S]{0,60}clearPinRecord\(\);/);
});

test('a signed-in device with a PIN shows the lock screen before the app, not a network call (WP1b)', () => {
  assert.match(html, /if \(SUPPORTS_PIN && getPinRecord\(\)\) \{/);
  assert.match(html, /await showPinLockScreen\(\)/);
  assert.match(html, /await promptSetPinIfNeeded\(\)/);
});

test('ending the staff session for any reason also clears the local PIN (WP1b)', () => {
  // Fixed after Opus review: the PIN must not survive clearStaffSession()
  // (sign-out, disable/delete, a rejected refresh) — otherwise the next
  // cleaner to sign in on this device could unlock straight past the PIN
  // setup screen with the previous cleaner's PIN.
  assert.match(html, /function clearStaffSession\(\) \{[\s\S]{0,500}clearPinRecord\(\);[\s\S]{0,20}\}/);
});
