import { useState } from 'react'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/Button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { Input } from '../../components/ui/Input'
import { useResetPasswordMutation } from '../../features/auth/auth.api'
import brandMark from '../../assets/logo.png.jpeg'
import { OtpCodeInput } from '../../components/auth/OtpCodeInput'

const resetPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  otp: z.string().regex(/^\d{6}$/, 'Reset code must be exactly 6 digits.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(8, 'Please confirm your password.'),
}).refine((values) => values.password === values.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
})

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export default function ResetPasswordPage() {
  const location = useLocation()
  const [resetPassword, { isLoading, error }] = useResetPasswordMutation()
  const [isSuccess, setIsSuccess] = useState(false)
  const emailFromState = (location.state as { email?: string } | null)?.email ?? ''

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: emailFromState, otp: '', password: '', confirmPassword: '' },
  })

  const apiError = typeof error === 'object' && error !== null && 'data' in error
    ? (error as FetchBaseQueryError & { data?: { message?: string } }).data?.message
    : undefined

  const onSubmit = async (values: ResetPasswordFormValues) => {
    try {
      await resetPassword({ email: values.email, otp: values.otp, password: values.password }).unwrap()
      setIsSuccess(true)
      toast.success('Password reset successfully.')
    } catch {
      toast.error('Unable to reset password. Check the code and try again.')
    }
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden auth-bg-light px-4 py-5 text-slate-900 sm:px-6 lg:px-8 dark:auth-bg-dark dark:text-slate-100">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative mx-auto flex w-full max-w-lg flex-col gap-6 overflow-hidden rounded-4xl border border-(--border) bg-(--surface)/90 p-6 shadow-[0_30px_90px_rgba(2,6,23,0.28)] backdrop-blur-2xl sm:p-8">
        <div className="flex items-center justify-center border-b border-(--border) pb-6">
          <img src={brandMark} alt="SportZoneBD" className="h-auto w-48 max-w-[72%] object-contain sm:w-56" />
        </div>
        <div className="grid gap-2 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight text-text-primary"><motion.span whileHover={{ scale: 1.1, rotate: 5 }} className="text-accent"><KeyRound className="h-6 w-6" /></motion.span>Reset Password</h1>
          <p className="text-balance text-sm leading-6 text-text-muted">Enter the six-digit code from your email and choose a new password.</p>
        </div>
        {isSuccess ? (
          <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-green-200/80 bg-green-50/80 p-4 text-center text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8" />
            <p className="font-semibold">Password updated</p>
            <p className="mt-1">Your password has been reset. Sign in with your new password.</p>
            <Button asChild className="mt-3 w-full"><Link to="/login">Back to Sign In</Link></Button>
          </motion.div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" autoComplete="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="otp" render={({ field }) => (
                <FormItem><FormLabel>Reset code</FormLabel><FormControl><OtpCodeInput value={field.value} onChange={field.onChange} autoFocus error={Boolean(apiError)} disabled={isLoading} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem><FormLabel>New password</FormLabel><FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                <FormItem><FormLabel>Confirm password</FormLabel><FormControl><Input type="password" autoComplete="new-password" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {apiError && <motion.div role="alert" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={16} /> {apiError}</motion.div>}
              <Button type="submit" className="w-full rounded-2xl btn-auth-gradient py-3 text-sm font-semibold text-white" isLoading={isLoading}>Reset Password</Button>
            </form>
          </Form>
        )}
        {!isSuccess && <div className="text-center text-sm"><Link to="/login" className="font-medium underline-offset-4 hover:underline">Back to Sign In</Link></div>}
      </motion.div>
    </div>
  )
}
