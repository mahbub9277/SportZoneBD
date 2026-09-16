import { useState } from 'react'
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/Button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../../components/ui/Form'
import { Input } from '../../../components/ui/Input'
import { useRegisterMutation } from '../../../features/auth/auth.api.ts'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'

const registerSchema = z.object({
  fullName: z.string().min(3, { message: 'Full name must be at least 3 characters.' }),
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
})

type RegisterFormValues = z.infer<typeof registerSchema>

export function RegisterForm() {
  const navigate = useNavigate()
  const [register, { isLoading, }] = useRegisterMutation()
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
    },
  })

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      await register(values).unwrap();
      toast.success('Verification code sent! Please check your email.');
      navigate('/verify-email', { state: { email: values.email } });
    } catch (err) {
      const apiError = typeof err === 'object' && err !== null && 'data' in err
        ? (err as FetchBaseQueryError & { data?: { message?: string } }).data?.message ?? 'An unexpected error occurred.'
        : 'An unexpected error occurred.';
      
      // To prevent user enumeration, avoid specific messages like "Email already exists".
      const displayMessage = apiError.toLowerCase().includes('email') ? 'This email may not be available. Please try another.' : apiError;
      form.setError('root.serverError', { type: 'manual', message: displayMessage });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-semibold text-text-primary">Full name</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="Your Name" className="min-h-11 bg-(--surface-soft)/70 shadow-[0_8px_24px_var(--shadow)] focus:bg-(--surface)" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
                  <Input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Create a password" className="min-h-11 bg-(--surface-soft)/70 pr-12 shadow-[0_8px_24px_var(--shadow)] focus:bg-(--surface)" {...field} />
                  <Button type="button" variant="ghost" size="icon" aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full text-text-muted hover:bg-(--surface) hover:text-accent" onClick={() => setShowPassword(prev => !prev)}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </Button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root?.serverError && <div role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={16} /> {form.formState.errors.root.serverError.message}</div>}
        <Button type="submit" className="min-h-11 w-full rounded-2xl btn-auth-gradient py-3 text-sm font-semibold text-white shadow-[0_16px_35px_-16px_rgba(14,165,233,0.65)] transition-transform hover:-translate-y-0.5" isLoading={isLoading}>Create Account</Button>
      </form>
    </Form>
  )
}