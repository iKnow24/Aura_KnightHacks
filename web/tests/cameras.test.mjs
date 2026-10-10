import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assign, fillSlots } from '../src/lib/cameras.js'

test('empty wall fills center first, then the sides, in source order', () => {
  assert.deepEqual(fillSlots({}, ['zone:kitchen', 'zone:living', 'cam:a']),
    { center: 'zone:kitchen', left: 'zone:living', right: 'cam:a' })
  assert.deepEqual(fillSlots({}, ['cam:a']), { center: 'cam:a', left: null, right: null })
})

test('saved choices stay, and a camera that went away is replaced by a spare one', () => {
  const saved = { center: 'cam:a', left: 'zone:bedroom', right: 'zone:kitchen' }
  assert.deepEqual(fillSlots(saved, ['zone:kitchen', 'zone:living', 'cam:a']),
    { center: 'cam:a', left: 'zone:living', right: 'zone:kitchen' })
})

test('the same camera is never shown twice', () => {
  assert.deepEqual(fillSlots({ center: 'cam:a', left: 'cam:a' }, ['cam:a', 'cam:b']),
    { center: 'cam:a', left: 'cam:b', right: null })
})

test('putting a side camera in the center swaps the two', () => {
  const wall = { center: 'zone:kitchen', left: 'cam:a', right: 'zone:living' }
  assert.deepEqual(assign(wall, 'center', 'cam:a'), { center: 'cam:a', left: 'zone:kitchen', right: 'zone:living' })
  assert.deepEqual(assign(wall, 'right', 'cam:b'), { ...wall, right: 'cam:b' })
})
