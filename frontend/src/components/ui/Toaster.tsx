import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[rgba(10,16,28,0.9)] group-[.toaster]:border group-[.toaster]:border-(--border) group-[.toaster]:text-(--text-primary) group-[.toaster]:shadow-[0_24px_80px_rgba(2,6,23,0.24)]',
          title: 'text-(--text-primary)',
          description: 'text-(--text-muted)',
          actionButton: 'bg-(--accent) text-slate-950',
          cancelButton: 'bg-(--surface-soft) text-(--text-primary)',
          closeButton: 'bg-(--surface-soft) text-(--text-primary) border-(--border)',
        },
      }}
    />
  )
}

export { SonnerToaster as ToasterBase }
