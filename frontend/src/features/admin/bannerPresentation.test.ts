import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BANNER_FIELD_LIMITS,
  bannerDisplayName,
  bannerFormFromRecord,
  bannerStatusLabel,
  buildBannerPayload,
  emptyBannerForm,
  filterBanners,
  hasBannerFormErrors,
  moveBannerBy,
  nextDisplayOrder,
  validateBannerForm,
  type BannerFormState,
} from './bannerPresentation.ts'
import type { Banner } from './banners.api.ts'

/** Banner management rules, tested without a DOM: filtering, ordering, validation and the API payload. */

const banner = (overrides: Partial<Banner> = {}): Banner => ({
  id: 'b1',
  title: 'Champions League',
  subtitle: 'Watch every match',
  type: 'IMAGE',
  imageUrl: 'https://cdn.example.com/b1.jpg',
  videoUrl: null,
  posterUrl: null,
  badge: 'LIVE',
  ctaText: 'Watch now',
  ctaUrl: 'https://example.com/watch',
  isActive: true,
  displayOrder: 0,
  ...overrides,
})

const form = (overrides: Partial<BannerFormState> = {}): BannerFormState => ({
  ...emptyBannerForm,
  imageUrl: 'https://cdn.example.com/b1.jpg',
  ...overrides,
})

test('a banner without a title is named the way the public feed presents it', () => {
  assert.equal(bannerDisplayName(banner({ title: '  ' })), 'Untitled image banner')
  assert.equal(bannerDisplayName(banner({ title: '', type: 'VIDEO' })), 'Untitled video banner')
  assert.equal(bannerDisplayName(banner({ title: '  Final  ' })), 'Final')
  assert.equal(bannerStatusLabel(banner({ isActive: false })), 'Inactive')
})

test('search matches the fields an admin can see, and the status filter is independent', () => {
  const banners = [
    banner({ id: 'a', title: 'Champions League', isActive: true }),
    banner({ id: 'b', title: 'Cricket Final', badge: 'TODAY', isActive: false }),
    banner({ id: 'c', title: '', ctaText: 'Open fixtures', isActive: false }),
  ]

  assert.deepEqual(filterBanners(banners).map((entry) => entry.id), ['a', 'b', 'c'])
  assert.deepEqual(filterBanners(banners, { query: 'cricket' }).map((entry) => entry.id), ['b'])
  assert.deepEqual(filterBanners(banners, { query: 'TODAY' }).map((entry) => entry.id), ['b'])
  assert.deepEqual(filterBanners(banners, { query: 'fixtures' }).map((entry) => entry.id), ['c'])
  assert.deepEqual(filterBanners(banners, { query: 'nothing here' }), [])
  assert.deepEqual(filterBanners(banners, { status: 'INACTIVE' }).map((entry) => entry.id), ['b', 'c'])
  assert.deepEqual(filterBanners(banners, { status: 'ACTIVE' }).map((entry) => entry.id), ['a'])
  assert.deepEqual(filterBanners(banners, { status: 'INACTIVE', query: 'cricket' }).map((entry) => entry.id), ['b'])
})

test('a new banner is placed after the last one', () => {
  assert.equal(nextDisplayOrder([]), 0)
  assert.equal(nextDisplayOrder([{ displayOrder: 0 }, { displayOrder: 4 }, { displayOrder: 2 }]), 5)
})

test('keyboard reordering swaps one position and renumbers the list', () => {
  const banners = [banner({ id: 'a', displayOrder: 0 }), banner({ id: 'b', displayOrder: 1 }), banner({ id: 'c', displayOrder: 2 })]

  const moved = moveBannerBy(banners, 'b', -1)
  assert.ok(moved)
  assert.deepEqual(moved.map((entry) => [entry.id, entry.displayOrder]), [['b', 0], ['a', 1], ['c', 2]])

  // A move that cannot happen returns null, so the page skips the request entirely.
  assert.equal(moveBannerBy(banners, 'a', -1), null)
  assert.equal(moveBannerBy(banners, 'c', 1), null)
  assert.equal(moveBannerBy(banners, 'missing', 1), null)
})

