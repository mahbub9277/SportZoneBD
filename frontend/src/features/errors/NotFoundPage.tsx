import { FileQuestion } from 'lucide-react'
import { ErrorStatusPage } from './ErrorStatusPage'

export function NotFoundPage() {
  return <ErrorStatusPage code="404" eyebrow="Route unavailable" title="Page not found" description="The route you requested is unavailable or has moved. Return to the home experience or revisit your last page." icon={FileQuestion} />
}
