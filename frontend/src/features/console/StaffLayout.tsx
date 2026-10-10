import { useMemo } from 'react'

import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from '../auth/authSlice'
import { getUserPermissions } from '../auth/roleExperience'
import { ConsoleLayout } from './ConsoleLayout'
import { buildConsoleNav } from './config/consoleNav.config'

const STAFF_BASE = '/staff'
const STAFF_LOGIN_PATH = '/staff/login'

/**
 * The shared console for administrator-made custom roles.
 *
 * A custom role starts with no permissions, so this console may legitimately have no modules to
 * offer; the landing page says so instead of pretending the account can do something.
 */
export function StaffLayout() {
  const user = useAppSelector(selectCurrentUser)
  const sections = useMemo(() => buildConsoleNav(STAFF_BASE, getUserPermissions(user)), [user])

  return (
    <ConsoleLayout
      base={STAFF_BASE}
      loginPath={STAFF_LOGIN_PATH}
      brandSubtitle="Staff console"
      sections={sections}
    />
  )
}

export default StaffLayout
