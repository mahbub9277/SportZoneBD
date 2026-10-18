import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVENT_ASSET_UPLOAD_MISSING,
  buildEventAssetPayload,
  resolveEventAsset,
  type EventAssetUpload,
} from './eventAssetPayload.ts'

const STORED_LOGO = 'https://res.cloudinary.com/demo/image/upload/v1/sportzone/events/logo.webp'
const STORED_BANNER = 'https://res.cloudinary.com/demo/image/upload/v1/sportzone/events/banner.webp'
const UPLOADED_LOGO = 'https://res.cloudinary.com/demo/image/upload/v2/sportzone/events/logo-new.webp'
const UPLOADED_BANNER = 'https://res.cloudinary.com/demo/image/upload/v2/sportzone/events/banner-new.webp'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/webp' })

const success = (url: string): EventAssetUpload => ({ uploads: [{ url }], failedUploads: [] })
const failure = (reason: string): EventAssetUpload => ({ uploads: [], failedUploads: [reason] })

const baseForm = () => ({
  name: 'Premier League',
  slug: 'premier-league',
  description: 'Every match, live.',
  logo: STORED_LOGO,
  banner: STORED_BANNER,
  status: 'ACTIVE' as const,
  showInSidebar: true,
  sortOrder: 3,
  isPremium: false,
  channelIds: ['channel-1'],
  matchIds: ['match-1'],
})

test('saving without a new file keeps both stored images and reports no failure', () => {
  const { payload, failures } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: null,
    bannerFile: null,
    logoUpload: null,
    bannerUpload: null,
  })

  assert.deepEqual(failures, [])
  assert.equal(payload.logo, STORED_LOGO)
  assert.equal(payload.banner, STORED_BANNER)
})

test('a verified upload replaces the stored URL with the durable Cloudinary URL', () => {
  const { payload, failures } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: file('logo.webp'),
    bannerFile: file('banner.webp'),
    logoUpload: success(UPLOADED_LOGO),
    bannerUpload: success(UPLOADED_BANNER),
  })

  assert.deepEqual(failures, [])
  assert.equal(payload.logo, UPLOADED_LOGO)
  assert.equal(payload.banner, UPLOADED_BANNER)
})

test('every other form field survives the asset resolution untouched', () => {
  const form = baseForm()
  const { payload } = buildEventAssetPayload({
    form,
    logoFile: file('logo.webp'),
    bannerFile: null,
    logoUpload: success(UPLOADED_LOGO),
    bannerUpload: null,
  })

  assert.deepEqual(payload, { ...form, logo: UPLOADED_LOGO })
})

test('a failed upload is reported instead of silently keeping the old image', () => {
  const { payload, failures } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: file('logo.webp'),
    bannerFile: null,
    logoUpload: failure('logo.webp: Upload verification failed.'),
    bannerUpload: null,
  })

  assert.deepEqual(failures, ['Logo: logo.webp: Upload verification failed.'])
  // The previous URL is kept so an ignoring caller cannot write a broken reference.
  assert.equal(payload.logo, STORED_LOGO)
})

test('an upload that returns no stored asset is still reported', () => {
  const resolution = resolveEventAsset({
    current: STORED_BANNER,
    file: file('banner.webp'),
    upload: { uploads: [], failedUploads: [] },
  })

  assert.equal(resolution.failure, EVENT_ASSET_UPLOAD_MISSING)
  assert.equal(resolution.url, STORED_BANNER)
})

test('a missing upload result is reported rather than treated as success', () => {
  const resolution = resolveEventAsset({ current: '', file: file('logo.webp'), upload: null })

  assert.equal(resolution.failure, EVENT_ASSET_UPLOAD_MISSING)
  assert.equal(resolution.url, '')
})

test('two failing images produce two failures, one per field', () => {
  const { failures } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: file('logo.webp'),
    bannerFile: file('banner.webp'),
    logoUpload: failure('logo.webp: Image preparation failed.'),
    bannerUpload: failure('banner.webp: Selected file exceeds the authorized upload size.'),
  })

  assert.equal(failures.length, 2)
  assert.match(failures[0], /^Logo: logo\.webp: Image preparation failed\.$/)
  assert.match(failures[1], /^Banner: banner\.webp: Selected file exceeds the authorized upload size\.$/)
})

test('one failing image does not hide the other image resolving correctly', () => {
  const { payload, failures } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: file('logo.webp'),
    bannerFile: file('banner.webp'),
    logoUpload: success(UPLOADED_LOGO),
    bannerUpload: failure('banner.webp: Upload failed.'),
  })

  assert.deepEqual(failures, ['Banner: banner.webp: Upload failed.'])
  assert.equal(payload.logo, UPLOADED_LOGO)
  assert.equal(payload.banner, STORED_BANNER)
})

test('removing an image keeps the removal and needs no upload', () => {
  const { payload, failures } = buildEventAssetPayload({
    form: { ...baseForm(), logo: '', banner: '' },
    logoFile: null,
    bannerFile: null,
    logoUpload: null,
    bannerUpload: null,
  })

  assert.deepEqual(failures, [])
  assert.equal(payload.logo, '')
  assert.equal(payload.banner, '')
})

test('an asset chosen from the media library is saved as its stored URL', () => {
  const libraryUrl = 'https://res.cloudinary.com/demo/image/upload/v1/sportzone/events/library.webp'
  const { payload, failures } = buildEventAssetPayload({
    form: { ...baseForm(), banner: libraryUrl },
    logoFile: null,
    bannerFile: null,
    logoUpload: null,
    bannerUpload: null,
  })

  assert.deepEqual(failures, [])
  assert.equal(payload.banner, libraryUrl)
})

test('the payload never contains a local preview URL', () => {
  const { payload } = buildEventAssetPayload({
    form: baseForm(),
    logoFile: file('logo.webp'),
    bannerFile: file('banner.webp'),
    logoUpload: success(UPLOADED_LOGO),
    bannerUpload: success(UPLOADED_BANNER),
  })

  for (const value of [payload.logo, payload.banner]) {
    assert.ok(value === null || !value.startsWith('blob:'), `${value} must not be a preview URL`)
  }
})
