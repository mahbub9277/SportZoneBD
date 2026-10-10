import { selectTeamLogo, teamInitials } from '../../utils/teamLogo'
import type { CloudinaryTransformations } from '../../utils/cloudinary'

interface TeamLogoBadgeProps {
  /**
   * Every logo reference known for this team. An assigned logo always wins over a provider crest, so the
   * caller does not have to know which one is which.
   */
  candidates: Array<string | null | undefined>
  name?: string | null
  /** The label shown when no logo can be rendered, for example `T1` for an unnamed home side. */
  fallback?: string
  /** Styling of the rendered logo. */
  className?: string
  /** Styling of the initials fallback, which lays out differently from an image. */
  fallbackClassName?: string
  /** Cloudinary transformations for a logo the project delivers itself. */
  transform?: CloudinaryTransformations
}

/**
 * A team's logo with its initials fallback, resolved through the shared team-logo resolver.
 *
 * The badge exists so a surface cannot accidentally bypass the resolution rules: a reference the project
 * may not hotlink is never requested, provider crests never shadow an assigned logo, and a team with
 * nothing usable keeps the same initials label everywhere.
 */
export function TeamLogoBadge({ candidates, name, fallback = '', className, fallbackClassName, transform }: TeamLogoBadgeProps) {
  const logo = selectTeamLogo(candidates, transform).url

  if (logo) return <img src={logo} alt="" className={className} />

  return <span className={fallbackClassName ?? className}>{teamInitials(name, { fallback })}</span>
}
