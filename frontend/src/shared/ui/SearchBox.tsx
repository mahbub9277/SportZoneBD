import { useEffect } from 'react'
import { Search } from 'lucide-react'

export function SearchBox({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpen()
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [onOpen])

  return (
    <button
      onClick={onOpen}
      className="group relative flex h-12 w-full items-center rounded-full border-2 border-transparent bg-(--surface-soft) px-4 text-base text-(--text-muted) transition-all hover:bg-(--surface-strong) focus:border-(--accent)/30 focus:bg-(--surface-strong)"
    >
      <Search size={18} className="transition-colors group-hover:text-(--text-primary)" />
      <span className="ml-3">Search...</span>
      <kbd className="absolute right-4 top-1/2 -translate-y-1/2 rounded-md border border-(--border) bg-(--surface) px-2 py-1 text-xs font-medium text-(--text-muted)">
        Ctrl+K
      </kbd>
    </button>
  )
}
