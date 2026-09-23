import { Ban } from 'lucide-react'
import { ErrorStatusPage } from './ErrorStatusPage'

export function UnauthorizedPage() {
  return <ErrorStatusPage code="403" eyebrow="Access restricted" title="Access denied" description="You do not have the necessary permissions to access this page." icon={Ban} tone="danger" />
}