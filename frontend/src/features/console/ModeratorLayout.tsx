import { useMemo } from 'react'

import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from '../auth/authSlice'
import { getUserPermissions } from '../auth/roleExperience'
import { ConsoleLayout } from './ConsoleLayout'
import { buildConsoleNav } from './config/consoleNav.config'

const MODERATOR_BASE = '/moderator'
const MODERATOR_LOGIN_PATH = '/moderator/login'

/**
 * The dedicated moderator console. Only the modules the moderator's resolved permissions unlock are
 * rendered in its navigation.
 */
export function ModeratorLayout() {
  const user = useAppSelector(selectCurrentUser)
  const sections = useMemo(() => buildConsoleNav(MODERATOR_BASE, getUserPermissions(user)), [user])

  return (
    <ConsoleLayout
      base={MODERATOR_BASE}
      loginPath={MODERATOR_LOGIN_PATH}
      brandSubtitle="Moderator console"
      sections={sections}
    />
  )
}

export default ModeratorLayout
