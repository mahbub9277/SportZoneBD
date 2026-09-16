import { useState, useEffect } from 'react';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '../../components/ui/Button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '../../components/ui/Form';
import { Input } from '../../components/ui/Input';
import { useVerifyEmailMutation, useResendOtpMutation } from '../../features/auth/auth.api.ts';
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import brandMark from '../../assets/logo.png.jpeg'
import { OtpCodeInput } from '../../components/auth/OtpCodeInput'

const verifyEmailSchema = z.object({
  otp: z.string().length(6, { message: 'OTP must be 6 digits.' }),
});

type VerifyEmailFormValues = z.infer<typeof verifyEmailSchema>;

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email;

  const [verifyEmail, { isLoading, error }] = useVerifyEmailMutation();
  const [resendOtp, { isLoading: isResending }] = useResendOtpMutation();
  const [cooldown, setCooldown] = useState(0);
  const [isVerified, setIsVerified] = useState(false);

  const form = useForm<VerifyEmailFormValues>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: {
      otp: '',
    },
  });

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldown > 0) {
      timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!isVerified) return

    const navigationTimer = window.setTimeout(() => navigate('/'), 900)
    return () => window.clearTimeout(navigationTimer)
  }, [isVerified, navigate]);

  const handleResendOtp = async () => {
    try {
      await resendOtp({ email }).unwrap();
      toast.success('A new OTP has been sent.');
      setCooldown(60); // Start 60-second cooldown
    } catch (resendError) {
      const message = typeof resendError === 'object' && resendError !== null && 'data' in resendError
        ? (resendError as FetchBaseQueryError & { data?: { message?: string } }).data?.message
        : 'Unable to resend the code. Please try again.';
      toast.error(message);
    }
  };

  if (!email) {
    return (
      <div className="text-center">
        <p>No email provided. Please start the registration process again.</p>
        <Link to="/login" className="underline mt-4 inline-block">Back to Login</Link>
      </div>
    );
  }

  const apiError = typeof error === 'object' && error !== null && 'data' in error
    ? (error as FetchBaseQueryError & { data?: { message?: string } }).data?.message
    : undefined;

  const onSubmit = async (values: VerifyEmailFormValues) => {
    try {
      await verifyEmail({ email, otp: values.otp }).unwrap();
      toast.success('Account verified successfully! Welcome.');
      setIsVerified(true);
    } catch (error) {
      const message = typeof error === 'object' && error !== null && 'data' in error
        ? (error as FetchBaseQueryError & { data?: { message?: string } }).data?.message
        : 'Verification failed. Please try again.'
      toast.error(message);
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
          <h1 className="flex items-center justify-center gap-2 text-3xl font-semibold tracking-tight text-text-primary"><motion.span whileHover={{ scale: 1.1, rotate: 5 }} className="text-accent"><ShieldCheck className="h-6 w-6" /></motion.span>Verify Your Email</h1>
          <p className="text-balance text-sm text-text-muted">
            We've sent a 6-digit code to <strong>{email}</strong>. Please enter it below.
          </p>
        </div>
        {isVerified ? (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, type: 'spring', stiffness: 180 }}
            className="flex flex-col items-center gap-3 rounded-3xl border border-emerald-200/70 bg-emerald-50/80 px-5 py-8 text-center text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.15, duration: 0.4, type: 'spring', stiffness: 220 }}
              className="grid h-16 w-16 place-items-center rounded-full bg-linear-to-br from-emerald-400 to-green-600 text-white shadow-[0_10px_28px_rgba(16,185,129,0.3)]"
            >
              <CheckCircle2 className="h-9 w-9" />
            </motion.div>
            <div>
              <h2 className="text-lg font-semibold">Email verified successfully</h2>
              <p className="mt-1 text-sm opacity-80">Taking you to your home page...</p>
            </div>
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.25, duration: 0.7, ease: 'easeOut' }}
              className="h-1 w-full origin-left overflow-hidden rounded-full bg-emerald-500/30"
            >
              <div className="h-full w-full rounded-full bg-emerald-500" />
            </motion.div>
          </motion.div>
        ) : (
        <Form {...form}>
          <motion.form initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="otp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Verification Code</FormLabel>
                  <FormControl>
                    <OtpCodeInput value={field.value} onChange={field.onChange} autoFocus error={Boolean(apiError)} disabled={isLoading} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            {apiError && <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} role="alert" className="flex items-center gap-2 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"><motion.div whileHover={{ scale: 1.1, rotate: -5 }}><AlertCircle size={16} /></motion.div> {apiError}</motion.div>}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}><Button className="w-full rounded-2xl btn-auth-gradient py-3 text-sm font-semibold text-white shadow-[0_16px_35px_-16px_rgba(14,165,233,0.65)]" isLoading={isLoading}>Verify Account</Button></motion.div>
          </motion.form>
        </Form>
        )}
        {!isVerified && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="text-center text-sm">
          <Button
            type="button"
            variant="link"
            onClick={handleResendOtp}
            disabled={isResending || cooldown > 0}
            className="font-medium text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white"
          >
            <span className="inline-flex items-center gap-2"><motion.span animate={isResending ? { rotate: 360 } : undefined} transition={isResending ? { repeat: Infinity, duration: 1, ease: 'linear' } : undefined}><RefreshCw className="h-4 w-4" /></motion.span>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Did not receive a code? Resend'}</span>
          </Button>
        </motion.div>}
      </motion.div>
    </div>
  );
}