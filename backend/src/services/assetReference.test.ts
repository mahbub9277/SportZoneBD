import assert from 'node:assert/strict'
import test from 'node:test'
import { getAssetIdentity, referenceOr, releasedAssets } from './assetReference.js'

// The shapes production actually stores and scans. The event logo is a real record: cleanup scans the
// public id Cloudinary reports for it, while the database holds the delivery URL below.
const storedEventLogo = 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1791003613/sportzone/events/2455f928-db32-4aaf-b32c-1340c4093263.jpg'
const scannedPublicId = 'sportzone/events/2455f928-db32-4aaf-b32c-1340c4093263.jpg'
const eventLogoIdentity = 'sportzone/events/2455f928-db32-4aaf-b32c-1340c4093263'

test('the identity of a scanned asset is what the stored delivery URL contains', () => {
  const identity = getAssetIdentity(scannedPublicId)

  assert.equal(identity, eventLogoIdentity)
  assert.equal(storedEventLogo.includes(identity), true)
})

test('an exact comparison could never have matched the stored URL, which is why the asset was deleted', () => {
  // The old check compared the record against the public id and the canonical version-less URL.
  const canonicalUrl = 'https://res.cloudinary.com/drmqcl0ft/image/upload/sportzone/events/2455f928-db32-4aaf-b32c-1340c4093263.jpg'

  assert.notEqual(storedEventLogo, scannedPublicId)
  assert.notEqual(storedEventLogo, canonicalUrl)
})

test('a transformation and a version do not hide the identity', () => {
  const transformed = 'https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_800/v1791003613/sportzone/events/2455f928-db32-4aaf-b32c-1340c4093263.jpg'

  assert.equal(getAssetIdentity(transformed), eventLogoIdentity)
  assert.equal(transformed.includes(eventLogoIdentity), true)
})

test('a reference that is not a Cloudinary asset is matched as itself', () => {
  const crest = 'https://crests.football-data.org/563.png'

  assert.equal(getAssetIdentity(crest), crest)
  assert.equal(getAssetIdentity(crest).startsWith('https://'), true)
})

test('a missing or unusable reference produces no identity to match on', () => {
  assert.equal(getAssetIdentity(''), '')
  assert.equal(getAssetIdentity('   '), '')
  assert.equal(getAssetIdentity(null), '')
  assert.equal(getAssetIdentity(undefined), '')
})

test('the filter searches every column that can hold the asset', () => {
  const clauses = referenceOr<{ logo: string; banner: string }>(['logo', 'banner'], eventLogoIdentity)

  assert.deepEqual(clauses, [
    { logo: { contains: eventLogoIdentity } },
    { banner: { contains: eventLogoIdentity } },
  ])
})

test('a null-ish reference is never used as a filter', () => {
  const identity = getAssetIdentity(null)
  assert.equal(Boolean(identity), false)
  // `undefined` would make Prisma ignore the condition and treat every row as a match.
  assert.notEqual(identity, undefined)
})

test('an edit only reports the assets it stopped referencing', () => {
  const previousHome = 'sportzone/team-logos/old-home.png'
  const keptHome = 'sportzone/team-logos/new-home.png'
  const keptStream = 'sportzone/stream-logos/main.png'

  assert.deepEqual(
    releasedAssets([previousHome, keptHome, keptStream], [keptHome, keptStream]),
    [previousHome],
  )
})

test('clearing a logo or dropping a stream releases its asset, and a re-save releases nothing', () => {
  assert.deepEqual(releasedAssets(['sportzone/team-logos/a.png'], [null, undefined, '  ']), ['sportzone/team-logos/a.png'])
  assert.deepEqual(releasedAssets(['sportzone/stream-logos/a.png'], []), ['sportzone/stream-logos/a.png'])
  assert.deepEqual(releasedAssets(['sportzone/team-logos/a.png'], ['sportzone/team-logos/a.png']), [])
  // Nothing was stored before, so there is nothing to re-check after.
  assert.deepEqual(releasedAssets([null, undefined], ['sportzone/team-logos/b.png']), [])
})

test('an asset kept by any field is not treated as released, and each is reported once', () => {
  // The same logo on both teams, then only on one: the asset is still referenced, so nothing is released.
  const shared = 'sportzone/team-logos/shared.png'
  assert.deepEqual(releasedAssets([shared, shared], [shared, null]), [])

  const deleted = 'sportzone/team-logos/deleted.png'
  assert.deepEqual(releasedAssets([deleted, ` ${deleted} `], []), [deleted])
})
