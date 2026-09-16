import { useForm } from 'react-hook-form';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { useForgotPasswordMutation } from '../../features/auth/auth.api.ts';
import { AlertCircle, ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import brandMark from '../../assets/logo.png.jpeg'

const forgotPasswordSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
});

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [forgotPassword, { isLoading, error, isSuccess }] = useForgotPasswordMutation();

  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const apiError = typeof error === 'object' && error !== null && 'data' in error
    ? (error as FetchBaseQueryError & { data?: { message?: string } }).data?.message
    : undefined;

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      await forgotPassword(values).unwrap();
      toast.success('If an account with that email exists, a reset code has been sent.');
      navigate('/reset-password', { state: { email: values.email } });
    } catch {
      // Error is handled by the apiError display, but we can toast a generic one too
      toast.error('An error occurred. Please try again.');
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden auth-bg-light px-4 py-5 text-slate-900 sm:px-6 lg:px-8 dark:auth-bg-dark dark:text-slate-100">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative mx-auto flex w-full max-w-md flex-col gap-5 overflow-hidden rounded-4xl border border-(--border) bg-(--surface)/85 p-5 shadow-[0_30px_90px_rgba(2,6,23,0.24)] backdrop-blur-2xl sm:p-7"
      >
        <div className="flex items-center justify-center border-b border-(--border) pb-5">
          <img src={brandMark} alt="SportZoneBD" className="h-auto w-44 max-w-[68%] object-contain sm:w-52" />
        </div>
        <div className="grid gap-2 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-semibold tracking-tight text-text-primary"><motion.span whileHover={{ scale: 1.1, rotate: 5 }} className="text-accent"><Mail className="h-6 w-6" /></motion.span>Forgot Password</h1>
          <p className="text-balance text-sm text-text-muted">
            Enter your email and we'll send you a 6-digit code to reset your password.
          </p>
        </div>
        {isSuccess ? (
          <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-green-200/80 bg-green-50/80 p-4 text-center text-sm text-green-800 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}><CheckCircle2 className="mx-auto mb-2 h-8 w-8" /></motion.div>
            <p className="font-semibold">Request sent!</p>
            <p className="mt-1">If an account with that email exists, a password reset code has been sent.</p>
            <Button asChild variant="link" className="mt-2 text-green-800 dark:text-green-200">
              <Link to="/login">Back to Sign In</Link>
            </Button>
          </motion.div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="name@example.com"
                        className="shadow-nav-active"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              {apiError && <motion.div role="alert" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><AlertCircle size={16} /> {apiError}</motion.div>}
              <Button type="submit" className="w-full rounded-2xl btn-auth-gradient py-3 text-sm font-semibold text-white shadow-[0_16px_35px_-16px_rgba(14,165,233,0.65)]" isLoading={isLoading}><span className="inline-flex items-center gap-2">Send Reset Code <ArrowRight className="h-4 w-4" /></span></Button>
            </form>
          </Form>
        )}
        <div className="text-center text-sm">
          <Link to="/login" className="font-medium text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white">
            Back to Sign In
          </Link>
        </div>
      </motion.div>
    </div>
  );
}