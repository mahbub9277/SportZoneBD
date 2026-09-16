import { toast } from 'sonner'

export function useToast(): { toast: typeof toast } {
  return { toast }
}

export type ToastOptions = Parameters<typeof toast>[0]

export { toast }
