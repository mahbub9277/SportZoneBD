import { Navigate, useNavigate } from 'react-router-dom'

import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useStaffLoginMutation } from '../../features/auth/auth.api'
import { selectCurrentUser, selectIsAuthenticated, selectIsInitializing, setCredentials } from '../../features/auth/authSlice'
import { EXPERIENCE_HOME, resolveAuthExperience } from '../../features/auth/roleExperience'
import { ConsoleLoginView, type ConsoleLoginValues } from '../../features/console/components/ConsoleLoginView'
import { getErrorMessage } from '../../utils/get-error-message'

/**
 * The shared sign-in entry point for administrator-made custom roles (for example an editor).
 *
 * The endpoint refuses seeded system roles, so an administrator or moderator who lands here is
 * forwarded on to their own console rather than being shown a form that could never work for them.
 */
export function StaffLoginPage() {
  const [staffLogin] = useStaffLoginMutation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const isInitializing = useAppSelector(selectIsInitializing)
  const user = useAppSelector(selectCurrentUser)

  if (!isInitializing && isAuthenticated) {
    return <Navigate to={EXPERIENCE_HOME[resolveAuthExperience(user)]} replace />
  }

  const handleSubmit = async (values: ConsoleLoginValues) => {
    try {
      const response = await staffLogin(values).unwrap()
      dispatch(setCredentials({ user: response.user }))
      navigate(EXPERIENCE_HOME[resolveAuthExperience(response.user)], { replace: true })
      return
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  }

  return (
    <ConsoleLoginView
      eyebrow="Staff console"
      title="Staff sign in"
      description="Sign in with your staff account to reach the tools your role has been granted."
      emailPlaceholder="staff@sportzonebd.com"
      onSubmit={handleSubmit}
    />
  )
}

export default StaffLoginPage
