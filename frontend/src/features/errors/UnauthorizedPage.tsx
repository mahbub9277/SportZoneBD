import { Link, useNavigate } from 'react-router-dom'
import { Home, ArrowLeft, ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'

export function UnauthorizedPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4">
      <Card className="w-full p-8 text-center shadow-[0_30px_90px_rgba(2,6,23,0.22)] sm:p-10">
        <div className="mx-auto w-fit rounded-full bg-(--danger-soft) p-3 text-(--danger)">
          <ShieldAlert size={32} />
        </div>
        <p className="mt-4 text-sm uppercase tracking-[0.3em] text-(--danger)">403 - Forbidden</p>
        <h1 className="mt-3 text-4xl font-semibold text-(--text-primary)">Access Denied</h1>
        <p className="mt-3 text-(--text-muted)">You do not have the necessary permissions to access this page.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/">
            <Button className="gap-2"><Home size={16} />Go Home</Button>
          </Link>
          <Button variant="secondary" onClick={() => navigate(-1)} className="gap-2"><ArrowLeft size={16} />Go Back</Button>
        </div>
      </Card>
    </div>
  )
}