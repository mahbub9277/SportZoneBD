import { Outlet } from 'react-router-dom';
import { Suspense, useState } from 'react';
import { AdminSidebar } from '../../../features/admin/AdminSidebar';
import { AdminHeader } from '../../../features/admin/AdminHeader';
import { GlobalLoadingIndicator } from '../../../components/shared/GlobalLoadingIndicator';
import { cn } from '../../../lib/utils';
import { SocketProvider } from '../../useSocket';

const AdminLayout = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <SocketProvider>
      <div className="min-h-screen bg-brand-background text-brand-text-primary">
        {/* Desktop Sidebar */}
        <AdminSidebar />

        {/* Mobile Sidebar */}
        <div
          className={cn(
            'fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 lg:hidden',
            isMobileSidebarOpen ? 'opacity-100 pointer-events-auto' : 'pointer-events-none opacity-0'
          )}
          onClick={() => setIsMobileSidebarOpen(false)}
        />
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-[min(24rem,calc(100vw-1rem))] transform transition-transform duration-300 lg:hidden [&>aside]:flex [&>aside]:h-full [&>aside]:w-full',
            isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <AdminSidebar isMobile onNavigate={() => setIsMobileSidebarOpen(false)} />
        </div>
        
        <div className="flex min-h-screen flex-col lg:ml-80">
          <AdminHeader onMobileMenuClick={() => setIsMobileSidebarOpen(true)} />
          <main className="flex-1 p-4 sm:p-6 lg:p-8">
            <Suspense fallback={<GlobalLoadingIndicator force />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </SocketProvider>
  );
};

export default AdminLayout;