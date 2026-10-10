import assert from 'node:assert/strict'
import test from 'node:test'
import { actionFromRemote, digitFromRemote } from './remoteKeys.ts'

test('the standard remote keys map onto the TV Mode actions', () => {
  assert.equal(actionFromRemote({ key: 'ArrowUp' }), 'up')
  assert.equal(actionFromRemote({ key: 'ArrowDown' }), 'down')
  assert.equal(actionFromRemote({ key: 'ArrowLeft' }), 'left')
  assert.equal(actionFromRemote({ key: 'ArrowRight' }), 'right')
  assert.equal(actionFromRemote({ key: 'Enter' }), 'activate')
  assert.equal(actionFromRemote({ key: ' ' }), 'activate')
  assert.equal(actionFromRemote({ key: 'Escape' }), 'back')
})

test('media and channel remotes reach the same actions as the arrow keys', () => {
  // Channel up/down arrive as either the channel keys or the page keys, depending on the remote.
  for (const key of ['ChannelUp', 'PageUp', 'MediaTrackPrevious']) {
    assert.equal(actionFromRemote({ key }), 'channelUp')
  }
  for (const key of ['ChannelDown', 'PageDown', 'MediaTrackNext']) {
    assert.equal(actionFromRemote({ key }), 'channelDown')
  }
  for (const key of ['MediaPlayPause', 'MediaPlay', 'MediaPause']) {
    assert.equal(actionFromRemote({ key }), 'playPause')
  }
})

test('the values smart-TV browsers send for Back and OK are recognized', () => {
  for (const key of ['GoBack', 'BrowserBack', 'Back', 'Backspace']) {
    assert.equal(actionFromRemote({ key }), 'back')
  }
  // Tizen and webOS report the confirm button by name rather than as Enter.
  for (const key of ['Select', 'Accept']) {
    assert.equal(actionFromRemote({ key }), 'activate')
  }
})

test('a key the page needs is left alone', () => {
  // Tab, letters, and browser shortcuts must keep working: the remote handler has no opinion on them.
  for (const key of ['Tab', 'a', 'F5', 'Shift', 'Delete']) {
    assert.equal(actionFromRemote({ key }), null)
  }
})

test('a remote that reports Unidentified is understood from its code', () => {
  assert.equal(actionFromRemote({ key: 'Unidentified', code: 'ArrowLeft' }), 'left')
  assert.equal(actionFromRemote({ key: '', code: 'Enter' }), 'activate')
  // A usable key always wins over the code.
  assert.equal(actionFromRemote({ key: 'ArrowUp', code: 'Enter' }), 'up')
  // Nothing usable at all is not an action.
  assert.equal(actionFromRemote({ key: 'Unidentified', code: 'Unidentified' }), null)
})

test('digits are read from the key or from a numeric code', () => {
  assert.equal(digitFromRemote({ key: '3' }), '3')
  assert.equal(digitFromRemote({ key: 'Unidentified', code: 'Digit3' }), '3')
  assert.equal(digitFromRemote({ key: 'Unidentified', code: 'Numpad0' }), '0')

  for (const key of ['Enter', 'ArrowUp', 'a', 'F3', ' ']) {
    assert.equal(digitFromRemote({ key }), null)
  }
})
