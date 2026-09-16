import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Crown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppSelector } from '../../app/hooks'
import { selectIsAuthenticated } from '../../features/auth/authSlice'

interface SubscriptionModalProps {
  isOpen: boolean
  onClose: () => void
  returnPath?: string
}

export function SubscriptionModal({ isOpen, onClose, returnPath }: SubscriptionModalProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthenticated = useAppSelector(selectIsAuthenticated)

  const handleSubscribe = () => {
    onClose()
    const redirectPath = returnPath || `${location.pathname}${location.search}`
    sessionStorage.setItem('premium-return-path', redirectPath)

    if (!isAuthenticated) {
      sessionStorage.setItem(
        'post-auth-action',
        JSON.stringify({ action: 'unlockPremium', redirect: redirectPath }),
      )
      navigate(`/login?redirect=${encodeURIComponent(redirectPath)}`)
      return
    }

    navigate('/subscriptions')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center text-center">
          <div className="mb-4 rounded-full border-4 border-(--accent)/20 bg-(--accent-soft) p-3 shadow-glow">
            <Crown className="h-8 w-8 text-(--accent)" />
          </div>
          <DialogTitle className="text-2xl font-bold">Unlock Premium Content</DialogTitle>
          <DialogDescription className="text-text-muted">
            This content is available for premium members only. Upgrade your plan to get instant access to exclusive SportZoneBD content and features.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Button onClick={handleSubscribe} className="w-full gap-2 bg-(--accent) text-slate-950 shadow-glow hover:bg-(--accent-strong)">
            <Crown size={16} /> Upgrade to Premium
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full">
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}