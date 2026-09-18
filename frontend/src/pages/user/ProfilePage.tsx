import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { Button } from '../../components/ui/Button'
import { Edit, ShieldCheck, Sparkles, CalendarClock, BellRing, ArrowRight, CreditCard, Crown } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../../components/ui/Dialog'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import { useGetMeQuery, useUpdateProfileMutation } from '../../features/auth/auth.api'
import { Link } from 'react-router-dom' 
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { EditProfileForm } from './components/EditProfileForm.tsx'
import { useAppSelector } from '../../app/hooks'
import { selectCurrentUser } from '../../features/auth/authSlice'
import { selectRecentChannelIds } from '../../features/recent/recent.slice'
import { RecentChannels } from '../../components/shared/sidebar/RecentChannels'

export function ProfilePage() {
  const cachedUser = useAppSelector(selectCurrentUser)
  const { data: fetchedUser, isLoading: isUserLoading, refetch: refetchUser } = useGetMeQuery();
  const user = fetchedUser ?? cachedUser
  const [now, setNow] = useState(() => Date.now())
  const [updateProfile, { isLoading: isUpdating }] = useUpdateProfileMutation()
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const recentChannelIds = useAppSelector(selectRecentChannelIds)

  const activeSubscription = user?.subscription;
  const isPremium = Boolean(activeSubscription && activeSubscription.status === 'ACTIVE' && new Date(activeSubscription.expiresAt).getTime() > now);

  useEffect(() => {
    if (!activeSubscription || activeSubscription.status !== 'ACTIVE') return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [activeSubscription])

  useEffect(() => {
    if (!activeSubscription || activeSubscription.status !== 'ACTIVE') return
    const expiryTimer = window.setTimeout(() => void refetchUser(), Math.max(0, new Date(activeSubscription.expiresAt).getTime() - Date.now()) + 50)
    return () => window.clearTimeout(expiryTimer)
  }, [activeSubscription, refetchUser])

  const subscriptionEndDate = activeSubscription?.expiresAt
    ? new Date(activeSubscription.expiresAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;


  if (isUserLoading || !user) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold text-text-primary">My Profile</h1>
        <Card>
          <CardHeader><Skeleton className="h-8 w-48" /></CardHeader>
          <CardContent><Skeleton className="h-24 w-full" /></CardContent>
        </Card>
      </div>
    )
  }

  const handleProfileUpdate = (formData: FormData): { abort: () => void } => {
    const mutationPromise = updateProfile(formData)
    toast.promise(
      mutationPromise.unwrap(),
      {
        loading: 'Updating profile...',
        success: () => {
          setIsEditModalOpen(false) // Close modal on success
          return 'Profile updated successfully!'
        },
        error: (err: unknown) => {
          const message = typeof err === 'object' && err !== null && 'data' in err && typeof (err as { data?: { message?: string } }).data?.message === 'string'
            ? (err as { data?: { message?: string } }).data?.message
            : 'Failed to update profile.'
          return message
        }
      }
    );
    return mutationPromise
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="app-page space-y-3">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="app-page-section flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">My Profile</h1>
          <p className="mt-1 text-sm text-text-muted">Your home for favorites, account details, and quick access to the best live content.</p>
        </div>
        <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <span className="flex items-center gap-2">
                <Edit size={16} /> Edit Profile
              </span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Your Profile</DialogTitle>
              <DialogDescription>Make changes to your profile here. Click save when you&apos;re done.</DialogDescription>
            </DialogHeader>
            <EditProfileForm user={user} onSubmit={handleProfileUpdate} isLoading={isUpdating} onCancel={() => setIsEditModalOpen(false)} />
          </DialogContent>
        </Dialog>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }} className="app-page-card overflow-hidden border-border bg-surface/70 p-0">
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-5">
            <Avatar className="h-20 w-20 border-2 border-accent" isLoading={isUpdating}>
              <AvatarImage src={user.avatar ? buildCloudinaryUrl(user.avatar) : undefined} alt={user.fullName ?? 'User Profile'} />
              <AvatarFallback name={user.fullName ?? user.email ?? ''} className="text-2xl" />
            </Avatar>
            <div>
              <CardTitle className="text-2xl">{user.fullName}</CardTitle>
              <p className="text-text-muted">{user.email}</p>
              {isPremium && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-surface-soft/80 px-3 py-1 text-sm text-text-primary">
                  <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
                    <ShieldCheck className="h-4 w-4 text-accent" />
                  </motion.div>
                  Premium member
                </div>
              )}
            </div>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 md:w-auto">
            <div className="rounded-2xl border border-border bg-surface-soft/80 p-4">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
                  <CalendarClock className="h-4 w-4 text-accent" />
                </motion.div>
                Member since
              </div>
              <p className="mt-2 text-sm text-text-muted">{new Date(user.createdAt).toLocaleDateString()}</p>
            </div>
            <div className="rounded-2xl border border-border bg-surface-soft/80 p-4">
              <div className="flex items-center gap-2 text-sm text-text-primary">
                <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
                  <BellRing className="h-4 w-4 text-accent" />
                </motion.div>
                Alerts
              </div>
              <p className="mt-2 text-sm text-text-muted">Live updates enabled</p>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="app-page-section grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border bg-surface-soft/70 p-5">
          <div className="flex items-center gap-2 text-text-primary">
            <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-accent" />
            </motion.div>
            <h2 className="text-lg font-semibold">Quick access</h2>
          </div>
          <p className="mt-2 text-sm text-text-muted">Jump straight into live matches, standings, and your favorites.</p>
          <Link to="/matches" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-accent">
            Explore matches
            <motion.div whileHover={{ scale: 1.15, x: 3 }} className="flex items-center justify-center">
              <ArrowRight className="h-4 w-4" />
            </motion.div>
          </Link>
        </Card>
        <Card className="flex flex-col border-border bg-surface-soft/70 p-5">
          <CardContent className="grow p-0">
            <div className="flex items-center gap-2 text-text-primary">
              <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
                <Crown className="h-4 w-4 text-accent" />
              </motion.div>
              <h2 className="text-lg font-semibold">Subscription Status</h2>
            </div>
            {isPremium && activeSubscription ? (
              <p className="mt-2 text-sm text-text-muted">
                Status: <strong>ACTIVE</strong>. Plan: <strong>{activeSubscription.plan.name}</strong>. Price: <strong>{activeSubscription.plan.price} BDT</strong>. Started: <strong>{new Date(activeSubscription.startedAt).toLocaleString()}</strong>. Your access is valid until{' '}
                <strong>{subscriptionEndDate}</strong>.
              </p>
            ) : user.subscription?.status === 'EXPIRED' ? (
              <p className="mt-2 text-sm text-text-muted">Status: EXPIRED. Your previous <strong>{user.subscription.plan.name}</strong> plan has ended.</p>
            ) : (
              <p className="mt-2 text-sm text-text-muted">You are on the free plan. Upgrade to unlock premium content.</p>
            )}
          </CardContent>
          <CardFooter className="p-0 pt-4">
            <Link to="/subscriptions" className="inline-flex items-center gap-2 text-sm font-medium text-accent">
              {isPremium ? 'Manage Subscription' : 'Upgrade to Premium'}
              <motion.div whileHover={{ scale: 1.15, x: 3 }} className="flex items-center justify-center">
                <ArrowRight className="h-4 w-4" />
              </motion.div>
            </Link>
          </CardFooter>
        </Card>

        <Card className="border-border bg-surface-soft/70 p-5">
          <div className="flex items-center gap-2 text-text-primary">
            <BellRing className="h-4 w-4 text-accent" />
            <h2 className="text-lg font-semibold">Preferences</h2>
          </div>
          <p className="mt-2 text-sm text-text-muted">Custom alerts and saved matches are kept ready for your next session.</p>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }} className="app-page-card border-border bg-surface-soft/70 p-5">
        <div className="flex items-center gap-2 text-text-primary">
          <h2 className="text-lg font-semibold">Recently Watched</h2>
        </div>
        <div className="mt-4">
          <RecentChannels recentChannelIds={recentChannelIds} />
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }} className="app-page-card border-border bg-surface-soft/70 p-5">
        <div className="flex items-center gap-2 text-text-primary">
          <motion.div whileHover={{ scale: 1.15, rotate: 5 }} className="flex items-center justify-center">
            <CreditCard className="h-4 w-4 text-accent" />
          </motion.div>
          <h2 className="text-lg font-semibold">Billing</h2>
        </div>
        <p className="mt-2 text-sm text-text-muted">Review your subscription payments and transaction history.</p>
        <Link to="/profile/payment-history" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-accent">
          View Payment History <ArrowRight className="h-4 w-4" />
        </Link>
      </motion.div>
    </motion.div>
  )
}