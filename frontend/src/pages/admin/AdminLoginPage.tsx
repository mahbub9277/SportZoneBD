import { useState } from 'react'
import { useActionData, useNavigation, Form as RouterForm } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'

import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { Input } from '../../components/ui/Input'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import brandMark from '../../assets/logo.png.webp'

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function AdminLoginPage() {
  const actionData = useActionData() as { error?: string } | undefined
  const navigation = useNavigation()
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const isSubmitting = navigation.state === 'submitting'

  return (
    <main aria-labelledby="admin-login-title" className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-(--background) px-4 py-8 text-(--text-primary) sm:px-6 lg:px-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--hero-glow),transparent_58%)]" />
      <Card className="relative w-full max-w-md overflow-hidden rounded-3xl border border-(--border) bg-(--surface)/95 shadow-[0_28px_90px_var(--shadow)]">
        <CardHeader className="items-center space-y-5 px-6 pt-8 text-center sm:px-8 sm:pt-9">
          <img src={brandMark} alt="SportZoneBD" className="h-auto max-h-16 w-52 max-w-[75%] object-contain" />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--accent)">Admin console</p>
            <CardTitle id="admin-login-title" className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">Administrator sign in</CardTitle>
            <p className="text-sm leading-6 text-(--text-muted)">Sign in to manage the SportZoneBD platform.</p>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-8 sm:px-8 sm:pb-9">
          <Form {...form}>
            <RouterForm method="post" className="space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-(--text-secondary)">Email address</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="username" placeholder="admin@sportzone.com" {...field} className="h-12 border-(--border) bg-(--surface-soft) text-(--text-primary) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--accent) focus-visible:ring-(--accent)/25" />
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
                      <FormLabel className="text-sm font-semibold text-(--text-secondary)">Password</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input type={isPasswordVisible ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" {...field} className="h-12 border-(--border) bg-(--surface-soft) pr-12 text-(--text-primary) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--accent) focus-visible:ring-(--accent)/25" />
                        </FormControl>
                        <button
                          type="button"
                          aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                          aria-pressed={isPasswordVisible}
                          onClick={() => setIsPasswordVisible((visible) => !visible)}
                          className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-md text-(--text-muted) hover:text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--accent)"
                        >
                          {isPasswordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                        </button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {actionData?.error && (
                  <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    <AlertCircle size={16} /> {actionData.error}
                  </div>
                )}
                <Button
                  type="submit"
                  variant="neon"
                  className="mt-2 h-12 w-full rounded-xl py-3 text-base font-semibold"
                  isLoading={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? 'Signing In...' : 'Sign In'}
                </Button>
            </RouterForm>
          </Form>
        </CardContent>
      </Card>
    </main>
  )
}