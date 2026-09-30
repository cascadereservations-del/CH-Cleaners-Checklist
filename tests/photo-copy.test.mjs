// The photo hints must quote the minimums the app enforces (v8.8: they said "at least 2" while the app needed 5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const num = (name) => Number(html.match(new RegExp(`const ${name}\\s*=\\s*(\\d+)`))[1])
const hint = (id) => html.match(new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)</p>`))[1]

test('pre-clean and after-clean hints quote the enforced minimums', () => {
  const mid = num('MIDSTAY_PHOTO_MIN')
  assert.match(hint('p1-gate-hint'), new RegExp(`at least ${num('PRECLEAN_PHOTO_MIN')} pre-clean photos \\(${mid} for a mid-stay\\)`))
  for (const id of ['p4-photo-gate-hint', 'p4-gate-hint']) {
    assert.match(hint(id), new RegExp(`at least ${num('AFTERCLEAN_PHOTO_MIN')} after-cleaning photos \\(${mid} for a mid-stay\\)`))
  }
})

test('after-clean allows the 12-14 the hint asks for', () => {
  assert.equal(num('AFTERCLEAN_PHOTO_MAX'), 14)
  assert.match(html, /aim for 12-14 photos/)
  assert.match(html, /id="afterclean-photo-count"[^>]*>0 \/ 14 photos attached</)
})
