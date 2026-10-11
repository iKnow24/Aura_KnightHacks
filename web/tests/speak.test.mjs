import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseVoice } from '../src/lib/speak.js'

const v = (name, lang) => ({ name, lang })

test('picks Samantha ahead of other English voices', () => {
  const picked = chooseVoice([
    v('Alex', 'en-US'),
    v('Samantha', 'en-US'),
    v('Google UK English Male', 'en-GB'),
  ])
  assert.equal(picked.name, 'Samantha')
})

test('picks Google US English when the Mac voice is missing', () => {
  const picked = chooseVoice([
    v('Google UK English Male', 'en-GB'),
    v('Google US English', 'en-US'),
  ])
  assert.equal(picked.name, 'Google US English')
})

test('prefers an English voice over the first voice in the list', () => {
  const picked = chooseVoice([
    v('Amelie', 'fr-FR'),
    v('Karen', 'en-AU'),
  ])
  assert.equal(picked.name, 'Karen')
})

test('uses whatever voice exists when none are English', () => {
  assert.equal(chooseVoice([v('Amelie', 'fr-FR')]).name, 'Amelie')
})

test('returns null when the browser has no voices yet', () => {
  assert.equal(chooseVoice([]), null)
  assert.equal(chooseVoice(null), null)
})
