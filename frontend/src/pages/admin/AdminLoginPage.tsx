import { useActionData, useNavigation, Form as RouterForm, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'

import { Button } from '../../components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form'
import { Input } from '../../components/ui/Input'
import { AlertCircle, Trophy } from 'lucide-react'

const loginSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters.' }),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function AdminLoginPage() {
  const actionData = useActionData() as { error?: string } | undefined
  const navigation = useNavigation()

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const isSubmitting = navigation.state === 'submitting'

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#07111d] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(4,116,196,0.18),transparent_34%),linear-gradient(145deg,#07111d,#0d1527)]" aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        <Card className="overflow-hidden rounded-3xl border border-white/12 bg-[#0d1527]/80 text-white shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <CardHeader className="space-y-4 px-6 pt-7 text-center sm:px-8 sm:pt-8">
            <div className="inline-flex items-center justify-center gap-3 rounded-full border border-[#0474C4]/35 bg-[#0474C4]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#8ed7ff]">
              <Trophy className="h-5 w-5" />
              Admin console
            </div>
            <div className="flex items-center justify-center gap-2">
              <Trophy className="h-7 w-7 text-[#7ec8ff]" />
              <CardTitle className="text-2xl font-bold tracking-tight text-white">SportZoneBD</CardTitle>
            </div>
            <p className="text-sm text-white/60">Sign in to manage the SportZoneBD platform.</p>
          </CardHeader>
          <CardContent className="px-6 pb-7 sm:px-8 sm:pb-8">
            <Form {...form}>
              <RouterForm method="post" className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-semibold text-white/80">Email address</FormLabel>
                      <FormControl>
                        <Input placeholder="admin@sportzone.com" {...field} className="h-11 border-white/12 bg-black/20 text-white shadow-none placeholder:text-white/35 focus-visible:border-[#0474C4] focus-visible:ring-2 focus-visible:ring-[#0474C4]/30" />
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
                      <FormLabel className="text-sm font-semibold text-white/80">Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Enter your password" {...field} className="h-11 border-white/12 bg-black/20 text-white shadow-none placeholder:text-white/35 focus-visible:border-[#0474C4] focus-visible:ring-2 focus-visible:ring-[#0474C4]/30" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {actionData?.error && (
                  <div className="flex items-center gap-2 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    <AlertCircle size={16} /> {actionData.error}
                  </div>
                )}
                <Button
                  type="submit"
                  variant="neon"
                  className="mt-2 h-11 w-full rounded-2xl border border-[#0474C4]/40 bg-[#0474C4] py-3 text-base font-semibold text-white shadow-[0_16px_35px_-16px_rgba(4,116,196,0.7)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#1689d4] hover:shadow-xl"
                  isLoading={isSubmitting}
                  aria-busy={isSubmitting}
                >
                  {isSubmitting ? 'Signing In...' : 'Sign In'}
                </Button>
                <div className="text-center text-sm">
                  <Link to="/forgot-password" className="text-sm text-white/55 underline-offset-4 transition-colors hover:text-[#8ed7ff] hover:underline">
                    Forgot your password?
                  </Link>
                </div>
              </RouterForm>
            </Form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}