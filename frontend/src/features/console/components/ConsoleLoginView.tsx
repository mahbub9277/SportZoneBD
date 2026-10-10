import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'

import { Button } from '../../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/Card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import brandMark from '../../../assets/logo.png.webp'

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
})

export type ConsoleLoginValues = z.infer<typeof loginSchema>

interface ConsoleLoginViewProps {
  eyebrow: string
  title: string
  description: string
  emailPlaceholder: string
  /** Resolves to an error to display, or nothing on success. */
  onSubmit: (values: ConsoleLoginValues) => Promise<{ error?: string } | void>
}

/**
 * The sign-in card shared by the moderator and staff consoles, matching the existing admin console
 * styling. It only handles the form state; which endpoint is called and where the session lands is
 * decided by the page that owns it.
 */
export function ConsoleLoginView({ eyebrow, title, description, emailPlaceholder, onSubmit }: ConsoleLoginViewProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)

  const form = useForm<ConsoleLoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const handleSubmit = async (values: ConsoleLoginValues) => {
    setFormError(null)
    const result = await onSubmit(values)
    if (result?.error) {
      setFormError(result.error)
    }
  }

  return (
    <main
      aria-labelledby="console-login-title"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-(--background) px-4 py-8 text-(--text-primary) sm:px-6 lg:px-8"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--hero-glow),transparent_58%)]" />
      <Card className="relative w-full max-w-md overflow-hidden rounded-3xl border border-(--border) bg-(--surface)/95 shadow-[0_28px_90px_var(--shadow)]">
        <CardHeader className="items-center space-y-5 px-6 pt-8 text-center sm:px-8 sm:pt-9">
          <img src={brandMark} alt="SportZoneBD" className="h-auto max-h-16 w-52 max-w-[75%] object-contain" />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--accent)">{eyebrow}</p>
            <CardTitle id="console-login-title" className="text-2xl font-semibold tracking-tight text-(--text-primary) sm:text-3xl">
              {title}
            </CardTitle>
            <p className="text-sm leading-6 text-(--text-muted)">{description}</p>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-8 sm:px-8 sm:pb-9">
          <Form {...form}>
            <form className="space-y-5" onSubmit={form.handleSubmit(handleSubmit)} noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-semibold text-(--text-secondary)">Email address</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="username"
                        placeholder={emailPlaceholder}
                        {...field}
                        className="h-12 border-(--border) bg-(--surface-soft) text-(--text-primary) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--accent) focus-visible:ring-(--accent)/25"
                      />
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
                        <Input
                          type={isPasswordVisible ? 'text' : 'password'}
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          {...field}
                          className="h-12 border-(--border) bg-(--surface-soft) pr-12 text-(--text-primary) shadow-none placeholder:text-(--text-muted) focus-visible:border-(--accent) focus-visible:ring-(--accent)/25"
                        />
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
              {formError && (
                <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <AlertCircle size={16} aria-hidden="true" /> {formError}
                </div>
              )}
              <Button
                type="submit"
                variant="neon"
                className="mt-2 h-12 w-full rounded-xl py-3 text-base font-semibold"
                isLoading={form.formState.isSubmitting}
                aria-busy={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? 'Signing In...' : 'Sign In'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  )
}
