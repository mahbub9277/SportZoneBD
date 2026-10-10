/**
 * How a stored Cloudinary asset is recognised in the database.
 *
 * Cleanup compares an asset against the columns that can hold it, and that comparison was an exact
 * string match against the public id and the canonical delivery URL. Every column stores a *delivery
 * URL*, and a delivered URL carries a version segment (`/v1791003613/`) and often a transformation, so
 * the comparison never matched anything that had actually been served: the asset looked unused, got
 * deleted from Cloudinary, and the record that referenced it started returning 404.
 *
 * The public id is the part every form of the reference shares, so matching on it as a substring is what
 * identifies a reference. The match errs towards a false positive (an unused asset whose id happens to
 * prefix another one is kept), which is the safe direction: keeping an unused asset costs storage,
 * deleting a referenced one breaks the site.
 */

import { parseCloudinaryAssetReference } from './cloudinaryAsset.js'

/**
 * The public id a stored reference resolves to, or the reference itself when it is not a delivery URL.
 *
 * Orphan cleanup passes the public id Cloudinary reports while the record-driven paths pass the URL a
 * record stores, and both have to end up comparing the same thing.
 */
export function getAssetIdentity(asset: string | null | undefined): string {
  const value = (asset ?? '').trim()
  if (!value) return ''
  return parseCloudinaryAssetReference(value)?.publicId ?? value
}

/**
 * The `OR` clauses that find this asset in the given columns.
 *
 * Typed per model so a wrong column name is a compile error rather than a filter that silently matches
 * nothing; the cast is only needed because the field name is dynamic.
 */
export const referenceOr = <T>(fields: Array<keyof T & string>, identity: string): T[] =>
  fields.map((field) => ({ [field]: { contains: identity } }) as unknown as T)

/**
 * The assets a record released when it was edited: the references it held before and no longer holds.
 *
 * This says which assets are worth re-checking, not that they are unused — `cleanupAssetIfUnused` makes
 * that decision against every other record, which is what protects an asset shared with another match,
 * team or stream. Duplicates are collapsed and blank values dropped so an asset is only ever checked once.
 */
export function releasedAssets(
  previous: Array<string | null | undefined>,
  current: Array<string | null | undefined>,
): string[] {
  const normalize = (values: Array<string | null | undefined>) =>
    values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim())

  const retained = new Set(normalize(current))
  return [...new Set(normalize(previous).filter((asset) => !retained.has(asset)))]
}
