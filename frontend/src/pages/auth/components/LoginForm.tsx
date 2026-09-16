import { useState } from 'react'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { authApi, useLoginMutation } from '../../../features/auth/auth.api.ts'
import { useAppDispatch } from '../../../app/hooks'
import { setCredentials } from '../../../features/auth/authSlice'
import { Checkbox } from '../../../components/ui/Checkbox'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
  rememberMe: z.boolean().default(false).optional(),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const [login, { isLoading, error }] = useLoginMutation()
  const [showPassword, setShowPassword] = useState(false)
  const dispatch = useAppDispatch()

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: true,
    },
  })

  const apiError = typeof error === 'object' && error !== null && 'data' in error
    ? (error as FetchBaseQueryError & { data?: { message?: string } }).data?.message
    : undefined

  const onSubmit = async (values: LoginFormValues) => {
    try {
      const loginResponse = await login({ email: values.email, password: values.password }).unwrap()
      const user = loginResponse?.user ?? null

      if (user) {
        dispatch(setCredentials({ user, rememberMe: values.rememberMe }))
      }

      const refreshedUser = await dispatch(authApi.endpoints.getMe.initiate(undefined, { forceRefetch: true })).unwrap()
      dispatch(setCredentials({ user: refreshedUser, rememberMe: values.rememberMe }))

      toast.success('Login successful! Welcome back.')

      const searchParams = new URLSearchParams(location.search)
      const redirectQuery = searchParams.get('redirect')

      // Security: Validate the redirect URL to prevent open redirects
      const isValidRedirect = (url: string | null): url is string => {
        return url ? url.startsWith('/') && !url.startsWith('//') && !url.includes('..') : false
      }

      const fromState = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
      const destination =
        isValidRedirect(redirectQuery) ? redirectQuery :
        (fromState ? `${fromState.pathname ?? '/'}${fromState.search ?? ''}` : null)

      if (destination) {
        navigate(destination, { replace: true })
        return
      }

      const isAdmin = user?.roles?.some((role) => {
        const roleName = (role.role?.name || role.name || '').toLowerCase();
        return roleName === 'admin' || roleName === 'super_admin';
      });

      navigate(isAdmin ? '/admin' : '/', { replace: true })
    } catch {
      // Error is handled by the apiError display
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-text-primary">Email address</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="name@example.com" className="min-h-11 bg-(--surface-soft)/70 shadow-[0_8px_24px_var(--shadow)] focus:bg-(--surface)" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-text-primary">Password</FormLabel>
              <FormControl>
                <div className="relative">
                  <Input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" className="min-h-11 bg-(--surface-soft)/70 pr-12 shadow-[0_8px_24px_var(--shadow)] focus:bg-(--surface)" {...field} />
                  <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full text-text-muted hover:bg-surface-soft hover:text-accent" onClick={() => setShowPassword(prev => !prev)}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FormField
            control={form.control}
            name="rememberMe"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="text-sm font-normal">Remember me</FormLabel>
              </FormItem>
            )} />
          <Link to="/forgot-password" className="text-sm font-medium text-text-muted underline-offset-4 transition-colors hover:text-accent hover:underline">Forgot password?</Link>
        </div>
        {apiError && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={16} /> {apiError}</div>}
        <Button
          type="submit"
          className="min-h-11 w-full rounded-2xl btn-auth-gradient py-3 text-sm font-semibold text-white shadow-[0_16px_35px_-16px_rgba(14,165,233,0.65)] transition-transform hover:-translate-y-0.5"
          isLoading={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? 'Signing In...' : 'Sign In'}
        </Button>
      </form>
    </Form>
  )
}