import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, LogIn, UserPlus } from 'lucide-react'

import { Button } from '../../components/ui/Button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/Tabs'
import { LoginForm } from './components/LoginForm'
import { RegisterForm } from './components/RegisterForm'
import brandMark from '../../assets/logo.png.webp'

const LoginPage = () => {
  const shouldReduceMotion = useReducedMotion()
  const [isGoogleLoginStarting, setIsGoogleLoginStarting] = useState(false)
  const handleGoogleLogin = () => {
    if (isGoogleLoginStarting) return
    setIsGoogleLoginStarting(true)
    const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api/v1'
    const googleAuthUrl = `${apiBaseUrl.replace(/\/$/, '')}/auth/google`
    window.location.assign(googleAuthUrl)
  }

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden auth-bg-light px-4 py-5 text-text-primary sm:px-6 lg:px-8 dark:auth-bg-dark" aria-labelledby="login-page-title">
      <motion.div
        animate={shouldReduceMotion ? undefined : { y: [0, -12, 0], x: [0, 10, 0], scale: [1, 1.03, 1] }}
        transition={shouldReduceMotion ? undefined : { duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -left-14 top-10 h-56 w-56 rounded-full bg-(--accent-secondary)/15 blur-3xl"
      />
      <motion.div
        animate={shouldReduceMotion ? undefined : { y: [0, 16, 0], x: [0, -12, 0], scale: [1, 1.04, 1] }}
        transition={shouldReduceMotion ? undefined : { duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute bottom-8 right-0 h-72 w-72 rounded-full bg-(--accent)/10 blur-3xl"
      />
      <div className="w-full max-w-2xl py-2 sm:py-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="relative mx-auto flex w-full flex-col gap-5 overflow-hidden rounded-4xl border border-(--border) bg-(--surface)/90 p-5 shadow-[0_30px_90px_var(--shadow)] backdrop-blur-2xl sm:p-8"
        >
          <div className="flex items-center justify-center border-b border-(--border) pb-5">
            <img src={brandMark} alt="SportZoneBD" className="h-auto w-44 max-w-[68%] object-contain sm:w-52" />
          </div>
          <div className="space-y-3 text-center">
            <div className="space-y-2">
              <h1 id="login-page-title" className="text-3xl font-semibold tracking-tight text-text-primary sm:text-4xl">Welcome to SportZoneBD</h1>
              <p className="mx-auto max-w-xl text-sm leading-6 text-text-muted">
                Sign in or create an account to enjoy live sports, curated highlights, and premium match coverage.
              </p>
            </div>
          </div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}><Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 gap-2 rounded-2xl border border-(--border) bg-(--surface-soft)/60 p-1.5 backdrop-blur-sm">
              <TabsTrigger value="login" className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted data-[state=active]:bg-(--surface) data-[state=active]:text-text-primary data-[state=active]:shadow-sm">
                <motion.span whileHover={{ scale: 1.1 }} className="mr-2 inline-flex"><LogIn className="h-4 w-4" /></motion.span>
                Sign In
              </TabsTrigger>
              <TabsTrigger value="register" className="rounded-xl px-3 py-2 text-sm font-semibold text-text-muted data-[state=active]:bg-(--surface) data-[state=active]:text-text-primary data-[state=active]:shadow-sm">
                <motion.span whileHover={{ scale: 1.1 }} className="mr-2 inline-flex"><UserPlus className="h-4 w-4" /></motion.span>
                Sign Up
              </TabsTrigger>
            </TabsList>
            <TabsContent value="login" className="pt-3">
              <LoginForm />
            </TabsContent>
            <TabsContent value="register" className="pt-3">
              <RegisterForm />
            </TabsContent>
          </Tabs></motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }} className="relative py-2 text-center">
            <div className="absolute inset-x-8 top-1/2 h-px bg-slate-300/70 dark:bg-slate-700/70" />
            <span className="relative inline-flex bg-(--surface)/90 px-4 text-[11px] uppercase tracking-[0.28em] text-text-muted">
              Or continue with
            </span>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
            <Button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isGoogleLoginStarting}
              variant="outline"
              className="min-h-11 w-full rounded-2xl border border-(--border) bg-(--surface-soft)/70 py-3 text-sm font-semibold text-text-primary shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-(--surface)"
              aria-label="Continue with Google"
            >
              <motion.div className="flex items-center justify-center" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                <svg xmlns="http://www.w3.org/2000/svg" className="mr-2 h-4 w-4" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path><path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path><path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path><path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C42.021,35.846,44,30.138,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path></svg>
              </motion.div>
              {isGoogleLoginStarting ? 'Opening Google...' : 'Continue with Google'}
            </Button>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }} className="text-center text-sm">
            <Link to="/" className="font-medium text-text-muted underline-offset-4 transition-colors hover:text-text-primary hover:underline">
              <span className="inline-flex items-center gap-1">Continue as Guest <motion.span whileHover={{ x: 3 }}><ArrowRight className="h-4 w-4" /></motion.span></span>
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </main>
  )
}

export default LoginPage