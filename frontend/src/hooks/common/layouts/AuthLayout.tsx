import { Outlet } from 'react-router-dom' // Keep Outlet for rendering child routes
import { Suspense } from 'react' // Import Suspense for lazy loading
import { Spinner } from '../../../components/ui/Spinner'

const AuthLayout = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-bg">
      {/* Wrap Outlet with Suspense for lazy-loaded routes */}
      <Suspense fallback={<div className="flex h-screen w-full items-center justify-center"><Spinner size="2rem" /></div>}>
        <Outlet />
      </Suspense>
    </div>
  )
}

export default AuthLayout