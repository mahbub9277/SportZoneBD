import { Ban, CircleAlert, LockKeyhole, ServerCrash, TriangleAlert } from 'lucide-react'
import { ErrorStatusPage } from './ErrorStatusPage'

export function BadRequestPage() {
  return <ErrorStatusPage code="400" eyebrow="Request needs attention" title="That request could not be understood" description="The information sent to SportZoneBD was incomplete or invalid. Return to the previous page and try again." icon={CircleAlert} tone="warning" />
}

export function SessionExpiredPage() {
  return <ErrorStatusPage code="401" eyebrow="Authentication required" title="Your session is not active" description="Sign in again to continue. Public pages remain available while protected actions require a valid session." icon={LockKeyhole} tone="accent" />
}

export function ForbiddenPage() {
  return <ErrorStatusPage code="403" eyebrow="Access restricted" title="You do not have access here" description="Your account is signed in, but it does not have the permissions required for this page." icon={Ban} tone="danger" />
}

export function ServerErrorPage() {
  return <ErrorStatusPage code="500" eyebrow="Unexpected server error" title="SportZoneBD hit a problem" description="The request could not be completed right now. Please retry in a moment or return to the home experience." icon={ServerCrash} tone="danger" showRetry />
}

export function ServiceUnavailablePage() {
  return <ErrorStatusPage code="503" eyebrow="Service temporarily unavailable" title="We are reconnecting the service" description="SportZoneBD is temporarily unable to complete this request. Please retry shortly." icon={TriangleAlert} tone="warning" showRetry />
}
