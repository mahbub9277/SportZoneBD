import { Navigate, useNavigate } from 'react-router-dom'

import { useAppDispatch, useAppSelector } from '../../app/hooks'
import { useModeratorLoginMutation } from '../../features/auth/auth.api'
import { selectCurrentUser, selectIsAuthenticated, selectIsInitializing, setCredentials } from '../../features/auth/authSlice'
import { EXPERIENCE_HOME, resolveAuthExperience } from '../../features/auth/roleExperience'
import { ConsoleLoginView, type ConsoleLoginValues } from '../../features/console/components/ConsoleLoginView'
import { getErrorMessage } from '../../utils/get-error-message'

/**
 * Dedicated sign-in for the moderator console.
 *
 * The endpoint only issues a session to an account holding the moderator role. An already
 * authenticated visitor is forwarded to the console their account actually belongs to, so landing
 * here twice (or as the wrong kind of user) never produces a redirect loop.
 */
export function ModeratorLoginPage() {
  const [moderatorLogin] = useModeratorLoginMutation()
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
      const response = await moderatorLogin(values).unwrap()
      dispatch(setCredentials({ user: response.user }))
      navigate(EXPERIENCE_HOME[resolveAuthExperience(response.user)], { replace: true })
      return
    } catch (error) {
      return { error: getErrorMessage(error) }
    }
  }

  return (
    <ConsoleLoginView
      eyebrow="Moderator console"
      title="Moderator sign in"
      description="Sign in to manage matches, streams, channels and other operational content."
      emailPlaceholder="moderator@sportzonebd.com"
      onSubmit={handleSubmit}
    />
  )
}

export default ModeratorLoginPage
