import { buildCloudinaryUrl } from '../../../utils/cloudinary'
import { teamLogoTransform } from './streamFormFields'

/**
 * A logo with the initials fallback the match and channel option rows use, so every stream picker shows
 * the same badge — and a channel whose logo is missing or gone is still identifiable.
 */
export function StreamOptionBadge({
  name,
  logo,
  className = 'h-7 w-7',
}: {
  name?: string | null
  logo?: string | null
  className?: string
}) {
  if (logo) {
    return (
      <img
        src={buildCloudinaryUrl(logo, teamLogoTransform)}
        alt=""
        loading="lazy"
        decoding="async"
        className={`${className} shrink-0 rounded-full border border-(--border) bg-(--surface) object-cover`}
      />
    )
  }

  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-full border border-(--border) bg-(--surface-soft) text-[10px] font-bold text-(--text-muted)`}>
      {(name?.trim() || 'T').slice(0, 2).toUpperCase()}
    </span>
  )
}
