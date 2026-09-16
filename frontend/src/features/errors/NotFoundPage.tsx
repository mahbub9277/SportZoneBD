import { Link } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4">
      <Card className="w-full p-8 text-center shadow-[0_30px_90px_rgba(2,6,23,0.22)] sm:p-10">
        <p className="text-sm uppercase tracking-[0.3em] text-(--accent)">404</p>
        <h1 className="mt-3 text-4xl font-semibold text-(--text-primary)">Page not found</h1>
        <p className="mt-3 text-(--text-muted)">
          The route you requested is unavailable or has moved. Return to the home experience or revisit your last page.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/">
            <Button className="gap-2"><Home size={16} />Go home</Button>
          </Link>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-(--border) bg-(--surface-soft) px-4 py-2.5 text-sm font-semibold text-(--text-primary) transition hover:border-(--accent)/40 hover:text-(--accent)"
          >
            <ArrowLeft size={16} />
            Go back
          </button>
        </div>
      </Card>
    </div>
  )
}