test('a banner needs artwork that matches its type', () => {
  assert.equal(validateBannerForm(form({ type: 'IMAGE', imageUrl: '' })).media, 'Upload a banner image before saving.')
  assert.equal(validateBannerForm(form({ type: 'VIDEO', videoUrl: '' })).media, 'Upload a banner video before saving.')
  assert.equal(validateBannerForm(form({ type: 'IMAGE', imageUrl: 'https://cdn.example.com/a.jpg' })).media, undefined)
  assert.equal(validateBannerForm(form({ type: 'VIDEO', videoUrl: 'https://cdn.example.com/a.mp4' })).media, undefined)
})

test('a banner link accepts a full URL or an in-app path and rejects anything else', () => {
  for (const accepted of ['', 'https://example.com/watch', 'http://example.com', '/watch/123', '/matches?day=today']) {
    assert.equal(validateBannerForm(form({ ctaUrl: accepted })).ctaUrl, undefined, accepted)
  }

  // Surrounding whitespace is trimmed, so a padded but valid path is accepted.
  assert.equal(validateBannerForm(form({ ctaUrl: '  /watch/123  ' })).ctaUrl, undefined)

  for (const rejected of ['example.com', 'javascript:alert(1)', '//evil.example.com', 'ftp://example.com', 'relative/path']) {
    assert.ok(validateBannerForm(form({ ctaUrl: rejected })).ctaUrl, `${rejected} must be refused`)
  }
})

test('the server column limits are enforced inline', () => {
  assert.ok(validateBannerForm(form({ title: 'x'.repeat(BANNER_FIELD_LIMITS.title + 1) })).title)
  assert.ok(validateBannerForm(form({ subtitle: 'x'.repeat(BANNER_FIELD_LIMITS.subtitle + 1) })).subtitle)
  assert.ok(validateBannerForm(form({ badge: 'x'.repeat(BANNER_FIELD_LIMITS.badge + 1) })).badge)
  assert.ok(validateBannerForm(form({ ctaText: 'x'.repeat(BANNER_FIELD_LIMITS.ctaText + 1) })).ctaText)
  assert.equal(hasBannerFormErrors(validateBannerForm(form())), false)
})

test('the payload clears emptied fields and keeps the position an edit already had', () => {
  const payload = buildBannerPayload(
    form({ title: '  Final  ', subtitle: '', badge: '  ', ctaUrl: '', posterUrl: '', displayOrder: 3 }),
    { isEditing: true, displayOrder: 7 },
  )

  assert.equal(payload.title, 'Final')
  assert.equal(payload.subtitle, null, 'clearing a field must clear it, not keep the old value')
  assert.equal(payload.badge, null)
  assert.equal(payload.ctaUrl, null)
  assert.equal(payload.posterUrl, null)
  assert.equal(payload.displayOrder, 3, 'editing a banner must not reorder the hero')
  assert.equal(payload.isActive, true)
})

test('a new banner takes the next free position', () => {
  const payload = buildBannerPayload(form({ displayOrder: 0 }), { isEditing: false, displayOrder: 4 })
  assert.equal(payload.displayOrder, 4)
})

test('edit mode loads the stored values into the form', () => {
  const record = banner({ id: 'x', title: 'Final', subtitle: null, badge: null, ctaUrl: null, isActive: false, displayOrder: 2 })
  const state = bannerFormFromRecord(record)

  assert.equal(state.title, 'Final')
  assert.equal(state.subtitle, '')
  assert.equal(state.badge, '')
  assert.equal(state.ctaUrl, '')
  assert.equal(state.isActive, false)
  assert.equal(state.displayOrder, 2)
  assert.equal(state.imageUrl, record.imageUrl)
})

test('an edit round-trip preserves the fields the form does not own', () => {
  // The payload only carries fields the form edits; anything else (timestamps, ids, soft-delete state)
  // is never sent, which is what keeps an unrelated field from being rewritten.
  const payload = buildBannerPayload(bannerFormFromRecord(banner()), { isEditing: true, displayOrder: 0 })
  assert.deepEqual(Object.keys(payload).sort(), [
    'badge', 'ctaText', 'ctaUrl', 'displayOrder', 'imageUrl', 'isActive', 'posterUrl', 'subtitle', 'title', 'type', 'videoUrl',
  ])
})
