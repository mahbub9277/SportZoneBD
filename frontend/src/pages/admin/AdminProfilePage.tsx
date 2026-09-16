import { useState } from 'react'
import { useAuth } from '../../hooks/common/layouts/useAuth'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { ImagePlus, ShieldCheck } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/Avatar'
import { buildCloudinaryUrl } from '../../utils/cloudinary'
import { useUpdateProfileMutation } from '../../features/auth/auth.api'
import { toast } from 'sonner'
import { motion } from 'framer-motion'

type AdminRole = string | { name?: string; role?: { name?: string } }
export function AdminProfilePage() {
  const { user } = useAuth()
  const [updateProfile, { isLoading: isUploading }] = useUpdateProfileMutation()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Avatar must be smaller than 5 MB.')
      return
    }

    const localUrl = URL.createObjectURL(file)
    setPreviewUrl(localUrl)
    const formData = new FormData()
    formData.append('avatar', file)

    try {
      await updateProfile(formData).unwrap()
      setPreviewUrl(null)
      toast.success('Profile photo updated.')
    } catch (error) {
      setPreviewUrl(null)
      toast.error(error instanceof Error ? error.message : 'Unable to update profile photo.')
    } finally {
      URL.revokeObjectURL(localUrl)
    }
  }

  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} whileHover={{ y: -4 }}><Card className="rounded-[1.8rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,199,0,0.18),transparent_40%),rgba(15,23,42,0.95)] shadow-[0_40px_110px_rgba(0,0,0,0.22)]">
        <CardHeader>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <CardTitle className="text-3xl">Admin Profile</CardTitle>
              <p className="mt-2 text-sm text-text-muted">Manage your account and access controls from a premium admin console.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-[0.24em] text-accent">
              <motion.span whileHover={{ scale: 1.15, rotate: 5 }} whileTap={{ scale: 0.9 }}><ShieldCheck size={18} /></motion.span>
              Premium Admin
            </div>
          </div>
          {Array.isArray(user?.roles) && user.roles.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">Roles:</span>
              <span>{user.roles.map((role: unknown) => {
                if (typeof role === 'string') return role
                if (!role || typeof role !== 'object') return ''
                const typedRole = role as AdminRole & object
                return typeof typedRole.name === 'string' ? typedRole.name : typeof typedRole.role?.name === 'string' ? typedRole.role.name : ''
              }).filter(Boolean).join(', ')}</span>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center">
            <div className="grid place-items-center rounded-[1.75rem] border border-border bg-surface-soft/70 p-5 shadow-[0_30px_60px_rgba(247,199,93,0.08)] sm:p-6">
              <label className="group relative cursor-pointer rounded-[1.75rem] focus-within:outline-none focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface-soft">
                <Avatar className="h-28 w-28 border-2 border-accent/40 bg-surface-soft sm:h-32 sm:w-32">
                  <AvatarImage src={previewUrl || buildCloudinaryUrl(user?.avatar)} alt={user?.fullName || 'Admin Avatar'} />
                  <AvatarFallback name={user?.fullName || user?.email || ''} />
                </Avatar>
                <span className="absolute inset-x-2 bottom-2 flex items-center justify-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <motion.span whileHover={{ scale: 1.15, rotate: 5 }}><ImagePlus className="h-3.5 w-3.5" /></motion.span> {isUploading ? 'Uploading' : 'Change photo'}
                </span>
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleAvatarChange} disabled={isUploading} />
              </label>
            </div>
            <div>
              <p className="wrap-break-word text-3xl font-semibold text-text-primary">{user?.fullName}</p>
              <p className="mt-1 break-all text-sm text-text-muted">{user?.email}</p>
            </div>
          </div>
          <div>
            <h3 className="mt-4 font-semibold">Account Details</h3>
            <p className="text-sm text-text-muted">Member since: {new Date(user?.createdAt ?? '').toLocaleDateString()}</p>
          </div>
        </CardContent>
      </Card></motion.div>
    </motion.div>
  )
}