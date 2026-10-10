import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeUploadProgress,
  isDeterminateUpload,
  toTransferPercent,
  type MediaUploadProgressUpdate,
} from './uploadProgress.ts'

const update = (overrides: Partial<MediaUploadProgressUpdate> = {}): MediaUploadProgressUpdate => ({
  stage: 'uploading',
  percent: 40,
  fileName: 'logo.png',
  fileIndex: 1,
  fileCount: 1,
  ...overrides,
})

test('transfer progress is a whole percentage of the file that really moved', () => {
  assert.equal(toTransferPercent(0, 1000), 0)
  assert.equal(toTransferPercent(500, 1000), 50)
  assert.equal(toTransferPercent(1000, 1000), 100)
  assert.equal(toTransferPercent(1, 3), 33)
})

test('transfer progress is clamped and never divides by zero', () => {
  // A rounding artefact or an already-closed connection must not produce 101% or a negative bar.
  assert.equal(toTransferPercent(1001, 1000), 100)
  assert.equal(toTransferPercent(-5, 1000), 0)
  assert.equal(toTransferPercent(10, 0), 0)
  assert.equal(toTransferPercent(Number.NaN, 1000), 0)
  assert.equal(toTransferPercent(100, Number.POSITIVE_INFINITY), 0)
})

test('only the byte-transfer stage has a measurable percentage', () => {
  assert.equal(isDeterminateUpload(update({ stage: 'uploading' })), true)
  for (const stage of ['preparing', 'processing', 'done'] as const) {
    assert.equal(isDeterminateUpload(update({ stage })), false, `${stage} must not claim a percentage`)
  }
  assert.equal(isDeterminateUpload(null), false)
  assert.equal(isDeterminateUpload(undefined), false)
})

test('the caption names the stage and shows a percentage only while transferring', () => {
  assert.deepEqual(describeUploadProgress(update({ stage: 'uploading', percent: 87 })), {
    stageLabel: 'Uploading',
    batchLabel: null,
    percentLabel: '87%',
  })

  const processing = describeUploadProgress(update({ stage: 'processing', percent: 100 }))
  assert.equal(processing.stageLabel, 'Processing on server…')
  assert.equal(processing.percentLabel, null, 'the transfer percentage must not stand in for server work')

  assert.equal(describeUploadProgress(update({ stage: 'preparing' })).stageLabel, 'Preparing upload…')
  assert.equal(describeUploadProgress(update({ stage: 'done' })).stageLabel, 'Upload complete')
})

test('a batch reports which file is being uploaded', () => {
  assert.equal(describeUploadProgress(update({ fileIndex: 2, fileCount: 3 })).batchLabel, '2 of 3')
  assert.equal(describeUploadProgress(update({ fileIndex: 1, fileCount: 1 })).batchLabel, null)
})
